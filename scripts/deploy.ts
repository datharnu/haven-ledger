/**
 * Deploys HavenLedger from spike in an unscoped window.
 * A finished report throws "already ran".
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { evmToQor } from "@qorechain/sdk";
import { readMlDsaKey, requireMlDsaKey, testnetClient } from "haven-pq-kit/keydir";
import { TESTNET } from "haven-pq-kit/network";
import { encodeDeployData, getAddress, type Abi, type Address, type Hex } from "viem";
import { evmClient, loadAccount, pricedCall, sendPriced, WINDOW_CAP, withEvmWindow } from "./lib/chain.js";

const REPORT = "deployments/ledger.json";
const ARTIFACT = "out/HavenLedger.sol/HavenLedger.json";
const TOKEN = getAddress("0x97143B771D34ddb9130b807b135Ae675A5a963CA");
const RECEIPTS = "qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8";

/** Addresses `Bech32.qor` already matches in the Foundry tests. */
const BECH32_VECTORS: [Address, string][] = [
  ["0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396", "qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl"],
  ["0xf09cc23e992A4591A456836D7223655399D0BB90", "qor17zwvy05e9fzerfzksdkhygm92wvapwusvh4zfv"],
];

type AccountRow = { name: string; evm: Address; qor1: string };

type Tx = { hash: string; note: string; gasUsed?: string; fee?: string };

type Report = {
  network: string;
  ranAt?: string;
  ok: boolean;
  ledger?: Address;
  ledgerAccount?: string;
  constructorArgs?: { payer: Address; payee: Address; token: Address; receipts: string };
  deployer?: Address;
  transactions: Tx[];
};

