/**
 * Shared by the native-QOR ledger scripts. Every script that can broadcast prints its plan and
 * stops unless `--broadcast` is on the command line.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getAddress, type Abi, type Address } from "viem";

export const QOR_ARTIFACT = "out/HavenLedgerQor.sol/HavenLedgerQor.json";
export const QOR_DEPLOY = "deployments/ledger-qor.json";
export const QOR_FUND = "deployments/ledger-qor-fund.json";
export const RECEIPTS = "qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8";

/** 5 QOR from ledger-payer's bank balance into the ledger. */
export const FUND_UQOR = 5_000_000n;

export const BROADCAST = process.argv.includes("--broadcast");

export function qorScenePath(scene: number): string {
  return `deployments/ledger-qor-scene-${scene}.json`;
}

export function qorArtifact(): { abi: Abi; bytecode: { object: `0x${string}` } } {
  if (!existsSync(QOR_ARTIFACT)) throw new Error(`${QOR_ARTIFACT} is missing; run /opt/homebrew/bin/forge build`);
  return JSON.parse(readFileSync(QOR_ARTIFACT, "utf8")) as { abi: Abi; bytecode: { object: `0x${string}` } };
}

export type AccountRow = { name: string; evm: Address; qor1: string };

export function named(name: string): AccountRow {
  const file = JSON.parse(readFileSync("deployments/accounts.json", "utf8")) as { accounts: AccountRow[] };
  const row = file.accounts.find((account) => account.name === name);
  if (!row?.evm || !row.qor1) throw new Error(`no ${name} in deployments/accounts.json`);
  return { name, evm: getAddress(row.evm), qor1: row.qor1 };
}

/** Spike's EVM address, as the recorded fUSD deploy names it. Read without touching the key file. */
export function spikeAddress(): Address {
  const doc = JSON.parse(readFileSync("deployments/ledger.json", "utf8")) as { deployer?: Address };
  if (!doc.deployer) throw new Error("deployments/ledger.json has no deployer");
  return getAddress(doc.deployer);
}

export type QorLedger = {
  ledger: Address;
  ledgerAccount: string;
  payer: Address;
  payee: Address;
  payerQor: string;
  payeeQor: string;
  receipts: string;
};

export type QorDeployReport = {
  network: string;
  ranAt?: string;
  ok: boolean;
  asset?: "uqor";
  ledger?: Address;
  ledgerAccount?: string;
  constructorArgs?: { payer: Address; payee: Address; receipts: string };
  accounts?: { payer: string; payee: string };
  deployer?: Address;
  transactions: { hash: string; note: string; gasUsed?: string; fee?: string }[];
};

export function qorLedgerExists(): boolean {
  if (!existsSync(QOR_DEPLOY)) return false;
  const doc = JSON.parse(readFileSync(QOR_DEPLOY, "utf8")) as QorDeployReport;
  return doc.ok === true;
}

export function qorLedgerDoc(): QorLedger {
  if (!existsSync(QOR_DEPLOY)) throw new Error(`${QOR_DEPLOY} does not exist; run npm run deploy:qor first`);
  const doc = JSON.parse(readFileSync(QOR_DEPLOY, "utf8")) as QorDeployReport;
  if (!doc.ok || !doc.ledger || !doc.ledgerAccount || !doc.constructorArgs || !doc.accounts) {
    throw new Error(`${QOR_DEPLOY} is not ok`);
  }
  return {
    ledger: getAddress(doc.ledger),
    ledgerAccount: doc.ledgerAccount,
    payer: getAddress(doc.constructorArgs.payer),
    payee: getAddress(doc.constructorArgs.payee),
    payerQor: doc.accounts.payer,
    payeeQor: doc.accounts.payee,
    receipts: doc.constructorArgs.receipts,
  };
}

export function loadJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function formatUqor(uqor: bigint): string {
  const whole = uqor / 1_000_000n;
  const frac = (uqor % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${uqor.toString()} uqor (${whole.toString()}${frac ? `.${frac}` : ""} QOR)`;
}

export function planOnly(lines: string[]): void {
  console.log("PLAN (nothing was signed or sent)");
  for (const line of lines) console.log(`  ${line}`);
  console.log("Re-run with -- --broadcast to sign and send.");
}
