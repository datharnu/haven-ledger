/**
 * Who may be trusted in `qday-receipts`.
 *
 * Anyone can write a receipt into `qday-receipts`. A receipt belongs to a Haven Ledger only when
 * its `sender` is that ledger's own `qor1` address (`ledgerAccount()` on the contract). Only the
 * ledger's EVM code can act as that address, and it writes only inside `pay` or `refund`.
 *
 * This file has no imports on purpose: `apps/web/lib/receipt.ts` is a byte-for-byte copy, and a
 * test in each package keeps them equal.
 */

export type ReceiptRow = { id: string; sender: string; note: string; height: string };

/** `uqor` is set only on a native-QOR ledger's note (`HavenLedgerQor`), which states the payout in bank units. */
export type LedgerNote = { nonce: bigint; commitment: string; memo: string; uqor?: bigint };

export type ReceiptCheckLine = { label: string; ok: boolean; detail: string };

export type ReceiptCheck = {
  ok: boolean;
  /** One sentence: why the receipt is accepted or rejected. */
  reason: string;
  /** Every check that ran, in order. The sender check is always first. */
  checks: ReceiptCheckLine[];
  /** Set only when the sender matched and the note parsed. */
  note?: LedgerNote;
};

/** What the EVM lane says this receipt must be. Each field is optional and checked only when given. */
export type ReceiptExpect = { id?: string; note?: string; height?: string };

const QOR1 = /^qor1[02-9ac-hj-np-z]{38,58}$/;
const NOTE = /^haven-ledger v1 n=(0|[1-9][0-9]{0,19}) c=(0x[0-9a-f]{64})(?: a=(0|[1-9][0-9]{0,38})uqor)?(?: m=([\s\S]+))?$/;
/** One bank `uqor` in EVM wei. A QOR ledger stores and emits wei. */
const UQOR_WEI = 1_000_000_000_000n;

/**
 * Parses the note `NativeReceipt.note` builds, `haven-ledger v1 n=<nonce> c=<commitment>[ m=<memo>]`,
 * and the QOR ledger's, which adds ` a=<amount>uqor` before the memo.
 */
export function parseLedgerNote(note: string): LedgerNote | null {
  const match = NOTE.exec(note);
  if (!match || !match[1] || !match[2]) return null;
  const parsed: LedgerNote = { nonce: BigInt(match[1]), commitment: match[2], memo: match[4] ?? "" };
  if (match[3] !== undefined) parsed.uqor = BigInt(match[3]);
  return parsed;
}

/**
 * Accepts a `qday-receipts` row as this ledger's receipt only when `receipt.sender === ledgerQor1`.
 * A matching note from any other sender is rejected: the note is public and can be copied.
 */
export function verifyLedgerReceipt(receipt: ReceiptRow, ledgerQor1: string, expect: ReceiptExpect = {}): ReceiptCheck {
  if (!QOR1.test(ledgerQor1)) throw new Error(`${ledgerQor1} is not a qor1 address`);
  const checks: ReceiptCheckLine[] = [];

  const senderOk = receipt.sender === ledgerQor1;
  checks.push({
    label: "Sender",
    ok: senderOk,
    detail: senderOk
      ? `${receipt.sender} is the ledger's own qor1 address.`
      : `${receipt.sender} is not the ledger (${ledgerQor1}).`,
  });
  if (!senderOk) {
    return {
      ok: false,
      reason: "Rejected: another account wrote this receipt. Anyone can write to qday-receipts, so only the ledger's own sender counts.",
      checks,
    };
  }

  const note = parseLedgerNote(receipt.note);
  checks.push({
    label: "Note",
    ok: note !== null,
    detail: note
      ? `haven-ledger v1, payout ${note.nonce.toString()}${note.uqor === undefined ? "" : `, ${note.uqor.toString()} uqor`}`
      : "The note is not a haven-ledger v1 note.",
  });
  if (!note) return { ok: false, reason: "Rejected: the ledger's sender wrote a note this check cannot read.", checks };

  const mismatches: string[] = [];
  if (expect.id !== undefined) {
    const ok = receipt.id === expect.id;
    checks.push({ label: "Receipt id", ok, detail: ok ? `${receipt.id} matches the stored payout.` : `${receipt.id}, expected ${expect.id}.` });
    if (!ok) mismatches.push("receipt id");
  }
  if (expect.note !== undefined) {
    const ok = receipt.note === expect.note;
    checks.push({ label: "Payout", ok, detail: ok ? "The note names this payout's commitment." : "The note names a different payout." });
    if (!ok) mismatches.push("note");
  }
  if (expect.height !== undefined) {
    const ok = receipt.height === expect.height;
    checks.push({ label: "Native height", ok, detail: ok ? `${receipt.height} matches the stored payout.` : `${receipt.height}, expected ${expect.height}.` });
    if (!ok) mismatches.push("height");
  }
  if (mismatches.length > 0) {
    return { ok: false, reason: `Rejected: the ledger's receipt does not match the EVM payout (${mismatches.join(", ")}).`, checks, note };
  }
  return { ok: true, reason: "Accepted: the ledger wrote this receipt.", checks, note };
}

