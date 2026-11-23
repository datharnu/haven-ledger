import scenes from "@/lib/fixtures/scenes.json";
import { verifyLedgerReceipt } from "@/lib/receipt";
import { PREFLIGHT_BLOCK, PREFLIGHT_RECEIPT } from "@/lib/spoof";

/** The same sender check the scenes use, run on a receipt the ledger did not write. Nothing is read or sent. */
export function SpoofCard() {
  const check = verifyLedgerReceipt(PREFLIGHT_RECEIPT, scenes.ledgerAccount);
  return (
    <section aria-labelledby="spoof" className="mt-14 border-t border-line pt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="spoof" className="text-[18px] font-medium tracking-[-0.02em] text-ink">
          Spoofed receipt example
        </h2>
        <span className="rounded-full bg-refused-soft px-2.5 py-0.5 text-[11px] font-medium tracking-[0.04em] text-refused uppercase">
          {check.ok ? "Accepted" : "Rejected"}
        </span>
      </div>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-[1.6] text-muted">
        Anyone can write to qday-receipts, so a receipt counts only when its sender is the ledger&apos;s own qor1 address.
        This row is the receipt Spike&apos;s preflight eth_call simulated at block {PREFLIGHT_BLOCK} (copied from
        deployments/preflight.json). It was never written to the chain. It is shown because its sender is not the ledger,
        which is what a receipt written straight into qday-receipts by someone else looks like. A copy of the
        ledger&apos;s exact note from another sender is rejected the same way.
      </p>
      <dl className="mt-4 grid gap-3 rounded-xl bg-surface p-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:grid-cols-2">
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-[12px] text-faint">Simulated receipt (not on chain)</dt>
          <dd className="num mt-1 text-[13px] break-all text-muted">
            id {PREFLIGHT_RECEIPT.id} · sender {PREFLIGHT_RECEIPT.sender} · note &quot;{PREFLIGHT_RECEIPT.note}&quot; · height{" "}
            {PREFLIGHT_RECEIPT.height}
          </dd>
        </div>
        {check.checks.map((line) => (
          <div key={line.label} className="min-w-0 sm:col-span-2">
            <dt className="text-[12px] text-faint">{line.label} check</dt>
            <dd className="num mt-1 text-[13px] break-all text-muted">
              {line.ok ? "Matches" : "Rejected"}: {line.detail}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-[1.6] text-ink">{check.reason}</p>
    </section>
  );
}
