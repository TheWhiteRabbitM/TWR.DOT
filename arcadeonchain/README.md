# arcadeonchain

`arcadeonchain.dot`: an arcade room with three cabinets. Walk up to one and
play.

Game Boy and NES cores run in the browser against ROMs served from the same
content-addressed bundle as the page. The room, the CRT curvature and the coin
slot are there because an arcade that looks like a file listing is not an arcade.

```bash
npm install && npm run dev
npm test
```

`src/node-shim.ts` exists because the emulator core expects a Node environment
and the sandbox is not one. That file is the reason this runs inside the Polkadot
app at all, rather than only in a desktop browser.
