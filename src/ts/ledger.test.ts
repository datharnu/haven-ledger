import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  NATIVE_QOR,
  PAY,
  PAY_QOR,
  REFUND,
  REFUND_QOR,
  argsHash,
  commitmentOf,
  noteOf,
  payoutMessage,
  qorNoteOf,
  recordPayload,
} from "./ledger.js";

const LEDGER = "0x3333333333333333333333333333333333333333" as Address;
const PAYER = "0x1111111111111111111111111111111111111111" as Address;
const PAYEE = "0x2222222222222222222222222222222222222222" as Address;
const TOKEN = "0x97143B771D34ddb9130b807b135Ae675A5a963CA" as Address;
const AMOUNT = 100_000n;
const MEMO = "invoice 1";
const NONCE = 0n;
const DEADLINE = 1_700_003_600n;
const SIGNATURE = `0x${"00".repeat(4627)}` as Hex;

const ARGS = "0x5c0abb9c891d31397c12868300827dc80119bbeef5e35421f16633c1ea33cd77" as Hex;
const COMMITMENT = "0x3a828fa2d2b949686b1ccb8fe942eb93870d0a6c48ac78524d8a70412563544b" as Hex;
const NOTE = "haven-ledger v1 n=0 c=0x3a828fa2d2b949686b1ccb8fe942eb93870d0a6c48ac78524d8a70412563544b m=invoice 1";
const MESSAGE =
  "0xe75e64e2fe37c327a6196b667e791aa53e61a6f7df40e7ac0542d985cea36278000000000000000000000000000000000000000000000000000000000000264800000000000000000000000033333333333333333333333333333333333333330000000000000000000000001111111111111111111111111111111111111111ce4f2429734c4677d82d9d124f394bf747b4657eeebba8e1acd340ec5675e2480000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006553ff105c0abb9c891d31397c12868300827dc80119bbeef5e35421f16633c1ea33cd77" as Hex;

describe("ledger vectors", () => {
  it("rebuilds the shared bytes", () => {
    expect(argsHash(PAYEE, TOKEN, AMOUNT, MEMO)).toBe(ARGS);
    expect(
      commitmentOf({
        chainId: 9800n,
        ledger: LEDGER,
        action: PAY,
        to: PAYEE,
        token: TOKEN,
        amount: AMOUNT,
        nonce: NONCE,
        signature: SIGNATURE,
      }),
    ).toBe(COMMITMENT);
    expect(noteOf(NONCE, COMMITMENT, MEMO)).toBe(NOTE);
    expect(
      payoutMessage({
        chainId: 9800n,
        ledger: LEDGER,
        payer: PAYER,
        action: PAY,
        nonce: NONCE,
        deadline: DEADLINE,
        to: PAYEE,
        token: TOKEN,
        amount: AMOUNT,
        memo: MEMO,
      }),
    ).toBe(MESSAGE);
    expect(recordPayload(NOTE)).toBe(`0x${Buffer.from(`{"record":{"note":"${NOTE}"}}`, "utf8").toString("hex")}`);
  });
});

/** The same vectors `test/HavenLedgerQor.t.sol` checks against the contract. */
describe("QOR ledger vectors", () => {
  const ONE_QOR = 1_000_000_000_000_000_000n;
  const QOR_COMMITMENT = "0x0ed7c205df59d8f54fc83b4a13ad204e6b0f92823eddcf7838afad6cdb3f95ca" as Hex;

  it("rebuilds the bytes the contract builds", () => {
    expect(PAY_QOR).toBe("0x16f937ef09f1c1944047c2812b86083a9be667bf35922dbfc47408f135508e96");
    expect(argsHash(PAYEE, NATIVE_QOR, ONE_QOR, MEMO)).toBe("0xbb88ae558f7a4fb8c4feb93576543904d95dc5857b6680b4260bc8b2f3399017");
    expect(
      commitmentOf({ chainId: 9800n, ledger: LEDGER, action: PAY_QOR, to: PAYEE, token: NATIVE_QOR, amount: ONE_QOR, nonce: 0n, signature: SIGNATURE }),
    ).toBe(QOR_COMMITMENT);
    expect(qorNoteOf(0n, QOR_COMMITMENT, ONE_QOR, MEMO)).toBe(`haven-ledger v1 n=0 c=${QOR_COMMITMENT} a=1000000uqor m=invoice 1`);
    expect(qorNoteOf(2n, QOR_COMMITMENT, 1_000_000_000_000n, "")).toBe(`haven-ledger v1 n=2 c=${QOR_COMMITMENT} a=1uqor`);
  });

  it("keeps the two assets' actions apart and refuses a fractional uqor", () => {
    expect(new Set([PAY, REFUND, PAY_QOR, REFUND_QOR]).size).toBe(4);
    expect(() => qorNoteOf(0n, QOR_COMMITMENT, 1n, "")).toThrow("not a whole uqor");
  });
});
