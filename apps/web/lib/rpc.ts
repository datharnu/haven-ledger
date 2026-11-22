import type { Hex } from "viem";
import { CallError, EVM_RPC, NETWORK, NetworkError, type NativeReceipt, type Rpc } from "./check";

/** Reads the public EVM RPC. A failed fetch is a network error, never a pass. */
export function browserRpc(): Rpc {
  return async (method, params) => {
    let response: Response;
    try {
      response = await fetch(EVM_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    } catch {
      throw new NetworkError();
    }
    if (!response.ok) throw new NetworkError();
    let body: { result?: unknown; error?: { message?: string; data?: unknown } };
    try {
      body = (await response.json()) as { result?: unknown; error?: { message?: string; data?: unknown } };
    } catch {
      throw new NetworkError();
    }
    if (body.error) {
      const data = typeof body.error.data === "string" && body.error.data.startsWith("0x") ? (body.error.data as Hex) : undefined;
      throw new CallError(body.error.message ?? "The testnet refused the read.", data);
    }
    if (body.result === undefined) throw new NetworkError();
    return body.result;
  };
}

export async function browserNative(id: bigint): Promise<NativeReceipt> {
  let response: Response;
  try {
    response = await fetch(`/native-receipt/${id.toString()}`);
  } catch {
    throw new NetworkError();
  }
  if (response.status === 400) throw new Error("This page will not query that receipt id.");
  if (!response.ok) throw new NetworkError();
  let body: { data?: { id?: number; sender?: string; note?: string; height?: number } };
  try {
    body = (await response.json()) as { data?: { id?: number; sender?: string; note?: string; height?: number } };
  } catch {
    throw new NetworkError();
  }
  const row = body.data;
  if (!row || row.id === undefined || !row.sender || row.note === undefined || row.height === undefined) {
    throw new NetworkError();
  }
  return { id: String(row.id), sender: row.sender, note: row.note, height: String(row.height) };
}

export const NETWORK_LABEL = NETWORK;
