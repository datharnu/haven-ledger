import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLedgerNote, reconcile, verifyLedgerReceipt, type PayoutRow, type ReceiptRow } from "./receipt.js";

const LEDGER = "qor1fdhya5x2lxyecp7fjgk7kzu95fgyu6gcs40yzu";
const SPIKE = "qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl";
const PAYER = "0x4bAb10E94557E5976FDf55cCbe57D269d9Ad5f76";
const PAYEE = "0x22607e19d7017bBdCf94Ce7a9B446F89fD62d530";
const C0 = "0xcdc97ad6e835a6a9777cb73f8be535110576497d540203a5ce050a226887e307";
const C1 = "0xaef0d6832b80b17abe01aee49ceb586799ba33682ab2186a451949716b9831c8";

/** `qday-receipts` receipts 1 to 7 as the Diana LCD returned them on 23 November 2026. */
const BOOK: ReceiptRow[] = [
  { id: "1", sender: "qor14e5dcx0ex2n7x39l645lsyvfnn5at5qnxjz9g7", note: "dry run: coffee for the team", height: "10426682" },
  { id: "2", sender: "qor14e5dcx0ex2n7x39l645lsyvfnn5at5qnxjz9g7", note: "coffee for Phil", height: "10444285" },
  { id: "3", sender: "qor1525xaz9fqpzauna9ah6amh9yku3vh8hs72ag5s", note: "Tuvyy #1: NATIVE 2000000000000000000; Demo grant", height: "10483018" },
  { id: "4", sender: LEDGER, note: `haven-ledger v1 n=0 c=${C0} m=invoice 1`, height: "10543960" },
  { id: "5", sender: LEDGER, note: `haven-ledger v1 n=1 c=${C1}`, height: "10544236" },
  { id: "6", sender: "qor1h08sqh68pcgstpa9vnjwn8vr54xr04mhlfeftc", note: "ORAQLE ETH/USD r2 1712.36000000", height: "10605711" },
  { id: "7", sender: "qor1h08sqh68pcgstpa9vnjwn8vr54xr04mhlfeftc", note: "ORAQLE BTC/USD r2 60768.16500000", height: "10605715" },
];

function payouts(): PayoutRow[] {
  return [
    {
      id: 0n,
      to: PAYEE,
      refund: false,
      amount: 100_000n,
      receiptId: 4n,
      nativeHeight: 10_543_960n,
      commitment: C0,
      moved: { to: PAYEE, refund: false, amount: 100_000n, receiptId: 4n, nativeHeight: 10_543_960n, commitment: C0, tx: "0x915c" },
    },
    {
      id: 1n,
      to: PAYER,
      refund: true,
      amount: 200_000n,
      receiptId: 5n,
      nativeHeight: 10_544_236n,
      commitment: C1,
      moved: { to: PAYER, refund: true, amount: 200_000n, receiptId: 5n, nativeHeight: 10_544_236n, commitment: C1, tx: "0x78a9" },
    },
  ];
}

