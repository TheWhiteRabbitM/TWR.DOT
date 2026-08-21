# secretballot

`secretballot.dot`: real OpenGov referenda, counted a second way — one person,
one vote, on a ballot nobody can read.

Governance on chain currently makes you choose between two things nobody should
have to trade. Either the tally is verifiable and every ballot is public, so
votes can be bought because a buyer can check what he paid for, or the ballot is
private and you are trusting somebody's server to count honestly. And the weight
is not a design choice either: token weighting is what you are forced into when
identities are free, because the only scarce thing left to count is money.

This does both halves differently. Enrolling checks a mask, which is the one
moment identity appears and it happens before anyone has voted. Casting carries
no identity at all: it carries a **linkable ring signature** proving the sender
is one of the enrolled without saying which, plus a key image that is the same
every time that voter signs here and is unrelated to who they are. A second
ballot carrying it is refused while the first stays anonymous.

| What | Address |
|---|---|
| `SecretBallot` | `0x7921323f3F926d6A17513291e7616a6B4fA01aC3` |
| masks | `0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a` |

## The part that is new

The proof is verified **inside the contract**, using the elliptic curve
precompiles pallet-revive exposes: `0x06` to add points, `0x07` to multiply one,
`0x05` for the modular exponentiation that hashing onto the curve needs. No
trusted setup, no ceremony, no circuit compiler — the scheme (bLSAG) is
arithmetic over bn254, and the arithmetic runs on chain.

Proven on devnet: a real signature made in a browser verified, a tampered one
was refused, and a proof replayed onto a different answer was refused too. The
scheme is well known; running it in a contract here does not appear to have been
done before.

## The experiment

Referenda and their token tallies come from subsquare.io and are shown as they
stand. Beside each one is the same question counted per person. Whether that
gives a better answer is the entire point, and it is not decided by the app.

```bash
npm install
npm run import      # refresh the referenda from SubSquare
npm run dev
```

`src/blsag.ts` is the browser half of the scheme and mirrors the contract byte
for byte: same hash-to-curve, same challenge chain. A signer and a verifier that
disagree about one byte are two programs that will never agree about anything.

A ring of one hides nobody, so the contract refuses ballots until at least two
people have enrolled. That is not a limitation to work around; it is the
property being defended.
