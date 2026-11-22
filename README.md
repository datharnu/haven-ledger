# Haven Ledger

**fUSD leaves the ledger only for the payee or the payer named at creation, only with a fresh ML-DSA-87 signature from the payer, and only together with a receipt in `qday-receipts`. If either lane refuses, neither changes.**

Track: Cross-VM, [Build Before Q-Day](https://build.qorechain.io/). Repository: https://github.com/datharnu/haven-ledger. Licence: Apache-2.0.

Network `qorechain-diana`, EVM chain id 9800. Testnet only. fUSD has no value.

The two names on the line are fixed in the constructor. Spike can submit a signed call. Spike cannot choose a third recipient. There is no owner, no upgrade, and no function that takes an address.

## How to check it

`npm run evidence` reads every hash in `deployments/*.json` and checks it on `qorechain-diana`. It needs no key. It does not send a transaction.

```bash
git clone --recurse-submodules https://github.com/datharnu/haven-ledger
cd haven-ledger
npm ci
npm run evidence
```

On 22 November 2026 that command printed 25 passed, 0 failed. Re-run it. A later failure means a recorded hash no longer matches the chain.

The same check runs in the browser. It sends nothing. The public copy is https://haven-ledger-nine.vercel.app. Opened on 22 November 2026. **Verify both lanes** on `/verify` finished at 390px and at 1440px. The tally was 7 checked, 2 agreed on both lanes, 4 refused, and 1 has no hash. Scene 1 agreed: receipt 4 is from the ledger's own qor1, and both heights are 10543960. Scene 3 was refused with `ERC20InsufficientBalance` for 5,000,000 against 900,000. Scene 7 says there is no hash. Horizontal overflow was 0. No scene said "Could not reach the testnet".

```bash
cd apps/web
npm ci
npm run dev
```

**Verify both lanes** is on `/verify`. The list on `/` is the record. The verdict is the testnet. The site is the Next.js app in `apps/web`. Vercel builds it with the root directory set to `apps/web`. The install is `npm ci` and the build is `npm run build`. Leave both as the framework defaults. Do not set a root `vercel.json`. The one setting is the root directory. The page has no environment variables.

The same day, after the scenes, these reads matched the scene files: `nonce()` 2, `payoutCount()` 2, fUSD balances 700,000 on the ledger, 200,000 on the payer and 100,000 on the payee, and receipt count 5. Amounts are base units.

`forge test` and `npm run test:ts` need no chain and no key. On 22 November 2026 `forge test` printed 32 passed, 0 failed. A passing test is not a testnet receipt.

## What was recorded

All of this ran on 22 November 2026. The call hashes are the EVM transactions. The hashes with no `0x` are Cosmos transactions. Gas and fees are the figures stored next to each hash.

### Deploy and fund

| Step | Hash | Gas | Fee |
| --- | --- | --- | --- |
| Open the deploy window | `02DC8C4BEE87B449588CE57684AF72C2D45CEEF4C40B25D713B3B25C371DBD5C` | 187,340 | 180,000 uqor |
| Deploy HavenLedger | `0xe13ba27c1ef83f18c1e1afb237447d2075d2c23bf666022c31463ecd261edac4` | 1,988,176 | 223,670 uqor |
| Close the deploy window | `7D932A024B35D3376F4414A74A9721CBCFA5A2F8AA4E846455BD96289197A3C8` | 170,532 | 180,000 uqor |
| Fund the ledger | `9ECA49BBD47467966800637D55BD35440B4095292566B551BF13F78F7A33925F` | — | — |

The fund moved 1,000,000 base units with `MsgConvertCoin`. There was no pool swap. The ledger's fUSD balance after it was 1,000,000. `deployments/fund-ledger.json` does not record gas or a fee, so that row leaves both blank.

### The seven scenes

| Scene | What happened | Hash |
| --- | --- | --- |
| 1 | Pay 100,000 to the payee. Receipt 4, height 10543960. Count 3 to 4. Ledger 900,000. Payee 100,000. Gas 889,125. Fee 100,027 uqor | `0x915c5f80901db1c4097ca1d766a07e86876dd41bf9050a4b37f4a50593e468a3` |
| 2 | Reverted. The reason contains `the note must be 1 to 140 characters`. Count stayed 4. Gas 1,000,000. Fee 112,500 uqor | `0xe30358d24980be8452ba43259b3427f31365fda9b3412d1fcba738aa98e5c0ed` |
| 3 | Reverted `ERC20InsufficientBalance` for 5,000,000 against 900,000. Count stayed 4. Gas 1,000,000. Fee 112,500 uqor | `0x5fa5d1bcab4e0fc6282fd9b823eae62c66bd64782708ea06869d04b41d087d4f` |
| 4 | Reverted `SignatureInvalid`. Count stayed 4. Gas 1,000,000. Fee 112,500 uqor | `0x5db0afa49e3ec28c2359ca3c1a40b0ec5538ecdd54894f82b8f0c15cbd0fbfad` |
| 5 | The scene 1 signature sent again. Reverted `SignatureInvalid`. Count stayed 4. Gas 1,000,000. Fee 112,500 uqor | `0xc78e0efe3806c3d032fda2374551359246d0f1dadd936d0107a5f63dca2a4677` |
| 6 | Refund 200,000 to the payer. Receipt 5, height 10544236, note carries `n=1`. Count 4 to 5. Ledger 700,000. Payer 200,000. Payee 100,000. Nonce 2. Gas 846,143. Fee 95,192 uqor | `0x78a95df330323747e9def24189446977a70869af091545ca6f4c420d34ec490d` |
| 7 | Refused before broadcast; there is no hash | none |

Receipt 4 begins `haven-ledger v1 n=0`. Its sender is the ledger. Receipt 5 begins `haven-ledger v1 n=1`. Its sender is the ledger.

Each broadcast scene also opened and closed a window. Those hashes are in the scene files, and `npm run evidence` checks them too.

| Scene | Open | Close |
| --- | --- | --- |
| 1 | `49702ECCEB160FC853B3A4670AD21A163AD5EFB38ABC9D48DDD819EF4BFFE88E` | `A507C54EA1333CF855CFF9C60904243BD2C44DD8B41A333801DC3C15416F8367` |
| 2 | `7ADC75F8D9679A1A15AF8E5E7418054E568DE533A37F3A2B480092EBF22397CC` | `CA2C9E56C6039E6043714C2345D27575F53622043E69FD27E39520007144CED6` |
| 3 | `270504DFFAFC14A9917FA43801A0B52368AAE5E68138134F2888C1A479449660` | `0AFC86419EA91A8904FDD505424DACD7E1F091144875DCF64FEB935B1AE0C896` |
| 4 | `3A576F94BE9118313367EA4AF27CFC192B45028284BCF8713CE77C91C85A1276` | `5E1C7179296D3BCEC267599E5E1D7C17FCAC215C2372DE4614D3EADFBF97D8B4` |
| 5 | `184EB0A55C657A5E70582EFF3F64F447FB3E37B47331EE7325755171ADBF28E6` | `DE59EFD85A564EF8F245081EFB0ADD3B0FC49146C81BB0AB6C4566EF2AAD0F19` |
| 6 | `CCBD041F1E83328F8D36D4D7BB24DFDA0C5190D9F133B4B3383E9A002D06DB9F` | `111AEA9F850A1B5A0DE4F0A61791458F059CE867AD5AFEEBFB7FD818E5829BF8` |

The payer was funded and enrolled before the deploy. `871100955616776AB80EE1E7D8749F1E9C36A530A962237464E1DB76CA081617` is the 3,000,000 uqor send. `E8B758F28878BDC0CEE735B8685F8115D3FFBF8D4EF7BAE20D9830FEAA88EA33` is the ML-DSA-87 enrollment with proof of possession. The payee has no hash. No QOR was sent to the payee, and no key was enrolled for the payee.

## Addresses

| What | Address |
| --- | --- |
| Ledger | `0x4B6E4ed0Caf9899c07c9922DEb0b85A2504E6918` / `qor1fdhya5x2lxyecp7fjgk7kzu95fgyu6gcs40yzu` |
| Payer | `qor1fw43p6292ljewm7l2hxtu47jd8v66hmkyajz4q` / `0x4bAb10E94557E5976FDf55cCbe57D269d9Ad5f76` |
| Payee | `qor1yfs8uxwhq9ammnu5eeafk3r0387k94fs82n86g` / `0x22607e19d7017bBdCf94Ce7a9B446F89fD62d530` |
| fUSD | `0x97143B771D34ddb9130b807b135Ae675A5a963CA` |
| `qday-receipts` | `qor1xjayq5ev55tkzpml9klxwyshr7gdrha0nurha9jhm0f0gdckksgs3gltw8` |
| Spike, deployer and relayer, not a party | `qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl` / `0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396` |

The explorer is https://explore.qore.network. `npm run evidence` is the check that the hashes landed.

## How to run the tests

Foundry and Node 22 are required. Clone with `--recurse-submodules`. The two submodules stay at `haven-pq-kit` `9fe7ac289f512e39bce6a2d5e31baeb98195519c` and `forge-std` `f3dae6e6ee381f25eb6a246f7da9b85c91a68219`.

```bash
forge build
forge test
npm run typecheck
npm run test:ts
```

`.github/workflows/test.yml` runs those four in the contract job, after `npm ci`. A second job, in `apps/web`, runs `npm run typecheck`, `npm run test:unit`, and `npm run smoke`. Neither job calls the testnet, and neither runs `npm run evidence`. The live browser check stays off unless `HAVEN_LIVE_VERIFY=1`. On 22 November 2026 GitHub Actions run `45005303250` succeeded. That run is the contract job only.

`.gas-snapshot` is the `forge snapshot` output from the same day. The workflow does not compare against it. Fuzz gas moves between runs.

Do not run `npm run deploy`, `npm run fund-account`, `npm run fund-ledger`, or `npm run scenes`. A finished report throws `already ran`. Sending one again would be a second payout or a second deploy.

## What the bridge does and does not prove

Scene 1 is one payout on both lanes. The EVM transaction succeeded, receipt 4 names the ledger, and the note carries the commitment. The Native sender of that contract call is the contract's own `qor1`.

Scene 3 is the refusal. The pay asked for more fUSD than the ledger held. The EVM transaction reverted, and the receipt count stayed 4. The Native write inside the call did not remain.

A reader who skips the sender check can be fooled. Anyone can write to `qday-receipts`. A receipt belongs to this ledger only when its sender is `qor1fdhya5x2lxyecp7fjgk7kzu95fgyu6gcs40yzu`. The preflight `eth_call` in `deployments/preflight.json` returned a simulated receipt whose sender was Spike. That call wrote nothing. Receipt 4 is the scene 1 transaction, and its sender is the ledger.

The ledger stores the Native height and the EVM block and does not require them to be equal. On these two contract calls they were equal: 10543960 and 10544236. The account `eth_call` was one block ahead. That is a record, not a rule.

Scene 7 never left the machine. The bridge refused an unlisted target, and there is no hash to fetch.

## Credits

`package.json` pins `@qorechain/sdk` 0.14.0, `@qorechain/evm` 0.14.0, and `@qorechain/pqc` 0.2.3. What each one does in this repo is [docs/kits.md](docs/kits.md).

`haven-pq-kit` v0.1.0 is the submodule at `9fe7ac289f512e39bce6a2d5e31baeb98195519c`. `src/HavenLedger.sol` uses its `PqAuth`. `forge-std` v1.17.0 is the submodule at `f3dae6e6ee381f25eb6a246f7da9b85c91a68219`. `src/HavenLedger.sol` imports its `IERC20`, and the tests import `forge-std/Test.sol`.

The `PqAuth` interface follows Adityaakr's public `qore-pq-kit` (Apache-2.0).

The call shape follows the fest workshop `02-cross-vm`, listed in the [Build Before Q-Day workshop repository](https://github.com/qorechain/build-before-qday) as `workshop-3/02-cross-vm`: an EVM contract writes into a governance-approved Native contract in the same transaction, through the bridge at `0x…0901`, and both sides change or neither does.

The cover is [docs/cover.png](docs/cover.png), 1200×675.

## Not in the repo yet, and not claimed

- There is no film. The shot list is [docs/DEMO.md](docs/DEMO.md).
- Scene 8 was not run. A window that hides the bridge cannot be previewed with `eth_call`, and a broadcast would have been a valid pay.
- Escrow and Steward do not call this contract. A search of those repositories on 22 November 2026 found no `HavenLedger` and not this address.
- [docs/cover.png](docs/cover.png) has not been uploaded to the project page.
- Nothing here compares the deployed bytecode with the source. `forge test` is the local check. The compiler settings are in `foundry.toml`.
