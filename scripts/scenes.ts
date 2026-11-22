/**
 * One testnet scene per invocation. A finished report throws "already ran".
 * Scene 8 stays closed until the human asks for it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { evmWindowCost, weiToUqorCeil } from "@qorechain/evm";
import { TESTNET } from "haven-pq-kit/network";
import {
  BaseError,
  RawContractError,
  decodeErrorResult,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { PAY, REFUND, commitmentOf, noteOf, recordPayload, signPayout, type PayoutFields } from "../src/ts/ledger.js";
import {
  assertUnderCap,
  evmClient,
  loadAccount,
  pricedCall,
  sendExpectedRevert,
  sendPriced,
  WINDOW_CAP,
  withEvmWindow,
} from "./lib/chain.js";

const BRIDGE = getAddress("0x0000000000000000000000000000000000000901");
const UNLISTED = "qor1qg5ega6dykkxc307y25pecuufrjkxkaggkkxh7nad0vhyhtuhw3sqaa3c5";
/** Above the 1,333,314 gas a successful pay estimated, and 225,000 uqor at the gas price read on 22 Nov 2026. */
const REFUSAL_GAS = 2_000_000n;
const HOUR = 3600n;

const compiled = JSON.parse(readFileSync("out/HavenLedger.sol/HavenLedger.json", "utf8")) as { abi: Abi };
const ERRORS: Abi = [
  ...compiled.abi.filter((item) => item.type === "error"),
  { type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] },
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      { name: "sender", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
];

const bridgeAbi = [
  {
    type: "function",
    name: "executeCrossVMCall",
    stateMutability: "nonpayable",
    inputs: [
      { name: "targetVM", type: "uint8" },
      { name: "targetContract", type: "string" },
      { name: "payload", type: "bytes" },
    ],
    outputs: [{ name: "reply", type: "bytes" }],
  },
] as const;

type Call = { amount: string; memo: string; deadline: string; signature: Hex; action: Hex };
type Tx = { hash: string; note: string; gasUsed?: string; fee?: string };
type Report = {
  network: string;
  scene: number;
  ranAt?: string;
  ok: boolean;
  nativeCountBefore?: number;
  nativeCountAfter?: number;
  transactions?: Tx[];
  call?: Call;
  balances?: { ledger: string; payer: string; payee: string };
  payout?: Record<string, string>;
  receipt?: { id: string; sender: string; note: string; height: string };
  result?: Record<string, string>;
  note?: string;
};

type Ledger = {
  ledger: Address;
  ledgerAccount: string;
  payer: Address;
  payee: Address;
  token: Address;
  receipts: string;
};

function reportPath(scene: number): string {
  return `deployments/scene-${scene}.json`;
}

function load(scene: number): Report {
  try {
    return JSON.parse(readFileSync(reportPath(scene), "utf8")) as Report;
  } catch {
    return { network: "qorechain-diana", scene, ok: false };
  }
}

function save(report: Report): void {
  const path = reportPath(report.scene);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}

function requireScene(scene: number): Report {
  const report = load(scene);
  if (!report.ok) throw new Error(`scene ${scene} has not finished`);
  return report;
}

function ledgerDoc(): Ledger {
  const doc = JSON.parse(readFileSync("deployments/ledger.json", "utf8")) as {
    ok?: boolean;
    ledger?: Address;
    ledgerAccount?: string;
    constructorArgs?: { payer: Address; payee: Address; token: Address; receipts: string };
  };
  if (!doc.ok || !doc.ledger || !doc.ledgerAccount || !doc.constructorArgs) throw new Error("deployments/ledger.json is not ok");
  return {
    ledger: getAddress(doc.ledger),
    ledgerAccount: doc.ledgerAccount,
    payer: getAddress(doc.constructorArgs.payer),
    payee: getAddress(doc.constructorArgs.payee),
    token: getAddress(doc.constructorArgs.token),
    receipts: doc.constructorArgs.receipts,
  };
}

