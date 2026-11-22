"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
      <circle cx="8" cy="8" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1.25v1.6M8 13.15v1.6M1.25 8h1.6M13.15 8h1.6M3.05 3.05l1.15 1.15M11.8 11.8l1.15 1.15M3.05 12.95l1.15-1.15M11.8 4.2l1.15-1.15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
      <path
        d="M13.2 9.4A5.1 5.1 0 0 1 6.6 2.7 5.4 5.4 0 1 0 13.2 9.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next: Theme = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    const apply = () => {
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("haven-ledger-theme", next);
      } catch {
        // Private mode can block storage. The theme still applies for this visit.
      }
      setTheme(next);
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && "startViewTransition" in document) {
      document.startViewTransition(apply);
      return;
    }
    apply();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line text-muted transition-colors hover:bg-raise hover:text-ink active:scale-95"
    >
      {theme === "light" ? <MoonIcon /> : theme === "dark" ? <SunIcon /> : <span className="block h-4 w-4" aria-hidden="true" />}
    </button>
  );
}
