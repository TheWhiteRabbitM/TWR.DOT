# Handshake

Plain agreements between real people — written once, accepted by the other person, sealed
by you, kept forever. `handshake.dot` on the Polkadot Products Devnet.

The everyday problem: informal agreements leave nothing behind. The €200 lent to a friend,
the deposit paid in cash, the used bike sold "as working" — when it goes wrong there is no
proof, and online you cannot even be sure the other party is one real person. Handshake
gives both sides a permanent, undeniable record co-signed by **two verified, distinct
humans** — and every completed agreement grows a **kept-word record** that follows the
person, not the account. A scammer cannot reset it with a fresh profile.

## Lifecycle

```
propose ──accept──> accepted ──seal──> sealed ──both mark done──> completed
   └─ withdraw (proposer, any time before seal — never counts)
```

Acceptance alone binds nobody: the proposer sees who accepted (pseudonym, verification
badge, kept-word record) and only then seals. After sealing, nothing can be edited or
deleted by anyone — the contract has no owner and no admin path.

## Deployed

> **Status: parked.** Built and lifecycle-verified locally, contract deployed and domain
> registered, but never published — the deferred-payoff nature of the product didn't
> convince in demo form. Everything below is banked for a possible revival (which should
> start with a modern redesign and a shorter flow with visible immediate payoff).

| | |
|---|---|
| Contract | `0x373aD399586EfABA4BF04E88cfC3BEDE7Fd81214` (devnet Asset Hub) |
| CDM package | `@thebutton/handshake` |
| Domain | `handshake.dot` (registered, no contenthash bound) |
| Alias context | `keccak256("handshake.dot")` |

## Honest limits

- **Terms are public** on this test network. The UI warns: first names or nicknames only,
  never addresses, phones, or documents. Production would encrypt terms to the two parties.
- **Completion is mutual, not adjudicated.** If one side never marks done, the agreement
  stays visibly un-completed on both records — that asymmetry *is* the signal. There is no
  arbitration; this is a record, not a court.
- **Kept-word counts are per-app pseudonyms.** The same human is the same name here, but
  this record does not follow them to other apps — by design (per-context aliases).

## UI language

Same "products for people" rules as OpenPetition: no hex, no jargon, friendly stable
pseudonyms ("Calm Cedar"), relative dates, one-line explanations at every decision point,
and the demo mode lets one visitor play both parties.

## Development

```bash
npm run dev        # http://localhost:5175 — demo mode outside the Polkadot host
npm run build      # typecheck + bundle (CSS and favicon inlined)
```

Platform pitfalls and deploy pipeline: [`../thebutton/README.md`](../thebutton/README.md).
