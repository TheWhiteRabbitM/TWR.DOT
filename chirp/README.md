# chirp

`chirponchain.dot`: a microblog that lives entirely in a contract. You post as a
mask bound to your account, so a chirp cannot be forged, and there is no server
anywhere in the path.

Posts are stored inline on chain rather than behind a link, which is the choice
that makes the rest work: nothing expires, nothing needs re-pinning, and reading
a chirp is a contract call. Everything else grew around that core as separate
contracts, so a feature can be added without touching the ones already holding
what people wrote.

| Contract | Address |
|---|---|
| chirp | `0x37A7CE834428636815b2746408343574aD13be7C` |
| masks (Peoplebook) | `0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a` |
| handles | `0x7C61D99564C61e667C6Fd5D41aC2466327ea4109` |
| face (on-chain picture) | `0xbc11688b1421bdde1fa1be5ea5bf02e9bb49be03` |
| pfp (older, Bulletin key) | `0x6f3f9d84161f0bd0eb9d6524a5a2e5089b565470` |
| notes, polls, rules, media, lens, album, pin | see `src/chain.ts` |

Reading needs no wallet. Writing needs a mask, and the signing path in
`src/chain.ts` is the one every other app in this repo copied: try the host
legacy accounts first, fall back to a `SignerManager` scoped to `peoplebook.dot`
when the web shell hands back an empty list, and resolve a proxy delegator when
the account you sign with is not the one holding the mask.

```bash
npm install && npm run dev
```

Two picture systems exist and the order matters: `face.faceOf(mask)` returns the
image bytes from Asset Hub and works for every reader, while `pfp.pfpOf(mask)`
returns a Bulletin preimage key that only the host can resolve. Read the first
one first.
