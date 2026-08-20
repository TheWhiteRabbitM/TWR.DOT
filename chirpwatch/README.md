# chirpwatch

`chirpwatch.dot`: are the chirp contracts answering, and are their numbers
moving? Read live from Asset Hub, with no indexer in between.

A single page, no build step and no framework: `index.html` calls the contracts
over `eth_call` and shows what came back. If a number is stale, the contract is
stale; there is no cache or backend that could be lying to you instead.

It exists because the alternative was trusting a dashboard that trusts an indexer
that trusts a node. This trusts one node, and says which one.

```bash
./build.sh
pad ./dist chirpwatch.dot --env devnet
```
