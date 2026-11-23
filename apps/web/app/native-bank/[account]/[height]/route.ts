import { bankAccounts } from "@/lib/qor-scenes";

const REST = "https://api-testnet.qore.host";

/**
 * The x/bank `uqor` balance of the QOR ledger's payer or payee after one block. No other account and
 * no other REST path is proxied. Until a QOR ledger is recorded, every request is refused.
 */
export async function GET(_request: Request, context: { params: Promise<{ account: string; height: string }> }) {
  const { account, height } = await context.params;
  if (!bankAccounts().includes(account) || !/^[1-9][0-9]{0,11}$/.test(height)) {
    return Response.json({ error: "This page will not query that balance." }, { status: 400 });
  }
  const url = `${REST}/cosmos/bank/v1beta1/balances/${account}/by_denom?denom=uqor`;
  try {
    const response = await fetch(url, { headers: { "user-agent": "haven-ledger", "x-cosmos-block-height": height }, cache: "no-store" });
    if (!response.ok) return Response.json({ error: "Could not reach the testnet" }, { status: 502 });
    const body: unknown = await response.json();
    return Response.json(body, { headers: { "cache-control": "public, max-age=300" } });
  } catch {
    return Response.json({ error: "Could not reach the testnet" }, { status: 502 });
  }
}
