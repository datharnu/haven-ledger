"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-[1080px] px-5 py-16">
      <p className="text-[12px] tracking-[0.14em] text-refused uppercase">The page failed</p>
      <h1 className="mt-3 text-3xl font-medium tracking-[-0.03em]">The ledger did not open.</h1>
      <p className="mt-3 max-w-[46ch] text-muted">Nothing was sent. The recorded hashes are still in the repository.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-flex h-11 items-center rounded-lg bg-action px-4 text-sm font-medium text-on-action"
      >
        Try again
      </button>
    </main>
  );
}
