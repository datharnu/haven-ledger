import { encodeAuthMessage, signAuth, type AuthFields } from "haven-pq-kit/pqauth";
import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";

export const PAY: Hex = keccak256(toBytes("haven-ledger.pay"));
export const REFUND: Hex = keccak256(toBytes("haven-ledger.refund"));
export const COMMITMENT_DOMAIN: Hex = keccak256(toBytes("haven-ledger.commitment.v1"));

/** `HavenLedgerQor.PAY` and `REFUND`. Not the fUSD actions, so one asset's signature never moves the other. */
export const PAY_QOR: Hex = keccak256(toBytes("haven-ledger.qor.pay"));
export const REFUND_QOR: Hex = keccak256(toBytes("haven-ledger.qor.refund"));
/** `HavenLedgerQor.token()`: native QOR stands where the fUSD ledger puts its ERC-20. */
export const NATIVE_QOR: Address = "0x0000000000000000000000000000000000000000";
/** One bank `uqor` in EVM wei. */
export const UQOR_WEI = 1_000_000_000_000n;

/** The hash `HavenLedger.argsHash` returns: `keccak256(abi.encode(to, token, amount, keccak256(memo)))`. */
export function argsHash(to: Address, token: Address, amount: bigint, memo: string): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }],
      [to, token, amount, keccak256(toBytes(memo))],
    ),
  );
}

/** The hash `HavenLedger.commitmentOf` returns. */
export function commitmentOf(fields: {
  chainId: bigint;
  ledger: Address;
  action: Hex;
  to: Address;
  token: Address;
  amount: bigint;
  nonce: bigint;
  signature: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        COMMITMENT_DOMAIN,
        fields.chainId,
        fields.ledger,
        fields.action,
        fields.to,
        fields.token,
        fields.amount,
        fields.nonce,
        keccak256(fields.signature),
      ],
    ),
  );
}

/** The note `NativeReceipt.note` builds. */
export function noteOf(nonce: bigint, commitment: Hex, memo: string): string {
  const base = `haven-ledger v1 n=${nonce.toString()} c=${commitment}`;
  if (memo.length === 0) return base;
  return `${base} m=${memo}`;
}

/** The note `HavenLedgerQor.noteOf` builds: the fUSD note with ` a=<uqor>uqor` before the memo. */
export function qorNoteOf(nonce: bigint, commitment: Hex, amountWei: bigint, memo: string): string {
  if (amountWei % UQOR_WEI !== 0n) throw new Error(`${amountWei} wei is not a whole uqor`);
  const base = `haven-ledger v1 n=${nonce.toString()} c=${commitment} a=${(amountWei / UQOR_WEI).toString()}uqor`;
  if (memo.length === 0) return base;
  return `${base} m=${memo}`;
}

/** The JSON `NativeReceipt.recordPayload` sends to the bridge. */
export function recordPayload(note: string): Hex {
  return `0x${Buffer.from(`{"record":{"note":"${note}"}}`, "utf8").toString("hex")}`;
}

export type PayoutFields = {
  chainId: bigint;
  ledger: Address;
  payer: Address;
  action: Hex;
  nonce: bigint;
  deadline: bigint;
  to: Address;
  token: Address;
  amount: bigint;
  memo: string;
};

/** ML-DSA-87 over the `PqAuth` message for one payout. */
export function signPayout(secretKey: Uint8Array, fields: PayoutFields): Hex {
  const signed = signAuth(secretKey, authFields(fields));
  return signed.signature;
}

export function payoutMessage(fields: PayoutFields): Hex {
  return encodeAuthMessage(authFields(fields));
}

function authFields(fields: PayoutFields): AuthFields {
  return {
    chainId: fields.chainId,
    contract: fields.ledger,
    signer: fields.payer,
    action: fields.action,
    nonce: fields.nonce,
    deadline: fields.deadline,
    argsHash: argsHash(fields.to, fields.token, fields.amount, fields.memo),
  };
}
