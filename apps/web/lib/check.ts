/**
 * Re-checks one recorded scene against RPC replies and one Native receipt.
 * The fixture supplies the hash to fetch. It does not supply the verdict.
 */
import { mldsa87 } from "@qorechain/pqc";
import {
  decodeAbiParameters,
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  hexToBytes,
  isAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import ledgerAbiJson from "./abi/haven-ledger.json";
import { PAY, REFUND, commitmentOf, encodeAuthMessage, noteOf } from "./ledger";

export const ledgerAbi = ledgerAbiJson as Abi;

/** `PqAuth.PQC_STATUS` in `lib/haven-pq-kit/src/PqAuth.sol`. */
export const PQC_STATUS = "0x0000000000000000000000000000000000000a02" as const;

/** The receipt book the route is allowed to query. From `deployments/ledger.json`. */
export const RECEIPTS = "qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8";

export const CHAIN_ID = 9800n;
export const PUBKEY_LEN = 2592;
export const SIG_LEN = 4627;
export const ML_DSA_87 = 1;
/** Enough for the two payouts on 22 November 2026, and a bound so a later nonce cannot hang the page. */
export const NONCE_LIMIT = 64n;

export const EVM_RPC = "https://evm-testnet.qore.host";
export const NETWORK = "Could not reach the testnet";
export const NO_HASH = "Refused before broadcast; there is no hash.";

const statusAbi = [
  {
    type: "function",
    name: "pqcKeyStatus",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "algorithmId", type: "uint8" },
      { name: "pubkey", type: "bytes" },
      { name: "possessionProven", type: "bool" },
    ],
  },
] as const;

export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

export class CallError extends Error {
  readonly data?: Hex;
  constructor(message: string, data?: Hex) {
    super(message);
    this.name = "CallError";
    this.data = data;
  }
}

export class NetworkError extends Error {
  constructor() {
    super(NETWORK);
    this.name = "NetworkError";
  }
}

export type NativeReceipt = { id: string; sender: string; note: string; height: string };
export type ReadNative = (id: bigint) => Promise<NativeReceipt>;

export type Outcome = "agreed" | "refused" | "failed" | "offline" | "no-hash";

export type Verdict = {
  scene: number;
  hash: string | null;
  outcome: Outcome;
  summary: string;
  lines: { label: string; detail: string }[];
  heights?: { native: string; evm: string };
};

/** What `deployments/scene-<n>.json` recorded. The chain still has to say the same thing. */
export type Expect =
  | { outcome: "agreed"; signedNonce: number }
  | { outcome: "refused"; reason: string; signedNonce: number | null }
  | { outcome: "no-hash" };

type Scene = { scene: number; hash: string | null; expect?: Expect };

export function viewData(name: "nonce" | "payer" | "payee" | "token" | "receipts" | "ledgerAccount" | "payout", args: readonly unknown[] = []): Hex {
  return encodeFunctionData({ abi: ledgerAbi, functionName: name, args });
}

export function keyData(payer: Address): Hex {
  return encodeFunctionData({ abi: statusAbi, functionName: "pqcKeyStatus", args: [payer] });
}

function offline(scene: Scene): Verdict {
  return { scene: scene.scene, hash: scene.hash, outcome: "offline", summary: NETWORK, lines: [] };
}

function failed(scene: Scene, summary: string, lines: Verdict["lines"] = []): Verdict {
  return { scene: scene.scene, hash: scene.hash, outcome: "failed", summary, lines };
}

function asHex(value: unknown): Hex | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value) ? (value as Hex) : null;
}

function field(value: unknown, name: string, index: number): string {
  if (value && typeof value === "object" && name in value) {
    const named = (value as Record<string, unknown>)[name];
    if (named !== undefined && named !== null) return String(named);
  }
  if (Array.isArray(value) && value[index] !== undefined) return String(value[index]);
  throw new Error(`missing ${name}`);
}