function hexData(value: unknown): Hex | undefined {
  if (typeof value === "string" && value.startsWith("0x")) return value as Hex;
  if (value && typeof value === "object" && "data" in value) return hexData(value.data);
  return undefined;
}

function revertDataOf(error: unknown): Hex | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const raw = error.walk((candidate) => candidate instanceof RawContractError);
  if (raw instanceof RawContractError) {
    const data = hexData(raw.data);
    if (data) return data;
  }
  const carrier = error.walk((candidate) => hexData((candidate as { data?: unknown } | null)?.data) !== undefined);
  return carrier ? hexData((carrier as { data?: unknown }).data) : undefined;
}

function describeRevert(error: unknown): { name: string; text: string } {
  const data = revertDataOf(error);
  if (!data) return { name: "Unknown", text: error instanceof Error ? error.message.split("\n")[0] : String(error) };
  try {
    const decoded = decodeErrorResult({ abi: ERRORS, data });
    const text = (decoded.args ?? []).map((arg) => String(arg)).join(" ");
    return { name: decoded.errorName, text: text || decoded.errorName };
  } catch {
    return { name: `undecoded:${data.slice(0, 10)}`, text: data.slice(0, 10) };
  }
}

async function nativeCount(receipts: string): Promise<number> {
  const query = Buffer.from(JSON.stringify({ count: {} })).toString("base64");
  const response = await fetch(`${TESTNET.rest}/cosmwasm/wasm/v1/contract/${receipts}/smart/${query}`, {
    headers: { "user-agent": "haven-ledger" },
  });
  if (!response.ok) throw new Error(`count query ${response.status}`);
  const body = (await response.json()) as { data?: { count?: number } };
  if (typeof body.data?.count !== "number") throw new Error("count query has no count");
  return body.data.count;
}

async function nativeReceipt(receipts: string, id: bigint): Promise<{ id: string; sender: string; note: string; height: string }> {
  const query = Buffer.from(JSON.stringify({ receipt: { id: Number(id) } })).toString("base64");
  const response = await fetch(`${TESTNET.rest}/cosmwasm/wasm/v1/contract/${receipts}/smart/${query}`, {
    headers: { "user-agent": "haven-ledger" },
  });
  if (!response.ok) throw new Error(`receipt ${id} query ${response.status}`);
  const body = (await response.json()) as { data?: { id?: number; sender?: string; note?: string; height?: number } };
  const row = body.data;
  if (!row || row.id === undefined || !row.sender || row.note === undefined || row.height === undefined) {
    throw new Error(`receipt ${id} is missing a field`);
  }
  return { id: String(row.id), sender: row.sender, note: row.note, height: String(row.height) };
}

async function nativeCost(hash: string): Promise<{ gasUsed: string; fee: string }> {
  const response = await fetch(`${TESTNET.rest}/cosmos/tx/v1beta1/txs/${hash}`, { headers: { "user-agent": "haven-ledger" } });
  if (!response.ok) throw new Error(`tx ${hash} ${response.status}`);
  const body = (await response.json()) as {
    tx?: { auth_info?: { fee?: { amount?: { denom: string; amount: string }[] } } };
    tx_response?: { gas_used?: string };
  };
  const fee = body.tx?.auth_info?.fee?.amount?.find((coin) => coin.denom === "uqor")?.amount;
  const gasUsed = body.tx_response?.gas_used;
  if (!fee || !gasUsed) throw new Error(`tx ${hash} has no uqor fee or gas_used`);
  return { gasUsed, fee };
}

function balanceOf(token: Address, holder: Address): Promise<bigint> {
  return evmClient().readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] });
}

async function balances(doc: Ledger): Promise<{ ledger: string; payer: string; payee: string }> {
  const [ledger, payer, payee] = await Promise.all([
    balanceOf(doc.token, doc.ledger),
    balanceOf(doc.token, doc.payer),
    balanceOf(doc.token, doc.payee),
  ]);
  return { ledger: ledger.toString(), payer: payer.toString(), payee: payee.toString() };
}

