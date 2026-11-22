# Threat model

Nothing below has run on testnet yet. Every claim is backed by a Foundry test, named in brackets. The CrossVM bridge does not exist in Foundry, so the tests use `test/mocks/FakeBridge.sol`, etched at `0x…0901`. It copies the replies and refusals read from qorechain-diana on 21 and 22 November 2026 with read-only `eth_call`.

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

**The bridge and the chain.** The ledger trusts the precompile to call the named contract, to report the real sender, and to undo the Native write when the EVM reverts. Docs and the 22 November probes support this. The probes used `eth_call` from an account, not from a contract.

**Metadata.** Amounts, memos, parties and commitments are public on both lanes.

**A lost payer key.** Funds stay in the ledger. There is no recovery path.

## Open before testnet

- The docs say the Native sender for a contract's bridge call is the contract's own `qor1` name. If testnet shows a different sender, every payout reverts `ReplyMismatch`. That fails closed, but the ledger would be unusable and the reply check would need to change.
- Gas for the real ML-DSA-87 verify plus the CosmWasm write is not known. It has to be estimated with `eth_estimateGas` before any broadcast.
