# Kits and libraries

Versions are the pins in `package.json`. A file path is an import under `src/`, `scripts/`, or `test/` in this repository, not a file inside `lib/`. A hash is a recorded transaction. `npm run evidence` on 22 November 2026 printed 25 passed, 0 failed.

## QoreChain packages in package.json

| Package | Version | What it does here | File | Evidence |
| --- | --- | --- | --- | --- |
| `@qorechain/sdk` | 0.14.0 | Opens and closes an EVM window, derives the account that signs it, turns the deployed address into a `qor1` name, and registers `MsgConvertCoin` for the fund | `scripts/lib/chain.ts` imports `EthNativeSigner`, `openEvmWindowMsg`, `closeEvmWindowMsg`, `fetchEvmWindow`, and `deriveUnifiedAccount`. `scripts/deploy.ts` imports `evmToQor`. `scripts/fund-ledger.ts` imports `qorechainRegistry` | Deploy window `02DC8C4BEE87B449588CE57684AF72C2D45CEEF4C40B25D713B3B25C371DBD5C`. Fund `9ECA49BBD47467966800637D55BD35440B4095292566B551BF13F78F7A33925F`. `deployments/ledger.json` records `ledgerAccount` `qor1fdhya5x2lxyecp7fjgk7kzu95fgyu6gcs40yzu` after `scripts/deploy.ts` compared it with `evmToQor` |
| `@qorechain/evm` | 0.14.0 | Prices a window before a broadcast, and turns the receipt's gas into uqor afterwards | `scripts/lib/chain.ts` and `scripts/scenes.ts` import `evmWindowCost` and `weiToUqorCeil` | Scene 1 records fee 100,027 uqor on `0x915c5f80901db1c4097ca1d766a07e86876dd41bf9050a4b37f4a50593e468a3`. Each refusal records fee 112,500 uqor |
| `@qorechain/pqc` | 0.2.3 | Checks an ML-DSA-87 signature against the payer key. `scripts/evidence.ts` and `apps/web/lib/check.ts` call `mldsa87.verify`. The web package pins the same version because the page imports it. `apps/web/node_modules/@qorechain/pqc/src/index.js` contains no WebAssembly | `scripts/evidence.ts`, `apps/web/lib/check.ts` | The evidence run. Scene 1's signature verified at nonce 0. Scene 4's signature did not verify. Scene 6's signature verified at nonce 1. The page uses the same call |

`src/ts/ledger.ts` does not import a `@qorechain/*` package. It calls `signAuth` and `encodeAuthMessage` from `haven-pq-kit/pqauth`. The kit's `src/ts/pqauth.ts` calls `pqcSign` from `@qorechain/sdk`.

## The kit this repo vendors

| Package | Pin | File | Evidence |
| --- | --- | --- | --- |
| `haven-pq-kit` | v0.1.0, `9fe7ac289f512e39bce6a2d5e31baeb98195519c` | `src/HavenLedger.sol` imports `PqAuth`. `src/ts/ledger.ts` imports `encodeAuthMessage` and `signAuth`. `scripts/evidence.ts` and `scripts/deploy.ts` import `readMlDsaKey` from `haven-pq-kit/keydir` | Pay `0x915c5f80901db1c4097ca1d766a07e86876dd41bf9050a4b37f4a50593e468a3`. `test/Vectors.t.sol` checks the shared message with no chain |
| `forge-std` | v1.17.0, `f3dae6e6ee381f25eb6a246f7da9b85c91a68219` | `src/HavenLedger.sol` imports `IERC20`. `test/HavenLedger.invariant.t.sol` imports `Test` | `forge test` on 22 November 2026: 32 passed, 0 failed |

The `PqAuth` interface follows Adityaakr's public `qore-pq-kit` (Apache-2.0).

## Not used, and why

These names were searched under `src/`, `scripts/`, and `test/` on 22 November 2026. None of those trees import them. Some appear in `package-lock.json` because `haven-pq-kit` depends on them. This repository does not call them.

- `@qorechain/qoreseal` 0.1.0. There is no sealed file. The note on a receipt is public.
- `@qorechain/qoresign` 0.1.0. The payer enrollment `E8B758F28878BDC0CEE735B8685F8115D3FFBF8D4EF7BAE20D9830FEAA88EA33` was made with the kit CLI. No ledger script imports this package.
- `@qorechain/mcp` 0.1.1. `scripts/evidence.ts` uses viem and the REST endpoints. It does not call MCP.
- `@qorechain/qorescan`. It is not in this `package.json`. There is no CBOM script and no `cbom.json` in this repo. No scan is claimed.
- `@qorechain/qore-cli`. It is not a direct dependency in `package.json`. No script under `scripts/` calls it.
- `create-qorechain-dapp`, `@qorechain/wallet-adapter`, and `@qorechain/qorex-types`. They are not in `package.json` or `apps/web/package.json`. The page does not open a wallet.
- The AI precompiles. No file under `src/` or `scripts/` names them. Spike submits a signed call. Spike is not an agent with authority.
