# OpenPetition

Petitions signed by real people — one signature per person, guaranteed by proof of
personhood. Live at [openpetition.dev-dot.li](https://openpetition.dev-dot.li) and as
`openpetition.dot` inside the Polkadot app.

Online petitions are structurally worthless: anyone can sign fifty times with fifty
emails, so recipients rightly ignore the numbers. Here a signature can only come from a
distinct verified human — signing twice from a new wallet, new device, or reinstalled app
is rejected **by the network**, not by this site. A petition with 50 verified signatures
makes a stronger claim than one with 100,000 unverifiable ones.

## Deployed

| | |
|---|---|
| Contract | `0x9e195eeca2E3BAB0ffC236f51Fd6c4a0330C38E1` (devnet Asset Hub) |
| CDM package | `@thebutton/openpetition` |
| Domain | `openpetition.dot` |
| Alias context | `keccak256("openpetition.dot")` |

Verified live with `node contract/scripts/verify-petitions.cjs` — count 0, MIN_STATUS 1,
MAX_PER_AUTHOR 5, CONTEXT and PERSONHOOD as expected.

## How counting works

Signatures are keyed on the signer's personhood `contextAlias` and **stratified by tier,
not gated**: Full-tier signatures are the verified headline number; Lite-tier (username
only, repeatable with fresh accounts) is disclosed separately as "unverified" and never
merged; tier 0 is rejected. Honest on a devnet where Full may be hard to reach, honest
later too.

Authors are capped at 5 petitions per human. Petitions are permanent: the contract has no
owner, no admin path, and no delete — nobody can censor the register, including us.

## Product language

The UI never says "personhood", "tier", "alias", "bytes" or shows raw hex to a person:

- Signature ids render as stable friendly pseudonyms ("Calm Cedar") derived from the alias.
- Tiers are "verified" / "unverified"; the user's own standing is "You're verified",
  "Partly verified", or "Not verified yet".
- Every petition has **Copy link** / **Send by email**, and a collapsible "Proof anyone
  can check" block with instructions a recipient can follow without trusting this site.
- Signing is explained in one line: it doesn't reveal who you are, and it can't be undone.

## Roadmap (deliberately not built yet)

- **Ring VRF anonymity**: today signatures are pseudonymous within the app (stable alias);
  Ring VRF (`createRingVRFProof` in the host API) could make them fully unlinkable while
  still provably one-per-human. Needs research on on-chain proof verification.
- **OpenGov bridge**: petitions weigh *humans*, OpenGov weighs *tokens* — complementary
  layers. A petition crossing a threshold could export a referendum-ready draft
  (Polkassembly/Subsquare format) carrying its on-chain evidence. Submission stays a
  manual governance act with a DOT deposit.

## Development

```bash
npm run dev        # http://localhost:5174 — demo mode outside the Polkadot host
npm run build      # typecheck + bundle (CSS and favicon inlined into index.html)
```

### Testing every personhood tier

Personhood is granted by the network, not requested from the app, so the three states a
visitor can be in are not otherwise reachable on demand. Demo mode takes an override:

| URL | Badge | What it proves |
|---|---|---|
| `?tier=full` (default) | You're verified | start, sign, signature counts as verified |
| `?tier=lite` | Partly verified | can still sign; the signature is tallied as unverified |
| `?tier=none` | Not verified yet | read and share only |

`?tier=none` is the one worth checking after any change to the action screens: it is the
only state where a person can reach a screen they cannot act on, and every such screen has
to carry a way out. The verify notice changes its own copy and offers *Back to petitions*
when demo is already running — offering "switch to demo mode" to someone already in demo
was a dead end with no control on the page at all.

Deploy pipeline, platform pitfalls, and funding notes: see
[`../thebutton/README.md`](../thebutton/README.md) — every lesson there applies here.