async function rpcHex(rpc: Rpc, method: string, params: unknown[]): Promise<Hex> {
  let result: unknown;
  try {
    result = await rpc(method, params);
  } catch (error) {
    if (error instanceof CallError || error instanceof NetworkError) throw error;
    throw new NetworkError();
  }
  const hex = asHex(result);
  if (!hex) throw new NetworkError();
  return hex;
}

async function readView(rpc: Rpc, ledger: Address, name: Parameters<typeof viewData>[0], args: readonly unknown[] = []): Promise<Hex> {
  return rpcHex(rpc, "eth_call", [{ to: ledger, data: viewData(name, args) }, "latest"]);
}

function decodeReason(data: Hex): string | null {
  try {
    const decoded = decodeErrorResult({ abi: ledgerAbi, data });
    const args = [...(decoded.args ?? [])];
    if (decoded.errorName === "Error") return String(args[0] ?? "Error");
    if (decoded.errorName === "ERC20InsufficientBalance") return `ERC20InsufficientBalance ${args.join(" ")}`;
    return decoded.errorName;
  } catch {
    return null;
  }
}

export async function verifyScene(scene: Scene, rpc: Rpc, native: ReadNative): Promise<Verdict> {
  if (!scene.hash) {
    return { scene: scene.scene, hash: null, outcome: "no-hash", summary: NO_HASH, lines: [] };
  }
  try {
    return await checkHash(scene, scene.hash, rpc, native);
  } catch (error) {
    if (error instanceof NetworkError) return offline(scene);
    const message = error instanceof Error ? error.message : "The check failed.";
    return failed(scene, message.split("\n")[0]?.slice(0, 280) ?? "The check failed.");
  }
}