describe("verifyLedgerReceipt", () => {
  it("accepts receipt 4 from the ledger and reads its note", () => {
    const book = BOOK[3]!;
    const check = verifyLedgerReceipt(book, LEDGER, { id: "4", note: book.note, height: "10543960" });
    expect(check.ok).toBe(true);
    expect(check.checks.map((line) => line.label)).toEqual(["Sender", "Note", "Receipt id", "Payout", "Native height"]);
    expect(check.checks.every((line) => line.ok)).toBe(true);
    expect(check.note).toEqual({ nonce: 0n, commitment: C0, memo: "invoice 1" });
  });

  it("rejects the preflight receipt, which Spike's eth_call simulated and never wrote", () => {
    const preflight = JSON.parse(readFileSync(new URL("../../deployments/preflight.json", import.meta.url), "utf8")) as {
      calls: { record: { text: string } };
    };
    const row = JSON.parse(preflight.calls.record.text) as { id: number; sender: string; note: string; height: number };
    expect(row.sender).toBe(SPIKE);
    const check = verifyLedgerReceipt({ id: String(row.id), sender: row.sender, note: row.note, height: String(row.height) }, LEDGER);
    expect(check.ok).toBe(false);
    expect(check.checks).toHaveLength(1);
    expect(check.checks[0]).toMatchObject({ label: "Sender", ok: false });
    expect(check.reason).toContain("Anyone can write to qday-receipts");
  });

  it("rejects an exact copy of the ledger's note written by anyone else", () => {
    const copy = { ...BOOK[3]!, sender: SPIKE };
    const check = verifyLedgerReceipt(copy, LEDGER, { id: "4", note: BOOK[3]!.note, height: "10543960" });
    expect(check.ok).toBe(false);
    expect(check.note).toBeUndefined();
    expect(check.checks.map((line) => line.label)).toEqual(["Sender"]);
  });

  it("rejects a sender that differs only by case or whitespace", () => {
    expect(verifyLedgerReceipt({ ...BOOK[3]!, sender: LEDGER.toUpperCase() }, LEDGER).ok).toBe(false);
    expect(verifyLedgerReceipt({ ...BOOK[3]!, sender: ` ${LEDGER}` }, LEDGER).ok).toBe(false);
  });

  it("rejects the ledger's receipt when it names a different payout or height", () => {
    const book = BOOK[3]!;
    expect(verifyLedgerReceipt(book, LEDGER, { note: BOOK[4]!.note }).ok).toBe(false);
    const height = verifyLedgerReceipt(book, LEDGER, { height: "10543961" });
    expect(height.ok).toBe(false);
    expect(height.reason).toContain("height");
  });

  it("refuses to run against something that is not a qor1 address", () => {
    expect(() => verifyLedgerReceipt(BOOK[3]!, "0x4B6E4ed0Caf9899c07c9922DEb0b85A2504E6918")).toThrow("not a qor1 address");
    expect(() => verifyLedgerReceipt(BOOK[3]!, "")).toThrow();
  });
});

describe("parseLedgerNote", () => {
  it("reads notes with and without a memo, and nothing else", () => {
    expect(parseLedgerNote(BOOK[4]!.note)).toEqual({ nonce: 1n, commitment: C1, memo: "" });
    expect(parseLedgerNote(`haven-ledger v1 n=0 c=${C0} m=a m=b`)?.memo).toBe("a m=b");
    expect(parseLedgerNote("haven ledger preflight")).toBeNull();
    expect(parseLedgerNote(`haven-ledger v1 n=01 c=${C0}`)).toBeNull();
    expect(parseLedgerNote(`haven-ledger v1 n=0 c=${C0.toUpperCase()}`)).toBeNull();
    expect(parseLedgerNote(`haven-ledger v1 n=0 c=${C0} `)).toBeNull();
  });
});

