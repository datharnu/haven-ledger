/**
 * Sends 5 QOR (5,000,000 uqor) from ledger-payer's bank balance to the QOR ledger's own qor1 address
 * with a plain x/bank MsgSend. The EVM denom is uqor, so the ledger's EVM balance becomes
 * 5,000,000 x 1e12 wei. Without `--broadcast` it prints the plan and reads balances only.
 * A finished report throws "already ran".
 */
import { evmToQor } from "@qorechain/sdk";
import { getAddress, type Address } from "viem";
import { broadcast, evmClient, loadAccount } from "./lib/chain.js";
import { UQOR_WEI, bankUqor } from "./lib/native.js";
import { BROADCAST, FUND_UQOR, QOR_FUND, formatUqor, loadJson, named, planOnly, qorLedgerDoc, saveJson } from "./lib/qor.js";

/** The MsgSend fee `broadcast` pays (scripts/lib/chain.ts). */
const MSG_FEE = 180_000n;

type Report = {
  network: string;
  ranAt?: string;
  ok: boolean;
  ledger?: Address;
  ledgerAccount?: string;
  from?: string;
  amountUqor?: string;
  hash?: string;
  bankUqor?: string;
  evmWei?: string;
};

async function main(): Promise<void> {
  const report = loadJson<Report>(QOR_FUND, { network: "qorechain-diana", ok: false });
  if (report.ok) throw new Error("already ran");
  const doc = qorLedgerDoc();
  if (evmToQor(doc.ledger) !== doc.ledgerAccount) throw new Error("ledgerAccount is not the bech32 of the ledger");
  const payer = named("ledger-payer");
  if (!report.hash) {
    const [bankLedger, evmLedger, bankPayer] = await Promise.all([
      bankUqor(doc.ledgerAccount),
      evmClient().getBalance({ address: doc.ledger }),
      bankUqor(payer.qor1),
    ]);
    if (bankLedger !== 0n || evmLedger !== 0n) throw new Error(`ledger already holds ${bankLedger} uqor / ${evmLedger} wei`);
    if (bankPayer < FUND_UQOR + MSG_FEE) throw new Error(`ledger-payer holds ${bankPayer} uqor, below ${FUND_UQOR + MSG_FEE}`);
    if (!BROADCAST) {
      planOnly([
        `MsgSend ${formatUqor(FUND_UQOR)} from ledger-payer ${payer.qor1} to the ledger ${doc.ledgerAccount}`,
        `signed hybrid (secp256k1 + ML-DSA-87) by ledger-payer; fee ${formatUqor(MSG_FEE)}`,
        `ledger-payer holds ${formatUqor(bankPayer)} now; the ledger holds 0`,
        `then checks bank(ledger) = ${FUND_UQOR} uqor and eth_getBalance(ledger) = ${FUND_UQOR * UQOR_WEI} wei`,
        `writes ${QOR_FUND}`,
      ]);
      return;
    }
    const account = await loadAccount("ledger-payer");
    if (getAddress(account.evm) !== payer.evm) throw new Error("ledger-payer key does not match deployments/accounts.json");
    const hash = await broadcast(account, [
      {
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        value: { fromAddress: account.cosmos, toAddress: doc.ledgerAccount, amount: [{ denom: "uqor", amount: FUND_UQOR.toString() }] },
      },
    ]);
    report.ledger = doc.ledger;
    report.ledgerAccount = doc.ledgerAccount;
    report.from = account.cosmos;
    report.amountUqor = FUND_UQOR.toString();
    report.hash = hash;
    saveJson(QOR_FUND, report);
    console.log(hash);
  }
  let bank = 0n;
  let wei = 0n;
  for (let attempt = 0; attempt < 10; attempt++) {
    [bank, wei] = await Promise.all([bankUqor(doc.ledgerAccount), evmClient().getBalance({ address: doc.ledger })]);
    if (bank === FUND_UQOR && wei === FUND_UQOR * UQOR_WEI) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (bank !== FUND_UQOR) throw new Error(`bank(ledger) is ${bank} uqor`);
  if (wei !== FUND_UQOR * UQOR_WEI) throw new Error(`eth_getBalance(ledger) is ${wei} wei, bank says ${bank} uqor`);
  report.ok = true;
  report.bankUqor = bank.toString();
  report.evmWei = wei.toString();
  report.ranAt = new Date().toISOString();
  saveJson(QOR_FUND, report);
  console.log(`${bank} uqor = ${wei} wei`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
