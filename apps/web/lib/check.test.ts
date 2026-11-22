import { readFileSync } from "node:fs";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { CallError, NETWORK, NO_HASH, NetworkError, ledgerAbi, verifyScene, type Expect, type NativeReceipt, type Rpc } from "./check";
import scenes from "./fixtures/scenes.json";
import recorded from "./fixtures/recorded-rpc.json";
import { PAY, argsHash, commitmentOf, encodeAuthMessage, noteOf } from "./ledger";

type Scene = { scene: number; hash: string | null; expect: Expect };

function sceneAt(index: number): Scene {
  const scene = scenes.scenes[index];
  if (!scene) throw new Error(`missing scene ${index + 1}`);
  return { scene: scene.scene, hash: scene.hash, expect: scene.expect as Expect };
}

const LEDGER = "0x3333333333333333333333333333333333333333" as Address;
const PAYER = "0x1111111111111111111111111111111111111111" as Address;
const PAYEE = "0x2222222222222222222222222222222222222222" as Address;
const TOKEN = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as Address;
const MESSAGE =
  "0xe75e64e2fe37c327a6196b667e791aa53e61a6f7df40e7ac0542d985cea36278000000000000000000000000000000000000000000000000000000000000264800000000000000000000000033333333333333333333333333333333333333330000000000000000000000001111111111111111111111111111111111111111ce4f2429734c4677d82d9d124f394bf747b4657eeebba8e1acd340ec5675e2480000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006553ff105c0abb9c891d31397c12868300827dc80119bbeef5e35421f16633c1ea33cd77" as Hex;

type Recorded = {
  chainId: string;
  transactions: Record<string, unknown>;
  receipts: Record<string, unknown>;
  calls: { to: string; data: string; result: string }[];
  replays: { data: string; block: string; errorData?: string; result?: string }[];
  native: Record<string, { data: { id: number; sender: string; note: string; height: number } }>;
};

const replies = recorded as Recorded;

function rpcFrom(source: Recorded): Rpc {
  return async (method, params) => {
    if (method === "eth_chainId") return source.chainId;
    if (method === "eth_getTransactionByHash") {
      const tx = source.transactions[String(params[0])];
      if (!tx) throw new NetworkError();
      return tx;
    }
    if (method === "eth_getTransactionReceipt") {
      const receipt = source.receipts[String(params[0])];
      if (!receipt) throw new NetworkError();
      return receipt;
    }
    if (method === "eth_call") {
      const call = params[0] as { to?: string; data?: string };
      const block = String(params[1]);
      if (block !== "latest") {
        const replay = source.replays.find((item) => item.data === call.data && item.block === block);
        if (!replay) throw new NetworkError();
        if (replay.errorData) throw new CallError("execution reverted", replay.errorData as Hex);
        return replay.result;
      }
      const found = source.calls.find((item) => item.to.toLowerCase() === String(call.to).toLowerCase() && item.data === call.data);
      if (!found) throw new NetworkError();
      return found.result;
    }
    throw new NetworkError();
  };
}

function nativeFrom(source: Recorded) {
  return async (id: bigint): Promise<NativeReceipt> => {
    const row = source.native[id.toString()]?.data;
    if (!row) throw new NetworkError();
    return { id: String(row.id), sender: row.sender, note: row.note, height: String(row.height) };
  };
}

describe("the message builder", () => {
  it("rebuilds the shared vector", () => {
    const signature = `0x${"00".repeat(4627)}` as Hex;
    expect(argsHash(PAYEE, TOKEN, 100_000n, "invoice 1")).toBe("0x5c0abb9c891d31397c12868300827dc80119bbeef5e35421f16633c1ea33cd77");
    expect(
      commitmentOf({
        chainId: 9800n,
        ledger: LEDGER,
        action: PAY,
        to: PAYEE,
        token: TOKEN,
        amount: 100_000n,
        nonce: 0n,
        signature,
      }),
    ).toBe("0x3a828fa2d2b949686b1ccb8fe942eb93870d0a6c48ac78524d8a70412563544b");
    expect(noteOf(0n, "0x3a828fa2d2b949686b1ccb8fe942eb93870d0a6c48ac78524d8a70412563544b", "invoice 1")).toBe(
      "haven-ledger v1 n=0 c=0x3a828fa2d2b949686b1ccb8fe942eb93870d0a6c48ac78524d8a70412563544b m=invoice 1",
    );
    expect(
      encodeAuthMessage({
        chainId: 9800n,
        ledger: LEDGER,
        payer: PAYER,
        action: PAY,
        nonce: 0n,
        deadline: 1_700_003_600n,
        to: PAYEE,
        token: TOKEN,
        amount: 100_000n,
        memo: "invoice 1",
      }),
    ).toBe(MESSAGE);
  });
});

describe("the page's ABI", () => {
  type Entry = { type: string; name?: string };
  const key = (entry: Entry) => `${entry.type}:${entry.name ?? ""}`;
  const relayed = ["error:Error", "error:ERC20InsufficientBalance"];

  it("matches what forge compiled for every ledger entry it uses", () => {
    const compiled = JSON.parse(readFileSync(new URL("../../../out/HavenLedger.sol/HavenLedger.json", import.meta.url), "utf8")) as {
      abi: Entry[];
    };
    const byKey = new Map(compiled.abi.map((entry) => [key(entry), entry]));
    const page = ledgerAbi as readonly Entry[];
    expect(page.filter((entry) => !byKey.has(key(entry))).map(key).sort()).toEqual([...relayed].sort());
    for (const entry of page) {
      if (relayed.includes(key(entry))) continue;
      expect(entry, key(entry)).toEqual(byKey.get(key(entry)));
    }
  });
});

