/**
 * One testnet scene for the native-QOR ledger per invocation: `npm run scenes:qor -- <1-6> [--broadcast]`.
 * Without `--broadcast` a scene prints its plan and reads the chain only: no key is read, nothing is
 * signed or sent. Scenes 4 and 5 need no new signature, so their plan also previews the revert with
 * `eth_call`. A finished report throws "already ran".
 *
 * 1 pay 1 QOR to the payee         4 a junk signature
 * 2 a note the Native book refuses  5 scene 1's signature again
 * 3 more QOR than the ledger holds  6 refund 2 QOR to the payer
 */
import { evmWindowCost, weiToUqorCeil } from "@qorechain/evm";
import {
  BaseError,
  RawContractError,
  decodeErrorResult,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { NATIVE_QOR, PAY_QOR, REFUND_QOR, commitmentOf, qorNoteOf, signPayout, type PayoutFields } from "../src/ts/ledger.js";
import { assertUnderCap, evmClient, loadAccount, pricedCall, sendExpectedRevert, sendPriced, WINDOW_CAP, withEvmWindow } from "./lib/chain.js";
import { UQOR_WEI, bankDelta, bankUqor, nativeCost, nativeCount, nativeReceipt, type BankDelta } from "./lib/native.js";
import { BROADCAST, FUND_UQOR, QOR_FUND, formatUqor, loadJson, planOnly, qorArtifact, qorLedgerDoc, qorScenePath, saveJson, spikeAddress, type QorLedger } from "./lib/qor.js";

const BRIDGE = getAddress("0x0000000000000000000000000000000000000901");
/** The fUSD scenes' limit for a call that must revert. */
const REFUSAL_GAS = 2_000_000n;
const HOUR = 3600n;
const QOR = 1_000_000n * UQOR_WEI;
/** Window open + close on 22 November 2026: 180,000 uqor each. */
const WINDOW_FEES = 360_000n;

const { abi } = qorArtifact();
const ERRORS: Abi = [
  ...abi.filter((item) => item.type === "error"),
  { type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] },
];

type Call = { amount: string; memo: string; deadline: string; signature: Hex; action: Hex };
type Tx = { hash: string; note: string; gasUsed?: string; fee?: string };
type Balances = { ledgerWei: string; payerUqor: string; payeeUqor: string };
type Report = {
  network: string;
  asset: "uqor";
  scene: number;
  ranAt?: string;
  ok: boolean;
  nativeCountBefore?: number;
  nativeCountAfter?: number;
  transactions?: Tx[];
  call?: Call;
  balances?: Balances;
  payout?: Record<string, string>;
  receipt?: { id: string; sender: string; note: string; height: string };
  bank?: BankDelta;
  result?: Record<string, string>;
};

function load(scene: number): Report {
  return loadJson<Report>(qorScenePath(scene), { network: "qorechain-diana", asset: "uqor", scene, ok: false });
}

function save(report: Report): void {
  saveJson(qorScenePath(report.scene), report);
}

function requireScene(scene: number): Report {
  const report = load(scene);
  if (!report.ok) throw new Error(`QOR scene ${scene} has not finished`);
  return report;
}

function requireFunded(): void {
  const fund = loadJson<{ ok?: boolean }>(QOR_FUND, {});
  if (!fund.ok) throw new Error(`${QOR_FUND} is not ok; run npm run fund-ledger:qor first`);
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
  if (!data) return { name: "Unknown", text: error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error) };
  try {
    const decoded = decodeErrorResult({ abi: ERRORS, data });
    const text = (decoded.args ?? []).map((arg) => String(arg)).join(" ");
    return { name: decoded.errorName, text: text || decoded.errorName };
  } catch {
    return { name: `undecoded:${data.slice(0, 10)}`, text: data.slice(0, 10) };
  }
}

function readNonce(doc: QorLedger): Promise<bigint> {
  return evmClient().readContract({ address: doc.ledger, abi, functionName: "nonce" }) as Promise<bigint>;
}

async function balances(doc: QorLedger): Promise<Balances> {
  const [ledgerWei, payerUqor, payeeUqor] = await Promise.all([
    evmClient().getBalance({ address: doc.ledger }),
    bankUqor(doc.payerQor),
    bankUqor(doc.payeeQor),
  ]);
  return { ledgerWei: ledgerWei.toString(), payerUqor: payerUqor.toString(), payeeUqor: payeeUqor.toString() };
}