async function checkHash(scene: Scene, hash: string, rpc: Rpc, native: ReadNative): Promise<Verdict> {
  const chainHex = await rpcHex(rpc, "eth_chainId", []);
  if (BigInt(chainHex) !== CHAIN_ID) return failed(scene, "This page checks chain 9800.");

  let txRaw: unknown;
  let receiptRaw: unknown;
  try {
    txRaw = await rpc("eth_getTransactionByHash", [hash]);
    receiptRaw = await rpc("eth_getTransactionReceipt", [hash]);
  } catch (error) {
    if (error instanceof NetworkError) throw error;
    throw new NetworkError();
  }
  const tx = parseTx(txRaw);
  const receipt = parseReceipt(receiptRaw);
  if (!tx || !receipt) return failed(scene, "The testnet returned a transaction this page could not read.");

  const decoded = decodeFunctionData({ abi: ledgerAbi, data: tx.input });
  if (decoded.functionName !== "pay" && decoded.functionName !== "refund") {
    return failed(scene, "This transaction does not call pay or refund.");
  }
  const args = [...(decoded.args ?? [])];
  const amount = args[0] as bigint;
  const memo = String(args[1]);
  const deadline = args[2] as bigint;
  const signature = args[3] as Hex;
  const action = decoded.functionName === "refund" ? REFUND : PAY;
  const ledger = tx.to;

  const payer = getAddress(decodeFunctionResult({ abi: ledgerAbi, functionName: "payer", data: await readView(rpc, ledger, "payer") }) as Address);
  const payee = getAddress(decodeFunctionResult({ abi: ledgerAbi, functionName: "payee", data: await readView(rpc, ledger, "payee") }) as Address);
  const token = getAddress(decodeFunctionResult({ abi: ledgerAbi, functionName: "token", data: await readView(rpc, ledger, "token") }) as Address);
  const receipts = String(decodeFunctionResult({ abi: ledgerAbi, functionName: "receipts", data: await readView(rpc, ledger, "receipts") }));
  const ledgerAccount = String(decodeFunctionResult({ abi: ledgerAbi, functionName: "ledgerAccount", data: await readView(rpc, ledger, "ledgerAccount") }));
  const chainNonce = BigInt(String(decodeFunctionResult({ abi: ledgerAbi, functionName: "nonce", data: await readView(rpc, ledger, "nonce") })));
  const to = decoded.functionName === "refund" ? payer : payee;

  const keyRaw = await rpcHex(rpc, "eth_call", [{ to: PQC_STATUS, data: keyData(payer) }, "latest"]);
  const key = decodeKey(keyRaw);
  if (!key) return failed(scene, "The payer key is not a registered ML-DSA-87 key.");

  const signedNonce = nonceCovered(key, { chainId: CHAIN_ID, ledger, payer, action, deadline, to, token, amount, memo, signature, chainNonce });
  const lines: Verdict["lines"] = [
    { label: "Transaction", detail: `${receipt.status} at block ${BigInt(receipt.blockNumber).toString()}` },
    { label: "Call", detail: `${decoded.functionName} ${amount.toString()}${memo ? ` · ${memo}` : ""}` },
    {
      label: "Signature",
      detail: signedNonce === undefined ? "The signature does not verify." : `The signature verifies at nonce ${signedNonce.toString()}.`,
    },
  ];

  const expect = scene.expect;
  if (!expect || expect.outcome === "no-hash") return failed(scene, "This scene has no recorded result to compare with.", lines);
  const wantNonce = expect.signedNonce === null ? undefined : BigInt(expect.signedNonce);
  if (signedNonce !== wantNonce) {
    const want = wantNonce === undefined ? "no nonce" : `nonce ${wantNonce.toString()}`;
    return failed(scene, `The signature was recorded at ${want}, and the chain says otherwise.`, lines);
  }

  if (receipt.status === "reverted") {
    if (expect.outcome !== "refused") return failed(scene, "This scene was recorded as a payout, and the transaction reverted.", lines);
    const reason = await revertReason(rpc, tx, receipt.blockNumber);
    if (!reason.includes(expect.reason)) {
      return failed(scene, `Refused for a different reason than recorded: ${reason}`, lines);
    }
    return {
      scene: scene.scene,
      hash,
      outcome: "refused",
      summary: reason,
      lines,
    };
  }

  if (expect.outcome !== "agreed") return failed(scene, "This scene was recorded as a refusal, and the transaction succeeded.", lines);
  if (signedNonce === undefined) return failed(scene, "The signature does not verify.", lines);
  const moved = movedFrom(receipt.logs, ledger);
  if (!moved) return failed(scene, "The receipt has no Moved event.", lines);
  if (BigInt(moved.id) !== signedNonce) return failed(scene, "The signature nonce is not the payout id.", lines);
  if (getAddress(moved.to) !== to) return failed(scene, "Moved names a different recipient.", lines);

  const commitment = commitmentOf({ chainId: CHAIN_ID, ledger, action, to, token, amount, nonce: signedNonce, signature });
  if (commitment.toLowerCase() !== moved.commitment.toLowerCase()) return failed(scene, "The commitment does not match Moved.", lines);
  const payoutRaw = await readView(rpc, ledger, "payout", [signedNonce]);
  const payout = decodeFunctionResult({ abi: ledgerAbi, functionName: "payout", data: payoutRaw });
  const storedCommitment = field(payout, "commitment", 5);
  const storedReceipt = field(payout, "receiptId", 2);
  const storedNative = field(payout, "nativeHeight", 3);
  const storedEvm = field(payout, "evmBlock", 4);
  if (storedCommitment.toLowerCase() !== commitment.toLowerCase()) return failed(scene, "The stored payout commitment does not match.", lines);
  if (storedReceipt !== moved.receiptId) return failed(scene, "The stored receipt id does not match Moved.", lines);
  if (receipts !== RECEIPTS) return failed(scene, "This ledger names a different receipt book, so this page will not read it.", lines);

  const note = noteOf(signedNonce, commitment, memo);
  const row = await native(BigInt(storedReceipt));
  if (row.sender !== ledgerAccount) return failed(scene, `The Native sender is ${row.sender}.`, lines);
  if (row.note !== note) return failed(scene, "The Native note does not match this payout.", lines);
  if (row.height !== storedNative) return failed(scene, "The Native receipt height does not match the stored payout.", lines);

  lines.push(
    { label: "Commitment", detail: commitment },
    { label: "Native receipt", detail: `${row.id} from ${row.sender}` },
  );
  return {
    scene: scene.scene,
    hash,
    outcome: "agreed",
    summary: "Both lanes agree. The Native receipt names this payout.",
    lines,
    heights: { native: row.height, evm: storedEvm },
  };
}

