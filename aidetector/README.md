# aidetector

`aidetector.dot`: paste any text and see which AI writing patterns are in it,
where they are, and what to write instead. Nothing is uploaded, because nothing
needs to be.

The reading is done by [avoid-ai-writing](https://github.com/conorbronsdon/avoid-ai-writing)
by Conor Bronsdon, MIT licensed, vendored in `src/detector.js`. That file is
upstream byte-for-byte apart from two export lines at the end, since this app
loads it as an ES module rather than a script tag. It is a few hundred rules and
some arithmetic: 62 pattern categories, a three-tier vocabulary table, and
stylometric checks like punctuation distribution and function-word entropy. It
runs in about a millisecond on a paragraph, in your tab, which is why an app
promising privacy does not need a server to keep the promise.

What this page adds is the interface and the swaps.

## The two halves

**Reading.** A score from 0 to 100, the label behind it, the human/mixed/ai
split, and every finding grouped by pattern with the offending text quoted. The
ring sweeps and the figure counts because a score that simply appears reads as
an assertion, while one that moves reads as a measurement.

**Fixing.** The detector often says what to write instead, and its suggestions
come in two kinds. "leverage -> use" is a swap a machine can make. "vibrant ->
describe what makes it active" is an instruction to a writer, and a tool that
pasted that into someone's draft would be worse than useless. So `src/fix.ts`
sorts them: swaps get a button, instructions get shown as advice. Structural
rewrites (em dashes, curly quotes, chatbot openers, formulaic closers, stacked
transitions) are separate and each one explains itself before you press it.

Swapping a word can break the article in front of it, so "a pivotal moment"
becoming "a important moment" is corrected to "an", with the usual liars listed:
"a user" and "an hour" stay as they are.

## Running it

```bash
npm install && npm run dev
```

No wallet, no contract, no account. It reads nothing from chain and writes
nothing to it.

## What a score is not

It is evidence about patterns, not proof about a person. Plenty of people write
with em dashes and plenty of generated text has none. The findings are the
useful part; the number is a summary of them.

Style follows [dotdirectory](../dotdirectory/), which follows polkadot.com: one
accent, warm stone greys, DM Sans and DM Serif Display, tabular figures, no
gradients on data. Motion is off under `prefers-reduced-motion`.
