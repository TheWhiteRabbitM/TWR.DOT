# DotDirectory (.dot)

The plaintext list of every registered `.dot` name, kept on-chain, with a page
that reads it live. Nothing here runs on a schedule and nothing is baked into
the bundle.

Live at **dotdirectory.dot** · contract on Asset Hub.

## The problem it removes

DotNS is ENS-style: names are keys in a namehash-mapped store, and the registry's
events carry the **hash** of a name, never its text. So the chain cannot answer
"what names exist" — only "who owns `namehash(x)`" for an `x` you already have,
and a hash does not run backwards.

Discovery therefore meant walking every block and scraping ascii runs out of raw
extrinsic bytes, since historical extrinsics cannot be decoded once a runtime
upgrade moves call indices. That needs a machine, thirty minutes and a cron. In
August 2026 that cron fell behind the chain and stayed behind for three days,
because a run killed by its timeout wrote nothing and the next one restarted with
more to cover.

This contract keeps the plaintext on-chain instead. Discovery becomes two calls,
and a browser can do it alone.

## The contract

- `announce(label)` stores a label **only if** `REGISTRY.owner(namehash(label))`
  is non-zero. The list cannot be poisoned with names that were never
  registered, and no permission is needed — announcing a name you do not own is
  a favour, not an attack.
- `prune(label)` removes one **only if** the registry now says it has no owner.
  The list cleans itself the same permissionless way it fills.
- `pageDetailed(start, size)` returns labels with owner and arrival block in one
  call. On v1 the owners cost one call each — about 19 seconds in a browser for
  205 names; here they are free.
- No admin, no owner, no pause. Both directions are gated by the same external
  truth, so there is nothing for an operator to decide and nobody to trust.

Verified against the chain after deploy: 205 of 205 labels present, none
missing, none extra, no duplicates. `announce` rejects an unregistered name with
`NotRegistered` and a listed one with `AlreadyListed`; `prune` refuses a
still-owned name with `StillOwned` and an unlisted one with `NotListed`.

## What it does not do

Nothing on-chain wakes up on its own. A contract runs only when a transaction
calls it, and this one is no exception — it does not discover names by itself.
What changes is **who may do the calling**: before, one GitHub schedule; now
anyone. The registrant announcing their own name, a keeper, a wallet doing it at
registration time, or a one-off backfill. Any of them suffices and none is
required.

Three things genuinely cannot move into the page:

- **History.** A page that loads fresh has no memory of yesterday, and
  `eth_getLogs` returns nothing here — contract events surface as Substrate
  `revive.ContractEmitted` records rather than EVM logs, which was measured
  against this very contract. Arrival blocks are therefore kept as contract
  *state*, not read back from events.
- **Liveness.** Probing whether each bundle is still served is 205 HTTP requests
  from the client, CORS-dependent, and repeated by every visitor.
- **Screenshots.** These want a headless browser, which is irreducibly a machine.

## The app

```bash
npm install
npm run dev            # http://localhost:5184
npm run build
```

Everything on screen is fetched at view time: the list from the directory
contract, the records — category, contenthash, manifest — from the content
resolver at `0x326bdE29315199c814B1c58b431D84D16EA5cE41`, the same one dotmetrics
reads. Those three records together give the tier a name sits at: **described**
if it has a manifest, **deployed** if it has a bundle but nothing describing it,
**name only** if it has neither.

### One performance note worth keeping

`ethers` coalesces calls issued in the same tick into a single JSON-RPC batch.
Hand-rolling batches of eight and awaiting each one **defeats that completely**:
measured over the same 205 names, sequential batches took 99.3 seconds against
11.5 for the identical work submitted at once. The provider is configured with
`batchMaxCount` and every read is fired together. Do not reintroduce manual
batching — it looks like backpressure and acts like a bottleneck.

The owners and records passes run one after the other rather than at the same
time. Together they briefly quadrupled the load on a single public endpoint,
which started refusing, and the per-call `catch`es turned that into empty maps
that looked exactly like "still loading". Failures are now surfaced in the page.

## Publishing

```bash
npm run build && pad ./dist dotdirectory.dot --env devnet
```

Names shorter than nine characters need `ProofOfPersonhoodFull`, which a pooled
worker signer does not have — `dotdirectory` clears it, `dotdir` would not.
