# whenwemeet

`whenwemeet.dot`: pick the times that suit you and see what suits everyone.

Everybody has used the other version of this. A link arrives, you tick some
slots, and in exchange a company learns who you meet, when you are free and
what your email address is. None of that is needed to answer the question. What
is needed is a list of options, one tick per person per option, and a guarantee
that one person cannot tick fifty times.

The first two are a contract. The third is a mask.

| What | Address |
|---|---|
| `WhenWe` | `0x707e80b9640CC3935D570290879576386D5a81e7` |
| masks | `0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a` |

A vote is a bitmap of the slots that suit you, so answering again replaces your
previous answer and moves the tallies with it without counting you twice. That
is what changing your mind looks like somewhere nothing can be deleted.

There is no owner. The person who opened a poll cannot close it, delete it or
remove a vote.

```bash
npm install && npm run dev
```