function payData(call: Call): Hex {
  return encodeFunctionData({
    abi,
    functionName: call.action === REFUND_QOR ? "refund" : "pay",
    args: [BigInt(call.amount), call.memo, BigInt(call.deadline), call.signature],
  });
}

/** Signs with ledger-payer's ML-DSA-87 key. Only reached with `--broadcast`. */
async function freshCall(doc: QorLedger, action: Hex, to: Address, amount: bigint, memo: string): Promise<Call> {
  if (!BROADCAST) throw new Error("refusing to sign without --broadcast");
  const client = evmClient();
  const [nonce, block, payer] = await Promise.all([readNonce(doc), client.getBlock(), loadAccount("ledger-payer")]);
  if (getAddress(payer.evm) !== doc.payer) throw new Error("ledger-payer key does not match the ledger's payer");
  const deadline = block.timestamp + HOUR;
  const fields: PayoutFields = {
    chainId: BigInt(client.chain?.id ?? 0),
    ledger: doc.ledger,
    payer: doc.payer,
    action,
    nonce,
    deadline,
    to,
    token: NATIVE_QOR,
    amount,
    memo,
  };
  return { action, amount: amount.toString(), memo, deadline: deadline.toString(), signature: signPayout(payer.pqc.secretKey, fields) };
}

function expectedNote(doc: QorLedger, call: Call, nonce: bigint): string {
  const amount = BigInt(call.amount);
  const commitment = commitmentOf({
    chainId: BigInt(evmClient().chain?.id ?? 0),
    ledger: doc.ledger,
    action: call.action,
    to: call.action === REFUND_QOR ? doc.payer : doc.payee,
    token: NATIVE_QOR,
    amount,
    nonce,
    signature: call.signature,
  });
  return qorNoteOf(nonce, commitment, amount, call.memo);
}

async function previewRevert(doc: QorLedger, call: Call): Promise<{ name: string; text: string }> {
  try {
    await evmClient().call({ account: spikeAddress(), to: doc.ledger, data: payData(call) });
  } catch (error) {
    return describeRevert(error);
  }
  throw new Error("eth_call succeeded; refusing to send a scene that must fail");
}

function payTx(report: Report): Tx | undefined {
  return report.transactions?.find((tx) => tx.note === "pay" || tx.note === "refund" || tx.note === "refused");
}

