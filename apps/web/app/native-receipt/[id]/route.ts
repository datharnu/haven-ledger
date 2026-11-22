import { RECEIPTS } from "@/lib/check";

const REST = "https://api-testnet.qore.host";

/** One receipt id, on the one allowlisted book. No other REST path is proxied. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: raw } = await context.params;
  if (!/^[0-9]{1,7}$/.test(raw)) {
    return Response.json({ error: "This page will not query that receipt id." }, { status: 400 });
  }
  const query = Buffer.from(JSON.stringify({ receipt: { id: Number(raw) } }), "utf8").toString("base64");
  const url = `${REST}/cosmwasm/wasm/v1/contract/${RECEIPTS}/smart/${query}`;
  try {
    const response = await fetch(url, { headers: { "user-agent": "haven-ledger" }, cache: "no-store" });
    if (!response.ok) return Response.json({ error: "Could not reach the testnet" }, { status: 502 });
    const body: unknown = await response.json();
    return Response.json(body, { headers: { "cache-control": "public, max-age=300" } });
  } catch {
    return Response.json({ error: "Could not reach the testnet" }, { status: 502 });
  }
}