describe("the fixture names the recorded hashes", () => {
  it("matches deployments and carries no signature", () => {
    const text = readFileSync(new URL("./fixtures/scenes.json", import.meta.url), "utf8");
    expect(/0x[0-9a-fA-F]{80,}/.test(text)).toBe(false);
    for (const scene of scenes.scenes) {
      const doc = JSON.parse(readFileSync(new URL(`../../../deployments/scene-${scene.scene}.json`, import.meta.url), "utf8")) as {
        transactions?: { hash: string }[];
        note?: string;
      };
      const evm = (doc.transactions ?? []).find((tx) => tx.hash.startsWith("0x"));
      expect(scene.hash).toBe(evm?.hash ?? null);
      if (scene.scene === 7) expect(scene.record).toBe(doc.note);
    }
  });
});

describe("recorded replies", () => {
  const rpc = rpcFrom(replies);
  const native = nativeFrom(replies);

  it("agrees on scene 1 and scene 6", async () => {
    const pay = await verifyScene(sceneAt(0), rpc, native);
    const refund = await verifyScene(sceneAt(5), rpc, native);
    expect(pay.outcome).toBe("agreed");
    expect(pay.heights).toEqual({ native: "10543960", evm: "10543960" });
    expect(pay.summary).toBe("Both lanes agree. The Native receipt names this payout.");
    expect(refund.outcome).toBe("agreed");
    expect(refund.heights).toEqual({ native: "10544236", evm: "10544236" });
  });

  it("refuses scenes 2 through 5 from the receipt, not the fixture text", async () => {
    for (const index of [1, 2, 3, 4]) {
      const scene = sceneAt(index);
      const verdict = await verifyScene(scene, rpc, native);
      expect(verdict.outcome).toBe("refused");
      expect(verdict.summary).not.toBe(scenes.scenes[index]?.record);
    }
    const balance = await verifyScene(sceneAt(2), rpc, native);
    expect(balance.summary.startsWith("ERC20InsufficientBalance")).toBe(true);
    const junk = await verifyScene(sceneAt(3), rpc, native);
    expect(junk.lines.find((line) => line.label === "Signature")?.detail).toBe("The signature does not verify.");
    const replay = await verifyScene(sceneAt(4), rpc, native);
    expect(replay.lines.find((line) => line.label === "Signature")?.detail).toBe("The signature verifies at nonce 0.");
    const note = await verifyScene(sceneAt(1), rpc, native);
    expect(note.summary).toContain("the note must be 1 to 140 characters");
  });

  it("a revert for a different reason is not the recorded refusal", async () => {
    const note = sceneAt(1);
    const verdict = await verifyScene({ ...note, expect: { outcome: "refused", reason: "ERC20InsufficientBalance", signedNonce: 1 } }, rpc, native);
    expect(verdict.outcome).toBe("failed");
    expect(verdict.summary).toContain("different reason");
  });

  it("a signature at a different nonce is not the recorded refusal", async () => {
    const replay = sceneAt(4);
    const verdict = await verifyScene({ ...replay, expect: { outcome: "refused", reason: "SignatureInvalid", signedNonce: null } }, rpc, native);
    expect(verdict.outcome).toBe("failed");
  });

  it("a reverted payout is not a pass, and a refusal that succeeds is not a pass", async () => {
    const reverted = await verifyScene({ ...sceneAt(2), expect: { outcome: "agreed", signedNonce: 1 } }, rpc, native);
    expect(reverted.outcome).toBe("failed");
    const succeeded = await verifyScene({ ...sceneAt(0), expect: { outcome: "refused", reason: "SignatureInvalid", signedNonce: 0 } }, rpc, native);
    expect(succeeded.outcome).toBe("failed");
  });

  it("a refusal never reads the Native lane", async () => {
    let read = false;
    const watching = async (id: bigint): Promise<NativeReceipt> => {
      read = true;
      return native(id);
    };
    for (const index of [1, 2, 3, 4]) await verifyScene(sceneAt(index), rpc, watching);
    expect(read).toBe(false);
  });

  it("does not look for a hash on scene 7", async () => {
    let called = false;
    const verdict = await verifyScene(sceneAt(6), async () => {
      called = true;
      throw new NetworkError();
    }, native);
    expect(called).toBe(false);
    expect(verdict.outcome).toBe("no-hash");
    expect(verdict.summary).toBe(NO_HASH);
  });

  it("a changed Native note is not a pass", async () => {
    const tampered = async (id: bigint): Promise<NativeReceipt> => {
      const row = await native(id);
      return { ...row, note: `${row.note} ` };
    };
    const verdict = await verifyScene(sceneAt(0), rpc, tampered);
    expect(verdict.outcome).toBe("failed");
    expect(verdict.outcome).not.toBe("agreed");
  });

  it("a network failure is never a pass", async () => {
    const verdict = await verifyScene(sceneAt(0), async () => {
      throw new NetworkError();
    }, native);
    expect(verdict.outcome).toBe("offline");
    expect(verdict.summary).toBe(NETWORK);
  });
});
