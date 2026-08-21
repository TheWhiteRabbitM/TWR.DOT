# blockchoir

`blockchoir.dot`: a piece of music that lives in contract storage. One person
adds one note every thirty blocks, and the scale is pentatonic, so whatever
anyone adds is consonant with whatever is already there.

That last part is the argument, not a nicety. Because no arrangement of these
notes can clash, strangers cannot write something ugly together, and nothing
here needs a moderator. It is the case this whole ecosystem makes about speech,
made somewhere it can be demonstrated in four seconds instead of argued about.

A choir was a definition of proof of personhood long before the phrase existed:
many people, one voice each. Take the personhood away and it stops being a
choir, because whoever automates fastest sings every part.

| What | Address |
|---|---|
| `BlockCanvas` | `0x7cA0698F6aE709d797f0AC9881D21472cc9657b4` |
| masks | `0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a` |

The contract holds 64 words of storage, four bits a cell, and a per-mask
cooldown counted in blocks rather than seconds: you cannot buy more turns, you
wait like everyone else. The same storage renders twice, as a score and as a
picture, which is a twenty-year-old idea rather than a new one — "Content-based
visualisation to aid common navigation of musical audio", G. Wood, 2005.

```bash
npm install && npm run dev
```

Audio is two oscillators and one delay line, because it has to run in a
sandboxed iframe on a phone. Note that `requestAnimationFrame` does not run in a
hidden tab, so anything counting toward a number needs a timeout as well.