function payData(call: Call): Hex {
  const fn = call.action === REFUND ? "refund" : "pay";
  return encodeFunctionData({
    abi: compiled.abi,
    functionName: fn,
    args: [BigInt(call.amount), call.memo, BigInt(call.deadline), call.signature],
  });
}

async function freshCall(doc: Ledger, action: Hex, to: Address, amount: bigint, memo: string): Promise<Call> {
  const client = evmClient();
  const [nonce, block, payer] = await Promise.all([
    client.readContract({ address: doc.ledger, abi: compiled.abi, functionName: "nonce" }) as Promise<bigint>,
    client.getBlock(),
    loadAccount("ledger-payer"),
  ]);
  const deadline = block.timestamp + HOUR;
  const fields: PayoutFields = {
    chainId: BigInt(client.chain?.id ?? 0),
    ledger: doc.ledger,
    payer: doc.payer,
    action,
    nonce,
    deadline,
    to,
    token: doc.token,
    amount,
    memo,
  };
  return {
    action,
    amount: amount.toString(),
    memo,
    deadline: deadline.toString(),
    signature: signPayout(payer.pqc.secretKey, fields),
  };
}

function expectedNote(doc: Ledger, call: Call, nonce: bigint): string {
  const commitment = commitmentOf({
    chainId: BigInt(evmClient().chain?.id ?? 0),
    ledger: doc.ledger,
    action: call.action,
    to: call.action === REFUND ? doc.payer : doc.payee,
    token: doc.token,
    amount: BigInt(call.amount),
    nonce,
    signature: call.signature,
  });
  return noteOf(nonce, commitment, call.memo);
}

async function previewRevert(doc: Ledger, call: Call): Promise<{ name: string; text: string }> {
  try {
    await evmClient().call({ account: getAddress((await loadAccount("spike")).evm), to: doc.ledger, data: payData(call) });
  } catch (error) {
    return describeRevert(error);
  }
  throw new Error("eth_call succeeded; refusing to send a scene that must fail");
}

function payTx(report: Report): Tx | undefined {
  return report.transactions?.find((tx) => tx.note === "pay" || tx.note === "refund" || tx.note === "refused");
}

async function openAndSend(doc: Ledger, report: Report, call: Call, mode: "pay" | "refuse"): Promise<void> {
  if (payTx(report)) return;
  const before = report.nativeCountBefore ?? (await nativeCount(doc.receipts));
  report.nativeCountBefore = before;
  report.call = call;
  save(report);
  const opened = await withEvmWindow(
    "spike",
    { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [doc.ledger, BRIDGE], blocks: 200 },
    async (account) => {
      const data = payData(call);
      if (mode === "refuse") {
        const gasPrice = await evmClient().getGasPrice();
        assertUnderCap("call", evmWindowCost({ gas: REFUSAL_GAS, maxFeePerGas: gasPrice }), `scene ${report.scene}`);
        const sent = await sendExpectedRevert({
          account,
          to: doc.ledger,
          data,
          gas: REFUSAL_GAS,
          maxFeePerGas: gasPrice,
        });
        const row = { hash: sent.hash, gasUsed: sent.gasUsed.toString(), fee: sent.uqor.toString(), note: "refused" };
        report.transactions = [row];
        save(report);
        return row;
      }
      const priced = await pricedCall({
        from: getAddress(account.evm),
        to: doc.ledger,
        data,
        kind: "call",
        label: `scene ${report.scene}`,
      });
      const sent = await sendPriced({
        account,
        to: doc.ledger,
        data,
        gas: priced.gas,
        gasPrice: priced.gasPrice,
        kind: "call",
        label: `scene ${report.scene}`,
      });
      const row = { hash: sent.hash, gasUsed: sent.gasUsed.toString(), fee: sent.uqor.toString(), note: call.action === REFUND ? "refund" : "pay" };
      report.transactions = [row];
      save(report);
      return row;
    },
  );
  const open = await nativeCost(opened.openHash);
  const close = await nativeCost(opened.closeHash);
  const sent = report.transactions?.find((tx) => tx.hash === opened.result.hash) ?? opened.result;
  report.transactions = [
    { hash: opened.openHash, note: "open window", gasUsed: open.gasUsed, fee: open.fee },
    sent,
    { hash: opened.closeHash, note: "close window", gasUsed: close.gasUsed, fee: close.fee },
  ];
  save(report);
}

