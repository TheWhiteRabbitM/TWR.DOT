/**
 * Build the $WUD holder leaderboard.
 *
 * 221k+ holders is far too much to iterate from a browser, so this Node script
 * walks `assets.account` for asset 31337 once, ranks holders, buckets them into
 * tiers, and writes a small JSON the dashboard can load instantly.
 *
 *   node holders.mjs [--top 100]
 */
import { ApiPromise, WsProvider } from '@polkadot/api';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'holders.json');

/** Several public endpoints: individual ones rate-limit or drop connections. */
const ENDPOINTS = [
  'wss://polkadot-asset-hub-rpc.polkadot.io',
  'wss://sys.ibp.network/asset-hub-polkadot',
  'wss://asset-hub-polkadot.dotters.network',
  'wss://statemint-rpc.dwellir.com',
  'wss://rpc-asset-hub-polkadot.luckyfriday.io',
  'wss://asset-hub-polkadot-rpc.dwellir.com',
];
const ASSET_ID = 31337;
const PAGE = 1000;

const args = process.argv.slice(2);
const topN = Number(args[args.indexOf('--top') + 1]) || 100;

setTimeout(() => {
  console.error('FATAL: 20 min deadline exceeded');
  process.exit(1);
}, 1_200_000).unref();

/**
 * Tiers by share of total supply — the usual crypto ladder, with thresholds
 * chosen so each tier actually has members at WUD's ~1T supply.
 */
const TIERS = [
  { key: 'whale', label: 'Whale', emoji: '🐋', minShare: 0.01 },      // ≥ 1%
  { key: 'shark', label: 'Shark', emoji: '🦈', minShare: 0.001 },     // ≥ 0.1%
  { key: 'dolphin', label: 'Dolphin', emoji: '🐬', minShare: 0.0001 },// ≥ 0.01%
  { key: 'fish', label: 'Fish', emoji: '🐟', minShare: 0.00001 },     // ≥ 0.001%
  { key: 'shrimp', label: 'Shrimp', emoji: '🦐', minShare: 0.000001 },// ≥ 0.0001%
  { key: 'plankton', label: 'Plankton', emoji: '🦠', minShare: 0 },
];

const tierOf = (share) => TIERS.find((t) => share >= t.minShare) ?? TIERS[TIERS.length - 1];

async function connect() {
  // Two passes: transient refusals are common, so give the list a second try.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    for (const endpoint of ENDPOINTS) {
      try {
        const api = await ApiPromise.create({
          provider: new WsProvider(endpoint, 3_000),
          noInitWarn: true,
          throwOnConnect: true,
        });
        console.log(`connected: ${endpoint}`);
        return api;
      } catch (e) {
        console.log(`  [${attempt}] ${endpoint}: ${String(e.message ?? e).slice(0, 55)}`);
      }
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error('no Asset Hub endpoint reachable');
}

async function main() {
  let api = await connect();

  const meta = await api.query.assets.metadata(ASSET_ID);
  const assetOpt = await api.query.assets.asset(ASSET_ID);
  const asset = assetOpt.unwrap();
  const decimals = meta.decimals.toNumber();
  const unit = 10n ** BigInt(decimals);
  const supplyRaw = BigInt(asset.supply.toString());
  const supply = Number(supplyRaw / unit);

  console.log(`${meta.name.toUtf8()} (${meta.symbol.toUtf8()}) · supply ${supply.toLocaleString('en-US')}`);
  console.log(`holders reported: ${asset.accounts.toString()}\n`);

  // Walk every holder account. entriesPaged keeps memory bounded; a single
  // endpoint reliably dies somewhere past 200k pages, so a dropped connection
  // reconnects and resumes from the last key instead of losing the whole run.
  const holders = [];
  let startKey;
  let scanned = 0;
  let client = api;
  let consecutiveFailures = 0;

  for (;;) {
    let page;
    try {
      page = await client.query.assets.account.entriesPaged({
        args: [ASSET_ID],
        pageSize: PAGE,
        startKey,
      });
      consecutiveFailures = 0;
    } catch (e) {
      consecutiveFailures += 1;
      console.log(`  page failed (${consecutiveFailures}): ${String(e.message ?? e).slice(0, 60)}`);
      if (consecutiveFailures > 6) throw new Error('too many consecutive page failures');
      try {
        await client.disconnect();
      } catch {
        /* already gone */
      }
      client = await connect();
      continue; // retry the same startKey
    }

    if (page.length === 0) break;

    for (const [key, value] of page) {
      scanned += 1;
      if (!value.isSome) continue;
      const account = value.unwrap();
      const raw = BigInt(account.balance.toString());
      if (raw === 0n) continue;
      holders.push({ address: key.args[1].toString(), raw });
    }

    startKey = page[page.length - 1][0].toHex();
    if (scanned % 20000 === 0) console.log(`  …${scanned.toLocaleString('en-US')} accounts`);
    if (page.length < PAGE) break;
  }
  api = client;

  console.log(`\nscanned ${scanned.toLocaleString('en-US')} accounts, ${holders.length.toLocaleString('en-US')} with a balance`);

  holders.sort((a, b) => (b.raw > a.raw ? 1 : b.raw < a.raw ? -1 : 0));

  // Tier distribution across every holder.
  const distribution = Object.fromEntries(TIERS.map((t) => [t.key, { count: 0, total: 0 }]));
  for (const h of holders) {
    const amount = Number(h.raw / unit);
    const share = amount / supply;
    const tier = tierOf(share);
    distribution[tier.key].count += 1;
    distribution[tier.key].total += amount;
  }

  const top = holders.slice(0, topN).map((h, i) => {
    const amount = Number(h.raw / unit);
    const share = amount / supply;
    return {
      rank: i + 1,
      address: h.address,
      amount,
      share,
      tier: tierOf(share).key,
    };
  });

  const topTotal = top.reduce((s, h) => s + h.amount, 0);

  const out = {
    asset: ASSET_ID,
    name: meta.name.toUtf8(),
    symbol: meta.symbol.toUtf8(),
    decimals,
    supply,
    holders: holders.length,
    reportedHolders: Number(asset.accounts.toString()),
    top10Share: top.slice(0, 10).reduce((s, h) => s + h.share, 0),
    topShare: topTotal / supply,
    tiers: TIERS.map((t) => ({
      key: t.key,
      label: t.label,
      emoji: t.emoji,
      minShare: t.minShare,
      count: distribution[t.key].count,
      total: distribution[t.key].total,
    })),
    top,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log('\ntier distribution:');
  for (const t of out.tiers) {
    console.log(`  ${t.emoji} ${t.label.padEnd(9)} ${String(t.count).padStart(7)} holders · ${(t.total / supply * 100).toFixed(2)}% of supply`);
  }
  console.log(`\ntop 10 hold ${(out.top10Share * 100).toFixed(2)}% of supply`);
  console.log(`wrote ${OUT}`);

  await api.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('failed:', e.message ?? e);
  process.exit(1);
});
