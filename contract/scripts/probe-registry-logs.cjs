/**
 * Can we enumerate all .dot names client-side via eth_getLogs on the DotNS
 * registry? Fetch raw logs from candidate registry/resolver contracts and show
 * their event topics, so we know if registration is eth-observable.
 */
const { ethers } = require('ethers');
const RPC = process.env.ASSETHUB_ETH_RPC ?? 'https://paseo-assethub-rpc.laissez-faire.trade';

const CANDIDATES = {
  'dotns registry': '0x527b08a640b527a3dae0C4BE04D7344E430B6E50',
  'resolver': '0xfd2594FcF920B38A970011C486e1E3041563147F',
  'cdm registry': '0x59b0245778917af55224e5f8fb55f7f8d452619f',
};

async function main() {
  const p = ethers.JsonRpcProvider ? new ethers.JsonRpcProvider(RPC) : new ethers.providers.JsonRpcProvider(RPC);
  const latest = await p.getBlockNumber();
  console.log('latest block:', latest);
  const fromBlock = Math.max(0, latest - 200_000);

  for (const [label, address] of Object.entries(CANDIDATES)) {
    try {
      const logs = await p.getLogs({ address, fromBlock, toBlock: latest });
      console.log(`\n${label} (${address}): ${logs.length} logs in last ${latest - fromBlock} blocks`);
      const topics = new Map();
      for (const l of logs) {
        topics.set(l.topics[0], (topics.get(l.topics[0]) ?? 0) + 1);
      }
      for (const [t, n] of topics) console.log(`   topic0 ${t} ×${n}`);
      if (logs.length) {
        const s = logs[logs.length - 1];
        console.log(`   sample: block ${s.blockNumber}, ${s.topics.length} topics, data ${s.data.slice(0, 40)}…`);
      }
    } catch (e) {
      console.log(`\n${label}: getLogs ERROR ${e.shortMessage ?? e.message}`);
    }
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
