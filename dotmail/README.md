# dotmail

`dotmailbox.dot`: sealed mail on Asset Hub. No server, no provider, and no
envelope that names its recipient.

Mail on chain has an obvious problem: a public ledger is a terrible place to
write down who is talking to whom. So the address is not in the clear. Recipients
find their own mail by trial decryption against their key, which means the chain
holds the letters without holding the social graph.

| Contract | Address |
|---|---|
| dotmail | `0x9e12df714fd4b581414753d07fee23e00f7e2bf3` |
| dotmail keys | `0x9d03cc0f36d123f964b09cfb154458816817b5be` |
| masks | `0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a` |
| handles | `0x7C61D99564C61e667C6Fd5D41aC2466327ea4109` |
| content resolver | `0x326bdE29315199c814B1c58b431D84D16EA5cE41` |

```bash
npm install && npm run dev
npm test
```

The tests matter here more than usual. A bug in `seal.ts` does not throw: it
produces mail that looks fine and cannot be opened, or worse, one that can be
opened by the wrong person.