function decodeKey(data: Hex): Uint8Array | null {
  if (data.length < 2 + 64 * 2) return null;
  const [registered, algorithmId, pubkey, possessionProven] = decodeAbiParameters(statusAbi[0].outputs, data);
  if (!registered || !possessionProven || Number(algorithmId) !== ML_DSA_87) return null;
  const bytes = hexToBytes(pubkey);
  if (bytes.length !== PUBKEY_LEN) return null;
  return bytes;
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
  if (signature.length !== SIG_LEN) return undefined;
  const limit = fields.chainNonce > NONCE_LIMIT ? NONCE_LIMIT : fields.chainNonce;
  let found: bigint | undefined;
  for (let nonce = 0n; nonce < limit; nonce++) {
    const message = hexToBytes(
      encodeAuthMessage({
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
    if (found !== undefined) throw new Error("The signature verifies at two nonces.");
    found = nonce;
  }
  return found;
}

async function revertReason(rpc: Rpc, tx: Tx, block: Hex): Promise<string> {
  try {
    await rpc("eth_call", [{ from: tx.from, to: tx.to, data: tx.input }, block]);
    return "The receipt reverted.";
  } catch (error) {
    if (error instanceof CallError && error.data) return decodeReason(error.data) ?? "The receipt reverted.";
    return "The receipt reverted.";
  }
}

type Tx = { from: Address; to: Address; input: Hex };
type Log = { address: Address; topics: [Hex, ...Hex[]]; data: Hex };
type Receipt = { status: "success" | "reverted"; blockNumber: Hex; logs: Log[] };

function parseTx(value: unknown): Tx | null {
  if (!value || typeof value !== "object") return null;
  const tx = value as Record<string, unknown>;
  const input = asHex(tx.input);
  if (!input || typeof tx.to !== "string" || !isAddress(tx.to) || typeof tx.from !== "string" || !isAddress(tx.from)) return null;
  return { from: getAddress(tx.from), to: getAddress(tx.to), input };
}

function parseReceipt(value: unknown): Receipt | null {
  if (!value || typeof value !== "object") return null;
  const receipt = value as Record<string, unknown>;
  const blockNumber = asHex(receipt.blockNumber);
  const status = asHex(receipt.status);
  if (!blockNumber || (status !== "0x1" && status !== "0x0") || !Array.isArray(receipt.logs)) return null;
  const logs: Log[] = [];
  for (const item of receipt.logs) {
    if (!item || typeof item !== "object") return null;
    const log = item as Record<string, unknown>;
    const data = asHex(log.data);
    if (!data || typeof log.address !== "string" || !isAddress(log.address) || !Array.isArray(log.topics)) return null;
    const topics: Hex[] = [];
    for (const topic of log.topics) {
      const hex = asHex(topic);
      if (!hex) return null;
      topics.push(hex);
    }
    if (topics.length === 0) return null;
    logs.push({ address: getAddress(log.address), topics: topics as [Hex, ...Hex[]], data });
  }
  return { status: status === "0x1" ? "success" : "reverted", blockNumber, logs };
}

function movedFrom(logs: Log[], ledger: Address): Record<string, string> | null {
  for (const log of logs) {
    if (log.address !== ledger) continue;
    try {
      const event = decodeEventLog({ abi: ledgerAbi, data: log.data, topics: log.topics });
      if (event.eventName !== "Moved") continue;
      const eventArgs = event.args as unknown;
      return {
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
  return null;
}
