# Haven Ledger: project page text (build.qorechain.io)

Paste-ready text for the project page. Every address and hash below is copied from `README.md` and `deployments/`.

## About

A payer pays a contractor or grantee in fUSD on QoreChain's EVM side; an auditor or a Cosmos-side app reads the payment trail on the Native side. Haven Ledger keeps the two from ever disagreeing. Each payout needs a fresh ML-DSA-87 signature from the payer, can go only to the payee or payer fixed at creation, and, in the same EVM call, writes a receipt into the governance-approved Native CosmWasm contract `qday-receipts` through the Cross-VM bridge precompile `0x…0901`. If either lane refuses, neither changes. Receipts are written by the ledger's own derived `qor1` address, so a reader who keeps only that sender gets exactly the payout list. Rollback is proven live, not just in tests: on Diana testnet (22 November 2026) a Native-side refusal reverted the EVM call, and an EVM transfer failure undid a Native receipt that had already been written. Plus two atomic payouts, junk-signature and replay refusals, and a bridge refusal before broadcast. A second contract, HavenLedgerQor, pays native QOR, so each payout also raises the payee's Native bank balance in the same transaction as the receipt (1 QOR → +1,000,000 uqor with receipt #11, 23 November 2026).

Video (2:46): https://drive.google.com/file/d/1YuR6Qxvw3hu0RyfVZHXfCtITZ4FG69k4/view · Live verifier: https://haven-ledger-nine.vercel.app/verify · Code: https://github.com/datharnu/haven-ledger (Apache-2.0)

## Contracts (`qorechain-diana`, EVM chain ID 9800)

| Contract | Address |
| --- | --- |
| `HavenLedger` (EVM) | [`0x4B6E4ed0Caf9899c07c9922DEb0b85A2504E6918`](https://explore.qore.network/address/0x4B6E4ed0Caf9899c07c9922DEb0b85A2504E6918) / Native sender `qor1fdhya5x2lxyecp7fjgk7kzu95fgyu6gcs40yzu` |
| `HavenLedgerQor` (native QOR) | [`0x087180B80f356AAFB772b091fa7CE5C03675919b`](https://explore.qore.network/address/0x087180B80f356AAFB772b091fa7CE5C03675919b) / `qor1ppccpwq0x442ldmjkzgl5l89cqm8tyvm3recw3` |
| `qday-receipts` (Native CosmWasm, governance-approved, not deployed by this project) | [`qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8`](https://explore.qore.network/address/qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8) |
| fUSD (ERC-20, 6 decimals) | [`0x97143B771D34ddb9130b807b135Ae675A5a963CA`](https://explore.qore.network/address/0x97143B771D34ddb9130b807b135Ae675A5a963CA) |

## Key transactions (22 November 2026)

| What | Hash |
| --- | --- |
| Deploy `HavenLedger` | [`0xe13ba27c1ef83f18c1e1afb237447d2075d2c23bf666022c31463ecd261edac4`](https://explore.qore.network/tx/0xe13ba27c1ef83f18c1e1afb237447d2075d2c23bf666022c31463ecd261edac4) |
| Scene 1: pay 100,000 fUSD base units to the payee + Native receipt #4, one call | [`0x915c5f80901db1c4097ca1d766a07e86876dd41bf9050a4b37f4a50593e468a3`](https://explore.qore.network/tx/0x915c5f80901db1c4097ca1d766a07e86876dd41bf9050a4b37f4a50593e468a3) |
| Scene 2: note over 140 characters; `qday-receipts` refused, EVM payout rolled back | [`0xe30358d24980be8452ba43259b3427f31365fda9b3412d1fcba738aa98e5c0ed`](https://explore.qore.network/tx/0xe30358d24980be8452ba43259b3427f31365fda9b3412d1fcba738aa98e5c0ed) |
| Scene 3: `ERC20InsufficientBalance` (5,000,000 vs. 900,000); Native receipt rolled back | [`0x5fa5d1bcab4e0fc6282fd9b823eae62c66bd64782708ea06869d04b41d087d4f`](https://explore.qore.network/tx/0x5fa5d1bcab4e0fc6282fd9b823eae62c66bd64782708ea06869d04b41d087d4f) |
| Scene 6: refund 200,000 fUSD base units to the payer + Native receipt #5, one call | [`0x78a95df330323747e9def24189446977a70869af091545ca6f4c420d34ec490d`](https://explore.qore.network/tx/0x78a95df330323747e9def24189446977a70869af091545ca6f4c420d34ec490d) |

All seven scenes, window hashes, gas, and fees: README section "Evidence: deploy, fund, and all seven scenes (22 November 2026)".
