/**
 * Receipt <-> payout reconciliation for the deployed ledger. Read-only: EVM `eth_call` and
 * `eth_getLogs`, and Native smart queries over the LCD. No key is read and nothing is sent.
 *
 * Lists every `qday-receipts` receipt, keeps only those whose sender is the ledger's own qor1
 * address, and matches them both ways against `HavenLedger.payout(i)` and the `Moved` events.
 * Prints the result and exits non-zero on any mismatch.
 *
 * When `deployments/ledger-qor.json` records a finished native-QOR ledger, it is reconciled the
 * same way, and each matched QOR payout's recipient must show the same amount as an x/bank `uqor`
 * change across the payout's block (read at historical heights over the LCD).
 */
import { readFileSync } from "node:fs";
import { TESTNET } from "haven-pq-kit/network";
import { decodeEventLog, getAddress, type Abi, type Address, type Hex } from "viem";
import { reconcile, type PayoutRow, type ReceiptRow } from "../src/ts/receipt.js";
import { evmClient } from "./lib/chain.js";
import { UQOR_WEI, bankDelta } from "./lib/native.js";
import { QOR_ARTIFACT, QOR_DEPLOY, qorLedgerDoc, qorLedgerExists } from "./lib/qor.js";

/** `eth_getLogs` on Diana refuses a range wider than 10,000 blocks. */
const LOG_SPAN = 10_000n;

const compiled = JSON.parse(readFileSync("out/HavenLedger.sol/HavenLedger.json", "utf8")) as { abi: Abi };

type LedgerDoc = {
  ledger: Address;
  ledgerAccount: string;
  transactions: { hash: string; note: string }[];
  constructorArgs: { payer: Address; payee: Address; receipts: string };
};

type Target = {
  label: string;
  file: string;
  abi: Abi;
  doc: LedgerDoc;
  /** The recipient's qor1 address, for a ledger whose payouts are x/bank `uqor`. */
  bankAccount?: (to: string) => string;
};

async function smart<T>(contract: string, query: unknown): Promise<T> {
  const encoded = Buffer.from(JSON.stringify(query), "utf8").toString("base64");
  const response = await fetch(`${TESTNET.rest}/cosmwasm/wasm/v1/contract/${contract}/smart/${encoded}`, {
    headers: { "user-agent": "haven-ledger" },
  });
  if (!response.ok) throw new Error(`${JSON.stringify(query)} returned ${response.status}`);
  const body = (await response.json()) as { data?: T };
  if (body.data === undefined) throw new Error(`${JSON.stringify(query)} returned no data`);
  return body.data;
}

function field(value: unknown, name: string, index: number): string {
  if (value && typeof value === "object" && name in value) {
    const named = (value as Record<string, unknown>)[name];
    if (named !== undefined) return String(named);
  }
  if (Array.isArray(value) && value[index] !== undefined) return String(value[index]);
  throw new Error(`missing ${name}`);
}

