# TrueReviews (.dot)

Reviews you can actually trust: **one verified human, one review per place, ever.**
Every place is anchored to its OpenStreetMap identifier, so a review here is about a
real business anyone can find on a map — and the count can't be padded with fake or
paid accounts. Live as `truereviews.dot`.

An **iOS-native feel on the open web**: translucent blur chrome, large titles, grouped
lists, a bottom tab bar, a slide-up review sheet, spring-animated stars, toasts, skeleton
loaders, push transitions — light and dark, safe-area aware. No UI framework; every surface
is hand-tuned.

## How it hangs together

| Layer | What |
|---|---|
| **Places** | OpenStreetMap via Nominatim (free, no API key). Each result carries a stable `node/way/relation` id → the on-chain `placeKey`. Deep-links back to OpenStreetMap and Google Maps. |
| **Reviews** | `ReviewRegistry.sol` on the devnet Asset Hub. One review per personhood alias per place; ratings stratified Full (verified, drives the score) vs Lite (provisional, disclosed). |
| **Review text** | Bulletin CID stored on-chain (`bodyCid`); the rating and dedup live in the contract. |
| **Identity** | Proof of personhood — a verified human, not an email. |

## On-chain

- **ReviewRegistry**: `0x29aF38913652B32989D1d96C51Af641980E55698` (devnet Asset Hub) — verified
  live: `placeCount()=0`, `CONTEXT=keccak256("truereviews.dot")`, `MIN_STATUS=1`.
- **Domain**: `truereviews.dot`, published to Bulletin.

## Status

- **Demo mode** — complete and verified. Real OpenStreetMap search, seeded places with
  reviews, post freely. This is what runs outside the Polkadot host, since personhood is
  granted to only a few accounts on this devnet (the same reason every app here is demo-first).
- **Live on-chain mode** — the contract and domain are ready. Wiring the in-host chain driver
  (read reviews from the contract; write = upload text to Bulletin for the CID, then call
  `review()` signed by the user's personhood account) is the next step. The write path needs
  testing inside the host, exactly as flagged for OpenPetition's `bodyCid`. See
  [`src/lib/config.ts`](src/lib/config.ts).

## Develop

```bash
npm install
npm run dev     # http://localhost:5179 (best viewed at iPhone width)
npm run build
```

`src/lib/mock.ts` is the demo data layer; swap in a chain driver implementing the same
`ReviewsDriver` interface for live mode.
