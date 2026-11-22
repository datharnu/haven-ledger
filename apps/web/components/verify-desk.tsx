"use client";

import { useEffect, useRef, useState } from "react";
import scenes from "@/lib/fixtures/scenes.json";
import { NETWORK, NO_HASH, verifyScene, type Expect, type Outcome, type Verdict } from "@/lib/check";
import { browserNative, browserRpc } from "@/lib/rpc";

type Row = {
  scene: number;
  hash: string | null;
  state: "idle" | "reading" | "done";
  verdict?: Verdict;
};

const CHIP: Record<Outcome | "idle" | "reading", { label: string; className: string }> = {
  idle: { label: "Not checked", className: "bg-held-soft text-held" },
  reading: { label: "Reading the testnet", className: "bg-brand-soft text-brand" },
  agreed: { label: "Both lanes agree", className: "bg-paid-soft text-paid" },
  refused: { label: "Refused", className: "bg-refused-soft text-refused" },
  failed: { label: "Does not match", className: "bg-refused-soft text-refused" },
  offline: { label: NETWORK, className: "bg-held-soft text-held" },
  "no-hash": { label: "No hash", className: "bg-held-soft text-held" },
};

function chipOf(row: Row) {
  if (row.state === "idle") return CHIP.idle;
  if (row.state === "reading") return CHIP.reading;
  return CHIP[row.verdict?.outcome ?? "failed"];
}

export function VerifyDesk({ autostart }: { autostart: boolean }) {
  const [rows, setRows] = useState<Row[]>(() => scenes.scenes.map((scene) => ({ scene: scene.scene, hash: scene.hash, state: "idle" })));
  const [running, setRunning] = useState(false);
  const started = useRef(false);

  async function run() {
    if (running) return;
    setRunning(true);
    const rpc = browserRpc();
    const next = scenes.scenes.map((scene) => ({ scene: scene.scene, hash: scene.hash, state: "idle" as const }));
    setRows(next);
    for (let index = 0; index < scenes.scenes.length; index++) {
      const scene = scenes.scenes[index];
      if (!scene) continue;
      setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, state: "reading", verdict: undefined } : row)));
      const verdict = await verifyScene({ scene: scene.scene, hash: scene.hash, expect: scene.expect as Expect }, rpc, browserNative);
      setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, state: "done", verdict } : row)));
    }
    setRunning(false);
  }

  useEffect(() => {
    if (!autostart || started.current) return;
    started.current = true;
    void run();
    // The first visit from the ledger page starts the check once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart]);

  const done = rows.filter((row) => row.state === "done");
  const offline = done.filter((row) => row.verdict?.outcome === "offline");
  const reading = rows.findIndex((row) => row.state === "reading");
  const banner = running
    ? reading >= 0
      ? `Checking ${reading + 1} of ${rows.length}`
      : "Reading the testnet"
    : done.length === 0
      ? "Nothing has been read from the testnet yet."
      : offline.length > 0
        ? NETWORK
        : [
            `${done.length} checked.`,
            `${done.filter((row) => row.verdict?.outcome === "agreed").length} agreed on both lanes.`,
            `${done.filter((row) => row.verdict?.outcome === "refused").length} refused.`,
            `${done.filter((row) => row.verdict?.outcome === "no-hash").length} has no hash.`,
            `${done.filter((row) => row.verdict?.outcome === "failed").length} do not match.`,
          ]
            .filter((part) => !part.startsWith("0 "))
            .join(" ");

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="inline-flex h-11 items-center rounded-lg bg-action px-5 text-[15px] font-medium text-on-action transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
        >
          Verify both lanes
        </button>
        {offline.length > 0 && !running ? (
          <button
            type="button"
            onClick={() => void run()}
            className="inline-flex h-11 items-center rounded-lg bg-raise px-5 text-[15px] text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
          >
            Retry
          </button>
        ) : null}
      </div>
      <p aria-live="polite" className="mt-4 max-w-[62ch] text-[15px] text-muted">
        {banner}
      </p>
      <ol className="mt-8 divide-y divide-line border-t border-line">
        {rows.map((row) => {
          const chip = chipOf(row);
          const verdict = row.verdict;
          return (
            <li key={row.scene} className="py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="text-[18px] font-medium tracking-[-0.02em] text-ink">Scene {row.scene}</h2>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-[0.04em] uppercase ${chip.className}`}>
                  {chip.label}
                </span>
              </div>
              <p className={row.hash ? "num mt-2 text-[12px] break-all text-faint" : "mt-2 max-w-[62ch] text-[15px] text-ink"}>{row.hash ?? NO_HASH}</p>
              {verdict && verdict.outcome !== "no-hash" ? (
                <div className="mt-4 min-w-0">
                  <p className="text-[15px] leading-[1.6] break-words text-ink">{verdict.summary}</p>
                  {verdict.lines.length > 0 ? (
                    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                      {verdict.lines.map((line) => (
                        <div key={line.label} className={line.detail.length > 42 ? "min-w-0 sm:col-span-2" : "min-w-0"}>
                          <dt className="text-[12px] text-faint">{line.label}</dt>
                          <dd className="num mt-1 text-[13px] break-all text-muted">{line.detail}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {verdict.heights ? (
                    <dl className="mt-4 grid gap-3 rounded-xl bg-surface p-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:grid-cols-2">
                      <div>
                        <dt className="text-[12px] text-faint">Native height</dt>
                        <dd className="num mt-1 text-[15px] text-ink">{verdict.heights.native}</dd>
                      </div>
                      <div>
                        <dt className="text-[12px] text-faint">EVM block</dt>
                        <dd className="num mt-1 text-[15px] text-ink">{verdict.heights.evm}</dd>
                      </div>
                    </dl>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
