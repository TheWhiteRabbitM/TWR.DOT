# ethonchain

`ethonchain.dot`: six real pages from ethereum.org, served from a content hash
on the Polkadot products devnet. No server, no host, no CDN.

An unofficial demonstration, not affiliated with the Ethereum Foundation. The
point is not the content: it is that an ordinary website with ordinary pages can
be addressed by hash and served from a chain-backed network, with nothing in the
middle that can take it down or bill for it.

```bash
npm install
npm run fetch
npm run build
pad ./dist ethonchain.dot --env devnet
```

Fetched pages are committed as `src/content.json`, so the build reproduces
without scraping again.
