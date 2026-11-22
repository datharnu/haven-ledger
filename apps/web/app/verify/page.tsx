import { VerifyDesk } from "@/components/verify-desk";
import scenes from "@/lib/fixtures/scenes.json";

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
        reads the Native receipt through this site. A failure to reach the testnet is not a pass. Nothing is sent.
      </p>
      <div className="mt-8">
        <VerifyDesk autostart={params.check === "1"} />
      </div>
    </main>
  );
}
