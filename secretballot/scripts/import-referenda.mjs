/**
 * Pull real OpenGov referenda from SubSquare.
 *
 * The point of the experiment is the comparison, so both numbers have to be
 * real: what the tokens said, taken from the chain that actually decided it,
 * and what the people say, counted here one human at a time. Inventing either
 * would make the whole thing a mock-up.
 */
import { writeFileSync } from 'node:fs';

const API = 'https://polkadot-api.subsquare.io';
const WANT = Number(process.env.WANT ?? 24);
const OUT = new URL('../public/referenda.json', import.meta.url);

const dot = (raw) => {
  if (raw == null) return 0;
  const v = typeof raw === 'string' ? BigInt(raw) : BigInt(Math.trunc(Number(raw)));
  return Number(v / 10_000_000n) / 1000; // planck -> DOT, three decimals
};

const res = await fetch(`${API}/gov2/referendums?page=1&page_size=${WANT}`, {
  headers: { accept: 'application/json' },
});
if (!res.ok) throw new Error(`subsquare ${res.status}`);
const body = await res.json();
const items = body.items ?? [];

const out = [];
for (const r of items) {
  const on = r.onchainData ?? {};
  const tally = on.tally ?? r.tally ?? {};
  out.push({
    index: r.referendumIndex,
    title: (r.title ?? `Referendum #${r.referendumIndex}`).trim(),
    state: on.state?.name ?? r.state?.name ?? 'Unknown',
    track: on.trackInfo?.name ?? String(r.track ?? ''),
    ayes: dot(tally.ayes),
    nays: dot(tally.nays),
    support: dot(tally.support),
    proposer: r.proposer ?? on.proposer ?? null,
    at: r.indexer?.blockTime ?? null,
    url: `https://polkadot.subsquare.io/referenda/${r.referendumIndex}`,
  });
}

writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), source: 'subsquare.io', referenda: out }, null, 1));
console.log(`wrote ${out.length} referenda`);
for (const r of out.slice(0, 4)) console.log(`  #${r.index} ${r.state.padEnd(10)} ayes ${r.ayes} DOT · ${r.title.slice(0, 46)}`);