/** Returns the number of mismatches. */
async function reconcileLedger(target: Target): Promise<number> {
  const { doc, abi } = target;
  const ledger = getAddress(doc.ledger);
  const client = evmClient();
  const read = (functionName: string, args: readonly unknown[] = []) =>
    client.readContract({ address: ledger, abi, functionName, args });

  const ledgerAccount = String(await read("ledgerAccount"));
  const book = String(await read("receipts"));
  const payer = getAddress(String(await read("payer")));
  if (ledgerAccount !== doc.ledgerAccount) throw new Error(`ledgerAccount() is ${ledgerAccount}, ${target.file} says ${doc.ledgerAccount}`);
  if (book !== doc.constructorArgs.receipts) throw new Error(`receipts() is ${book}`);

  // Native lane: every receipt in the book.
  const { count } = await smart<{ count: number }>(book, { count: {} });
  const receipts: ReceiptRow[] = [];
  for (let id = 1; id <= count; id++) {
    const row = await smart<{ id: number; sender: string; note: string; height: number }>(book, { receipt: { id } });
    receipts.push({ id: String(row.id), sender: row.sender, note: row.note, height: String(row.height) });
  }

  // EVM lane: every stored payout, then every Moved event since the deploy block.
  const deployHash = doc.transactions.find((tx) => tx.note.startsWith("deploy "))?.hash;
  if (!deployHash) throw new Error(`${target.file} has no deploy transaction`);
  const deployBlock = (await client.getTransactionReceipt({ hash: deployHash as Hex })).blockNumber;
  const latest = await client.getBlockNumber();
  const moved = new Map<string, NonNullable<PayoutRow["moved"]>>();
  const movedBlock = new Map<string, bigint>();
  for (let from = deployBlock; from <= latest; from += LOG_SPAN) {
    const to = from + LOG_SPAN - 1n < latest ? from + LOG_SPAN - 1n : latest;
    const logs = await client.getLogs({ address: ledger, fromBlock: from, toBlock: to });
    for (const log of logs) {
      let event;
      try {
        event = decodeEventLog({ abi, data: log.data, topics: log.topics });
      } catch {
        continue;
      }
      if (event.eventName !== "Moved") continue;
      const args = event.args as unknown;
      const id = field(args, "id", 0);
      if (moved.has(id)) throw new Error(`two Moved events for payout ${id}`);
      moved.set(id, {
        to: field(args, "to", 1),
        refund: field(args, "refund", 2) === "true",
        amount: BigInt(field(args, "amount", 3)),
        receiptId: BigInt(field(args, "receiptId", 4)),
        nativeHeight: BigInt(field(args, "nativeHeight", 5)),
        commitment: field(args, "commitment", 6),
        tx: log.transactionHash ?? "",
      });
      if (log.blockNumber !== null) movedBlock.set(id, log.blockNumber);
    }
  }

  const payoutCount = BigInt(String(await read("payoutCount")));
  const payouts: PayoutRow[] = [];
  for (let id = 0n; id < payoutCount; id++) {
    const stored = await read("payout", [id]);
    const to = getAddress(field(stored, "to", 0));
    payouts.push({
      id,
      to,
      refund: to === payer,
      amount: BigInt(field(stored, "amount", 1)),
      receiptId: BigInt(field(stored, "receiptId", 2)),
      nativeHeight: BigInt(field(stored, "nativeHeight", 3)),
      commitment: field(stored, "commitment", 5),
      moved: moved.get(id.toString()) ?? null,
    });
  }
  for (const id of moved.keys()) {
    if (BigInt(id) >= payoutCount) throw new Error(`Moved event for payout ${id}, but payoutCount() is ${payoutCount}`);
  }

  const result = reconcile(receipts, payouts, ledgerAccount);
  const bankLines: string[] = [];
  if (target.bankAccount) {
    for (const row of result.matched) {
      const block = movedBlock.get(row.payout.toString());
      const payout = payouts.find((item) => item.id === row.payout);
      if (block === undefined || !payout) {
        result.mismatches.push(`payout ${row.payout.toString()}: no block for the bank check`);
        continue;
      }
      const bank = await bankDelta(target.bankAccount(payout.to), block);
      if (BigInt(bank.delta) * UQOR_WEI !== payout.amount) {
        result.mismatches.push(
          `payout ${row.payout.toString()}: bank ${bank.account} changed by ${bank.delta} uqor at ${bank.height}, payout is ${payout.amount.toString()} wei`,
        );
        continue;
      }
      bankLines.push(`bank      payout ${row.payout.toString()} ${bank.account} +${bank.delta} uqor at height ${bank.height}`);
    }
  }
  console.log(`== ${target.label}`);
  console.log(`ledger        ${ledger} / ${ledgerAccount}`);
  console.log(`receipt book  ${book} (${count} receipts)`);
  console.log(`EVM           payoutCount() ${payoutCount}, ${moved.size} Moved events in blocks ${deployBlock}..${latest}`);
  console.log("");
  for (const row of result.matched) {
    const kind = row.refund ? "refund" : "pay   ";
    console.log(`match     payout ${row.payout} ${kind} ${row.amount} <-> receipt ${row.receipt}  ${row.tx ?? ""}`);
  }
  for (const line of bankLines) console.log(line);
  for (const row of result.otherSenders) {
    console.log(`not ours  receipt ${row.id} from ${row.sender}`);
  }
  for (const line of result.mismatches) console.log(`MISMATCH  ${line}`);
  console.log("");
  console.log(
    `${result.matched.length} matched, ${result.mismatches.length} mismatched, ${result.otherSenders.length} receipts from other senders ignored`,
  );
  console.log("");
  return result.mismatches.length;
}

async function main(): Promise<void> {
  const fusd = JSON.parse(readFileSync("deployments/ledger.json", "utf8")) as LedgerDoc;
  let mismatches = await reconcileLedger({ label: "fUSD ledger", file: "deployments/ledger.json", abi: compiled.abi, doc: fusd });
  if (qorLedgerExists()) {
    const qor = qorLedgerDoc();
    const doc = JSON.parse(readFileSync(QOR_DEPLOY, "utf8")) as LedgerDoc;
    const abi = (JSON.parse(readFileSync(QOR_ARTIFACT, "utf8")) as { abi: Abi }).abi;
    mismatches += await reconcileLedger({
      label: "QOR ledger",
      file: QOR_DEPLOY,
      abi,
      doc,
      bankAccount: (to) => (getAddress(to) === qor.payer ? qor.payerQor : qor.payeeQor),
    });
  } else {
    console.log(`== QOR ledger: ${QOR_DEPLOY} has no finished deploy, skipped`);
  }
  if (mismatches > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message.split("\n")[0] : error);
  process.exit(1);
});
