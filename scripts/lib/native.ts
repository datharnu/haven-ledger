/**
 * Read-only Native-lane queries over the LCD, shared by the QOR ledger scripts.
 * No key is read and nothing is sent.
 */
import { TESTNET } from "haven-pq-kit/network";

const HEADERS = { "user-agent": "haven-ledger" };

/** One bank `uqor` in EVM wei. The EVM denom on Diana is `uqor`, kept at 18 decimals on the EVM side. */
export const UQOR_WEI = 1_000_000_000_000n;

export type NativeReceiptRow = { id: string; sender: string; note: string; height: string };

export async function smart<T>(contract: string, query: unknown): Promise<T> {
  const encoded = Buffer.from(JSON.stringify(query), "utf8").toString("base64");
  const response = await fetch(`${TESTNET.rest}/cosmwasm/wasm/v1/contract/${contract}/smart/${encoded}`, { headers: HEADERS });
  if (!response.ok) throw new Error(`${JSON.stringify(query)} returned ${response.status}`);
  const body = (await response.json()) as { data?: T };
  if (body.data === undefined) throw new Error(`${JSON.stringify(query)} returned no data`);
  return body.data;
}

export async function nativeCount(receipts: string): Promise<number> {
  const { count } = await smart<{ count?: number }>(receipts, { count: {} });
  if (typeof count !== "number") throw new Error("count query has no count");
  return count;
}

export async function nativeReceipt(receipts: string, id: bigint): Promise<NativeReceiptRow> {
  const row = await smart<{ id?: number; sender?: string; note?: string; height?: number }>(receipts, { receipt: { id: Number(id) } });
  if (row.id === undefined || !row.sender || row.note === undefined || row.height === undefined) {
    throw new Error(`receipt ${id} is missing a field`);
  }
  return { id: String(row.id), sender: row.sender, note: row.note, height: String(row.height) };
}

export async function nativeCost(hash: string): Promise<{ gasUsed: string; fee: string }> {
  const response = await fetch(`${TESTNET.rest}/cosmos/tx/v1beta1/txs/${hash}`, { headers: HEADERS });
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

/** The x/bank `uqor` balance of `account`, at `height` when given (the state after that block). */
export async function bankUqor(account: string, height?: bigint): Promise<bigint> {
  const headers: Record<string, string> = { ...HEADERS };
  if (height !== undefined) headers["x-cosmos-block-height"] = height.toString();
  const response = await fetch(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${account}/by_denom?denom=uqor`, { headers });
  if (!response.ok) throw new Error(`bank balance of ${account}${height === undefined ? "" : ` at ${height}`} returned ${response.status}`);
  const body = (await response.json()) as { balance?: { denom?: string; amount?: string } };
  return BigInt(body.balance?.amount ?? "0");
}

export type BankDelta = { account: string; denom: "uqor"; height: string; before: string; after: string; delta: string };

/**
 * The change in `account`'s bank `uqor` balance across block `height`: the state after `height - 1`
 * against the state after `height`. It equals one payout only when nothing else touched the account
 * in that block, which is why a QOR scene relays through Spike and the payee holds nothing else.
 */
export async function bankDelta(account: string, height: bigint): Promise<BankDelta> {
  const [before, after] = await Promise.all([bankUqor(account, height - 1n), bankUqor(account, height)]);
  return {
    account,
    denom: "uqor",
    height: height.toString(),
    before: before.toString(),
    after: after.toString(),
    delta: (after - before).toString(),
  };
}
