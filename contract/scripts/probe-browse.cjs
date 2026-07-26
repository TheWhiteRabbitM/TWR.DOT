/**
 * Is the Browse publisher contract the enumerable .dot app directory?
 * Probe for code, logs, and common enumeration shapes.
 */
const { ethers } = require('ethers');
const RPC = process.env.ASSETHUB_ETH_RPC ?? 'https://paseo-assethub-rpc.laissez-faire.trade';
const BROWSE = '0xaab42efbe8ea4d4228c3a11e973f94c17b9a0f2c';

const CANDIDATE_VIEWS = [
  'function count() view returns (uint256)',
  'function total() view returns (uint256)',
  'function length() view returns (uint256)',
  'function appCount() view returns (uint256)',
  'function totalApps() view returns (uint256)',
  'function listingCount() view returns (uint256)',
  'function numListings() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function getAll() view returns (string[])',
  'function apps() view returns (string[])',
  'function listings() view returns (string[])',
  'function allApps() view returns (string[])',
];

async function main() {
  const p = ethers.JsonRpcProvider ? new ethers.JsonRpcProvider(RPC) : new ethers.providers.JsonRpcProvider(RPC);

  const code = await p.getCode(BROWSE);
  console.log(`browse publisher ${BROWSE}`);
  console.log(`  bytecode: ${code === '0x' ? 'NONE (not a contract here)' : `${(code.length - 2) / 2} bytes`}`);
  if (code === '0x') return;

  const latest = await p.getBlockNumber();
  const logs = await p.getLogs({ address: BROWSE, fromBlock: Math.max(0, latest - 300_000), toBlock: latest }).catch(() => []);
  console.log(`  logs (last 300k blocks): ${logs.length}`);
  const topics = new Map();
  for (const l of logs) topics.set(l.topics[0], (topics.get(l.topics[0]) ?? 0) + 1);
  for (const [t, n] of topics) console.log(`    topic0 ${t} x${n}`);

  console.log('  probing view methods:');
  for (const sig of CANDIDATE_VIEWS) {
    const name = sig.match(/function (\w+)/)[1];
    try {
      const c = new ethers.Contract(BROWSE, [sig], p);
      const v = await c[name]();
      console.log(`    ✓ ${name}() -> ${Array.isArray(v) ? `[${v.length}] ${v.slice(0, 5)}` : v.toString()}`);
    } catch {
      // silent: wrong signature
    }
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