describe("reconcile", () => {
  it("matches the two recorded payouts to receipts 4 and 5 and sets the other five senders aside", () => {
    const result = reconcile(BOOK, payouts(), LEDGER);
    expect(result.mismatches).toEqual([]);
    expect(result.matched.map((row) => [row.payout, row.receipt, row.refund, row.amount])).toEqual([
      [0n, "4", false, 100_000n],
      [1n, "5", true, 200_000n],
    ]);
    expect(result.otherSenders.map((row) => row.id)).toEqual(["1", "2", "3", "6", "7"]);
  });

  it("a payout with no receipt from the ledger is a mismatch", () => {
    const result = reconcile(BOOK.filter((row) => row.id !== "5"), payouts(), LEDGER);
    expect(result.mismatches).toEqual([`payout 1: no receipt from ${LEDGER} names it (stored receipt 5)`]);
  });

  it("a spoofed copy of a payout's receipt does not stand in for the real one", () => {
    const spoof = { ...BOOK[4]!, id: "8", sender: SPIKE };
    const result = reconcile([...BOOK.filter((row) => row.id !== "5"), spoof], payouts(), LEDGER);
    expect(result.otherSenders.map((row) => row.id)).toContain("8");
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toContain("payout 1: no receipt");
  });

  it("a receipt from the ledger with no stored payout is a mismatch", () => {
    const extra = { id: "9", sender: LEDGER, note: `haven-ledger v1 n=2 c=${C0}`, height: "1" };
    const result = reconcile([...BOOK, extra], payouts(), LEDGER);
    expect(result.mismatches).toEqual(["receipt 9: names payout 2, and the ledger stores no such payout"]);
  });

  it("two ledger receipts for one payout, a wrong height, or a missing Moved event are mismatches", () => {
    const twice = reconcile([...BOOK, { ...BOOK[3]!, id: "9" }], payouts(), LEDGER);
    expect(twice.mismatches).toEqual(["receipt 9: payout 0 is already named by another receipt"]);

    const rows = payouts();
    rows[0]!.nativeHeight = 1n;
    expect(reconcile(BOOK, rows, LEDGER).mismatches[0]).toContain("payout stores height 1");

    const noEvent = payouts();
    noEvent[1]!.moved = null;
    expect(reconcile(BOOK, noEvent, LEDGER).mismatches).toEqual(["payout 1: no Moved event found"]);

    const wrongEvent = payouts();
    wrongEvent[0]!.moved!.amount = 1n;
    expect(reconcile(BOOK, wrongEvent, LEDGER).mismatches).toEqual(["payout 0: Moved differs from storage (amount)"]);
  });
});

describe("a native-QOR ledger's notes", () => {
  const QOR_LEDGER = "qor1qg5ega6dykkxc307y25pecuufrjkxkaggkkxh7nad0vhyhtuhw3sqaa3c5";
  const qorPayout = (amount: bigint): PayoutRow => ({
    id: 0n,
    to: PAYEE,
    refund: false,
    amount,
    receiptId: 9n,
    nativeHeight: 11n,
    commitment: C0,
    moved: { to: PAYEE, refund: false, amount, receiptId: 9n, nativeHeight: 11n, commitment: C0, tx: "0x01" },
  });
  const qorReceipt: ReceiptRow = { id: "9", sender: QOR_LEDGER, note: `haven-ledger v1 n=0 c=${C0} a=1000000uqor m=invoice 1`, height: "11" };

  it("reads the amount in uqor, with and without a memo", () => {
    expect(parseLedgerNote(qorReceipt.note)).toEqual({ nonce: 0n, commitment: C0, memo: "invoice 1", uqor: 1_000_000n });
    expect(parseLedgerNote(`haven-ledger v1 n=3 c=${C0} a=1uqor`)).toEqual({ nonce: 3n, commitment: C0, memo: "", uqor: 1n });
    expect(parseLedgerNote(`haven-ledger v1 n=0 c=${C0} a=01uqor`)).toBeNull();
    expect(parseLedgerNote(`haven-ledger v1 n=0 c=${C0} a=1QOR`)).toBeNull();
    // On an fUSD note the same text is only memo.
    expect(parseLedgerNote(`haven-ledger v1 n=0 c=${C0} m=a=5uqor`)).toEqual({ nonce: 0n, commitment: C0, memo: "a=5uqor" });
  });

  it("shows the amount on the Note line", () => {
    const check = verifyLedgerReceipt(qorReceipt, QOR_LEDGER);
    expect(check.ok).toBe(true);
    expect(check.checks[1]?.detail).toBe("haven-ledger v1, payout 0, 1000000 uqor");
  });

  it("matches when the note's uqor times 1e12 is the stored wei, and not otherwise", () => {
    expect(reconcile([qorReceipt], [qorPayout(1_000_000_000_000_000_000n)], QOR_LEDGER).mismatches).toEqual([]);
    expect(reconcile([qorReceipt], [qorPayout(999_999_000_000_000_000n)], QOR_LEDGER).mismatches).toEqual([
      "receipt 9: note says 1000000 uqor, payout stores 999999000000000000 wei",
    ]);
  });
});
