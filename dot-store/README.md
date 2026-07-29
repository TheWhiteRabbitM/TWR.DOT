# dot-store (.dot)

**Every app registered on the Polkadot Products devnet, with real screenshots and
on-chain reviews.** Live as `dot-store.dot`.

dotmetrics answers *"what exists on this chain, and is it true?"*. This answers
*"what can I open, and is it any good?"*. One pipeline underneath — the catalog **is**
dotmetrics' verified directory, so the two front-ends can never disagree about what
exists.

## Design

The layout borrows the App Store's grammar, because it solves this exact problem:
editorial cards for the few apps worth leading with, three-row shelves for browsing 72
names without endless scrolling, and a product page that puts the facts in one
hairline-separated row. Apple's own system palette, label ramp and separator alphas
rather than hand-picked greys. Light and dark, four languages, no UI framework.

What it does **not** borrow is the confidence. Where Apple says "1.2M Ratings", this says
how many *wallets* reviewed — and says out loud that a wallet is not a person on this
devnet. A name with no bundle gets **no Open button**, because a store must not offer
something that isn't there.

## How it hangs together

| Layer | What |
|---|---|
| **Catalog** | dotmetrics' hourly directory, verified against `registry.owner()`. Synced by [`scripts/sync-catalog.mjs`](scripts/sync-catalog.mjs), which also bakes `keccak256(label)` into every entry so the browsing bundle needs no hashing library. |
| **Screenshots** | dotmetrics' weekly capture job, loaded through `?chainBackend=rpc-gateway`. Owner-supplied artwork takes precedence — see below. |
| **Ratings** | `AppReviews.sol` read on every load with plain `eth_call` and build-time selectors ([`src/lib/chain.ts`](src/lib/chain.ts)). No chain library in the browsing bundle. |
| **Writing** | [`src/lib/write.ts`](src/lib/write.ts), imported **only on submit**. Browsing costs 263 KB; signing pulls the rest. |
| **Identity** | Open on this devnet (`minStatus = 0`): a review counts one wallet. On the live network the same contract requires proof of personhood — `setMinStatus` is the switch. |

## On-chain

- **AppReviews**: `0xE4D0485C6e2C7db54C8f14A1620992Be98eDFEC3` (devnet Asset Hub),
  `CONTEXT = keccak256("dot-store.dot")`, one review per author per app, body ≤ 280 bytes.
- **Domain**: `dot-store.dot`, published to Bulletin.

## For developers of listed apps

You need **no account here**. The registry already rejects a write to a name you do not
own, so the key that owns the name *is* the authorisation.

```bash
# name, description and icon on your card
dotns text set <name>.dot manifest '{"displayName":"Your App","description":"…"}' --env devnet

# your own screenshots: upload to Bulletin, declare the CIDs
dotns text set <name>.dot screenshots bafy…,bafy… --env devnet
```

Both records are picked up on the next hourly run. Two caveats we enforce rather than
hide: owner-supplied artwork is **labelled as such**, because we cannot review
submissions the way an app store does; and Bulletin keeps data for about **14 days**, so
a lapsed CID degrades to our own capture and then to the app's monogram — never a hole.

## Self-updating

The `store` job in [`.github/workflows/dotmetrics-refresh.yml`](../.github/workflows/dotmetrics-refresh.yml)
runs hourly after the indexer, syncs the catalog, and publishes **only when something a
visitor would see actually changed** ([`scripts/tree-hash.mjs`](scripts/tree-hash.mjs)) —
Bulletin writes come out of a finite quota, so an unchanged hour costs zero transactions
and says so in the log. It checks the name is registered before trying
([`scripts/owner-of.mjs`](scripts/owner-of.mjs)), because a job that fails every hour
teaches you to ignore red crosses.

## Bundle

2.2 MB total, 263 KB loaded eagerly. The signing stack is lazily imported and
deliberately avoids `createApp()`, which registers every chain the SDK knows and dragged
in five unused metadata blobs (7.2 MB). Taking the genesis hash off the descriptor itself
and using the host's shared provider is what got it down — it matters because retention
means republishing weekly against a 57 MiB authorisation.

## Develop

```bash
npm install
npm run dev     # http://localhost:5181
npm run build
node scripts/sync-catalog.mjs   # re-pull the catalog and artwork from dotmetrics
```

Outside the Polkadot app there is no key to sign with, so a posted review is kept on the
device and **labelled as not on chain**. No path fabricates a transaction.
