import { existsSync, readFileSync } from "node:fs";
import { mldsa87 } from "@qorechain/pqc";
import {
  bytesToHex,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  hexToBytes,
  type Address,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";
import { evmToQor } from "./bech32";
import { CallError, NETWORK, NetworkError, PQC_STATUS, keyData, qorLedgerAbi, verifyQorScene, type Expect, type NativeReceipt, type ReadBank, type Rpc } from "./check";
import { NATIVE_QOR, PAY, PAY_QOR, REFUND_QOR, UQOR_WEI, argsHash, commitmentOf, encodeAuthMessage, qorNoteOf } from "./ledger";
import { bankAccounts, hasQorScenes, qorScenes, type QorFixture } from "./qor-scenes";

const LEDGER = getAddress("0x3333333333333333333333333333333333333333");
const PAYER = getAddress("0x1111111111111111111111111111111111111111");
const PAYEE = getAddress("0x2222222222222222222222222222222222222222");
const RELAYER = getAddress("0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396");
const RECEIPTS = "qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8";
const LEDGER_QOR = evmToQor(LEDGER);
const ONE_QOR = 1_000_000n * UQOR_WEI;
const BLOCK = 10_700_000n;
const DEADLINE = 1_795_500_000n;
const HASH = `0x${"ab".repeat(32)}` as Hex;

/** A throwaway test key from a fixed seed. Never a real account's key. */
const key = mldsa87.keygen(new Uint8Array(32).fill(7));

type Chain = {
  action: Hex;
  fn: "pay" | "refund";
  amount: bigint;
  memo: string;
  status: "0x1" | "0x0";
  revert?: Hex;
  token?: Address;
};

function sign(fields: { action: Hex; to: Address; amount: bigint; memo: string; nonce: bigint }): Hex {
  const message = encodeAuthMessage({
    chainId: 9800n,
    ledger: LEDGER,
    payer: PAYER,
    action: fields.action,
    nonce: fields.nonce,
    deadline: DEADLINE,
    to: fields.to,
    token: NATIVE_QOR,
    amount: fields.amount,
    memo: fields.memo,
  });
  return bytesToHex(mldsa87.sign(key.secretKey, hexToBytes(message)));
}

/** A one-transaction chain where the ledger behaves like HavenLedgerQor. */
function fakeChain(chain: Chain): { rpc: Rpc; native: (id: bigint) => Promise<NativeReceipt>; signature: Hex; commitment: Hex; to: Address } {
  const to = chain.fn === "refund" ? PAYER : PAYEE;
  const signature = sign({ action: chain.action, to, amount: chain.amount, memo: chain.memo, nonce: 0n });
  const commitment = commitmentOf({ chainId: 9800n, ledger: LEDGER, action: chain.action, to, token: NATIVE_QOR, amount: chain.amount, nonce: 0n, signature });
  const input = encodeFunctionData({ abi: qorLedgerAbi, functionName: chain.fn, args: [chain.amount, chain.memo, DEADLINE, signature] });
  const topics = encodeEventTopics({ abi: qorLedgerAbi, eventName: "Moved", args: { id: 0n, to } });
  const data = encodeAbiParameters(
    [{ type: "bool" }, { type: "uint256" }, { type: "uint64" }, { type: "uint64" }, { type: "bytes32" }],
    [chain.fn === "refund", chain.amount, 12n, BLOCK, commitment],
  );
  const views: Record<string, Hex> = {
    payer: encodeFunctionResult({ abi: qorLedgerAbi, functionName: "payer", result: PAYER }),
    payee: encodeFunctionResult({ abi: qorLedgerAbi, functionName: "payee", result: PAYEE }),
    token: encodeFunctionResult({ abi: qorLedgerAbi, functionName: "token", result: chain.token ?? NATIVE_QOR }),
    receipts: encodeFunctionResult({ abi: qorLedgerAbi, functionName: "receipts", result: RECEIPTS }),
    ledgerAccount: encodeFunctionResult({ abi: qorLedgerAbi, functionName: "ledgerAccount", result: LEDGER_QOR }),
    nonce: encodeFunctionResult({ abi: qorLedgerAbi, functionName: "nonce", result: 1n }),
    payout: encodeFunctionResult({
      abi: qorLedgerAbi,
      functionName: "payout",
      result: { to, amount: chain.amount, receiptId: 12n, nativeHeight: BLOCK, evmBlock: BLOCK, commitment },
    }),
  };
  const status = encodeAbiParameters(
    [{ type: "bool" }, { type: "uint8" }, { type: "bytes" }, { type: "bool" }],
    [true, 1, bytesToHex(key.publicKey), true],
  );
  const rpc: Rpc = async (method, params) => {
    if (method === "eth_chainId") return "0x2648";
    if (method === "eth_getTransactionByHash") return { from: RELAYER, to: LEDGER, input };
    if (method === "eth_getTransactionReceipt") {
      return {
        status: chain.status,
        blockNumber: `0x${BLOCK.toString(16)}`,
        logs: chain.status === "0x1" ? [{ address: LEDGER, topics, data }] : [],
      };
    }
    if (method === "eth_call") {
      const call = params[0] as { to: string; data: Hex };
      if (params[1] !== "latest") throw new CallError("execution reverted", chain.revert);
      if (call.to.toLowerCase() === PQC_STATUS && call.data === keyData(PAYER)) return status;
      for (const [name, result] of Object.entries(views)) {
        if (call.data.slice(0, 10) === encodeFunctionData({ abi: qorLedgerAbi, functionName: name, args: name === "payout" ? [0n] : [] } as never).slice(0, 10)) {
          return result;
        }
      }
    }
    throw new NetworkError();
  };
  const native = async (id: bigint): Promise<NativeReceipt> => {
    if (id !== 12n) throw new NetworkError();
    return { id: "12", sender: LEDGER_QOR, note: qorNoteOf(0n, commitment, chain.amount, chain.memo), height: BLOCK.toString() };
  };
  return { rpc, native, signature, commitment, to };
}

/** A bank where only `account` changed, by `delta` uqor, in BLOCK. */
function bankWith(account: string, delta: bigint): ReadBank {
  return async (who, height) => {
    if (who !== account) throw new Error(`read ${who}`);
    return height >= BLOCK ? 5_000_000n + delta : 5_000_000n;
  };
}

const agreed: Expect = { outcome: "agreed", signedNonce: 0 };

describe("a native-QOR payout", () => {
  it("agrees when the receipt names it and the payee's bank uqor moved by exactly the payout", async () => {
    const chain = fakeChain({ action: PAY_QOR, fn: "pay", amount: ONE_QOR, memo: "invoice 1", status: "0x1" });
    const verdict = await verifyQorScene({ scene: 1, hash: HASH, expect: agreed }, chain.rpc, chain.native, bankWith(evmToQor(PAYEE), 1_000_000n));
    expect(verdict.outcome).toBe("agreed");
    expect(verdict.lines.find((line) => line.label === "Call")?.detail).toBe("pay 1000000 uqor · invoice 1");
    expect(verdict.lines.find((line) => line.label === "Native bank")?.detail).toBe(
      `payee +1000000 uqor at height ${BLOCK} (${evmToQor(PAYEE)})`,
    );
    expect(verdict.heights).toEqual({ native: BLOCK.toString(), evm: BLOCK.toString() });
  });

  it("reads the payer's bank for a refund", async () => {
    const chain = fakeChain({ action: REFUND_QOR, fn: "refund", amount: 2n * ONE_QOR, memo: "", status: "0x1" });
    const verdict = await verifyQorScene({ scene: 6, hash: HASH, expect: agreed }, chain.rpc, chain.native, bankWith(evmToQor(PAYER), 2_000_000n));
    expect(verdict.outcome).toBe("agreed");
    expect(verdict.lines.find((line) => line.label === "Native bank")?.detail.startsWith("payer +2000000 uqor")).toBe(true);
  });

  it("is not a pass when the bank moved by a different amount", async () => {
    const chain = fakeChain({ action: PAY_QOR, fn: "pay", amount: ONE_QOR, memo: "", status: "0x1" });
    const verdict = await verifyQorScene({ scene: 1, hash: HASH, expect: agreed }, chain.rpc, chain.native, bankWith(evmToQor(PAYEE), 999_999n));
    expect(verdict.outcome).toBe("failed");
    expect(verdict.summary).toBe("The Native bank change is +999999 uqor, and the payout is 1000000 uqor.");
  });

  it("is offline, never a pass, when the bank cannot be read", async () => {
    const chain = fakeChain({ action: PAY_QOR, fn: "pay", amount: ONE_QOR, memo: "", status: "0x1" });
    const verdict = await verifyQorScene({ scene: 1, hash: HASH, expect: agreed }, chain.rpc, chain.native, async () => {
      throw new NetworkError();
    });
    expect(verdict.outcome).toBe("offline");
    expect(verdict.summary).toBe(NETWORK);
  });

  it("does not accept a signature made with the fUSD action", async () => {
    const chain = fakeChain({ action: PAY, fn: "pay", amount: ONE_QOR, memo: "", status: "0x1" });
    const verdict = await verifyQorScene({ scene: 1, hash: HASH, expect: agreed }, chain.rpc, chain.native, bankWith(evmToQor(PAYEE), 1_000_000n));
    expect(verdict.outcome).toBe("failed");
    expect(verdict.lines.find((line) => line.label === "Signature")?.detail).toBe("The signature does not verify.");
  });

  it("refuses a ledger whose token is not native QOR", async () => {
    const chain = fakeChain({ action: PAY_QOR, fn: "pay", amount: ONE_QOR, memo: "", status: "0x1", token: getAddress("0x97143B771D34ddb9130b807b135Ae675A5a963CA") });
    const verdict = await verifyQorScene({ scene: 1, hash: HASH, expect: agreed }, chain.rpc, chain.native, bankWith(evmToQor(PAYEE), 1_000_000n));
    expect(verdict.outcome).toBe("failed");
    expect(verdict.summary).toBe("This ledger does not pay native QOR.");
  });

  it("names InsufficientBalance from the replayed call and never reads the bank on a refusal", async () => {
    const revert = encodeErrorResult({ abi: qorLedgerAbi, errorName: "InsufficientBalance", args: [4n * ONE_QOR, 10n * ONE_QOR] });
    const chain = fakeChain({ action: PAY_QOR, fn: "pay", amount: 10n * ONE_QOR, memo: "", status: "0x0", revert });
    let read = false;
    const verdict = await verifyQorScene(
      { scene: 3, hash: HASH, expect: { outcome: "refused", reason: "InsufficientBalance", signedNonce: 0 } },
      chain.rpc,
      chain.native,
      async () => {
        read = true;
        return 0n;
      },
    );
    expect(verdict.outcome).toBe("refused");
    expect(verdict.summary).toBe(`InsufficientBalance ${4n * ONE_QOR} ${10n * ONE_QOR}`);
    expect(read).toBe(false);
  });
});

describe("the page's QOR ABI", () => {
  type Entry = { type: string; name?: string };
  const entryKey = (entry: Entry) => `${entry.type}:${entry.name ?? ""}`;

  it("matches what forge compiled for every entry it uses", () => {
    const compiled = JSON.parse(readFileSync(new URL("../../../out/HavenLedgerQor.sol/HavenLedgerQor.json", import.meta.url), "utf8")) as {
      abi: Entry[];
    };
    const byKey = new Map(compiled.abi.map((entry) => [entryKey(entry), entry]));
    const page = qorLedgerAbi as readonly Entry[];
    expect(page.filter((entry) => !byKey.has(entryKey(entry))).map(entryKey)).toEqual(["error:Error"]);
    for (const entry of page) {
      if (entryKey(entry) === "error:Error") continue;
      expect(entry, entryKey(entry)).toEqual(byKey.get(entryKey(entry)));
    }
  });

  it("rebuilds the vectors test/HavenLedgerQor.t.sol checks", () => {
    expect(PAY_QOR).toBe("0x16f937ef09f1c1944047c2812b86083a9be667bf35922dbfc47408f135508e96");
    expect(argsHash(PAYEE, NATIVE_QOR, ONE_QOR, "invoice 1")).toBe("0xbb88ae558f7a4fb8c4feb93576543904d95dc5857b6680b4260bc8b2f3399017");
  });
});

describe("the QOR fixture", () => {
  const deployed = existsSync(new URL("../../../deployments/ledger-qor.json", import.meta.url));

  it("is empty until a QOR ledger is deployed, and then names the recorded hashes without signatures", () => {
    const text = readFileSync(new URL("./fixtures/scenes-qor.json", import.meta.url), "utf8");
    expect(/0x[0-9a-fA-F]{80,}/.test(text)).toBe(false);
    if (!deployed) {
      expect(hasQorScenes()).toBe(false);
      expect(qorScenes.scenes).toEqual([]);
      expect(bankAccounts()).toEqual([]);
      return;
    }
    for (const scene of qorScenes.scenes) {
      const doc = JSON.parse(readFileSync(new URL(`../../../deployments/ledger-qor-scene-${scene.scene}.json`, import.meta.url), "utf8")) as {
        transactions?: { hash: string }[];
      };
      expect(scene.hash).toBe((doc.transactions ?? []).find((tx) => tx.hash.startsWith("0x"))?.hash ?? null);
    }
  });

  it("lets the bank route read only the payer and the payee", () => {
    const fixture: QorFixture = {
      ...qorScenes,
      ledger: LEDGER,
      ledgerAccount: LEDGER_QOR,
      payer: { qor: evmToQor(PAYER), evm: PAYER },
      payee: { qor: evmToQor(PAYEE), evm: PAYEE },
      scenes: [{ scene: 1, title: "t", hash: HASH, record: "r", expect: agreed }],
    };
    expect(hasQorScenes(fixture)).toBe(true);
    expect(bankAccounts(fixture)).toEqual([evmToQor(PAYER), evmToQor(PAYEE)]);
  });
});
