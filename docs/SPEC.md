# Haven Ledger specification

## The rule

fUSD leaves the ledger only for the payee or the payer named at creation. It leaves only with a fresh ML-DSA-87 signature from the payer. In the same transaction, the ledger writes a receipt into `qday-receipts`, a Native (CosmWasm) contract that governance put on the CrossVM allowlist. The Native receipt carries the payout's commitment. The EVM payout stores the Native receipt id. If either lane refuses, neither lane changes.

## Deployed

On 22 November 2026 the ledger on `qorechain-diana` (EVM chain id 9800) is `0x4B6E4ed0Caf9899c07c9922DEb0b85A2504E6918`. Its Native name is `qor1fdhya5x2lxyecp7fjgk7kzu95fgyu6gcs40yzu`. Scene 1, transaction `0x915c5f80901db1c4097ca1d766a07e86876dd41bf9050a4b37f4a50593e468a3`, wrote receipt 4. The sender on that receipt is the same `qor1`. The Native sender of a contract call is the contract's own `qor1`.

## Parts

| Part | Where | Who controls it |
| --- | --- | --- |
| `HavenLedger` | EVM, `src/HavenLedger.sol` | Nobody after deployment. No owner, no upgrade. |
| CrossVM bridge | precompile `0x…0901` | The chain. It calls only allowlisted Native contracts. |
| `qday-receipts` | Native, `qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8`, code 865 | Governance proposal 40. It has no admin. |
| PQC precompiles | `0x…0a01` verify, `0x…0a02` key status | The chain. |

## State fixed at creation

- `payer`, `payee`, `token`. Zero addresses and `payer == payee` are refused.
- `receipts`, the Native target. It must start with `qor1`. The bridge checks the allowlist on every call.
- `ledgerAccount`, the ledger's own `qor1` name. It is the bech32 of the contract's 20 bytes, computed in the constructor by `Bech32.qor`.
- The payer's ML-DSA-87 key must already be registered and possession-proven, or the constructor reverts `KeyNotRegistered`.

## `pay` and `refund`

`pay(amount, memo, deadline, signature)` sends to `payee`. `refund(...)` sends to `payer`. Anyone may submit either call. The submitter has no authority.

In order:

1. A reentrancy lock.
2. `amount` must be above zero and fit in 128 bits.
3. The memo may be empty. Otherwise it is printable ASCII, has no `"` and no `\`, has no space at either end, and is at most 256 bytes. These rules keep the memo inside the JSON string and stop the Native contract's trim from changing the echo. The Native 140-character note limit is not repeated. A note that is too long makes the Native lane refuse, and the payout reverts.
4. `PqAuth.authorize` checks the payer's signature over `keccak256("haven-pq-kit.PqAuth.v1")`, the chain id, the ledger, the payer, the action (`haven-ledger.pay` or `haven-ledger.refund`), the nonce, the deadline, and `argsHash = keccak256(abi.encode(to, token, amount, keccak256(memo)))`. The deadline may be at most one day ahead. The nonce goes up by one.
5. `commitment = keccak256(abi.encode(keccak256("haven-ledger.commitment.v1"), chainId, ledger, action, to, token, amount, nonce, keccak256(signature)))`.
6. The note is `haven-ledger v1 n=<nonce> c=0x<commitment>`, followed by ` m=<memo>` if there is a memo.
7. The ledger calls `executeCrossVMCall(1, receipts, {"record":{"note":"<note>"}})` with a plain `CALL`.
   - If the bridge reverts, the ledger reverts with the bridge's own reason.
   - If it returns no data, the ledger reverts `BridgeInactive`.
   - The reply may be ABI-encoded `bytes` or raw bytes. Both are accepted.
   - The reply must be exactly `{"id":<n>,"sender":"<ledgerAccount>","note":"<note>","height":<h>}`, or the ledger reverts `ReplyMismatch`.
8. The payout is stored: recipient, amount, Native receipt id, Native height, EVM block, commitment.
9. `token.transfer(to, amount)`. A false return reverts `TransferFailed`. A short balance reverts in the token. Either way, the Native receipt from step 7 is undone too.
10. `Moved(id, to, refund, amount, receiptId, nativeHeight, commitment)` is emitted.

## How a reader checks both lanes

From an EVM transaction alone:

1. Read the `Moved` event and the call's arguments, including the signature.
2. Recompute the commitment with `commitmentOf`.
3. Query `qday-receipts` for `{"receipt":{"id":<receiptId>}}`.
4. Check the sender is the ledger's `qor1` name, and the note contains `n=<id>` and the commitment.
5. Check the payer's signature against the key `pqcKeyStatus` reports.
6. Compare the Native height with the EVM block. The ledger stores both and does not require them to match. On 22 November 2026 the two successful contract calls stored the same number for both: receipt 4 at height 10543960, receipt 5 at height 10544236. An earlier `eth_call` from an account, in `deployments/preflight.json`, reported a height one above the block. That call did not write a receipt.

## Not in this contract

- A balance cap or a schedule. The payer signs each payout.
- A way to change payer, payee, token or target.
- Any call from Haven Escrow or Haven Steward. They do not use the ledger.
