/**
 * Read-only. Saves the RPC replies the unit tests replay.
 * It does not sign and it does not broadcast.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { getAddress, type Address, type Hex } from "viem";
import { EVM_RPC, PQC_STATUS, keyData, viewData } from "../lib/check";

const ledgerDoc = JSON.parse(readFileSync(new URL("../../../deployments/ledger.json", import.meta.url), "utf8")) as {
  ledger: Address;
  constructorArgs: { payer: Address };
};
const scenes = JSON.parse(readFileSync(new URL("../lib/fixtures/scenes.json", import.meta.url), "utf8")) as {
  scenes: { hash: string | null; scene: number }[];
};

async function rpc(method: string, params: unknown[]): Promise<{ result?: unknown; error?: { message?: string; data?: unknown } }> {
  const response = await fetch(EVM_RPC, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "haven-ledger" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method} returned ${response.status}`);
  return (await response.json()) as { result?: unknown; error?: { message?: string; data?: unknown } };
}

async function main(): Promise<void> {
  const ledger = getAddress(ledgerDoc.ledger);
  const payer = getAddress(ledgerDoc.constructorArgs.payer);
  const chain = await rpc("eth_chainId", []);
  const transactions: Record<string, unknown> = {};
  const receipts: Record<string, unknown> = {};
  const replays: { data: string; block: string; errorData?: string; result?: string }[] = [];
  for (const scene of scenes.scenes) {
    if (!scene.hash) continue;
    const tx = await rpc("eth_getTransactionByHash", [scene.hash]);
    const receipt = await rpc("eth_getTransactionReceipt", [scene.hash]);
    if (!tx.result || !receipt.result) throw new Error(`${scene.hash} has no receipt`);
    transactions[scene.hash] = tx.result;
    receipts[scene.hash] = receipt.result;
    const body = receipt.result as { status?: string; blockNumber?: string };
    const input = (tx.result as { input?: string; from?: string; to?: string });
    if (body.status === "0x0" && body.blockNumber && input.input && input.from && input.to) {
      const replay = await rpc("eth_call", [{ from: input.from, to: input.to, data: input.input }, body.blockNumber]);
      const data = typeof replay.error?.data === "string" ? replay.error.data : undefined;
      replays.push({ data: input.input, block: body.blockNumber, errorData: data, result: typeof replay.result === "string" ? replay.result : undefined });
    }
  }
  const reads: { name: string; to: Address; data: Hex; args?: readonly unknown[] }[] = [
    { name: "payer", to: ledger, data: viewData("payer") },
    { name: "payee", to: ledger, data: viewData("payee") },
    { name: "token", to: ledger, data: viewData("token") },
    { name: "receipts", to: ledger, data: viewData("receipts") },
    { name: "ledgerAccount", to: ledger, data: viewData("ledgerAccount") },
    { name: "nonce", to: ledger, data: viewData("nonce") },
    { name: "payout0", to: ledger, data: viewData("payout", [0n]) },
    { name: "payout1", to: ledger, data: viewData("payout", [1n]) },
    { name: "key", to: PQC_STATUS, data: keyData(payer) },
  ];
  const calls = [];
  for (const read of reads) {
    const body = await rpc("eth_call", [{ to: read.to, data: read.data }, "latest"]);
    if (typeof body.result !== "string") throw new Error(`${read.name} returned no result`);
    calls.push({ name: read.name, to: read.to, data: read.data, result: body.result });
  }
  const native: Record<string, unknown> = {};
  for (const id of [4, 5]) {
    const query = Buffer.from(JSON.stringify({ receipt: { id } }), "utf8").toString("base64");
    const response = await fetch(
      `https://api-testnet.qore.host/cosmwasm/wasm/v1/contract/qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8/smart/${query}`,
      { headers: { "user-agent": "haven-ledger" } },
    );
    if (!response.ok) throw new Error(`receipt ${id} returned ${response.status}`);
    native[String(id)] = await response.json();
  }
  const out = { chainId: chain.result, transactions, receipts, calls, replays, native };
  writeFileSync(new URL("../lib/fixtures/recorded-rpc.json", import.meta.url), JSON.stringify(out));
  console.log(`wrote recorded replies for ${Object.keys(transactions).length} transactions`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
