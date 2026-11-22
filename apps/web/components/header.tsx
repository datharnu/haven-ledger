import Link from "next/link";
import { ThemeToggle } from "./theme";

export function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden="true" className="shrink-0">
      <rect x="1" y="1" width="26" height="26" rx="6" fill="none" stroke="var(--color-line)" strokeWidth="1.25" />
      <path d="M6 10h16" stroke="var(--color-client)" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 18h16" stroke="var(--color-freelancer)" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 7v14" stroke="var(--color-brand)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1080px] items-center justify-between gap-4 px-5">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 text-ink">
          <Mark />
          <span className="truncate text-[15px] font-medium tracking-[-0.025em]">
            <span className="text-brand">Haven</span> Ledger
          </span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Pages">
          <Link href="/" className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-muted transition-colors hover:bg-raise hover:text-ink">
            Ledger
          </Link>
          <Link
            href="/verify"
            className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-muted transition-colors hover:bg-raise hover:text-ink"
          >
            Check
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
