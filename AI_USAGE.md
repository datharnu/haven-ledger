# How this was written

22 November 2026. The facts below are the git history and the documents in this repository. The commit messages do not name a model.

## Workflow

| Commit | Date | What it added |
| --- | --- | --- |
| `62e1293` | 22 November 2026 | The Apache-2.0 licence |
| `4136809` | 22 November 2026 | The ledger contract and its Foundry tests |
| `c235e16` | 22 November 2026 | The TypeScript client and the shared vectors |
| `06f032b` | 22 November 2026 | The testnet scenes for both lanes |
| `1773ea3` | 22 November 2026 | The evidence check and the test workflow |

Those five commits were written in Cursor by Grok 4.7. This note, the README, `docs/kits.md`, `docs/DEMO.md`, and the updates to `THREAT_MODEL.md` and `docs/SPEC.md` are the same session. The commit that adds them is not in the table. The scene scripts had already run. No commit in this list sends a new testnet transaction. `scripts/deploy.ts` and the scene scripts throw `already ran` when their report has `ok: true`.

## What the human decided

- The one rule. fUSD leaves the ledger only for the payee or the payer named at creation, only with a fresh ML-DSA-87 signature from the payer, and only together with a receipt in `qday-receipts`. If either lane refuses, neither changes. It is the first line of the README.
- `qday-receipts`, because a new Native contract needs governance. The ledger writes to the contract governance already approved.
- The 140-character limit stays on the Native side. The Solidity memo check does not copy it. A note that is too long makes the Native lane refuse, and the payout reverts with it.
- Spike is a relayer with no authority. Spike deploys, funds the window, and submits a call the payer already signed. Spike is not the payer and not the payee.
- No pool swap. `scripts/fund-ledger.ts` converts fUSD the payer already held. `deployments/fund-ledger.json` records `9ECA49BBD47467966800637D55BD35440B4095292566B551BF13F78F7A33925F`.
- Scene 8 was skipped. A window that hides the bridge cannot be previewed with `eth_call`, and a real broadcast would have been a valid pay.

## What was checked against the chain or the source

- `npm run evidence` on 22 November 2026 printed 25 passed, 0 failed.
- `forge test` the same day printed 32 passed, 0 failed. `npm run typecheck` passed.
- GitHub Actions run `45005303250` succeeded. The workflow does not call the testnet.
- After the scenes, `nonce()` and `payoutCount()` both read 2. The fUSD balances read 700,000, 200,000, and 100,000. The receipt count read 5. Those match `deployments/scene-6.json`.
- Receipt 4's sender in `deployments/scene-1.json` is `qor1fdhya5x2lxyecp7fjgk7kzu95fgyu6gcs40yzu`.
- A search of the Escrow and Steward repositories found no `HavenLedger` and not this ledger's address.

## What was not checked

- There is no film.
- There is no hosted page. `apps/web` can say "Verify both lanes" on a machine that can reach the testnet. No public URL has been opened.
- Scene 8 has no report and no hash.
- The deployed bytecode was not compared with the source.
- `deployments/preflight.json` is an `eth_call`. It is not a receipt.
