# gallery-icons

The 512px icons that the Polkadot app gallery shows next to a `.dot` name, and
the manifests that point at them.

A name carries its gallery metadata in a DotNS text record called `manifest`:

```json
{ "$v": 1, "displayName": "…", "description": "…", "icon": { "cid": "baf…", "format": "png" } }
```

The shape was read off the shell resolver rather than any documentation, which
is why it is written down here.

## Drawing one

`make-icon.mjs` draws them in code. The first nine were made by hand, which
works until a nineteenth app ships and nobody remembers the corner radius.

```bash
node make-icon.mjs
```

Same shape as the hand-made ones: a 512px squircle with a 108px radius, a
diagonal gradient from a light top-left to a deep bottom-right, and one white
mark with generous margins so it survives being shown at 64px. Shapes are
signed distance fields, so edges come out clean without supersampling, and the
only dependency is node's own zlib to write the PNG.

To add an icon, write a glyph function returning coverage from 0 to 1 for a
pixel, and add it to `ICONS`.

## Publishing one

Upload the picture, then point the record at it. The upload works with any
funded key; the record set needs the key that owns the name.

```bash
dotns bulletin upload gallery-icons/<app>.png --env devnet     # prints a CID
dotns text set <app>.dot manifest "$(cat gallery-icons/<app>.manifest.json)" --env devnet
```

A name published by `pad` without logging in stays with pad's storage pool
rather than with you, and the pool will refuse the second command. Take the name
first:

```bash
pad login
pad transfer <app>.dot
```

## Waiting to be published

Both icons are uploaded and both manifests are complete. Only the record set is
outstanding, because these two names are still held by the pool.

| Name | Icon CID |
|---|---|
| `polkadot-forum.dot` | `bafybeia7sjzysbxolp4i5xraw5twud3yf2ncx6muadt6bnrdhdkivx2vla` |
| `aidetector.dot` | `bafybeihpdjyg5reeqime67hblqq6es5oag6vfulgu6lebeu4igiiz3k2ma` |
| `dotdirectory.dot` | `bafybeiayy5ykqc5xt4lycdgtmcajqlxpcns5hs7f4k3jmop5hhlftpejai` |
| `blockchoir.dot` | `bafybeiby5gbyh7xqhjuhgdqgnurdgkgzcwbqx7glev5a4asbxlfa2am5ka` |
