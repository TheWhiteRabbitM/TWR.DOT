/**
 * Feasibility probe for a pure client-side analytics app: can we read, over the
 * public Ethereum JSON-RPC (no host, no personhood):
 *   1. an app's live on-chain counter, and
 *   2. its DotNS metadata (description/avatar text records) via the resolver?
 */
const { ethers } = require('ethers');

const RPC = process.env.ASSETHUB_ETH_RPC ?? 'https://paseo-assethub-rpc.laissez-faire.trade';
const RESOLVER = '0xfd2594FcF920B38A970011C486e1E3041563147F';

// From earlier `dotns lookup` output.
const APPS = [
  {
    name: 'openpetition',
    node: '0x408e4cc36e3f52056f7148539903a10e615ffe5d8673e914aa93e8432ac9bc2d',
    contract: '0x9e195eeca2E3BAB0ffC236f51Fd6c4a0330C38E1',
    stat: { sig: 'function count() view returns (uint256)', label: 'petitions' },
  },
  {
    name: 'thebutton',
    node: '0x90db5f2f49b96b544176abec765527085d2ca8bd3635be5a4ef81724cabff19d',
    contract: '0xC16Ee1AaF736DCF624f0A183f0975E3F05991DDb',
    stat: { sig: 'function totalPresses() view returns (uint256)', label: 'presses' },
  },
];

// Common ENS-style resolver text() signature.
const RESOLVER_ABI = ['function text(bytes32 node, string key) view returns (string)'];

function provider(url) {
  return ethers.JsonRpcProvider ? new ethers.JsonRpcProvider(url) : new ethers.providers.JsonRpcProvider(url);
}

async function main() {
  const p = provider(RPC);
  const resolver = new ethers.Contract(RESOLVER, RESOLVER_ABI, p);

  for (const app of APPS) {
    console.log(`=== ${app.name}.dot ===`);

    // 1. live counter
    try {
      const c = new ethers.Contract(app.contract, [app.stat.sig], p);
      const fn = app.stat.sig.match(/function (\w+)/)[1];
      const value = await c[fn]();
      console.log(`  ${app.stat.label}: ${value.toString()}`);
    } catch (e) {
      console.log(`  counter ERROR: ${e.shortMessage ?? e.message}`);
    }

    // 2. metadata via resolver text records
    for (const key of ['description', 'avatar']) {
      try {
        const v = await resolver.text(app.node, key);
        console.log(`  ${key}: ${v ? v.slice(0, 70) : '(empty)'}`);
      } catch (e) {
        console.log(`  ${key} ERROR: ${e.shortMessage ?? e.message}`);
      }
    }
    console.log();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
