import { SpoofCard } from "@/components/spoof-card";
import { VerifyDesk } from "@/components/verify-desk";
import scenes from "@/lib/fixtures/scenes.json";
import { hasQorScenes, qorScenes } from "@/lib/qor-scenes";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ check?: string }> }) {
  const params = await searchParams;
  return (
    <main className="mx-auto max-w-[1080px] px-5 pt-12 pb-28 sm:pt-16">
      <p className="num text-[12px] tracking-[0.14em] text-muted uppercase">
        {scenes.network} · EVM chain {scenes.chainId}
      </p>
      <h1 className="mt-4 max-w-[18ch] text-[34px] leading-[1.08] font-medium tracking-[-0.03em] sm:text-[48px]">
        Verify <span className="serif text-muted">both lanes.</span>
      </h1>
      <p className="mt-4 max-w-[62ch] text-[16px] leading-[1.6] text-muted">
        Each scene is read from the testnet. The page decodes the call, checks the payer&apos;s ML-DSA-87 signature, and
        reads the Native receipt through this site. A receipt counts only when its sender is the ledger&apos;s own qor1 address
        (<span className="num text-[14px] break-all text-ink">{scenes.ledgerAccount}</span>). A failure to reach the testnet is not a pass. Nothing is sent.
      </p>
      <div className="mt-8">
        <VerifyDesk autostart={params.check === "1"} />
      </div>
      {hasQorScenes() ? (
        <section aria-labelledby="qor-ledger" className="mt-20 border-t border-line pt-12">
          <h2 id="qor-ledger" className="max-w-[24ch] text-[28px] leading-[1.1] font-medium tracking-[-0.03em] sm:text-[36px]">
            Native QOR. <span className="serif text-muted">The payout is a bank balance.</span>
          </h2>
          <p className="mt-4 max-w-[62ch] text-[16px] leading-[1.6] text-muted">
            A second ledger pays native QOR instead of fUSD. The EVM denom on this chain is uqor, so the payout lands in the
            recipient&apos;s x/bank balance in the same transaction as the receipt. Each payout is also checked on the bank lane:
            the recipient&apos;s uqor balance across that block must change by exactly the payout. Ledger{" "}
            <span className="num text-[14px] break-all text-ink">{qorScenes.ledgerAccount}</span>
            {qorScenes.recordedOn ? `, recorded ${qorScenes.recordedOn}` : ""}.
          </p>
          <div className="mt-8">
            <VerifyDesk autostart={false} asset="qor" />
          </div>
        </section>
      ) : null}
      <SpoofCard />
    </main>
  );
}
