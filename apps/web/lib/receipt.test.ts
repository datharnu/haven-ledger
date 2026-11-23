import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import scenes from "./fixtures/scenes.json";
import { verifyLedgerReceipt } from "./receipt";
import { PREFLIGHT_BLOCK, PREFLIGHT_RECEIPT } from "./spoof";

describe("the page's receipt check", () => {
  it("is the same file as src/ts/receipt.ts", () => {
    const page = readFileSync(new URL("./receipt.ts", import.meta.url), "utf8");
    const root = readFileSync(new URL("../../../src/ts/receipt.ts", import.meta.url), "utf8");
    expect(page).toBe(root);
  });

  it("shows the preflight receipt exactly as deployments/preflight.json recorded it", () => {
    const preflight = JSON.parse(readFileSync(new URL("../../../deployments/preflight.json", import.meta.url), "utf8")) as {
      block: string;
      spike: { qor1: string };
      calls: { record: { text: string } };
    };
    const row = JSON.parse(preflight.calls.record.text) as { id: number; sender: string; note: string; height: number };
    expect(PREFLIGHT_RECEIPT).toEqual({ id: String(row.id), sender: row.sender, note: row.note, height: String(row.height) });
    expect(PREFLIGHT_BLOCK).toBe(preflight.block);
    expect(PREFLIGHT_RECEIPT.sender).toBe(preflight.spike.qor1);
    expect(PREFLIGHT_RECEIPT.sender).toBe(scenes.spike.qor);
  });

  it("rejects the preflight receipt on the sender check alone", () => {
    const check = verifyLedgerReceipt(PREFLIGHT_RECEIPT, scenes.ledgerAccount);
    expect(check.ok).toBe(false);
    expect(check.checks).toEqual([
      { label: "Sender", ok: false, detail: `${PREFLIGHT_RECEIPT.sender} is not the ledger (${scenes.ledgerAccount}).` },
    ]);
  });
});
