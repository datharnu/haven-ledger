/**
 * Converts 1_000_000 fUSD base units from ledger-payer's bank balance
 * into HavenLedger. There is no pool swap. A finished report throws "already ran".
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BinaryWriter } from "cosmjs-types/binary";
import { qorechainRegistry } from "@qorechain/sdk";
import { TESTNET } from "haven-pq-kit/network";
import { erc20Abi, getAddress, type Address } from "viem";
import { broadcast, evmClient, loadAccount } from "./lib/chain.js";

const REPORT = "deployments/fund-ledger.json";
const AMOUNT = 1_000_000n;
const CONVERT = "/cosmos.evm.erc20.v1.MsgConvertCoin";
const TOKEN = getAddress("0x97143B771D34ddb9130b807b135Ae675A5a963CA");
const DENOM = `erc20:${TOKEN}`;

const ConvertCoin = {
  typeUrl: CONVERT,
  fromPartial(value: { coin?: { denom?: string; amount?: string }; receiver?: string; sender?: string }) {
    return {
      coin: { denom: value.coin?.denom ?? "", amount: value.coin?.amount ?? "0" },
      receiver: value.receiver ?? "",
      sender: value.sender ?? "",
    };
  },
  encode(
    message: { coin: { denom: string; amount: string }; receiver: string; sender: string },
    writer = new BinaryWriter(),
  ) {
    const coin = new BinaryWriter();
    coin.uint32(10).string(message.coin.denom);
    coin.uint32(18).string(message.coin.amount);
    writer.uint32(10).bytes(coin.finish());
    writer.uint32(18).string(message.receiver);
    writer.uint32(26).string(message.sender);
    return writer;
  },
  decode() {
    throw new Error("decode is unused");
  },
};

type Report = {
  network: string;
  ranAt?: string;
  ok: boolean;
  ledger?: Address;
  amount?: string;
  hash?: string;
  balance?: string;
};

function load(): Report {
  try {
    return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
  } catch {
    return { network: "qorechain-diana", ok: false };
  }
}

function save(report: Report): void {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
}

function ledger(): Address {
  const doc = JSON.parse(readFileSync("deployments/ledger.json", "utf8")) as { ok?: boolean; ledger?: Address };
  if (!doc.ok || !doc.ledger) throw new Error("deployments/ledger.json is not ok");
  return getAddress(doc.ledger);
}

async function bankFusd(cosmos: string): Promise<bigint> {
  const response = await fetch(
    `${TESTNET.rest}/cosmos/bank/v1beta1/balances/${cosmos}/by_denom?denom=${encodeURIComponent(DENOM)}`,
    { headers: { "user-agent": "haven-ledger" } },
  );
  if (!response.ok) throw new Error(`fUSD bank balance ${cosmos} returned ${response.status}`);
  const body = (await response.json()) as { balance?: { amount?: string } };
  return BigInt(body.balance?.amount ?? "0");
}

function balanceOf(holder: Address): Promise<bigint> {
  return evmClient().readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [holder] });
}

async function main(): Promise<void> {
  const report = load();
  if (report.ok) throw new Error("already ran");
  const receiver = ledger();
  if (!report.hash) {
    const have = await balanceOf(receiver);
    if (have !== 0n) throw new Error(`ledger balance ${have} is not 0`);
    const payer = await loadAccount("ledger-payer");
    const bank = await bankFusd(payer.cosmos);
    if (bank < AMOUNT) throw new Error(`bank ${bank} is below ${AMOUNT}`);
    const hash = await broadcast(
      payer,
      [
        {
          typeUrl: CONVERT,
          value: { coin: { denom: DENOM, amount: AMOUNT.toString() }, receiver, sender: payer.cosmos },
        },
      ],
      "hybrid",
      qorechainRegistry([[CONVERT, ConvertCoin]]),
    );
    report.ledger = receiver;
    report.amount = AMOUNT.toString();
    report.hash = hash;
    save(report);
    console.log(hash);
  }
  let seen = 0n;
  for (let attempt = 0; attempt < 10; attempt++) {
    seen = await balanceOf(receiver);
    if (seen === AMOUNT) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (seen !== AMOUNT) throw new Error(`balanceOf(ledger) is ${seen}`);
  report.ok = true;
  report.ledger = receiver;
  report.amount = AMOUNT.toString();
  report.balance = seen.toString();
  report.ranAt = new Date().toISOString();
  save(report);
  console.log(seen.toString());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
