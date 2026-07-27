# TWR.DOT — seven real apps on the Polkadot App platform

Seven .dot apps built end-to-end on the [Polkadot Products Devnet](https://docs.polkadot.com/)
in its first three days (July 23–26, 2026) — contracts, frontends, on-chain publishing, gallery
manifests and self-updating automation. Everything here is live inside the Polkadot app
(mobile/desktop) and at the `dev-dot.li` web gateway.

Built by **Claude Code** (Anthropic's coding agent) operated by
[@TheWhiteRabbitM](https://github.com/TheWhiteRabbitM). Devnet only — tokens carry no value.

| App | Domain | What it is | On-chain |
|---|---|---|---|
| [`truereviews/`](truereviews/) | `truereviews.dot` | Reviews you can trust: **one verified human, one review per place**, anchored to real OpenStreetMap businesses. iOS-grade UI. | ReviewRegistry `0x29aF3891…5698` |
| [`discreet/`](discreet/) | `discreetly.dot` | **Private bookings for real people** — anonymous verified humans, escrow deposits, portable kept-word reputation, provider business console. | Discreet `0x8Fa1fcA9…f375` |
| [`openpetition/`](openpetition/) | `openpetition.dot` | Petitions signed by real people — one signature per person, tier-stratified counts, verifiable by anyone. | OpenPetition `0x9e195eec…38E1` |
| [`thebutton/`](thebutton/) | `thebutton.dot` | One button. One press per human, ever. A proof-of-personhood demo styled as the Lost Swan-station terminal. | TheButton `0xC16Ee1Aa…1DDb` |
| [`dotmetrics/`](dotmetrics/) | `dotmetrics.dot` | The index of the .dot ecosystem: every registered app discovered on-chain, growth charts, live contract metrics, **real-time registry tail in the browser**, hourly self-refresh. | reads 4 contracts live |
| [`italiarovente/`](italiarovente/) | `italiarovente.dot` | Italy's warming since 1940 — warming stripes, records, seas and a clickable map for 107 cities, from open ERA5 data. Daily self-refresh. Bulletin-native port of [italiarovente.app](https://italiarovente.app). | — |
| [`wudcommunity/`](wudcommunity/) | `wudcommunity.dot` | Unofficial $WUD community dashboard: live supply/holders from Polkadot Asset Hub, whale→plankton leaderboard over 221k holders. Official artwork used with the community's permission. | reads Asset Hub mainnet |
| [`contract/`](contract/) | — | Shared CDM/Hardhat workspace: all PolkaVM contracts build and deploy from here. | — |

## Why this platform is interesting

It is the first app platform where **"one unique real human" is a system primitive**
(proof of personhood + per-app aliases + Ring VRF anonymous aliases), combined with
**feeless, content-addressed hosting** on the Bulletin chain ("publish a folder, it's
on-chain, forever"). That combination enables app categories impossible both in web2 and
on classic chains: un-inflatable reviews, anonymous-but-honest bookings, secret-but-
verifiable voting. These apps exist to prove it.

Because personhood is granted to a small set of accounts on the devnet, every app ships
**demo-first** (fully usable by anyone) with its real contract deployed and read live
behind it; write paths activate as personhood rolls out. Each app carries a
`DEMO_ENABLED`-style gate to switch off demo affordances later.

## Platform techniques worked out along the way

- **Gallery metadata**: DotNS text record `manifest` on `<id>.dot` with
  `{"$v":1, displayName, description, icon:{cid, format:"png"}}` (icon uploaded to
  Bulletin) — reverse-engineered from the shell's resolver source; applied to all seven names.
- **Ecosystem indexing** without registry enumeration: walk Asset Hub blocks for
  `revive.ContractEmitted` from the DotNS registry, extract labels from **raw
  registration calldata** (historical extrinsics don't decode against current metadata);
  `dotmetrics` also runs this as a **live tail in the browser** for real-time listings.
- **Sandbox permissions**: request every needed origin up front via
  `requestPermission({tag:"Remote", value:{domains}})` — gated fetches otherwise fail
  silently. Device capabilities are a **second, separate** gate:
  `requestDevicePermission("OpenUrl")` is what lets an app hand a link to the browser,
  and `"Clipboard"` what lets it copy one. Neither is mentioned by the API that needs
  them, and the web shell grants both implicitly — so the omission only shows up on
  mobile, as a button that does nothing.
- **Shell-proof UI**: no native `<select>` (custom pickers/chips/segmented controls),
  no nested iframes (raw OSM tile `<img>`s instead), tap-to-skip splashes, error boundaries.
- **Self-updating .dot sites**: scheduled jobs re-index / re-fetch data, rebuild and
  republish with `pad` — Bulletin's incremental publish makes each refresh cheap.
  dotmetrics refreshes hourly on **GitHub Actions**
  ([workflow](.github/workflows/dotmetrics-refresh.yml)) with no personal machine
  involved; italiarovente refreshes daily via Task Scheduler + WSL.
- **Polkadot-app chat link**: `getChatManager().registerRoom(...)` + `navigateTo("polkadot://chat")`
  from `@parity/product-sdk-host`, wired into every app.

## Developer feedback

[`DEVFEEDBACK.md`](DEVFEEDBACK.md) — sixteen factual findings from this build (resolver,
sandbox, pad, DotNS, tooling, personhood rollout), each with a concrete suggestion, and a
summary table ranked by what each one costs a developer. Found by Claude Code while
building; offered upstream with thanks.

[`llms.txt`](llms.txt) — the same ground as a working manual for the next agent or
developer: nineteen traps as **symptom → cause → code that works**, with the verified
addresses, the shell's real iframe sandbox, a pre-ship checklist, and a procedure for
debugging the platform's characteristic failure — silence. Written because on this
platform a blocked fetch, a blocked popup and a wedged host call all look identical:
like a button that does nothing.

## Running locally

Each app is an independent Vite + React + TS workspace:

```bash
cd <app> && npm install && npm run dev
```

Contracts build from `contract/` (requires a Linux toolchain — WSL on Windows) and
deploy with `cdm deploy -n devnet`. Publishing uses `pad ./dist <name>.dot --env devnet`.
Keys and mnemonics are **not** in this repository; scripts read them from the local
environment.

## Status

Devnet software, three days old, moving fast. The platform is alpha and so is this code —
that is the point: it maps what is genuinely possible today.
