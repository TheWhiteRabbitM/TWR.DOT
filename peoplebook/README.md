# peoplebook

`peoplebook.dot`: every handle on the devnet, with a claimable on-chain avatar
NFT. Claim your mask for 1 PAS and roll its rarity.

The mask is the identity the rest of this repository is built on. It is
soulbound, one per account, and every app that needs to know whether this is a
person, and which one, asks this contract rather than keeping its own user table.

| Contract | Address |
|---|---|
| masks | `0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a` |
| handles | `0x7C61D99564C61e667C6Fd5D41aC2466327ea4109` |
| dotmail keys | `0x9d03cc0f36d123f964b09cfb154458816817b5be` |

`maskOf(address)` gives the mask an account holds, `ownerOf(id)` the reverse, and
`profileOf(id)` the display name and links. Apps gate writes on the pair
matching, which is why a post signed by someone else key cannot claim your
identity.

```bash
npm install && npm run dev
npm run fetch
```

The rarity roll happens on chain at claim time. Nobody, including whoever
deployed it, can re-roll it for you afterwards.
