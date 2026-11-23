/**
 * The native-QOR ledger's recorded scenes. `fixtures/scenes-qor.json` stays empty (`ledger: null`)
 * until `npm run fixture:qor` copies hashes from `deployments/ledger-qor*.json`. The fixture names
 * the hashes to read; the verdict still comes from the chain.
 */
import fixture from "./fixtures/scenes-qor.json";
import type { Expect } from "./check";

export type QorScene = {
  scene: number;
  title: string;
  hash: string | null;
  record: string;
  expect: Expect;
};

export type QorFixture = {
  recordedOn: string | null;
  network: string;
  chainId: number;
  ledger: string | null;
  ledgerAccount: string | null;
  payer: { qor: string; evm: string } | null;
  payee: { qor: string; evm: string } | null;
  receipts: string;
  scenes: QorScene[];
};

export const qorScenes = fixture as QorFixture;

/** True once a QOR ledger has been deployed and its scenes recorded. */
export function hasQorScenes(source: QorFixture = qorScenes): boolean {
  return source.ledger !== null && source.ledgerAccount !== null && source.scenes.length > 0;
}

/** The two accounts whose x/bank balance the page may read: the QOR ledger's payer and payee. */
export function bankAccounts(source: QorFixture = qorScenes): string[] {
  if (!hasQorScenes(source)) return [];
  return [source.payer?.qor, source.payee?.qor].filter((value): value is string => typeof value === "string");
}
