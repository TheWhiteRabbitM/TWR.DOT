# WUD Community

**Unofficial** community dashboard for $WUD, live at
[wudcommunity.dev-dot.li](https://wudcommunity.dev-dot.li) and as `wudcommunity.dot`.

Not affiliated with the $WUD project — official information lives at
[gavunwud.xyz](https://gavunwud.xyz/). Nothing here is financial advice.

## What it shows

- **Live token state** — name, symbol, supply, holder count and status, read on every load
  from asset `31337` on **Polkadot Asset Hub mainnet** (not the devnet this page is
  published to). No wallet, no sign-in, no personhood.
- **The pod** — all 221k+ holders bucketed by share of supply: 🐋 whale (≥1%), 🦈 shark,
  🐬 dolphin, 🐟 fish, 🦐 shrimp, 🦠 plankton, with a stacked bar of who holds what.
- **Top holders** — ranked leaderboard, each address linking to Subscan.

## Snapshot from 2026-07-24

| Tier | Holders | Share of supply |
|---|---|---|
| 🐋 Whale | 6 | 98.94% |
| 🦈 Shark | 3 | 0.56% |
| 🐬 Dolphin | 7 | 0.20% |
| 🐟 Fish | 135 | 0.29% |
| 🦐 Shrimp | 34 | 0.01% |
| 🦠 Plankton | 221,188 | 0.0016% |

Top 10 addresses hold 99.56% of supply.

**How to read that.** On Asset Hub the largest positions are typically liquidity pools,
bridges and burn addresses rather than individuals, so a high top-share is not by itself a
statement about anyone's holdings. The UI says this and links every address to a block
explorer so the claim can be checked rather than taken on trust.

## Architecture

Live figures come straight from the chain via `@polkadot/api`. The leaderboard cannot:
221k accounts is far too much to iterate in a browser, so `indexer/holders.mjs` walks
`assets.account` once in Node and writes a compact `holders.json` that the page imports.

```bash
node indexer/holders.mjs --top 100    # regenerate the snapshot
npm run dev                            # http://localhost:5177
npm run build
```

The indexer reconnects and resumes mid-scan: a single public endpoint reliably stops
responding somewhere past 200k pages, which killed the first full run.

### Reaching a node at all

Public Asset Hub endpoints are far less reliable from a browser than they look. Measured
from one machine, seven of eight refused the WebSocket outright and the survivor took
5.5 seconds to hand shake — so the original "try two endpoints in order, 2s apart" gave up
before the one working node had finished connecting, and the page sat on `offline`.

`src/lib/wud.ts` now races the endpoints instead: WebSockets start in waves of three every
2.5s, HTTPS joins only after 9s (it is the fallback for WebSocket-blocked networks, and
firing it earlier just collects rate-limit errors), first connection wins, losers are
disconnected. If nothing answers within 20s the page keeps working from the snapshot and
says plainly that it is doing so — including in the hero line, which otherwise claims
every number is read live.

## The artwork

The header logo and hero character are the **official $WUD artwork**, used with the
permission of the $WUD community (granted via its CTO, Alexandru Stefan). The page remains
unofficial and says so; the art lives in `public/art/`. `src/Mascot.tsx` — the original
stand-in character drawn before permission was granted — is kept in the repo but no longer
shown.
