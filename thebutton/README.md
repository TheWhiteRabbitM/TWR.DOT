# The Button

One button. Every human may press it exactly once, ever.

A deliberately small app for the [Polkadot Products Devnet](https://docs.polkadotcommunity.foundation/),
built to demonstrate the one primitive the normal web cannot offer: **proof of personhood**.
Without it, a global "press once" counter is a bot leaderboard within minutes.

## Why this needs the platform

The contract keys presses on the caller's personhood **`contextAlias`**, not on `msg.sender`.
Anyone can generate unlimited addresses, so an address-keyed version would be meaningless.
One human resolves to exactly one alias within this app's context — and that alias is a
per-application pseudonym, so it cannot be linked to the same human's activity in any other app.

## Deployed

Devnet Asset Hub, CDM package `@thebutton/the-button`.

| | |
|---|---|
| Contract | `0xC16Ee1AaF736DCF624f0A183f0975E3F05991DDb` |
| Deploy tx | `0x7993e472661fa8c09c53d1b46725ec93ccdb3c51bb990d9f3672cdcd960c7bc7` |
| Metadata | `ipfs://bafk2bzacedjy5c7evnrdhfr5sydmt77v7aalqetdxreht2d2kgmonejxxjmbm` |
| Bytecode | 16041 bytes |
| Domain | `thebutton.dot` |
| Domain owner | `0x4c8ad74eB2e8a804066E0bc7245A27A9Db9a983d` |
| Resolver | `0xfd2594FcF920B38A970011C486e1E3041563147F` |
| Bundle CID | `bafybeidprco3prxptp2nd7wc2xsquo565brdzan25jjg45rf7qg6mrvs5m` |
| Chain genesis | `0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2` (`devnet_asset_hub`) |
| Live at | <https://thebutton.dev-dot.li> |

Republishing is incremental: `pad` probes which chunks are already on Bulletin and uploads
only the difference — 1.0 MB of a 7.0 MB bundle on the last deploy.

One account does everything: the `cdm init` devnet key is imported into the `dotns`
keystore and reused by `pad`, so only one address ever needed funding. It is a throwaway
devnet key and holds nothing of value.

Verified by reading the live contract over Ethereum JSON-RPC, not by trusting the deploy
log — `node scripts/verify-deploy.cjs` from `contract/` re-runs the checks:

```
PASS  totalPresses  0
PASS  rollLength    0
PASS  MIN_STATUS    2
PASS  CONTEXT       0x9ba4db1b9e45a8632941363fcde5481050a4d9cda692da9654bf1cac98c0e227
PASS  PERSONHOOD    0x000000000000000000000000000000000a010000
```

`CONTEXT` is `keccak256("thebutton.dot")` and `MIN_STATUS` is 2 (Full) — confirmed on the
deployed bytecode, not just in the source.

## Status

| Part | State |
|---|---|
| UI, state machine, press flow | **Verified** — runs, presses, persists across reload, no console errors |
| `npm run build` (typecheck + bundle) | **Verified** — passes clean, 1.64 MB across 6 files |
| Contract compile | **Verified** — solc 0.8.28 and `cdm build` to PolkaVM |
| `src/lib/abi.ts` | **Verified** — matches both the compiler output and CDM's generated interface |
| Contract deployment | **Verified live on devnet** — see above |
| Signer wiring for `press()` | **Closed** — `SignerManager` passed to `createContract` |
| Account mapping (`ensureContractAccountMapped`) | **Closed** — runs lazily inside `press()`, never on load |
| Rendering inside the Polkadot host | **Verified** — app loads and reaches the contract |
| Chain driver read path | **Verified end-to-end** — a real user inside the host loaded the app, the snapshot query reached the deployed contract, the personhood precompile answered (tier 0), and the UI rendered the not-human state |
| Press path (`press()` transaction) | **Not exercised** — requires an account at personhood tier Full |

The remaining gap is the press itself: `MIN_STATUS` is 2, so executing needs an account
that has completed the full personhood flow in the Polkadot app.

Without `VITE_BUTTON_ADDRESS` the app falls back to a localStorage mock, so the interface
stays explorable with no chain at all.

### The SIMULATE key

Full personhood is granted to a handful of accounts on this devnet, so most people who
open the app *inside* the host land on the `not-human` screen — the one path where the
app used to have nothing to offer but "go open it in a different browser". Any screen the
visitor cannot act on now carries a second key:

- `not-human` — verified account required, but the walkthrough is one key away
- `outside-host` — no host container detected
- `error` — including a failure in `createApp` itself, which previously ended the visit
  on a dead screen (`FatalScreen` in `main.tsx`)

SIMULATE swaps the chain driver for the localStorage mock in place. It never writes to
the chain and the screen says so.

## Run locally

```bash
npm run dev
```

Outside the Polkadot host container the app always uses the mock — the SDK routes every
connection through the host provider and has no direct-WebSocket fallback.

## Toolchain

Installed and verified on Windows: `dotns@0.8.0`, `pad@0.13.1`, `cdm@0.8.26`. All three are
plain Node and run fine.

**`cdm` cannot build contracts on Windows.** `cdm setup --check` reports git ✔, curl ✔,
**C linker (cc) ✖**, and its manual-install hint only covers Debian/Ubuntu and macOS. This
machine has no `cc`, `gcc`, `clang`, `cl`, or `cargo`. Contract compilation therefore has
to happen under WSL (Ubuntu 24.04 is present, and the repo is reachable at
`/mnt/c/Users/miche/Downloads/DOT APP`).

Domain registration (`dotns`) and bundle publishing (`pad`) do **not** need the C
toolchain and work from Windows as-is. Only `cdm build` / `cdm deploy` need WSL.

WSL prerequisites, none of which are installed yet — `sudo` on this machine requires a
password, so these must be run by hand:

```bash
sudo apt update && sudo apt install -y build-essential
```

Then Node 22+ inside WSL (Ubuntu 24.04's apt Node is too old for `cdm`), followed by the
CLI and toolchain:

```bash
npm i -g @polkadot-community-foundation/cdm-cli && cdm setup
```

## Funding

The faucet at <https://faucet.polkadot.io> wants the **SS58** address, not the EVM one.
Request PAS on two chains: **Asset Hub (1000)** for contract, domain, and publishing fees,
and **People (1004)** for identity operations.

Bulletin uploads need a separate byte quota, granted from the
[Bulletin Chain Console](https://paritytech.github.io/polkadot-bulletin-chain/) — select
Products Devnet, then the Faucet tab.

## Deploy

**1. Deploy the contract** (from WSL, once the toolchain above is in place)

```bash
cdm deploy -n devnet
```

Constructor arguments:

- `personhoodPrecompile` — pass `address(0)` to use the documented default
  `0x000000000000000000000000000000000a010000`
- `context` — `keccak256("thebutton.dot")`
- `minStatus` — **must be `2` (Full)**. Tier `1` (Lite) only means "registered a
  username", which any number of fresh accounts can do, so deploying with `1` lets a
  single human press repeatedly and defeats the entire premise of the app

**2. Point the app at it**

```bash
cp .env.example .env
```

Set `VITE_BUTTON_ADDRESS` to the deployed address.

**3. Register the domain**

`thebutton` is exactly 9 characters, meeting the minimum label length.

```bash
dotns register domain --name thebutton --env devnet
```

**4. Publish the bundle**

```bash
npm run build
npm run deploy:devnet
```

The app then resolves as `thebutton.dot` inside the Polkadot app, and at
`https://thebutton.dev-dot.li` on the web gateway.

## Architecture

Two separate workspaces. The frontend is Vite + React; the contract is Hardhat. They
keep their own `package.json` because their toolchains pin incompatible TypeScript
versions — merging them is a dependency fight with nothing to gain.

```
src/                      frontend (Vite)
  main.tsx                host detection, picks the real or mock app
  App.tsx                 state machine (loading → ready → pressing → pressed)
  ButtonScreen.tsx        presentational, driver-agnostic
  lib/
    signer.ts             process-wide SignerManager
    chainDriver.ts        reads/writes the contract on devnet Asset Hub
    mockDriver.ts         localStorage stand-in
    abi.ts                ABI from the compiler — do not hand-edit
    config.ts             devnet addresses and app constants
contract/                 CDM workspace (Hardhat)
  hardhat.config.ts       solidity 0.8.28, @parity/hardhat-polkadot
  contracts/
    TheButton.sol         @custom:cdm @thebutton/the-button
    TheButton.md          published as the contract's README
```

Both drivers implement `ButtonDriver` (`load()` / `press()`), so the UI never knows
which one is behind it.

A Solidity contract declares its CDM package name with a NatSpec tag —
`/// @custom:cdm @thebutton/the-button`. Package names are global per registry and
first-writer-owns.

## Signing

`useWallet()` exposes `signMessage` but never a `PolkadotSigner`, so it cannot drive a
contract transaction. The signer comes from `SignerManager`
(`@parity/product-sdk-signer`) instead, created once in [`src/lib/signer.ts`](src/lib/signer.ts)
and handed to `createContract({ signerManager })`, which resolves the current account at
call time so account switches are picked up without rebuilding the contract handle.

`ProductSDKProvider` / `useWallet` are no longer used at all — one less moving part.

No `onConnect` resource allocation is requested. The Button asks for exactly one signature
in a user's lifetime, so the host's auto-signing allowance would buy nothing and widen what
the app is permitted to do.

**Two address spaces.** `SignerAccount` carries both `address` (SS58) and `h160Address`
(EVM). The contract's `snapshot(address)` and the personhood precompile take the **H160**;
the dry-run `origin` takes the **SS58**. Passing the wrong one reads a different account
and silently reports "never pressed".

**Chain access goes through the host, not around it.** `createChainClient` opens its own
connection, and the Polkadot host shows the user a "Direct Chain Access — this app uses a
direct chain connection instead of the recommended host API" warning when it does. The
driver now takes `app.chain` from `ProductSDKProvider` and calls `connect()` then
`getRawClient()`, which the SDK documents as the path to `createContractRuntime`. That is
why the provider is back despite `SignerManager` handling signing: the provider owns chain
connections, `SignerManager` owns keys.

**Queries must not run as the user.** pallet-revive rejects any dry-run whose origin is an
unmapped account with `Module.Revive.AccountUnmapped` — and a fresh user is always
unmapped. The SDK ships `QUERY_FALLBACK_ORIGIN` (the pallet's own module account, mapped
by construction) for exactly this, but its origin resolution prefers the signer's selected
account over the fallback, so the driver forces `{ origin: QUERY_FALLBACK_ORIGIN }` on
every `.query()`. This was the first error a real user ever saw on screen.

**Reads must never trigger a write.** `ensureContractAccountMapped` submits a transaction
when the account is unmapped. Calling it while constructing the driver made a read-only
page load wait on a signature, and the first run inside the Polkadot host sat on
"reading register" forever. It now runs lazily in `press()` — the only path that needs a
mapped account.

**Every await is bounded.** `chainDriver.ts` wraps each call in `withTimeout`. A promise
that never settles used to be indistinguishable from a slow network; now it becomes a named
error. The driver also reports its current step (`connecting to asset hub`, `reading
snapshot`, `signing`, …) and the UI prints it in the terminal readout, so a stall says
where it stalled.

## The keypad

The six numbers under the counter are a working keypad. Entering `4 8 15 16 23 42` — on a
real keyboard or by clicking them in order — sends a white rabbit hopping across the
screen. `src/lib/useSequence.ts` and `src/Rabbit.tsx`.

The rabbit unmounts on `animationend` **and** on a 6.2s timer. `animationend` never fires
when the page is not compositing (hidden tab, background window), which would otherwise
strand it on screen permanently.

## Publishing

**CSS is inlined into `index.html`** by a small Vite plugin (`vite.config.ts`). The
gateway twice served the external stylesheet as a `text/html` 404, which strict MIME
checking rejects — the second time this produced a full-viewport unstyled SVG for a real
user. A stylesheet that does not exist as a file cannot go missing.

Never rebuild `dist` while `pad` is running. `pad` packs the directory as it goes, so a
concurrent build produces a bundle whose `index.html` references assets from a different
build — the gateway then serves HTML in place of the missing file and the browser reports
`Refused to apply style … MIME type ('text/html')`. Delete `dist`, build once, publish
once, then confirm the gateway's iframe `?cid=` matches the CID `pad` printed.

The right chain descriptor was settled by asking the chain rather than guessing from names:
`chain_getBlockHash(0)` on the RPC `cdm` deployed to returns
`0xd6eec261…e11ef2`, which is `devnet_asset_hub`. `paseo_asset_hub` is a different chain and
does not have this contract on it.

## The personhood population (measured, not guessed)

`scripts/personhood.mjs` talks to the devnet individuality chain directly:

```bash
node scripts/personhood.mjs status      # count recognized persons, check our key
node scripts/personhood.mjs recognize   # devnet only: become a person via DummyDim
node scripts/personhood.mjs press       # dry-run + submit press() via Revive.call
```

Measured on 2026-07-24: **41 recognized persons** on the devnet (`People.People` map,
41 personal ids allocated). The map decodes as `personalId → { key }`, so recognition
binds a public key per person — which is why `recognize` registers our account's own
sr25519 key as the member key.

The `DummyDim` pallet is the devnet's mock individuality mechanism (reserve ids,
recognize, suspend). It exists precisely so testing does not require a live proving
ceremony, and none of it exists on a production network. Endpoint note:
`people-paseo.rotko.net` (the SDK's configured default) hung indefinitely when we used
it; `people-paseo.gatotech.network` answers. The script tries several in order.

## Known gaps

- **Bundle size.** `@parity/product-sdk/chain` pulls metadata for every supported chain
  (~4 MB across chunks). Importing the devnet descriptor directly, or code-splitting the
  chain driver behind a dynamic import, would cut a lot before publishing to Bulletin.
- **Multi-output decoding.** `snapshot()` returns four values; the driver accepts both
  array and named-object decoding since the decoder's shape is unconfirmed.
- **Nothing has run against a live chain.** Every chain-facing path above is written to the
  SDK's published types and typechecks, but has never exchanged a byte with devnet.
