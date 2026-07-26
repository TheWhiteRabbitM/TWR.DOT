/** $WUD lives on Polkadot Asset Hub (asset 31337). Confirm what we can read. */
import { ApiPromise, WsProvider } from '@polkadot/api';

const ENDPOINTS = [
  'wss://polkadot-asset-hub-rpc.polkadot.io',
  'wss://asset-hub-polkadot-rpc.dwellir.com',
  'wss://statemint-rpc.dwellir.com',
];
const ASSET_ID = 31337;

setTimeout(() => { console.error('global deadline'); process.exit(1); }, 220_000).unref();

for (const rpc of ENDPOINTS) {
  console.log(`\n=== ${rpc} ===`);
  let api;
  try {
    api = await ApiPromise.create({ provider: new WsProvider(rpc, 3_000), noInitWarn: true });
    const [asset, meta] = await Promise.all([
      api.query.assets.asset(ASSET_ID),
      api.query.assets.metadata(ASSET_ID),
    ]);

    if (!asset.isSome) {
      console.log('asset 31337 not found');
      await api.disconnect();
      continue;
    }
    const a = asset.unwrap();
    const decimals = meta.decimals.toNumber();
    const supply = BigInt(a.supply.toString());
    const human = Number(supply / 10n ** BigInt(decimals));

    console.log(`  name:      ${meta.name.toUtf8()}`);
    console.log(`  symbol:    ${meta.symbol.toUtf8()}`);
    console.log(`  decimals:  ${decimals}`);
    console.log(`  supply:    ${supply} (${human.toLocaleString('en-US')})`);
    console.log(`  holders:   ${a.accounts.toString()}`);
    console.log(`  status:    ${a.status.toString()}`);
    console.log(`  owner:     ${a.owner.toString()}`);
    console.log(`  admin:     ${a.admin.toString()}`);
    console.log(`  issuer:    ${a.issuer.toString()}`);
    console.log(`  freezer:   ${a.freezer.toString()}`);
    console.log('READABLE: yes');
    await api.disconnect();
    process.exit(0);
  } catch (e) {
    console.log(`  failed: ${(e.message ?? String(e)).slice(0, 90)}`);
    try { await api?.disconnect(); } catch {}
  }
}
console.log('\nno endpoint answered');
process.exit(1);
