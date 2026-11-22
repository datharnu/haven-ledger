"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const current = usePathname() === href;
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`inline-flex h-10 items-center rounded-lg px-3 text-sm transition-colors hover:bg-raise hover:text-ink ${current ? "text-ink" : "text-muted"}`}
    >
      {children}
    </Link>
  );
}
