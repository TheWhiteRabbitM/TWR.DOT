/**
 * Ask the deployed OpenPetition contract's me(account, 0) for several accounts,
 * to learn what the personhood precompile actually returns for tier-0 (no
 * personhood) accounts: is the contextAlias zero (all tier-0 collide) or
 * per-account (one signature per account)? This decides whether the app can be
 * opened to unverified users at all.
 */
const { ethers } = require('ethers');

const RPC = process.env.ASSETHUB_ETH_RPC ?? 'https://paseo-assethub-rpc.laissez-faire.trade';
const OPENPETITION = '0x9e195eeca2E3BAB0ffC236f51Fd6c4a0330C38E1';

const ABI = [
  'function me(address account, uint256 id) view returns (uint8 status, bytes32 yourAlias, uint8 signedTier)',
];

function makeProvider(url) {
  return ethers.JsonRpcProvider ? new ethers.JsonRpcProvider(url) : new ethers.providers.JsonRpcProvider(url);
}

async function main() {
  const provider = makeProvider(RPC);
  const c = new ethers.Contract(OPENPETITION, ABI, provider);

  // A spread of addresses: our deploy key's EVM addr, and random ones.
  const accounts = [
    ['deploy key', '0x4c8ad74eB2e8a804066E0bc7245A27A9Db9a983d'],
    ['random A', '0x1111111111111111111111111111111111111111'],
    ['random B', '0x2222222222222222222222222222222222222222'],
    ['zero', '0x0000000000000000000000000000000000000000'],
  ];

  for (const [label, addr] of accounts) {
    try {
      const [status, alias, signedTier] = await c.me(addr, 0);
      console.log(
        `${label.padEnd(11)} status=${status} alias=${alias} signed=${signedTier}`,
      );
    } catch (e) {
      console.log(`${label.padEnd(11)} ERROR ${e.shortMessage ?? e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
