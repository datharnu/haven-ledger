/**
 * The receipt Spike's preflight `eth_call` simulated on 22 November 2026, copied from
 * `deployments/preflight.json` (`calls.record.text`). It was never written to the chain:
 * `eth_call` changes nothing. Its sender is Spike, not the ledger, which is exactly what a
 * receipt written straight into `qday-receipts` by someone else looks like.
 * A test keeps this copy equal to the file.
 */
import type { ReceiptRow } from "./receipt";

export const PREFLIGHT_BLOCK = "10542384";

export const PREFLIGHT_RECEIPT: ReceiptRow = {
  id: "4",
  sender: "qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl",
  note: "haven ledger preflight",
  height: "10542385",
};
