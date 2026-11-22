import Link from "next/link";
import scenes from "@/lib/fixtures/scenes.json";

export default function Home() {
  return (
    <main className="mx-auto max-w-[1080px] px-5 pt-12 pb-28 sm:pt-20">
      <p className="num text-[12px] tracking-[0.14em] text-muted uppercase">
        {scenes.network} · EVM chain {scenes.chainId} · Recorded {scenes.recordedOn}
      </p>
      <h1 className="mt-4 max-w-[16ch] text-[38px] leading-[1.06] font-medium tracking-[-0.035em] text-ink sm:text-[54px]">
        Paid only when the Native receipt <span className="serif text-muted">names that payout.</span>
      </h1>
      <p className="mt-5 max-w-[58ch] text-[17px] leading-[1.6] text-muted">
        fUSD leaves only for the two names on the line, only with a fresh ML-DSA-87 signature from the payer, and only
        together with a receipt in qday-receipts. If either lane refuses, neither changes.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          href="/verify?check=1"
          className="inline-flex h-11 items-center rounded-lg bg-action px-5 text-[15px] font-medium text-on-action transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          Verify both lanes
        </Link>
        <a href="#record" className="inline-flex h-11 items-center px-2 text-[14px] text-muted underline underline-offset-4 hover:text-ink">
          Read the seven scenes
        </a>
      </div>

      <figure className="mt-12 overflow-hidden rounded-2xl border border-line bg-[#f3f0e8]">
        <img src="/cover.png" alt="Haven Ledger. Two lanes joined by one line." width={1200} height={675} className="block h-auto w-full" />
      </figure>

      <section id="record" className="mt-20 border-t border-line pt-14 sm:mt-24 sm:pt-16">
        <p className="text-[12px] font-medium tracking-[0.12em] text-muted uppercase">The record · {scenes.recordedOn}</p>
        <h2 className="mt-3 max-w-[22ch] text-[28px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[36px]">
          Seven scenes. This list is not the verdict.
        </h2>
        <p className="mt-4 max-w-[62ch] text-[15px] leading-[1.65] text-muted">
          The lines below are copied from <span className="num text-[13px] text-ink">deployments/</span>. Verify both lanes
          reads the testnet again and does not trust them.
        </p>
        <ol className="mt-8 divide-y divide-line border-t border-b border-line">
          {scenes.scenes.map((scene) => (
            <li key={scene.scene} className="grid gap-2 py-5 sm:grid-cols-[160px_minmax(0,1fr)]">
              <p className="text-[15px] font-medium text-ink">
                Scene {scene.scene}
                <span className="mt-1 block text-[13px] font-normal text-muted">{scene.title}</span>
              </p>
              <div className="min-w-0">
                <p className="text-[15px] leading-[1.6] break-words text-muted">{scene.record}</p>
                {scene.hash ? <p className="num mt-2 text-[12px] break-all text-faint">{scene.hash}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14">
        <p className="text-[12px] font-medium tracking-[0.12em] text-muted uppercase">The two names · {scenes.network}</p>
        <dl className="mt-4 grid gap-px overflow-hidden rounded-xl bg-line shadow-[inset_0_0_0_1px_var(--color-line)] sm:grid-cols-2">
          <Address term="Ledger" value={scenes.ledger} extra={scenes.ledgerAccount} />
          <Address term="Payer" value={scenes.payer.evm} extra={scenes.payer.qor} />
          <Address term="Payee" value={scenes.payee.evm} extra={scenes.payee.qor} />
          <Address term="fUSD · testnet token" value={scenes.token} />
          <Address term="qday-receipts" value={scenes.receipts} />
          <Address term="Spike · relayer, not a party" value={scenes.spike.evm} extra={scenes.spike.qor} />
        </dl>
      </section>

      <section id="limits" className="mt-20 border-t border-line pt-14 sm:mt-24 sm:pt-16">
        <p className="text-[12px] font-medium tracking-[0.12em] text-muted uppercase">Limits</p>
        <h2 className="mt-3 max-w-[24ch] text-[28px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[36px]">
          What this does not prove.
        </h2>
        <dl className="mt-8 divide-y divide-line border-t border-b border-line">
          <div className="grid gap-2 py-4 sm:grid-cols-[240px_minmax(0,1fr)]">
            <dt className="text-[15px] font-medium text-ink">A receipt with the wrong sender</dt>
            <dd className="text-[15px] text-muted">
              Anyone can write to qday-receipts. A receipt belongs to this ledger only when its sender is the ledger&apos;s
              own qor1. A reader who skips that check can be fooled.
            </dd>
          </div>
          <div className="grid gap-2 py-4 sm:grid-cols-[240px_minmax(0,1fr)]">
            <dt className="text-[15px] font-medium text-ink">A hosted page or a film</dt>
            <dd className="text-[15px] text-muted">
              This copy runs from the repository. There is no public URL yet, and the film has not been recorded.
            </dd>
          </div>
          <div className="grid gap-2 py-4 sm:grid-cols-[240px_minmax(0,1fr)]">
            <dt className="text-[15px] font-medium text-ink">Scene 8</dt>
            <dd className="text-[15px] text-muted">
              It was not run. A window that hides the bridge cannot be previewed with eth_call, and a broadcast would have
              been a valid pay.
            </dd>
          </div>
          <div className="grid gap-2 py-4 sm:grid-cols-[240px_minmax(0,1fr)]">
            <dt className="text-[15px] font-medium text-ink">Real value, or mainnet</dt>
            <dd className="text-[15px] text-muted">Testnet only. fUSD has no value.</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

function Address({ term, value, extra }: { term: string; value: string; extra?: string }) {
  return (
    <div className="bg-surface px-4 py-4">
      <dt className="text-[12px] text-faint">{term}</dt>
      <dd className="num mt-1 text-[13px] break-all text-ink">{value}</dd>
      {extra ? <dd className="num mt-1 text-[12px] break-all text-muted">{extra}</dd> : null}
    </div>
  );
}
