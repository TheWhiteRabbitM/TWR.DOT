/**
 * Read the deployed Petitions contract over Ethereum JSON-RPC and check its
 * compile-time constants match the source.
 *
 *   node scripts/verify-petitions.cjs [address]
 */
const { ethers } = require('ethers');

const RPC = process.env.ASSETHUB_ETH_RPC ?? 'https://paseo-assethub-rpc.laissez-faire.trade';
const ADDRESS = process.argv[2] ?? '0x9e195eeca2E3BAB0ffC236f51Fd6c4a0330C38E1';

const ABI = [
  'function count() view returns (uint256)',
  'function MIN_STATUS() view returns (uint8)',
  'function MAX_PER_AUTHOR() view returns (uint8)',
  'function CONTEXT() view returns (bytes32)',
  'function PERSONHOOD() view returns (address)',
];

function makeProvider(url) {
  if (ethers.JsonRpcProvider) return new ethers.JsonRpcProvider(url);
  return new ethers.providers.JsonRpcProvider(url);
}

function keccakUtf8(text) {
  if (ethers.keccak256) return ethers.keccak256(ethers.toUtf8Bytes(text));
  return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(text));
}

async function main() {
  console.log('rpc     ', RPC);
  console.log('address ', ADDRESS);

  const provider = makeProvider(RPC);
  const code = await provider.getCode(ADDRESS);
  console.log('bytecode', code === '0x' ? 'MISSING' : `${(code.length - 2) / 2} bytes`);
  if (code === '0x') process.exit(1);

  const contract = new ethers.Contract(ADDRESS, ABI, provider);
  const [count, minStatus, maxPerAuthor, context, personhood] = await Promise.all([
    contract.count(),
    contract.MIN_STATUS(),
    contract.MAX_PER_AUTHOR(),
    contract.CONTEXT(),
    contract.PERSONHOOD(),
  ]);

  const checks = [
    ['count', count.toString(), '0'],
    ['MIN_STATUS', minStatus.toString(), '1'],
    ['MAX_PER_AUTHOR', maxPerAuthor.toString(), '5'],
    ['CONTEXT', context.toLowerCase(), keccakUtf8('openpetition.dot').toLowerCase()],
    ['PERSONHOOD', personhood.toLowerCase(), '0x000000000000000000000000000000000a010000'],
  ];

  let failed = 0;
  console.log('');
  for (const [name, actual, expected] of checks) {
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(14)} ${actual}${ok ? '' : `  (expected ${expected})`}`);
  }
  console.log('');
  console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('verification failed:', error.message ?? error);
  process.exit(1);
});
