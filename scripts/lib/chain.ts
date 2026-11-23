import { readFileSync } from "node:fs";
import type { Registry } from "@cosmjs/proto-signing";
import { StargateClient } from "@cosmjs/stargate";
import { evmWindowCost, weiToUqorCeil } from "@qorechain/evm";
import {
  EthNativeSigner,
  closeEvmWindowMsg,
  deriveUnifiedAccount,
  fetchEvmWindow,
  openEvmWindowMsg,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { TESTNET, qorechainDiana } from "haven-pq-kit/network";
import {
  BaseError,
  RawContractError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readMnemonic } from "./secrets.js";

export const CHAIN_ID = TESTNET.chainId;
/** The fee for an EVM-window transaction. It is not lowered. */
const FEE = { amount: [{ denom: "uqor", amount: "180000" }], gas: "1200000" };

export const WINDOW_CAP = { deploy: 5_000_000n, call: 2_000_000n } as const;
export type WindowKind = keyof typeof WINDOW_CAP;

const ERROR_STRING = { type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] } as const;

function artifactErrors(path: string): Abi {
  const artifact = JSON.parse(readFileSync(path, "utf8")) as { abi: Abi };
  return artifact.abi.filter((item) => item.type === "error");
}

/** Ledger (fUSD and QOR), Native receipt, and PqAuth errors from the compiled ABIs, plus `Error(string)`. */
const KNOWN_ERRORS: Abi = [
  ...artifactErrors("out/HavenLedger.sol/HavenLedger.json"),
  ...artifactErrors("out/HavenLedgerQor.sol/HavenLedgerQor.json"),
  ERROR_STRING,
];

/** Stops before a transaction whose reservation is above 66% of its cap. */
export function assertUnderCap(kind: WindowKind, uqor: bigint, label: string): void {
  const cap = WINDOW_CAP[kind];
  const limit = (cap * 66n) / 100n;
  if (uqor > limit) {
    throw new Error(`${label} cost ${uqor} uqor is above 66% of the ${cap} uqor cap (${limit})`);
  }
}

export function evmClient(): PublicClient {
  return createPublicClient({ chain: qorechainDiana, transport: http(TESTNET.evmRpc) });
}

export function loadAccount(name: string): Promise<UnifiedAccount> {
  return deriveUnifiedAccount(readMnemonic(name));
}

async function accountSequence(account: UnifiedAccount): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const [res, nonce] = await Promise.all([
    fetch(`${TESTNET.rest}/cosmos/auth/v1beta1/accounts/${account.cosmos}`, { headers: { "user-agent": "haven-ledger" } }),
    evmClient().getTransactionCount({ address: account.evm as Address, blockTag: "pending" }),
  ]);
  if (!res.ok) throw new Error(`account ${account.cosmos} is not on chain (${res.status})`);
  const body = (await res.json()) as { account?: { account_number?: string } };
  if (!body.account?.account_number) throw new Error(`account ${account.cosmos} has no account_number on chain`);
  return { accountNumber: BigInt(body.account.account_number), sequence: BigInt(nonce) };
}

export type NativeMessages = Parameters<EthNativeSigner["sign"]>[0]["messages"];

export async function broadcast(
  account: UnifiedAccount,
  messages: NativeMessages,
  signMode: "hybrid" | "classical" = "hybrid",
  registry?: Registry,
): Promise<string> {
  const auth = await accountSequence(account);
  const signer = new EthNativeSigner(account, { signMode, rest: TESTNET.rest, signBytesVersion: "auto", registry });
  const node = await StargateClient.connect(TESTNET.rpc);
  try {
    const result = await signer.signAndBroadcast(node, {
      chainId: CHAIN_ID,
      messages,
      fee: FEE,
      accountNumber: auth.accountNumber,
      sequence: auth.sequence,
    });
    if (result.code !== 0) {
      throw new Error(`tx ${result.transactionHash} failed with code ${result.code}: ${result.rawLog ?? ""}`);
    }
    return result.transactionHash;
  } finally {
    node.disconnect();
  }
}

