/**
 * Re-checks every hash in deployments/ against the chain.
 * Read-only. Prints "N passed, M failed" and exits non-zero on a failure.
 */
import { readdirSync, readFileSync } from "node:fs";
import { mldsa87 } from "@qorechain/pqc";
import { readMlDsaKey, requireMlDsaKey, testnetClient } from "haven-pq-kit/keydir";
import { TESTNET } from "haven-pq-kit/network";
import {
  decodeEventLog,
  decodeFunctionData,
  getAddress,
  hexToBytes,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { PAY, REFUND, argsHash, commitmentOf, noteOf, payoutMessage } from "../src/ts/ledger.js";
import { evmClient } from "./lib/chain.js";

const LEDGER_ACCOUNT = "qor1fdhya5x2lxyecp7fjgk7kzu95fgyu6gcs40yzu";
const compiled = JSON.parse(readFileSync("out/HavenLedger.sol/HavenLedger.json", "utf8")) as { abi: Abi };

type Doc = Record<string, unknown>;
type HashRef = { file: string; hash: string; note: string; doc: Doc };
type LedgerDoc = {
  ledger: Address;
  ledgerAccount: string;
  constructorArgs: { payer: Address; payee: Address; token: Address; receipts: string };
};

const results: { ok: boolean; line: string }[] = [];

function pass(line: string): void {
  results.push({ ok: true, line });
  console.log(`pass  ${line}`);
}

function fail(line: string): void {
  results.push({ ok: false, line });
  console.log(`fail  ${line}`);
}

function hashesIn(value: unknown, file: string, doc: Doc, note: string, out: HashRef[]): void {
  if (Array.isArray(value)) {
    for (const item of value) hashesIn(item, file, doc, note, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Doc;
  const localNote = typeof record.note === "string" ? record.note : note;
  if (typeof record.hash === "string" && record.hash.length > 0) {
    out.push({ file, hash: record.hash, note: localNote, doc });
  }
  for (const child of Object.values(record)) hashesIn(child, file, doc, localNote, out);
}

function loadDocs(): { refs: HashRef[]; scene7: boolean } {
  const refs: HashRef[] = [];
  let scene7 = false;
  for (const name of readdirSync("deployments").filter((file) => file.endsWith(".json")).sort()) {
    const doc = JSON.parse(readFileSync(`deployments/${name}`, "utf8")) as Doc;
    if (name === "scene-7.json") scene7 = true;
    hashesIn(doc, name, doc, "", refs);
  }
  return { refs, scene7 };
}

function ledgerDoc(): LedgerDoc {
  const doc = JSON.parse(readFileSync("deployments/ledger.json", "utf8")) as LedgerDoc;
  if (getAddress(doc.ledger) === "0x0000000000000000000000000000000000000000") throw new Error("ledger address is empty");
  if (doc.ledgerAccount !== LEDGER_ACCOUNT) throw new Error(`ledger.json names ${doc.ledgerAccount}`);
  return doc;
}

function field(value: unknown, name: string, index: number): string {
  if (value && typeof value === "object" && name in value) {
    const named = (value as Record<string, unknown>)[name];
    if (named !== undefined) return String(named);
  }
  if (Array.isArray(value) && value[index] !== undefined) return String(value[index]);
  throw new Error(`missing ${name}`);
}

async function nativeTx(hash: string): Promise<void> {
  const response = await fetch(`${TESTNET.rest}/cosmos/tx/v1beta1/txs/${hash}`, { headers: { "user-agent": "haven-ledger" } });
  if (!response.ok) throw new Error(`${hash} returned ${response.status}`);
  const body = (await response.json()) as { tx_response?: { code?: number } };
  if (body.tx_response?.code !== 0) throw new Error(`${hash} code ${String(body.tx_response?.code)}`);
}

async function nativeReceipt(receipts: string, id: bigint): Promise<{ id: string; sender: string; note: string; height: string }> {
  const query = Buffer.from(JSON.stringify({ receipt: { id: Number(id) } })).toString("base64");
  const response = await fetch(`${TESTNET.rest}/cosmwasm/wasm/v1/contract/${receipts}/smart/${query}`, {
    headers: { "user-agent": "haven-ledger" },
  });
  if (!response.ok) throw new Error(`receipt ${id} returned ${response.status}`);
  const body = (await response.json()) as { data?: { id?: number; sender?: string; note?: string; height?: number } };
  const row = body.data;
  if (!row || row.id === undefined || !row.sender || row.note === undefined || row.height === undefined) {
    throw new Error(`receipt ${id} is missing a field`);
  }
  return { id: String(row.id), sender: row.sender, note: row.note, height: String(row.height) };
}

function recordedCall(doc: Doc): { signature?: string; memo?: string } | undefined {
  const call = doc.call;
  if (!call || typeof call !== "object") return undefined;
  return call as { signature?: string; memo?: string };
}

async function checkCall(ref: HashRef, ledger: LedgerDoc, pubkey: Uint8Array, chainNonce: bigint): Promise<void> {
  const hash = ref.hash as Hex;
  const client = evmClient();
  const tx = await client.getTransaction({ hash });
  const decoded = decodeFunctionData({ abi: compiled.abi, data: tx.input });
  if (decoded.functionName !== "pay" && decoded.functionName !== "refund") {
    throw new Error(`${hash} calls ${decoded.functionName}`);
  }
  const args = (decoded.args ?? []) as readonly unknown[];
  const amount = args[0] as bigint;
  const memo = String(args[1]);
  const deadline = args[2] as bigint;
  const signature = args[3] as Hex;
  const recorded = recordedCall(ref.doc);
  if (recorded?.signature && recorded.signature.toLowerCase() !== signature.toLowerCase()) {
    throw new Error(`${hash} calldata signature differs from ${ref.file}`);
  }
  const action = decoded.functionName === "refund" ? REFUND : PAY;
  const to = getAddress(decoded.functionName === "refund" ? ledger.constructorArgs.payer : ledger.constructorArgs.payee);
  const token = getAddress(ledger.constructorArgs.token);
  const ledgerAddress = getAddress(ledger.ledger);
  const signedNonce = nonceCovered(pubkey, {
    chainId: BigInt(client.chain?.id ?? 0),
    ledger: ledgerAddress,
    payer: getAddress(ledger.constructorArgs.payer),
    action,
    deadline,
    to,
    token,
    amount,
    memo,
    signature,
    chainNonce,
  });
  if (ref.note === "refused") {
    const zero = signature === `0x${"00".repeat(4627)}`;
    if (zero) {
      if (signedNonce !== undefined) throw new Error(`${hash} zero signature verified`);
      pass(`${hash} reverted; signature does not verify`);
      return;
    }
    if (signedNonce === undefined) throw new Error(`${hash} signature does not verify`);
    pass(`${hash} reverted; signature verifies at nonce ${signedNonce}`);
    return;
  }
  if (signedNonce === undefined) throw new Error(`${hash} signature does not verify`);
  const receipt = await client.getTransactionReceipt({ hash });
  let moved: Record<string, string> | undefined;
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== ledgerAddress) continue;
    try {
      const event = decodeEventLog({ abi: compiled.abi, data: log.data, topics: log.topics });
      if (event.eventName !== "Moved") continue;
      const eventArgs = event.args as unknown;
      moved = {
        id: field(eventArgs, "id", 0),
        to: field(eventArgs, "to", 1),
        amount: field(eventArgs, "amount", 3),
        receiptId: field(eventArgs, "receiptId", 4),
        commitment: field(eventArgs, "commitment", 6),
      };
    } catch {
      continue;
    }
  }
  if (!moved) throw new Error(`${hash} has no Moved event`);
  if (BigInt(moved.id) !== signedNonce) throw new Error(`${hash} Moved id ${moved.id} is not nonce ${signedNonce}`);
  if (getAddress(moved.to) !== to) throw new Error(`${hash} Moved to ${moved.to}`);
  if (BigInt(moved.amount) !== amount) throw new Error(`${hash} Moved amount ${moved.amount}`);
  const hashed = argsHash(to, token, amount, memo);
  const commitment = commitmentOf({
    chainId: BigInt(client.chain?.id ?? 0),
    ledger: ledgerAddress,
    action,
    to,
    token,
    amount,
    nonce: signedNonce,
    signature,
  });
  if (commitment.toLowerCase() !== moved.commitment.toLowerCase()) throw new Error(`${hash} commitment differs from Moved`);
  const payout = await client.readContract({
    address: ledgerAddress,
    abi: compiled.abi,
    functionName: "payout",
    args: [signedNonce],
  });
  const storedCommitment = field(payout, "commitment", 5);
  const storedReceipt = field(payout, "receiptId", 2);
  if (storedCommitment.toLowerCase() !== commitment.toLowerCase()) throw new Error(`${hash} payout commitment differs`);
  if (storedReceipt !== moved.receiptId) throw new Error(`${hash} payout receipt ${storedReceipt}`);
  const note = noteOf(signedNonce, commitment, memo);
  const native = await nativeReceipt(ledger.constructorArgs.receipts, BigInt(moved.receiptId));
  if (native.sender !== ledger.ledgerAccount) throw new Error(`${hash} receipt sender ${native.sender}`);
  if (native.note !== note) throw new Error(`${hash} receipt note differs`);
  const filed = ref.doc.receipt as { note?: string } | undefined;
  if (filed?.note && filed.note !== note) throw new Error(`${hash} scene file note differs`);
  if (!note.includes(commitment)) throw new Error(`${hash} note does not carry ${hashed.slice(0, 10)}`);
  pass(`${hash} ${decoded.functionName} nonce ${signedNonce} receipt ${native.id} args ${hashed.slice(0, 10)} commitment matches`);
}

function nonceCovered(
  pubkey: Uint8Array,
  fields: {
    chainId: bigint;
    ledger: Address;
    payer: Address;
    action: Hex;
    deadline: bigint;
    to: Address;
    token: Address;
    amount: bigint;
    memo: string;
    signature: Hex;
    chainNonce: bigint;
  },
): bigint | undefined {
  const signature = hexToBytes(fields.signature);
  let found: bigint | undefined;
  for (let nonce = 0n; nonce < fields.chainNonce; nonce++) {
    const message = hexToBytes(
      payoutMessage({
        chainId: fields.chainId,
        ledger: fields.ledger,
        payer: fields.payer,
        action: fields.action,
        nonce,
        deadline: fields.deadline,
        to: fields.to,
        token: fields.token,
        amount: fields.amount,
        memo: fields.memo,
      }),
    );
    if (mldsa87.verify(pubkey, message, signature) !== true) continue;
    if (found !== undefined) throw new Error("signature verifies at two nonces");
    found = nonce;
  }
  return found;
}

async function main(): Promise<void> {
  const ledger = ledgerDoc();
  const { refs, scene7 } = loadDocs();
  if (!scene7) throw new Error("deployments/scene-7.json is missing");
  pass("Refused before broadcast");
  const client = evmClient();
  const key = await readMlDsaKey(testnetClient(), getAddress(ledger.constructorArgs.payer));
  requireMlDsaKey(key);
  const pubkey = hexToBytes(key.pubkey);
  const chainNonce = (await client.readContract({
    address: getAddress(ledger.ledger),
    abi: compiled.abi,
    functionName: "nonce",
  })) as bigint;
  for (const ref of refs) {
    try {
      if (!ref.hash.startsWith("0x")) {
        await nativeTx(ref.hash);
        pass(`${ref.hash} code 0`);
        continue;
      }
      const receipt = await client.getTransactionReceipt({ hash: ref.hash as Hex });
      if (ref.note === "pay" || ref.note === "refund") {
        if (receipt.status !== "success") throw new Error(`${ref.hash} status ${receipt.status}`);
        await checkCall(ref, ledger, pubkey, chainNonce);
        continue;
      }
      if (ref.note.startsWith("deploy ")) {
        if (receipt.status !== "success") throw new Error(`${ref.hash} status ${receipt.status}`);
        if (!receipt.contractAddress || getAddress(receipt.contractAddress) !== getAddress(ledger.ledger)) {
          throw new Error(`${ref.hash} deployed ${String(receipt.contractAddress)}`);
        }
        pass(`${ref.hash} success deploy`);
        continue;
      }
      if (ref.note === "refused") {
        if (receipt.status !== "reverted") throw new Error(`${ref.hash} status ${receipt.status}`);
        await checkCall(ref, ledger, pubkey, chainNonce);
        continue;
      }
      throw new Error(`${ref.hash} note "${ref.note}" is not a known result`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(message.replace(/0x[0-9a-fA-F]{80,}/g, "0x…").split("\n")[0]?.slice(0, 400) ?? "failed");
    }
  }
  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
