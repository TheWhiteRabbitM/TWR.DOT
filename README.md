# TWR.DOT: nineteen apps on the Polkadot App platform

Apps built end-to-end on the [Polkadot Products Devnet](https://docs.polkadot.com/):
contracts, frontends, on-chain publishing, gallery manifests and self-updating
automation. It started with seven in the devnet first three days (July 23 to 26, 2026)
and kept going. Everything here is live inside the Polkadot app (mobile/desktop)
and at the `dot.li` web gateway.

Built by Claude Code (Anthropic coding agent) operated by
[@TheWhiteRabbitM](https://github.com/TheWhiteRabbitM). Devnet only, so tokens
carry no value.

## Identity, and the things built on it

The mask is the primitive the rest of the repo leans on: soulbound, one per
account, and the answer to whether this is a person and which one.

| App | Domain | What it is | On-chain |
|---|---|---|---|
| [`peoplebook/`](peoplebook/) | `peoplebook.dot` | Every handle on the devnet, with a claimable avatar NFT. Claim a mask for 1 PAS and roll its rarity. The identity every other app here asks. | Masks `0x4c1fe8F4…bD4a` |
| [`chirp/`](chirp/) | `chirponchain.dot` | A microblog living entirely in a contract. Posts stored inline, so nothing expires and nothing needs re-pinning. Notes, polls, albums, on-chain profile pictures. | chirp `0x37A7CE83…be7C` + 11 more |
| [`polkadot-forum/`](polkadot-forum/) | `polkadot-forum.dot` | A copy of forum.polkadot.network on chain: 3,590 topics imported read-only with original authors, new posts written by masks. No moderators, no admin, no delete. | ForumBoard `0x6B877c9A…C60d` |
| [`peoplewiki/`](peoplewiki/) | `peoplewiki.dot` | What the devnet actually does, written by the people using it, kept on chain and open to anyone with a mask. | Wiki `0x0465Db21…37AA` |
| [`peopleid/`](peopleid/) | none | The shared identity package. Every app had its own copy of who is this person, and the copies drifted silently. | none |

## Mail, files and agreements

| App | Domain | What it is | On-chain |
|---|---|---|---|
| [`dotmail/`](dotmail/) | `dotmailbox.dot` | Sealed mail on Asset Hub. No server, no provider, and no envelope naming its recipient: the chain holds the letters without holding the social graph. | dotmail `0x9e12df71…2bf3` |
| [`dot-drive/`](dot-drive/) | `dot-drive.dot` | Big files sealed and sent to a person. Bytes to Bulletin, key inside a sealed letter, neither half worth anything alone. | dotmail + keys |
| [`handshake/`](handshake/) | `handshake.dot` | Plain agreements between real people, sealed by both and kept forever. | none |
| [`discreet/`](discreet/) | `discreetly.dot` | Private bookings for real people: anonymous verified humans, escrow deposits, portable kept-word reputation, provider console. | Discreet `0x8Fa1fcA9…f375` |

## Voice, reviews and petitions

| App | Domain | What it is | On-chain |
|---|---|---|---|
| [`truereviews/`](truereviews/) | `truereviews.dot` | One verified human, one review per place, anchored to real OpenStreetMap businesses. | ReviewRegistry `0x29aF3891…5698` |
| [`openpetition/`](openpetition/) | `openpetition.dot` | Petitions signed by real people, one signature per person, verifiable by anyone. | OpenPetition `0x9e195eec…38E1` |
| [`thebutton/`](thebutton/) | `thebutton.dot` | One button. One press per human, ever. A proof-of-personhood demo styled as the Lost Swan-station terminal. | TheButton `0xC16Ee1Aa…1DDb` |

## Reading the ecosystem

| App | Domain | What it is | On-chain |
|---|---|---|---|
| [`dotmetrics/`](dotmetrics/) | `dotmetrics.dot` | The index of the .dot ecosystem: every registered app found by walking blocks, growth charts, live contract metrics, a real-time registry tail in the browser, hourly self-refresh. | reads 4 contracts live |
| [`dot-store/`](dot-store/) | `dot-store.dot` | The app store view of the same ground: what is published, browsable. | reads DotNS |
| [`chirpwatch/`](chirpwatch/) | `chirpwatch.dot` | Are the chirp contracts answering, and are their numbers moving? One page, no framework, no indexer in between. | reads chirp live |

## Demonstrations

| App | Domain | What it is | On-chain |
|---|---|---|---|
| [`italiarovente/`](italiarovente/) | `italiarovente.dot` | Italy warming since 1940: stripes, records, seas and a clickable map of 107 cities from open ERA5 data. Daily self-refresh. Port of [italiarovente.app](https://italiarovente.app). | none |
| [`wudcommunity/`](wudcommunity/) | `wudcommunity.dot` | Unofficial $WUD community dashboard: live supply and holders from Asset Hub, whale to plankton leaderboard over 221k holders. Artwork used with the community permission. | reads Asset Hub mainnet |
| [`ethonchain/`](ethonchain/) | `ethonchain.dot` | Six real pages from ethereum.org served from a content hash. No server, no host, no CDN. Unofficial, unaffiliated. | none |
| [`aidetector/`](aidetector/) | `aidetector.dot` | Paste text, see which AI writing patterns are in it and what to write instead. The rules are Conor Bronsdon’s avoid-ai-writing, MIT; the swaps and the interface are here. Runs entirely in the tab. | none |
| [`arcadeonchain/`](arcadeonchain/) | `arcadeonchain.dot` | An arcade room with three cabinets. Game Boy and NES cores running against ROMs from the same bundle as the page. | none |

Support folders: [`contract/`](contract/) is the shared CDM/Hardhat workspace all
PolkaVM contracts build from, [`gallery-icons/`](gallery-icons/) holds the icons
published in DotNS manifests, [`contrib/`](contrib/) is work sent upstream, and
[`docs/`](docs/) keeps the notes that did not belong in a single app.

## Why this platform is interesting

It is the first app platform where one unique real human is a system
primitive (proof of personhood, per-app aliases, Ring VRF anonymous aliases),
combined with feeless, content-addressed hosting on the Bulletin chain:
publish a folder and it is served from the network with no host, no bill and no
credit card.

*Not* forever, though. [The Parity write-up](https://www.parity.io/blog/inside-levity-polkadots-decentralized-storage-layer)
puts retention at approximately fourteen days, after which unrenewed data falls
off the network automatically, and the write authorization expires on its own
schedule too. An earlier version of this README said "on-chain, forever", which
was wrong, and the [keep-alive workflow](.github/workflows/keepalive.yml) exists
because of it.

That combination enables app categories impossible both in web2 and on classic
chains: uninflatable reviews, anonymous but honest bookings, secret but
verifiable voting, a forum nobody can moderate. These apps exist to prove it.

Because personhood is granted to a small set of accounts on the devnet, most apps
ship **demo-first** (usable by anyone) with the real contract deployed and read
live behind it; write paths activate as personhood rolls out.

## Platform techniques worked out along the way

- Gallery metadata: DotNS text record `manifest` on `<id>.dot` with
  `{"$v":1, displayName, description, icon:{cid, format:"png"}}` (icon uploaded to
  Bulletin), reverse-engineered from the shell resolver source.
- Ecosystem indexing without registry enumeration: walk Asset Hub blocks for
  `revive.ContractEmitted` from the DotNS registry and extract labels from raw
  registration calldata, since historical extrinsics do not decode against
  current metadata. `dotmetrics` runs the same walk as a live browser tail.
- Sandbox permissions: request every needed origin up front via
  `requestPermission({tag:"Remote", value:{domains}})`, or gated fetches fail
  silently. Device capabilities are a second, separate gate:
  `requestDevicePermission("OpenUrl")` for handing a link to the browser,
  `"Clipboard"` for copying one. Neither is mentioned by the API that needs them,
  and the web shell grants both implicitly, so the omission only shows up on
  mobile as a button that does nothing.
- Signing that actually works: the host legacy account list comes back empty
  in the web shell, so fall back to a `SignerManager` scoped to `peoplebook.dot`,
  and resolve a `Proxy.Proxies` delegator when the signing account is not the one
  holding the mask. `chirp/src/chain.ts` is the reference implementation.
- Shell-proof UI: no native `<select>`, no nested iframes (raw OSM tile
  `<img>`s instead), tap-to-skip splashes, error boundaries.
- Self-updating .dot sites: scheduled jobs re-index, rebuild and republish
  with `pad`; Bulletin incremental publish makes each refresh cheap. dotmetrics
  refreshes hourly on GitHub Actions, italiarovente daily via Task Scheduler.
- Republishing is not enough: the `.dot.li` shell registers a service worker
  that keeps serving the previous build, and `?cid=` does not beat it. Test in a
  private window, or unregister it.

## Developer feedback

[`DEVFEEDBACK.md`](DEVFEEDBACK.md) holds factual findings from these builds, numbered
through 27: resolver, sandbox, pad, DotNS, Bulletin authorization, tooling,
personhood rollout, the service-worker cache that makes a correct deploy look
broken, and one undocumented capability worth knowing about, since bn254 pairing
runs inside PolkaVM contracts and groth16 verification is therefore feasible
today. Each finding carries a concrete suggestion, and the summary table is
ranked by what it costs a developer. Found while building, offered upstream with
thanks.

[`llms.txt`](llms.txt) covers the same ground as a working manual for the next agent:
traps as symptom, cause, code that works, with verified addresses, the real
iframe sandbox, a pre-ship checklist, and a procedure for debugging the platform
characteristic failure, which is silence. A blocked fetch, a blocked popup and a
wedged host call all look identical: like a button that does nothing.

## Running locally

Each app is an independent Vite workspace:

```bash
cd <app> && npm install && npm run dev
```

Contracts build from `contract/` (Linux toolchain, WSL on Windows) and deploy
with `cdm deploy -n devnet`. Publishing uses `pad ./dist <name>.dot --env devnet`.
Keys and mnemonics are **not** in this repository; scripts read them from the
local environment.

## Status

Devnet software, moving fast, alpha on both sides. That is the point: it maps
what is possible today.