function field(value: unknown, name: string, index: number): string {
  if (value && typeof value === "object" && name in value) {
    const named = (value as Record<string, unknown>)[name];
    if (named !== undefined) return String(named);
  }
  if (Array.isArray(value) && value[index] !== undefined) return String(value[index]);
  throw new Error(`missing ${name}`);
}

function moved(doc: Ledger, receipt: TransactionReceipt): Record<string, string> {
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== doc.ledger) continue;
    let decoded: { eventName: string; args?: unknown };
    try {
      decoded = decodeEventLog({ abi: compiled.abi, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    if (decoded.eventName !== "Moved") continue;
    const args = decoded.args as unknown;
    return {
      id: field(args, "id", 0),
      to: field(args, "to", 1),
      refund: field(args, "refund", 2),
      amount: field(args, "amount", 3),
      receiptId: field(args, "receiptId", 4),
      nativeHeight: field(args, "nativeHeight", 5),
      commitment: field(args, "commitment", 6),
    };
  }
  throw new Error("Moved was not in the receipt");
}

async function payoutOf(doc: Ledger, id: bigint): Promise<Record<string, string>> {
  const value = await evmClient().readContract({ address: doc.ledger, abi: compiled.abi, functionName: "payout", args: [id] });
  return {
    to: field(value, "to", 0),
    amount: field(value, "amount", 1),
    receiptId: field(value, "receiptId", 2),
    nativeHeight: field(value, "nativeHeight", 3),
    evmBlock: field(value, "evmBlock", 4),
    commitment: field(value, "commitment", 5),
  };
}

async function finishSuccess(doc: Ledger, report: Report, call: Call, nonce: bigint, expect: { to: Address; refund: boolean; amount: bigint; ledger: bigint; payee: bigint; payer: bigint }): Promise<void> {
  const tx = payTx(report);
  if (!tx) throw new Error("the scene has no payout transaction");
  const evmReceipt = await evmClient().getTransactionReceipt({ hash: tx.hash as Hex });
  if (evmReceipt.status !== "success") throw new Error(`${tx.hash} status ${evmReceipt.status}`);
  const event = moved(doc, evmReceipt);
  if (event.to.toLowerCase() !== expect.to.toLowerCase()) throw new Error(`Moved to ${event.to}`);
  if ((event.refund === "true") !== expect.refund) throw new Error(`Moved refund ${event.refund}`);
  if (BigInt(event.amount) !== expect.amount) throw new Error(`Moved amount ${event.amount}`);
  const receipt = await nativeReceipt(doc.receipts, BigInt(event.receiptId));
  const note = expectedNote(doc, call, nonce);
  if (receipt.sender !== doc.ledgerAccount) throw new Error(`receipt sender ${receipt.sender}`);
  if (receipt.note !== note) throw new Error("receipt note does not match the payout");
  const payout = await payoutOf(doc, BigInt(event.id));
  if (payout.receiptId !== receipt.id) throw new Error(`payout receiptId ${payout.receiptId}`);
  if (payout.nativeHeight !== receipt.height) throw new Error(`payout nativeHeight ${payout.nativeHeight}`);
  if (payout.evmBlock !== evmReceipt.blockNumber.toString()) throw new Error(`payout evmBlock ${payout.evmBlock}`);
  if (payout.commitment.toLowerCase() !== event.commitment.toLowerCase()) throw new Error("payout commitment differs from Moved");
  const after = await nativeCount(doc.receipts);
  if (report.nativeCountBefore === undefined || after !== report.nativeCountBefore + 1) {
    throw new Error(`native count ${report.nativeCountBefore} -> ${after}`);
  }
  const held = await balances(doc);
  if (BigInt(held.ledger) !== expect.ledger || BigInt(held.payee) !== expect.payee || BigInt(held.payer) !== expect.payer) {
    throw new Error(`balances ledger ${held.ledger} payee ${held.payee} payer ${held.payer}`);
  }
  report.nativeCountAfter = after;
  report.balances = held;
  report.payout = payout;
  report.receipt = receipt;
  report.result = { movedTo: event.to, amount: event.amount, receiptId: receipt.id };
}

async function finishRefusal(doc: Ledger, report: Report, reason: string): Promise<void> {
  const tx = payTx(report);
  if (!tx) throw new Error("the scene has no refused transaction");
  const evmReceipt = await evmClient().getTransactionReceipt({ hash: tx.hash as Hex });
  if (evmReceipt.status !== "reverted") throw new Error(`${tx.hash} status ${evmReceipt.status}; a failing scene succeeded`);
  const after = await nativeCount(doc.receipts);
  if (report.nativeCountBefore === undefined || after !== report.nativeCountBefore) {
    throw new Error(`native count changed ${report.nativeCountBefore} -> ${after}`);
  }
  report.nativeCountAfter = after;
  report.balances = await balances(doc);
  report.result = { reason, gasUsed: evmReceipt.gasUsed.toString(), fee: weiToUqorCeil(evmReceipt.gasUsed * evmReceipt.effectiveGasPrice).toString() };
}

async function scene1(): Promise<void> {
  const report = load(1);
  if (report.ok) throw new Error("already ran");
  const doc = ledgerDoc();
  const call = report.call ?? (await freshCall(doc, PAY, doc.payee, 100_000n, "invoice 1"));
  if (!payTx(report)) {
    const nonce = (await evmClient().readContract({ address: doc.ledger, abi: compiled.abi, functionName: "nonce" })) as bigint;
    if (nonce !== 0n) throw new Error(`nonce is ${nonce}, scene 1 needs 0`);
    await openAndSend(doc, report, call, "pay");
  }
  await finishSuccess(doc, report, report.call ?? call, 0n, {
    to: doc.payee,
    refund: false,
    amount: 100_000n,
    ledger: 900_000n,
    payee: 100_000n,
    payer: 0n,
  });
  report.ok = true;
  report.ranAt = new Date().toISOString();
  save(report);
  console.log(`${report.transactions?.[1]?.hash} count ${report.nativeCountBefore} -> ${report.nativeCountAfter}`);
}

async function refuseScene(scene: number, build: (doc: Ledger) => Promise<Call>, accept: (reason: { name: string; text: string }) => boolean): Promise<void> {
  const report = load(scene);
  if (report.ok) throw new Error("already ran");
  requireScene(scene - 1);
  const doc = ledgerDoc();
  const call = report.call ?? (await build(doc));
  const reason = await previewRevert(doc, call);
  if (!accept(reason)) throw new Error(`scene ${scene} reverted as ${reason.name}: ${reason.text}`);
  if (!payTx(report)) await openAndSend(doc, report, call, "refuse");
  await finishRefusal(doc, report, `${reason.name} ${reason.text}`.trim());
  report.ok = true;
  report.ranAt = new Date().toISOString();
  save(report);
  console.log(`${report.transactions?.[1]?.hash} ${reason.name} count ${report.nativeCountAfter}`);
}

async function scene2(): Promise<void> {
  const memo = "a".repeat(60);
  await refuseScene(2, async (doc) => {
    const call = await freshCall(doc, PAY, doc.payee, 1n, memo);
    const nonce = (await evmClient().readContract({ address: doc.ledger, abi: compiled.abi, functionName: "nonce" })) as bigint;
    if (expectedNote(doc, call, nonce).length <= 140) throw new Error("the note is not over the Native limit");
    return call;
  }, (reason) => reason.text.includes("the note must be 1 to 140 characters"));
}

async function scene3(): Promise<void> {
  await refuseScene(3, async (doc) => {
    const held = await balanceOf(doc.token, doc.ledger);
    if (held !== 900_000n) throw new Error(`ledger holds ${held}, scene 3 expects 900000`);
    return freshCall(doc, PAY, doc.payee, 5_000_000n, "");
  }, (reason) => reason.name === "ERC20InsufficientBalance");
}

async function scene4(): Promise<void> {
  await refuseScene(4, async (doc) => {
    const block = await evmClient().getBlock();
    return { action: PAY, amount: "100000", memo: "", deadline: (block.timestamp + HOUR).toString(), signature: `0x${"00".repeat(4627)}` };
  }, (reason) => reason.name === "SignatureInvalid");
}

async function scene5(): Promise<void> {
  const first = requireScene(1);
  if (!first.call) throw new Error("scene 1 did not keep its call");
  await refuseScene(5, async () => first.call as Call, (reason) => reason.name === "SignatureInvalid");
}

async function scene6(): Promise<void> {
  const report = load(6);
  if (report.ok) throw new Error("already ran");
  requireScene(5);
  const doc = ledgerDoc();
  const call = report.call ?? (await freshCall(doc, REFUND, doc.payer, 200_000n, ""));
  if (!payTx(report)) {
    const nonce = (await evmClient().readContract({ address: doc.ledger, abi: compiled.abi, functionName: "nonce" })) as bigint;
    if (nonce !== 1n) throw new Error(`nonce is ${nonce}, the refund note has to carry n=1`);
    await openAndSend(doc, report, call, "pay");
  }
  await finishSuccess(doc, report, report.call ?? call, 1n, {
    to: doc.payer,
    refund: true,
    amount: 200_000n,
    ledger: 700_000n,
    payee: 100_000n,
    payer: 200_000n,
  });
  if (!report.receipt?.note.includes("n=1")) throw new Error("the refund note does not carry n=1");
  report.ok = true;
  report.ranAt = new Date().toISOString();
  save(report);
  console.log(`${report.transactions?.[1]?.hash} count ${report.nativeCountBefore} -> ${report.nativeCountAfter}`);
}

async function scene7(): Promise<void> {
  const report = load(7);
  if (report.ok) throw new Error("already ran");
  const doc = ledgerDoc();
  const spike = getAddress((await loadAccount("spike")).evm);
  const data = encodeFunctionData({
    abi: bridgeAbi,
    functionName: "executeCrossVMCall",
    args: [1, UNLISTED, recordPayload("haven ledger unlisted")],
  });
  let reason = { name: "Unknown", text: "" };
  try {
    await evmClient().call({ account: spike, to: BRIDGE, data });
    throw new Error("the unlisted target was accepted");
  } catch (error) {
    if (error instanceof Error && error.message === "the unlisted target was accepted") throw error;
    reason = describeRevert(error);
  }
  if (!reason.text.includes("is not allowlisted")) throw new Error(`scene 7: ${reason.name} ${reason.text}`);
  report.ok = true;
  report.ranAt = new Date().toISOString();
  report.note = "Refused before broadcast; there is no hash.";
  report.result = { reason: `${reason.name} ${reason.text}`.trim() };
  save(report);
  console.log(report.note);
}

function scene8(): never {
  throw new Error("scene 8 is optional. It opens a window that cannot see the bridge. Ask before running it.");
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/0x[0-9a-fA-F]{80,}/g, "0x…").split("\n")[0]?.slice(0, 500) ?? "failed";
}

const scenes: Record<number, () => Promise<void> | never> = {
  1: scene1,
  2: scene2,
  3: scene3,
  4: scene4,
  5: scene5,
  6: scene6,
  7: scene7,
  8: scene8,
};

const scene = Number(process.argv[2] ?? "");
const run = scenes[scene];
if (!run) {
  console.error("usage: npm run scenes -- <1-8>");
  process.exit(1);
}
Promise.resolve(run()).catch((error: unknown) => {
  console.error(publicError(error));
  process.exit(1);
});
