# whopays

`whopaysdot.dot`: a shared tab. Who paid what, and who owes whom.

The app everyone already uses for this works well and costs you your social
graph: it learns who you travel with, who you eat with, how often and for how
much. Settling a tab needs none of that. It needs a list of amounts, a name
against each, and agreement about who was in.

| What | Address |
|---|---|
| `WhoPays` | `0xbB584a13CDb814cb68ab6ce7BD375896A5f01929` |
| masks | `0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a` |

The arithmetic is deliberately not in the contract. Computing balances means
deciding who eats the last cent, and that is a policy rather than a fact.
Storage keeps the facts — payer, amount, who it was split between — and every
reader derives the same balances and can check them. A share is the total
divided by the people in it, and the odd unit goes to whoever already put the
money down, so a tab always sums to zero. There is a test for that, because a
function that divides money is not a place for confidence.

Amounts are whole units of whatever you are counting, so a currency is a label
rather than a feature and nothing goes through a float on its way to being
money.

```bash
npm install && npm run dev
```
