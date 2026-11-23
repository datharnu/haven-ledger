/**
 * Writes lib/fixtures/scenes-qor.json from deployments/ledger-qor*.json. Reads local files only:
 * no network, no key. Hashes and the recorded outcome only; signatures are not copied.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../../deployments/", import.meta.url);
const out = new URL("../lib/fixtures/scenes-qor.json", import.meta.url);

type SceneDoc = {
  ok?: boolean;
  scene: number;
  ranAt?: string;
  transactions?: { hash: string; note: string }[];
  nativeCountBefore?: number;
  nativeCountAfter?: number;
  receipt?: { id: string; height: string };
  bank?: { account: string; delta: string; height: string };
  result?: Record<string, string>;
};

const TITLES: Record<number, string> = {
  1: "Pay the payee 1 QOR",
  2: "A note the receipt book refuses",
  3: "More QOR than the ledger holds",
  4: "A signature that is not the payer's",
  5: "The first signature, sent again",
  6: "Refund the payer 2 QOR",
};
/** What each scene must show on chain. Nonces follow the order the scenes run in. */
const EXPECT: Record<number, unknown> = {
  1: { outcome: "agreed", signedNonce: 0 },
  2: { outcome: "refused", reason: "the note must be 1 to 140 characters", signedNonce: 1 },
  3: { outcome: "refused", reason: "InsufficientBalance", signedNonce: 1 },
  4: { outcome: "refused", reason: "SignatureInvalid", signedNonce: null },
  5: { outcome: "refused", reason: "SignatureInvalid", signedNonce: 0 },
  6: { outcome: "agreed", signedNonce: 1 },
};

function read<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, root), "utf8")) as T;
}

function main(): void {
  if (!existsSync(new URL("ledger-qor.json", root))) throw new Error("deployments/ledger-qor.json does not exist");
  const deploy = read<{ ok?: boolean; ledger?: string; ledgerAccount?: string; constructorArgs?: { payer: string; payee: string; receipts: string }; accounts?: { payer: string; payee: string } }>("ledger-qor.json");
  if (!deploy.ok || !deploy.ledger || !deploy.ledgerAccount || !deploy.constructorArgs || !deploy.accounts) {
    throw new Error("deployments/ledger-qor.json is not ok");
  }
  const scenes = [];
  let recordedOn: string | null = null;
  for (let scene = 1; scene <= 6; scene++) {
    const name = `ledger-qor-scene-${scene}.json`;
    if (!existsSync(new URL(name, root))) break;
    const doc = read<SceneDoc>(name);
    if (!doc.ok) break;
    const evm = (doc.transactions ?? []).find((tx) => tx.hash.startsWith("0x"));
    if (!evm) throw new Error(`${name} has no EVM hash`);
    const counts = `Count ${doc.nativeCountBefore} to ${doc.nativeCountAfter}.`;
    const record = doc.bank && doc.receipt
      ? `Receipt ${doc.receipt.id} at height ${doc.receipt.height}. ${counts} Native bank ${doc.bank.account} +${doc.bank.delta} uqor.`
      : `Reverted. ${counts.replace(/Count (\d+) to \d+\./, "Count stayed $1.")} ${doc.result?.reason ?? ""}`.trim();
    scenes.push({ scene, title: TITLES[scene], hash: evm.hash, record, expect: EXPECT[scene] });
    if (doc.ranAt) recordedOn = new Date(doc.ranAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }
  const fixture = {
    recordedOn,
    network: "qorechain-diana",
    chainId: 9800,
    ledger: deploy.ledger,
    ledgerAccount: deploy.ledgerAccount,
    payer: { qor: deploy.accounts.payer, evm: deploy.constructorArgs.payer },
    payee: { qor: deploy.accounts.payee, evm: deploy.constructorArgs.payee },
    receipts: deploy.constructorArgs.receipts,
    scenes,
  };
  writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${scenes.length} QOR scenes`);
}

main();