/** Opens a scoped EVM window, runs `body`, and always closes it. The value cap also pays gas. */
export async function withEvmWindow<T>(
  name: string,
  spec: { txs: number; maxValueUqor: string; targets?: string[]; blocks?: number },
  body: (account: UnifiedAccount) => Promise<T>,
): Promise<{ result: T; openHash: string; closeHash: string }> {
  const account = await loadAccount(name);
  const openHash = await broadcast(account, [
    openEvmWindowMsg({
      sender: account.cosmos,
      blocks: spec.blocks ?? 120,
      maxTxs: spec.txs,
      maxValue: spec.maxValueUqor,
      allowedTargets: spec.targets && spec.targets.length > 0 ? spec.targets : undefined,
    }),
  ]);
  const win = await fetchEvmWindow({ rest: TESTNET.rest, address: account.cosmos });
  if (!win.live) throw new Error(`window ${openHash} did not become live`);
  let result!: T;
  let bodyError: unknown;
  try {
    result = await body(account);
  } catch (error) {
    bodyError = error;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const closeHash = await broadcast(account, [closeEvmWindowMsg(account.cosmos)]);
  if (bodyError) throw bodyError;
  return { result, openHash, closeHash };
}

export type ExpectedRevert = { hash: Hex; errorName: string; gasUsed: bigint; uqor: bigint };

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

function customErrorName(data: Hex): string {
  try {
    return decodeErrorResult({ abi: KNOWN_ERRORS, data }).errorName;
  } catch {
    return `undecoded:${data.slice(0, 10)}`;
  }
}

/**
 * Sends a call that `eth_call` has already shown will revert.
 * Throws without sending when the call does not revert.
 */
export async function sendExpectedRevert(opts: {
  account: UnifiedAccount;
  to: Address;
  data: Hex;
  gas: bigint;
  maxFeePerGas?: bigint;
}): Promise<ExpectedRevert> {
  const client = evmClient();
  const signer = privateKeyToAccount(opts.account.privateKey as Hex);
  let data: Hex | undefined;
  try {
    await client.call({ account: signer.address, to: opts.to, data: opts.data });
  } catch (error) {
    data = revertDataOf(error);
    if (!data) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`eth_call failed without revert data; not sending. ${detail}`);
    }
  }
  if (!data) throw new Error("eth_call did not revert; refusing to send");
  const errorName = customErrorName(data);
  const wallet = createWalletClient({ account: signer, chain: qorechainDiana, transport: http(TESTNET.evmRpc) });
  const hash = await wallet.sendTransaction({
    to: opts.to,
    data: opts.data,
    gas: opts.gas,
    ...(opts.maxFeePerGas !== undefined
      ? { maxFeePerGas: opts.maxFeePerGas, maxPriorityFeePerGas: opts.maxFeePerGas }
      : {}),
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "reverted") {
    throw new Error(`EVM tx ${hash} status ${receipt.status}; expected reverted`);
  }
  return { hash, errorName, gasUsed: receipt.gasUsed, uqor: weiToUqorCeil(receipt.gasUsed * receipt.effectiveGasPrice) };
}

export async function pricedCall(opts: {
  from: Address;
  to?: Address;
  data: Hex;
  kind: WindowKind;
  label: string;
}): Promise<{ gas: bigint; gasPrice: bigint; budget: bigint }> {
  const client = evmClient();
  const gasPrice = await client.getGasPrice();
  const estimated = await client.estimateGas({ account: opts.from, to: opts.to, data: opts.data });
  const buffered = estimated + estimated / 5n;
  const gas =
    evmWindowCost({ gas: buffered, maxFeePerGas: gasPrice }) <= (WINDOW_CAP[opts.kind] * 66n) / 100n ? buffered : estimated;
  const budget = evmWindowCost({ gas, maxFeePerGas: gasPrice });
  assertUnderCap(opts.kind, budget, opts.label);
  return { gas, gasPrice, budget };
}

/** Signs one EIP-1559 transaction at the fee the budget was checked against. */
export async function sendPriced(opts: {
  account: UnifiedAccount;
  to?: Address;
  data: Hex;
  gas: bigint;
  gasPrice: bigint;
  kind: WindowKind;
  label: string;
}): Promise<{ hash: Hex; gasUsed: bigint; uqor: bigint }> {
  const client = evmClient();
  const signer = privateKeyToAccount(opts.account.privateKey as Hex);
  const nonce = await client.getTransactionCount({ address: signer.address, blockTag: "pending" });
  const signed = await signer.signTransaction({
    chainId: qorechainDiana.id,
    nonce,
    to: opts.to,
    data: opts.data,
    gas: opts.gas,
    maxFeePerGas: opts.gasPrice,
    maxPriorityFeePerGas: opts.gasPrice,
    type: "eip1559",
  });
  const hash = await client.sendRawTransaction({ serializedTransaction: signed });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${opts.label} reverted: ${hash}`);
  const uqor = weiToUqorCeil(receipt.gasUsed * receipt.effectiveGasPrice);
  assertUnderCap(opts.kind, uqor, opts.label);
  return { hash, gasUsed: receipt.gasUsed, uqor };
}
