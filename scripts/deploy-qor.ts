/**
 * Deploys HavenLedgerQor from spike in an unscoped window.
 * Without `--broadcast` it only prints the plan and a read-only gas estimate. No key is read.
 * A finished report throws "already ran".
 */
import { evmToQor } from "@qorechain/sdk";
import { evmWindowCost } from "@qorechain/evm";
import { readMlDsaKey, requireMlDsaKey, testnetClient } from "haven-pq-kit/keydir";
import { encodeDeployData, getAddress, type Address, type Hex } from "viem";
import { assertUnderCap, evmClient, pricedCall, sendPriced, WINDOW_CAP, withEvmWindow } from "./lib/chain.js";
import { nativeCost } from "./lib/native.js";
import {
  BROADCAST,
  QOR_DEPLOY,
  RECEIPTS,
  formatUqor,
  loadJson,
  named,
  planOnly,
  qorArtifact,
  saveJson,
  spikeAddress,
  type QorDeployReport,
} from "./lib/qor.js";

/** Window open + close on 22 November 2026: 180,000 uqor each. */
const WINDOW_FEES = 360_000n;

function constructorArgs(): NonNullable<QorDeployReport["constructorArgs"]> {
  return { payer: named("ledger-payer").evm, payee: named("ledger-payee").evm, receipts: RECEIPTS };
}

function deployData(): Hex {
  const args = constructorArgs();
  const compiled = qorArtifact();
  return encodeDeployData({ abi: compiled.abi, bytecode: compiled.bytecode.object, args: [args.payer, args.payee, args.receipts] });
}

async function assertPayerKey(): Promise<void> {
  const key = await readMlDsaKey(testnetClient(), named("ledger-payer").evm);
  requireMlDsaKey(key);
}

async function verify(report: QorDeployReport): Promise<void> {
  if (!report.ledger || !report.constructorArgs) throw new Error("deploy did not record the ledger");
  const { abi } = qorArtifact();
  const client = evmClient();
  const read = (functionName: string) => client.readContract({ address: report.ledger as Address, abi, functionName });
  const [payer, payee, token, receipts, ledgerAccount, nonce, payoutCount, uqor] = await Promise.all([
    read("payer"),
    read("payee"),
    read("token"),
    read("receipts"),
    read("ledgerAccount"),
    read("nonce"),
    read("payoutCount"),
    read("UQOR"),
  ]);
  const args = report.constructorArgs;
  const same = (left: unknown, right: string) => String(left).toLowerCase() === right.toLowerCase();
  if (!same(payer, args.payer)) throw new Error(`payer() is ${String(payer)}`);
  if (!same(payee, args.payee)) throw new Error(`payee() is ${String(payee)}`);
  if (!same(token, "0x0000000000000000000000000000000000000000")) throw new Error(`token() is ${String(token)}`);
  if (receipts !== args.receipts) throw new Error(`receipts() is ${String(receipts)}`);
  if (uqor !== 1_000_000_000_000n) throw new Error(`UQOR() is ${String(uqor)}`);
  const expected = evmToQor(report.ledger);
  if (ledgerAccount !== expected) throw new Error(`ledgerAccount() is ${String(ledgerAccount)}; evmToQor is ${expected}`);
  if (nonce !== 0n) throw new Error(`nonce() is ${String(nonce)}`);
  if (payoutCount !== 0n) throw new Error(`payoutCount() is ${String(payoutCount)}`);
  report.ledgerAccount = expected;
  report.accounts = { payer: evmToQor(args.payer), payee: evmToQor(args.payee) };
}

async function plan(): Promise<void> {
  await assertPayerKey();
  const args = constructorArgs();
  const from = spikeAddress();
  const client = evmClient();
  const [gas, gasPrice] = await Promise.all([client.estimateGas({ account: from, data: deployData() }), client.getGasPrice()]);
  const budget = evmWindowCost({ gas: gas + gas / 5n, maxFeePerGas: gasPrice });
  assertUnderCap("deploy", budget, "QOR ledger deploy");
  planOnly([
    `deploy HavenLedgerQor(payer ${args.payer}, payee ${args.payee}, receipts ${args.receipts})`,
    `from spike ${from} in an unscoped window (1 tx, max value ${WINDOW_CAP.deploy} uqor, 200 blocks)`,
    `payer ML-DSA-87 key: registered and possession-proven`,
    `estimated gas ${gas} at ${gasPrice} wei; window budget ${formatUqor(budget)}`,
    `expected spend: about ${formatUqor(budget)} at most for the deploy + ${formatUqor(WINDOW_FEES)} window open/close`,
    `writes ${QOR_DEPLOY}`,
  ]);
}

async function main(): Promise<void> {
  const report = loadJson<QorDeployReport>(QOR_DEPLOY, { network: "qorechain-diana", ok: false, asset: "uqor", transactions: [] });
  if (report.ok) throw new Error("already ran");
  if (!BROADCAST) {
    await plan();
    return;
  }
  if (!report.ledger) {
    await assertPayerKey();
    const args = constructorArgs();
    const data = deployData();
    const opened = await withEvmWindow("spike", { txs: 1, maxValueUqor: WINDOW_CAP.deploy.toString(), blocks: 200 }, async (account) => {
      const priced = await pricedCall({ from: getAddress(account.evm), data, kind: "deploy", label: "QOR ledger deploy" });
      const sent = await sendPriced({ account, data, gas: priced.gas, gasPrice: priced.gasPrice, kind: "deploy", label: "QOR ledger deploy" });
      const receipt = await evmClient().getTransactionReceipt({ hash: sent.hash });
      if (!receipt.contractAddress) throw new Error(`deploy ${sent.hash} has no contract address`);
      return {
        deployer: getAddress(account.evm),
        address: getAddress(receipt.contractAddress),
        hash: sent.hash,
        gasUsed: sent.gasUsed,
        uqor: sent.uqor,
        budget: priced.budget,
      };
    });
    const code = await evmClient().getCode({ address: opened.result.address });
    if (!code || code === "0x") throw new Error(`no code at ${opened.result.address}`);
    const open = await nativeCost(opened.openHash);
    const close = await nativeCost(opened.closeHash);
    report.asset = "uqor";
    report.ledger = opened.result.address;
    report.constructorArgs = args;
    report.deployer = opened.result.deployer;
    report.transactions = [
      { hash: opened.openHash, note: "open unscoped deploy window", gasUsed: open.gasUsed, fee: open.fee },
      {
        hash: opened.result.hash,
        note: `deploy HavenLedgerQor budget ${opened.result.budget} uqor`,
        gasUsed: opened.result.gasUsed.toString(),
        fee: opened.result.uqor.toString(),
      },
      { hash: opened.closeHash, note: "close deploy window", gasUsed: close.gasUsed, fee: close.fee },
    ];
    saveJson(QOR_DEPLOY, report);
  }
  await verify(report);
  report.ok = true;
  report.ranAt = new Date().toISOString();
  saveJson(QOR_DEPLOY, report);
  console.log(report.ledger);
  console.log(report.ledgerAccount);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
