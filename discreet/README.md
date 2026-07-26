# Discreet (.dot)

**Private bookings for real people.** Book a counselling session, a health test, a legal
consultation — or a haircut — as an **anonymous verified human**: no name, no phone, no
email, anywhere, ever. Live as `discreetly.dot` (the 8-letter name needs Full-personhood
tier on this devnet; the brand stays Discreet).

## Why this could not exist before

Web2 booking identifies you by design. Pseudonymous chains drown in bots — ghost bookings
kill providers. This platform's combination is the first that makes **anonymous but honest
booking** possible:

| Guarantee | Mechanism |
|---|---|
| Booker is a unique real human | proof of personhood (contextAlias) |
| …but unlinkable to their identity | alias per app context; Ring VRF path for full anonymity |
| No-shows have a cost without identity | refundable deposit in contract escrow |
| Reliability without deanonymization | `KeptWord` — kept/missed/cancelled per alias, portable |
| Provider never handles personal data | there is none: GDPR solved by construction |

## Super-customizable by design

Everything a provider can decide lives in `ServiceConfig`, enforced by the contract — the
same deployment serves a therapist, a clinic, a tutor, a barber or a yoga class:

- **deposit** (0 = trust mode) · **capacity** (1 = appointment, N = group/class)
- **autoConfirm** (instant vs provider approval) · **cancelWindow** (free-refund cutoff)
- **clientTier** (Lite or Full personhood) · details as a Bulletin CID

Booking lifecycle: `Requested → Confirmed → Completed / NoShow / Cancelled / Declined`.

## On-chain

`contract/contracts/Discreet.sol` — one deployable suite: provider registry, slot book,
booking escrow state machine, KeptWord ledger. Compiled clean; deployed via CDM to the
devnet Asset Hub (address recorded by CDM in `.cdm/solidity/thebutton/discreet.sol`).

## App

iOS-grade mobile UI (its own "quiet" graphite/teal identity): launch splash, Book /
My bookings / Provide tabs, slot grid by day, confirm sheet with optional encrypted note,
kept-word card, provider console (create with full config + approve/decline + settle).
Demo mode mirrors the contract state machine 1:1 in localStorage — fully usable by anyone,
since personhood writes need the in-host signing path (same status as every app here).

```bash
npm install && npm run dev   # http://localhost:5180
```
