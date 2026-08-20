# polkadot-forum

`polkadot-forum.dot`: a copy of [forum.polkadot.network](https://forum.polkadot.network)
that runs on chain, with no moderators, no admins and no delete button.

Two halves, kept visibly separate:

The archive is 3,590 topics and roughly 19,000 posts imported from the public
Discourse API, read only, with the original usernames preserved. That history
belongs to the people who wrote it, so it is credited to them and never
attributed to a mask.

On the live board, new topics and replies are written by whoever holds a
[Peoplebook](../peoplebook/) mask. Post bodies are stored inline in the contract
rather than behind a pointer that can expire, so there is nothing to keep alive
elsewhere. Once a post is written it stays, including for me.

## Contracts

| What | Address | Notes |
|---|---|---|
| `ForumBoard` | `0x6B877c9AD59B6fd0818A0369F9Bd0F256228C60d` | topics, replies, likes, edit, remove-by-author. No owner, no admin, no pause |
| `PeoplebookMasks2` | `0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a` | the identity gate a write is checked against |
| `PairingProbe` | `0xA61d094340d83D4c7e4a17e9ceca9414da3273f4` | proves bn254 pairing runs inside a PolkaVM contract (see below) |

The board contract has no privileged role in it at all. This is not a promise
about my intentions, it is what the deployed bytecode does: there is no function
that removes someone else's post, and I hold no key that changes that.

## Moderation without moderators

Removing the moderators does not remove the problems they handled, so the app
answers them in three different places.

Spam and bots are handled by identity. Writing requires a mask, one per
account, and proof of personhood once Individuality ships. A spammer becomes one
person with one permanent identity rather than a thousand throwaway accounts.

Opinions someone dislikes are handled by the reader. `src/filters.ts` keeps a
personal mute list of masks and words; a muted post collapses for you and stays
on chain for everyone else, one click from being shown again. Lists export as
plain text, so you can hand yours to someone who trusts your judgement, which is
the primitive shared blocklists are built from.

Illegal material is handled by shape. The forum takes text only, with no file
upload, so illegal imagery cannot be stored in it, and every post carries a
permanent signed identity, which makes it a worse place to commit a crime than a
pseudonymous forum rather than a better one.

A staked dispute court with an anonymous jury is designed but deliberately not
built: a board this young has an audience problem, not a moderation problem.
Filters work with one active reader; a jury needs a crowd. The one part that
needed proving first is done. `PairingProbe` verifies `e(G1,G2)·e(-G1,G2) = 1`
in-contract, so groth16 membership proofs are feasible on this chain today.

## Layout

```
src/chain.ts      reads: archive fetch, live posts over ethers, mask profile + on-chain PFP
src/forum.ts      writes: host wallet -> mask -> ForumBoard, the only path that needs a signer
src/filters.ts    personal mute lists (masks, words), export/import
src/App.tsx       shell, routing, home, categories, search, identity chip, filter panel
src/Thread.tsx    one thread: archived posts and live posts in the same Discourse chrome
src/Composer.tsx  new topic
scripts/import-discourse.mjs   archive import (supports --resume)
scripts/slim-index.mjs         builds the ~250 KB first-paint index from the full one
contract/ForumBoard.sol        the board
contract/PairingProbe.sol      the ZK feasibility probe
```

## Running it

```bash
npm install
npm run import     # fetch the archive from forum.polkadot.network (~47 MB, --resume to top up)
npm run dev
```

The archive is derived data and is not committed. Reading needs no wallet and no
SDK; the write path loads the SDK lazily, so a visitor who never posts downloads
none of it.

Build and publish:

```bash
npm run build
pad ./dist polkadot-forum.dot --env devnet
```

## Two things that will bite you

The `.dot.li` shell registers a service worker that keeps serving the previous
build after a republish, and `?cid=<newCID>` does not beat it. Use a private
window, or unregister it:

```js
navigator.serviceWorker.getRegistrations().then(r => r.forEach(x => x.unregister()));
caches.keys().then(k => k.forEach(x => caches.delete(x)));
```

A mask's picture lives in one of two places and the newer one comes first:
`FACE.faceOf(mask)` returns the image bytes straight from Asset Hub and resolves
for every reader, while the older `PFP.pfpOf(mask)` returns a Bulletin preimage
key that only the host can turn into bytes. Reading only the second one shows
nothing for most people.

Both are written up in [`../DEVFEEDBACK.md`](../DEVFEEDBACK.md), findings 22 and 27.