function artifact(): { abi: Abi; bytecode: { object: Hex } } {
  return JSON.parse(readFileSync(ARTIFACT, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
}

function named(name: string): AccountRow {
  const file = JSON.parse(readFileSync("deployments/accounts.json", "utf8")) as { accounts: AccountRow[] };
  const row = file.accounts.find((account) => account.name === name);
  if (!row?.evm || !row.qor1) throw new Error(`no ${name} in deployments/accounts.json`);
  return { name, evm: getAddress(row.evm), qor1: row.qor1 };
}

function constructorArgs(): Report["constructorArgs"] {
  const payer = named("ledger-payer");
  const payee = named("ledger-payee");
  return { payer: payer.evm, payee: payee.evm, token: TOKEN, receipts: RECEIPTS };
}

function deployData(): Hex {
  const args = constructorArgs();
  const compiled = artifact();
  if (!args) throw new Error("missing constructor args");
  return encodeDeployData({
    abi: compiled.abi,
    bytecode: compiled.bytecode.object,
    args: [args.payer, args.payee, args.token, args.receipts],
  });
}

function assertBech32(): void {
  for (const [evm, qor] of BECH32_VECTORS) {
    const encoded = evmToQor(evm);
    if (encoded !== qor) throw new Error(`evmToQor(${evm}) is ${encoded}; Bech32.qor returns ${qor}`);
  }
}

async function assertPayerKey(): Promise<void> {
  const payer = named("ledger-payer");
  const key = await readMlDsaKey(testnetClient(), payer.evm);
  requireMlDsaKey(key);
}

function load(): Report {
  try {
    return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
  } catch {
    return { network: "qorechain-diana", ok: false, transactions: [] };
  }
}

function save(report: Report): void {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
}

async function nativeCost(hash: string): Promise<{ gasUsed: string; fee: string }> {
  const res = await fetch(`${TESTNET.rest}/cosmos/tx/v1beta1/txs/${hash}`, { headers: { "user-agent": "haven-ledger" } });
  if (!res.ok) throw new Error(`tx ${hash} ${res.status}`);
  const body = (await res.json()) as {
    tx?: { auth_info?: { fee?: { amount?: { denom: string; amount: string }[] } } };
    tx_response?: { gas_used?: string };
  };
  const fee = body.tx?.auth_info?.fee?.amount?.find((coin) => coin.denom === "uqor")?.amount;
  const gasUsed = body.tx_response?.gas_used;
  if (!fee || !gasUsed) throw new Error(`tx ${hash} has no uqor fee or gas_used`);
  return { gasUsed, fee };
}

async function verify(report: Report): Promise<void> {
  if (!report.ledger || !report.constructorArgs) throw new Error("deploy did not record the ledger");
  const compiled = artifact();
  const client = evmClient();
  const read = (functionName: "payer" | "payee" | "token" | "receipts" | "ledgerAccount" | "nonce" | "payoutCount") =>
    client.readContract({ address: report.ledger as Address, abi: compiled.abi, functionName });
  const [payer, payee, token, receipts, ledgerAccount, nonce, payoutCount] = await Promise.all([
    read("payer"),
    read("payee"),
    read("token"),
    read("receipts"),
    read("ledgerAccount"),
    read("nonce"),
    read("payoutCount"),
  ]);
  const args = report.constructorArgs;
  const same = (left: unknown, right: string) => String(left).toLowerCase() === right.toLowerCase();
  if (!same(payer, args.payer)) throw new Error(`payer() is ${String(payer)}`);
  if (!same(payee, args.payee)) throw new Error(`payee() is ${String(payee)}`);
  if (!same(token, args.token)) throw new Error(`token() is ${String(token)}`);
  if (receipts !== args.receipts) throw new Error(`receipts() is ${String(receipts)}`);
  const expected = evmToQor(report.ledger);
  if (ledgerAccount !== expected) throw new Error(`ledgerAccount() is ${String(ledgerAccount)}; evmToQor is ${expected}`);
  if (nonce !== 0n) throw new Error(`nonce() is ${String(nonce)}`);
  if (payoutCount !== 0n) throw new Error(`payoutCount() is ${String(payoutCount)}`);
  report.ledgerAccount = expected;
}

/** Read-only. Confirms the payer key, estimates the deploy, and returns the window budget in uqor. */
export async function estimateDeploy(): Promise<{ gas: bigint; gasPrice: bigint; budget: bigint }> {
  assertBech32();
  await assertPayerKey();
  const spike = await loadAccount("spike");
  return pricedCall({
    from: getAddress(spike.evm),
    data: deployData(),
    kind: "deploy",
    label: "ledger deploy",
  });
}

async function main(): Promise<void> {
  const report = load();
  if (report.ok) throw new Error("already ran");
  if (!report.ledger) {
    assertBech32();
    await assertPayerKey();
    const args = constructorArgs();
    const data = deployData();
    const opened = await withEvmWindow(
      "spike",
      { txs: 1, maxValueUqor: WINDOW_CAP.deploy.toString(), blocks: 200 },
      async (account) => {
        const priced = await pricedCall({
          from: getAddress(account.evm),
          data,
          kind: "deploy",
          label: "ledger deploy",
        });
        const sent = await sendPriced({
          account,
          data,
          gas: priced.gas,
          gasPrice: priced.gasPrice,
          kind: "deploy",
          label: "ledger deploy",
        });
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
      },
    );
    const code = await evmClient().getCode({ address: opened.result.address });
    if (!code || code === "0x") throw new Error(`no code at ${opened.result.address}`);
    const open = await nativeCost(opened.openHash);
    const close = await nativeCost(opened.closeHash);
    report.ledger = opened.result.address;
    report.constructorArgs = args;
    report.deployer = opened.result.deployer;
    report.transactions = [
      { hash: opened.openHash, note: "open unscoped deploy window", gasUsed: open.gasUsed, fee: open.fee },
      {
        hash: opened.result.hash,
        note: `deploy HavenLedger budget ${opened.result.budget} uqor`,
        gasUsed: opened.result.gasUsed.toString(),
        fee: opened.result.uqor.toString(),
      },
      { hash: opened.closeHash, note: "close deploy window", gasUsed: close.gasUsed, fee: close.fee },
    ];
    save(report);
  }
  await verify(report);
  report.ok = true;
  report.ranAt = new Date().toISOString();
  save(report);
  console.log(report.ledger);
  console.log(report.ledgerAccount);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