/** One stored `HavenLedger.payout(id)`, with the `Moved` event seen for it, if any. */
export type PayoutRow = {
  id: bigint;
  to: string;
  refund: boolean;
  amount: bigint;
  receiptId: bigint;
  nativeHeight: bigint;
  commitment: string;
  /** The `Moved` event for this id, or null when none was found in the scanned blocks. */
  moved: { to: string; refund: boolean; amount: bigint; receiptId: bigint; nativeHeight: bigint; commitment: string; tx: string } | null;
};

export type Reconciliation = {
  matched: { payout: bigint; receipt: string; refund: boolean; amount: bigint; tx: string | null }[];
  /** Receipts in the book from any other sender. Never counted as the ledger's. */
  otherSenders: { id: string; sender: string }[];
  mismatches: string[];
};

/**
 * Matches every receipt the ledger sent against every stored payout, both ways.
 * A receipt from the ledger with no payout, a payout with no receipt from the ledger, a missing
 * `Moved` event, or any differing field is a mismatch.
 */
export function reconcile(receipts: ReceiptRow[], payouts: PayoutRow[], ledgerQor1: string): Reconciliation {
  const matched: Reconciliation["matched"] = [];
  const otherSenders: Reconciliation["otherSenders"] = [];
  const mismatches: string[] = [];
  const byId = new Map<string, PayoutRow>();
  for (const payout of payouts) byId.set(payout.id.toString(), payout);
  const claimed = new Set<string>();

  for (const receipt of receipts) {
    const check = verifyLedgerReceipt(receipt, ledgerQor1);
    if (!check.ok && check.checks[0]?.ok === false) {
      otherSenders.push({ id: receipt.id, sender: receipt.sender });
      continue;
    }
    if (!check.note) {
      mismatches.push(`receipt ${receipt.id}: from the ledger, but the note is not a haven-ledger v1 note`);
      continue;
    }
    const key = check.note.nonce.toString();
    const payout = byId.get(key);
    if (!payout) {
      mismatches.push(`receipt ${receipt.id}: names payout ${key}, and the ledger stores no such payout`);
      continue;
    }
    if (claimed.has(key)) {
      mismatches.push(`receipt ${receipt.id}: payout ${key} is already named by another receipt`);
      continue;
    }
    claimed.add(key);
    const wrong: string[] = [];
    if (payout.receiptId.toString() !== receipt.id) wrong.push(`payout stores receipt ${payout.receiptId.toString()}`);
    if (payout.nativeHeight.toString() !== receipt.height) wrong.push(`payout stores height ${payout.nativeHeight.toString()}`);
    if (payout.commitment.toLowerCase() !== check.note.commitment) wrong.push("commitment differs");
    if (check.note.uqor !== undefined && check.note.uqor * UQOR_WEI !== payout.amount) {
      wrong.push(`note says ${check.note.uqor.toString()} uqor, payout stores ${payout.amount.toString()} wei`);
    }
    if (wrong.length > 0) {
      mismatches.push(`receipt ${receipt.id}: ${wrong.join("; ")}`);
      continue;
    }
    const moved = payout.moved;
    if (!moved) {
      mismatches.push(`payout ${key}: no Moved event found`);
      continue;
    }
    const movedWrong: string[] = [];
    if (moved.to.toLowerCase() !== payout.to.toLowerCase()) movedWrong.push("to");
    if (moved.refund !== payout.refund) movedWrong.push("refund");
    if (moved.amount !== payout.amount) movedWrong.push("amount");
    if (moved.receiptId !== payout.receiptId) movedWrong.push("receiptId");
    if (moved.nativeHeight !== payout.nativeHeight) movedWrong.push("nativeHeight");
    if (moved.commitment.toLowerCase() !== payout.commitment.toLowerCase()) movedWrong.push("commitment");
    if (movedWrong.length > 0) {
      mismatches.push(`payout ${key}: Moved differs from storage (${movedWrong.join(", ")})`);
      continue;
    }
    matched.push({ payout: payout.id, receipt: receipt.id, refund: payout.refund, amount: payout.amount, tx: moved.tx });
  }

  for (const payout of payouts) {
    const key = payout.id.toString();
    if (claimed.has(key)) continue;
    mismatches.push(`payout ${key}: no receipt from ${ledgerQor1} names it (stored receipt ${payout.receiptId.toString()})`);
  }
  return { matched, otherSenders, mismatches };
}
