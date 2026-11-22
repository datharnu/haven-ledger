# Threat model

Every Foundry claim below is backed by a test, named in brackets. The CrossVM bridge does not exist in Foundry, so the tests use `test/mocks/FakeBridge.sol`, etched at `0x…0901`. It copies the replies and refusals read from qorechain-diana on 21 and 22 November 2026 with read-only `eth_call`. The seven scenes under "What the testnet showed" ran on 22 November 2026. Scene 7 was not broadcast.

## What the testnet showed

The ledger is `0x4B6E4ed0Caf9899c07c9922DEb0b85A2504E6918`. Amounts are fUSD base units. The count is the number of receipts in `qday-receipts`.

| Scene | What the chain did | Hash |
| --- | --- | --- |
| 1 | Pay of 100,000 to the payee. Receipt 4, height 10543960, sender the ledger. Count 3 to 4. Ledger 900,000. Payee 100,000 | `0x915c5f80901db1c4097ca1d766a07e86876dd41bf9050a4b37f4a50593e468a3` |
| 2 | Reverted. The reason contains `the note must be 1 to 140 characters`. Count stayed 4 | `0xe30358d24980be8452ba43259b3427f31365fda9b3412d1fcba738aa98e5c0ed` |
| 3 | Reverted `ERC20InsufficientBalance` for 5,000,000 against a balance of 900,000. Count stayed 4 | `0x5fa5d1bcab4e0fc6282fd9b823eae62c66bd64782708ea06869d04b41d087d4f` |
| 4 | Reverted `SignatureInvalid`. Count stayed 4 | `0x5db0afa49e3ec28c2359ca3c1a40b0ec5538ecdd54894f82b8f0c15cbd0fbfad` |
| 5 | The scene 1 signature sent again. Reverted `SignatureInvalid`. Count stayed 4 | `0xc78e0efe3806c3d032fda2374551359246d0f1dadd936d0107a5f63dca2a4677` |
| 6 | Refund of 200,000 to the payer. Receipt 5, height 10544236. Count 4 to 5. Ledger 700,000. Payer 200,000. Payee 100,000. Nonce 2 | `0x78a95df330323747e9def24189446977a70869af091545ca6f4c420d34ec490d` |
| 7 | Refused before broadcast; there is no hash. The bridge returned `cross-VM bridge call refused: target cosmwasm:qor1qg5ega6dykkxc307y25pecuufrjkxkaggkkxh7nad0vhyhtuhw3sqaa3c5 is not allowlisted` | none |

Scene 1 is the sender check. Receipt 4 was written by the contract, and its sender is `qor1fdhya5x2lxyecp7fjgk7kzu95fgyu6gcs40yzu`, the ledger's own name. The Native sender of a contract call is the contract's own `qor1`. An earlier `eth_call` from an account, stored in `deployments/preflight.json`, named that account instead, and it did not write a receipt.

Scene 3 is the atomic refusal. The token revert came after the bridge call. The receipt count did not move.

## What is protected

fUSD can go only to the payer or the payee fixed at creation. Each payout needs a fresh ML-DSA-87 signature from the payer over the recipient, token, amount and memo. Each payout writes exactly one Native receipt, and each Native receipt the ledger writes has exactly one payout. The two records name each other.

## Who it protects against

**A thief with only the payer's secp256k1 key.** That key cannot produce the ML-DSA-87 signature. A junk or random signature is refused before the bridge is called. [`test_pay_refusesAJunkSignatureBeforeTheBridge`, `testFuzz_pay_anyOtherSignatureIsRefused`]

**A relayer.** It can submit or withhold a signed call. It cannot change the amount, the memo, the action or the recipient, because all four are signed. [`test_pay_signatureCoversTheAmountAndTheMemo`, `test_pay_signatureForAPayCannotRefund`]

**Someone replaying a signature.** The nonce goes up on each success. [`test_pay_refusesAReplayedSignature`] A signature whose transaction reverted was never spent, so it can still be used once. [`test_pay_aSignatureWhoseCallRevertedIsStillUnspent`] The one-day deadline limits how long that lasts.

**A Native lane that refuses.** A note over 140 characters is refused by `qday-receipts`. The fUSD transfer, the nonce and the payout record are all undone. [`test_pay_nativeRefusalUndoesThePayment`, `testFuzz_pay_aNoteOverTheNativeLimitMovesNothing`]

**An EVM lane that fails after the Native write.** A payout larger than the balance reverts in the token. The Native receipt is undone with it. [`test_pay_failedTransferUndoesTheNativeReceipt`]

**A bridge that is off or answers wrongly.** No data reverts `BridgeInactive`. A reply naming another sender, a different note, or an extra field reverts `ReplyMismatch`. [`test_pay_refusesAnInactiveBridge`, `test_pay_refusesAReplyNamingAnotherSender`, `test_pay_refusesAReplyWithADifferentNote`, `test_pay_refusesAReplyWithAnUnknownField`, `testFuzz_reply_rejectsAnyChangedByte`]

**A target governance did not approve.** The bridge refuses it, and the ledger passes the bridge's reason up. [`test_pay_bridgeRefusesAnUnlistedTarget`]

**A memo that breaks the note.** Quotes, backslashes, control characters and edge spaces are refused before signing is checked. [`test_pay_refusesMemosThatCouldLeaveTheJsonOrBeTrimmed`]

The invariant run drives honest, forged, replayed and oversized calls through a bridge that sometimes lies. After each run, every transfer out of the ledger went to the payer or the payee, the Native receipt count equalled the payout count, each receipt named the ledger and carried its payout's commitment, and the balance matched the payouts. [`invariant_fundsGoOnlyToPayerOrPayee`, `invariant_onePayoutPerNativeReceipt`]

## Not protected

**The payer.** A payer who signs a payout gets that payout. The ledger does not judge whether it was deserved.

**`qday-receipts` is shared.** Anyone can write a receipt into it. A receipt belongs to the ledger only if its sender is the ledger's `qor1` name. A reader who skips that check can be fooled.

**The bridge and the chain.** The ledger trusts the precompile to call the named contract, to report the real sender, and to undo the Native write when the EVM reverts. Scene 1 showed the sender of a contract call is the ledger's own `qor1`. Scene 3 showed a reverted pay left the receipt count at 4. The earlier account `eth_call` is not that proof.

**Metadata.** Amounts, memos, parties and commitments are public on both lanes.

**A lost payer key.** Funds stay in the ledger. There is no recovery path.

## What scene 1 settled

The reply check requires the Native sender to be the ledger's own `qor1`. Receipt 4 names `qor1fdhya5x2lxyecp7fjgk7kzu95fgyu6gcs40yzu`. That is `ledgerAccount` on `0x4B6E4ed0Caf9899c07c9922DEb0b85A2504E6918`. The pay stored receipt 4. A different sender would have reverted `ReplyMismatch`.

The pay used 889,125 gas. The refund used 846,143. Each refusal used 1,000,000. Those figures are in `deployments/`.