async function openAndSend(doc: QorLedger, report: Report, call: Call, mode: "pay" | "refuse"): Promise<void> {
  if (payTx(report)) return;
  report.nativeCountBefore = report.nativeCountBefore ?? (await nativeCount(doc.receipts));
  report.call = call;
  save(report);
  const label = `QOR scene ${report.scene}`;
  const opened = await withEvmWindow(
    "spike",
    { txs: 1, maxValueUqor: WINDOW_CAP.call.toString(), targets: [doc.ledger, BRIDGE], blocks: 200 },
    async (account) => {
      const data = payData(call);
      if (mode === "refuse") {
        const gasPrice = await evmClient().getGasPrice();
        assertUnderCap("call", evmWindowCost({ gas: REFUSAL_GAS, maxFeePerGas: gasPrice }), label);
        const sent = await sendExpectedRevert({ account, to: doc.ledger, data, gas: REFUSAL_GAS, maxFeePerGas: gasPrice });
        const row = { hash: sent.hash, gasUsed: sent.gasUsed.toString(), fee: sent.uqor.toString(), note: "refused" };
        report.transactions = [row];
        save(report);
        return row;
      }
      const priced = await pricedCall({ from: getAddress(account.evm), to: doc.ledger, data, kind: "call", label });
      const sent = await sendPriced({ account, to: doc.ledger, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "call", label });
      const row = { hash: sent.hash, gasUsed: sent.gasUsed.toString(), fee: sent.uqor.toString(), note: call.action === REFUND_QOR ? "refund" : "pay" };
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

function moved(doc: QorLedger, receipt: TransactionReceipt): Record<string, string> {
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== doc.ledger) continue;
    let decoded: { eventName: string; args?: unknown };
    try {
      decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
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

async function payoutOf(doc: QorLedger, id: bigint): Promise<Record<string, string>> {
  const value = await evmClient().readContract({ address: doc.ledger, abi, functionName: "payout", args: [id] });
  return {
    to: field(value, "to", 0),
    amount: field(value, "amount", 1),
    receiptId: field(value, "receiptId", 2),
    nativeHeight: field(value, "nativeHeight", 3),
    evmBlock: field(value, "evmBlock", 4),
    commitment: field(value, "commitment", 5),
  };
}

async function finishSuccess(
  doc: QorLedger,
  report: Report,
  call: Call,
  nonce: bigint,
  expect: { to: Address; toQor: string; refund: boolean; amount: bigint; ledgerWei: bigint },
): Promise<void> {
  const tx = payTx(report);
  if (!tx) throw new Error("the scene has no payout transaction");
  const evmReceipt = await evmClient().getTransactionReceipt({ hash: tx.hash as Hex });
  if (evmReceipt.status !== "success") throw new Error(`${tx.hash} status ${evmReceipt.status}`);
  const event = moved(doc, evmReceipt);
  if (event.to.toLowerCase() !== expect.to.toLowerCase()) throw new Error(`Moved to ${event.to}`);
  if ((event.refund === "true") !== expect.refund) throw new Error(`Moved refund ${event.refund}`);
  if (BigInt(event.amount) !== expect.amount) throw new Error(`Moved amount ${event.amount}`);
  const receipt = await nativeReceipt(doc.receipts, BigInt(event.receiptId));
  if (receipt.sender !== doc.ledgerAccount) throw new Error(`receipt sender ${receipt.sender}`);
  if (receipt.note !== expectedNote(doc, call, nonce)) throw new Error("receipt note does not match the payout");
  const payout = await payoutOf(doc, BigInt(event.id));
  if (payout.receiptId !== receipt.id) throw new Error(`payout receiptId ${payout.receiptId}`);
  if (payout.nativeHeight !== receipt.height) throw new Error(`payout nativeHeight ${payout.nativeHeight}`);
  if (payout.evmBlock !== evmReceipt.blockNumber.toString()) throw new Error(`payout evmBlock ${payout.evmBlock}`);
  if (payout.commitment.toLowerCase() !== event.commitment.toLowerCase()) throw new Error("payout commitment differs from Moved");
  const after = await nativeCount(doc.receipts);
  if (report.nativeCountBefore === undefined || after !== report.nativeCountBefore + 1) {
    throw new Error(`native count ${report.nativeCountBefore} -> ${after}`);
  }
  // The Native bank lane: the recipient's x/bank uqor balance moved by exactly the payout, in that block.
  const bank = await bankDelta(expect.toQor, evmReceipt.blockNumber);
  if (BigInt(bank.delta) * UQOR_WEI !== expect.amount) {
    throw new Error(`bank ${expect.toQor} changed by ${bank.delta} uqor at ${bank.height}; the payout is ${expect.amount} wei`);
  }
  const held = await balances(doc);
  if (BigInt(held.ledgerWei) !== expect.ledgerWei) throw new Error(`ledger holds ${held.ledgerWei} wei`);
  report.nativeCountAfter = after;
  report.balances = held;
  report.payout = payout;
  report.receipt = receipt;
  report.bank = bank;
  report.result = { movedTo: event.to, amountWei: event.amount, bankUqor: bank.delta, receiptId: receipt.id };
}

async function finishRefusal(doc: QorLedger, report: Report, reason: string): Promise<void> {
  const tx = payTx(report);
  if (!tx) throw new Error("the scene has no refused transaction");
  const evmReceipt = await evmClient().getTransactionReceipt({ hash: tx.hash as Hex });
  if (evmReceipt.status !== "reverted") throw new Error(`${tx.hash} status ${evmReceipt.status}; a failing scene succeeded`);
  const after = await nativeCount(doc.receipts);
  if (report.nativeCountBefore === undefined || after !== report.nativeCountBefore) {
    throw new Error(`native count changed ${report.nativeCountBefore} -> ${after}`);
  }
  const bank = await bankDelta(doc.payeeQor, evmReceipt.blockNumber);
  if (bank.delta !== "0") throw new Error(`payee bank changed by ${bank.delta} uqor in a refused block`);
  report.nativeCountAfter = after;
  report.balances = await balances(doc);
  report.bank = bank;
  report.result = {
    reason,
    gasUsed: evmReceipt.gasUsed.toString(),
    fee: weiToUqorCeil(evmReceipt.gasUsed * evmReceipt.effectiveGasPrice).toString(),
  };
}

async function costLine(kind: "pay" | "refuse"): Promise<string> {
  const gasPrice = await evmClient().getGasPrice();
  // A successful fUSD pay used 889,125 gas; the QOR transfer adds a little. A refusal is sent with 2,000,000.
  const gas = kind === "pay" ? 1_100_000n : REFUSAL_GAS;
  const cost = weiToUqorCeil(gas * gasPrice);
  return `relayer spike pays about ${formatUqor(cost)} gas at most + ${formatUqor(WINDOW_FEES)} window open/close`;
}

async function stateLines(doc: QorLedger): Promise<string[]> {
  const [nonce, held, count] = await Promise.all([readNonce(doc), balances(doc), nativeCount(doc.receipts)]);
  return [
    `ledger ${doc.ledger} / ${doc.ledgerAccount}: nonce ${nonce}, holds ${held.ledgerWei} wei`,
    `payer bank ${formatUqor(BigInt(held.payerUqor))}; payee bank ${formatUqor(BigInt(held.payeeUqor))}`,
    `qday-receipts count ${count}`,
  ];
}

async function successScene(
  scene: number,
  opts: { action: Hex; amount: bigint; memo: string; nonce: bigint; ledgerBefore: bigint; requires?: number },
): Promise<void> {
  const report = load(scene);
  if (report.ok) throw new Error("already ran");
  requireFunded();
  if (opts.requires) requireScene(opts.requires);
  const doc = qorLedgerDoc();
  const refund = opts.action === REFUND_QOR;
  const to = refund ? doc.payer : doc.payee;
  const toQor = refund ? doc.payerQor : doc.payeeQor;
  if (!payTx(report)) {
    const nonce = await readNonce(doc);
    if (nonce !== opts.nonce) throw new Error(`nonce is ${nonce}, QOR scene ${scene} needs ${opts.nonce}`);
    const held = await evmClient().getBalance({ address: doc.ledger });
    if (held !== opts.ledgerBefore) throw new Error(`ledger holds ${held} wei, QOR scene ${scene} expects ${opts.ledgerBefore}`);
  }
  if (!BROADCAST) {
    planOnly([
      `QOR scene ${scene}: ${refund ? "refund" : "pay"} ${formatUqor(opts.amount / UQOR_WEI)} (${opts.amount} wei) to ${refund ? "payer" : "payee"} ${to}`,
      `memo "${opts.memo}"; ledger-payer signs ML-DSA-87 over nonce ${opts.nonce}; spike relays with no authority`,
      `expect: Native receipt with note "... a=${opts.amount / UQOR_WEI}uqor${opts.memo ? ` m=${opts.memo}` : ""}", count +1`,
      `expect: bank(${toQor}) +${opts.amount / UQOR_WEI} uqor in the payout's block; ledger ${opts.ledgerBefore - opts.amount} wei after`,
      ...(await stateLines(doc)),
      await costLine("pay"),
      `writes ${qorScenePath(scene)}`,
    ]);
    return;
  }
  const call = report.call ?? (await freshCall(doc, opts.action, to, opts.amount, opts.memo));
  if (!payTx(report)) await openAndSend(doc, report, call, "pay");
  await finishSuccess(doc, report, report.call ?? call, opts.nonce, {
    to,
    toQor,
    refund,
    amount: opts.amount,
    ledgerWei: opts.ledgerBefore - opts.amount,
  });
  report.ok = true;
  report.ranAt = new Date().toISOString();
  save(report);
  console.log(`${report.transactions?.[1]?.hash} count ${report.nativeCountBefore} -> ${report.nativeCountAfter}; bank ${toQor} +${report.bank?.delta} uqor`);
}

async function refuseScene(
  scene: number,
  describe: string[],
  build: (doc: QorLedger) => Promise<Call>,
  accept: (reason: { name: string; text: string }) => boolean,
  opts: { needsSignature: boolean },
): Promise<void> {
  const report = load(scene);
  if (report.ok) throw new Error("already ran");
  requireScene(scene - 1);
  const doc = qorLedgerDoc();
  if (!BROADCAST) {
    if (report.call) throw new Error(`${qorScenePath(scene)} has a call in progress; finish it with --broadcast`);
    const lines = [`QOR scene ${scene}: ${describe[0]}`, ...describe.slice(1)];
    if (!opts.needsSignature) {
      const reason = await previewRevert(doc, await build(doc));
      lines.push(`eth_call preview reverts ${reason.name} ${reason.text}`.trim());
      if (!accept(reason)) throw new Error(`QOR scene ${scene} would revert as ${reason.name}: ${reason.text}`);
    } else {
      lines.push("the eth_call preview needs a fresh payer signature, so it runs only with --broadcast, before sending");
    }
    planOnly([...lines, ...(await stateLines(doc)), await costLine("refuse"), `writes ${qorScenePath(scene)}`]);
    return;
  }
  const call = report.call ?? (await build(doc));
  const reason = await previewRevert(doc, call);
  if (!accept(reason)) throw new Error(`QOR scene ${scene} reverted as ${reason.name}: ${reason.text}`);
  if (!payTx(report)) await openAndSend(doc, report, call, "refuse");
  await finishRefusal(doc, report, `${reason.name} ${reason.text}`.trim());
  report.ok = true;
  report.ranAt = new Date().toISOString();
  save(report);
  console.log(`${report.transactions?.[1]?.hash} ${reason.name} count ${report.nativeCountAfter}`);
}

function scene1(): Promise<void> {
  const funded = FUND_UQOR * UQOR_WEI;
  return successScene(1, { action: PAY_QOR, amount: QOR, memo: "invoice 1", nonce: 0n, ledgerBefore: funded });
}

function scene2(): Promise<void> {
  const memo = "a".repeat(60);
  return refuseScene(
    2,
    [`pay 1 uqor with a 60-character memo; the note is over the Native book's 140 characters`, "expect: the book refuses, so the payout reverts; count unchanged"],
    async (doc) => {
      const call = await freshCall(doc, PAY_QOR, doc.payee, UQOR_WEI, memo);
      if (expectedNote(doc, call, await readNonce(doc)).length <= 140) throw new Error("the note is not over the Native limit");
      return call;
    },
    (reason) => reason.text.includes("the note must be 1 to 140 characters"),
    { needsSignature: true },
  );
}

function scene3(): Promise<void> {
  const held = FUND_UQOR * UQOR_WEI - QOR;
  return refuseScene(
    3,
    [`pay 10 QOR while the ledger holds ${held} wei`, "expect: InsufficientBalance after the Native write, which is undone; count unchanged"],
    async (doc) => {
      const now = await evmClient().getBalance({ address: doc.ledger });
      if (now !== held) throw new Error(`ledger holds ${now} wei, QOR scene 3 expects ${held}`);
      return freshCall(doc, PAY_QOR, doc.payee, 10n * QOR, "");
    },
    (reason) => reason.name === "InsufficientBalance",
    { needsSignature: true },
  );
}

function scene4(): Promise<void> {
  return refuseScene(
    4,
    ["pay 1 QOR with an all-zero 4,627-byte signature", "expect: SignatureInvalid before the bridge; count unchanged"],
    async () => {
      const block = await evmClient().getBlock();
      return { action: PAY_QOR, amount: QOR.toString(), memo: "", deadline: (block.timestamp + HOUR).toString(), signature: `0x${"00".repeat(4627)}` };
    },
    (reason) => reason.name === "SignatureInvalid",
    { needsSignature: false },
  );
}

function scene5(): Promise<void> {
  return refuseScene(
    5,
    ["send QOR scene 1's call again, signature and all", "expect: SignatureInvalid, the nonce has moved on; count unchanged"],
    async () => {
      const first = requireScene(1);
      if (!first.call) throw new Error("QOR scene 1 did not keep its call");
      return first.call;
    },
    (reason) => reason.name === "SignatureInvalid",
    { needsSignature: false },
  );
}

function scene6(): Promise<void> {
  const held = FUND_UQOR * UQOR_WEI - QOR;
  return successScene(6, { action: REFUND_QOR, amount: 2n * QOR, memo: "", nonce: 1n, ledgerBefore: held, requires: 5 });
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/0x[0-9a-fA-F]{80,}/g, "0x…").split("\n")[0]?.slice(0, 500) ?? "failed";
}

const scenes: Record<number, () => Promise<void>> = { 1: scene1, 2: scene2, 3: scene3, 4: scene4, 5: scene5, 6: scene6 };

const scene = Number(process.argv.find((arg, index) => index >= 2 && /^[0-9]+$/.test(arg)) ?? "");
const run = scenes[scene];
if (!run) {
  console.error("usage: npm run scenes:qor -- <1-6> [--broadcast]");
  process.exit(1);
}
run().catch((error: unknown) => {
  console.error(publicError(error));
  process.exit(1);
});
