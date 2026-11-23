/**
 * The `qor1...` name of a 20-byte EVM address: bech32 (BIP-173) with the `qor` prefix, the same
 * encoding `src/Bech32.sol` computes on chain. Used to read a payout recipient's x/bank balance.
 */
import { hexToBytes, isAddress, type Address } from "viem";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i] as number;
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const char of hrp) out.push(char.charCodeAt(0) >>> 5);
  out.push(0);
  for (const char of hrp) out.push(char.charCodeAt(0) & 31);
  return out;
}

function toWords(bytes: Uint8Array): number[] {
  const words: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >>> bits) & 31);
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  return words;
}

export function evmToQor(address: Address): string {
  if (!isAddress(address, { strict: false })) throw new Error(`${address} is not an address`);
  const hrp = "qor";
  const words = toWords(hexToBytes(address));
  const mod = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((word) => CHARSET[word]).join("")}`;
}
