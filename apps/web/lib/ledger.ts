/**
 * The bytes `src/ts/ledger.ts` and `lib/haven-pq-kit/src/ts/pqauth.ts` build.
 * `encodeAuthMessage` is the eight words in `encodeAuthMessage` there.
 */
import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";

export const PAY: Hex = keccak256(toBytes("haven-ledger.pay"));
export const REFUND: Hex = keccak256(toBytes("haven-ledger.refund"));
export const COMMITMENT_DOMAIN: Hex = keccak256(toBytes("haven-ledger.commitment.v1"));
export const AUTH_DOMAIN: Hex = keccak256(toBytes("haven-pq-kit.PqAuth.v1"));

export function argsHash(to: Address, token: Address, amount: bigint, memo: string): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }],
      [to, token, amount, keccak256(toBytes(memo))],
    ),
  );
}

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

export function noteOf(nonce: bigint, commitment: Hex, memo: string): string {
  const base = `haven-ledger v1 n=${nonce.toString()} c=${commitment}`;
  if (memo.length === 0) return base;
  return `${base} m=${memo}`;
}

export function encodeAuthMessage(fields: {
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
}): Hex {
  return encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes32" },
    ],
    [
      AUTH_DOMAIN,
      fields.chainId,
      fields.ledger,
      fields.payer,
      fields.action,
      fields.nonce,
      fields.deadline,
      argsHash(fields.to, fields.token, fields.amount, fields.memo),
    ],
  );
}
