# dotmetrics

`dotmetrics.dot`: live analytics for the .dot ecosystem. Public reads, no
account needed.

The registry does not enumerate, so the index is built by walking Asset Hub
blocks for `revive.ContractEmitted` from the DotNS registry and pulling labels
out of the raw registration calldata. Historical extrinsics do not decode against
current metadata, which is why the raw bytes are the source rather than a decoded
call. The same walk runs as a live tail in the browser, so a name registered
while you are watching shows up without a refresh.

It refreshes hourly on GitHub Actions, rebuilding and republishing itself with no
machine of mine involved.

```bash
npm install && npm run dev
```

Numbers are read live rather than served from a snapshot, so a slow RPC shows as
a slow page. That is the intended failure. A dashboard that keeps displaying
yesterday number with no indication is worse than one that stalls.
