import type { Metadata } from "next";
import localFont from "next/font/local";
import { Header } from "@/components/header";
import "./globals.css";

const sans = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/familjen-grotesk/files/familjen-grotesk-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/familjen-grotesk/files/familjen-grotesk-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
  ],
  variable: "--font-sans",
  display: "swap",
});

const serif = localFont({
  src: "../node_modules/@fontsource/newsreader/files/newsreader-latin-400-italic.woff2",
  variable: "--font-serif",
  display: "swap",
  style: "italic",
  weight: "400",
});

const mono = localFont({
  src: "../node_modules/@fontsource/fragment-mono/files/fragment-mono-latin-400-normal.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "400",
});

export const metadata: Metadata = {
  title: "Haven Ledger",
  description: "Paid only when the Native receipt names that payout.",
  icons: { icon: "/favicon.svg" },
};

const themeScript = `(function(){try{var t=localStorage.getItem("haven-ledger-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-20 focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        <Header />
        <div id="content">{children}</div>
      </body>
    </html>
  );
}
