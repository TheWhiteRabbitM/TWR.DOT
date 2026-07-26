/**
 * Read the deployed TheButton over the Ethereum JSON-RPC endpoint and check the
 * constants came out of the compiler the way the source says they should.
 *
 *   node scripts/verify-deploy.cjs [address]
 */
const { ethers } = require('ethers');

const RPC = process.env.ASSETHUB_ETH_RPC ?? 'https://paseo-assethub-rpc.laissez-faire.trade';
const ADDRESS = process.argv[2] ?? '0xC16Ee1AaF736DCF624f0A183f0975E3F05991DDb';

const ABI = [
  'function totalPresses() view returns (uint256)',
  'function rollLength() view returns (uint256)',
  'function MIN_STATUS() view returns (uint8)',
  'function CONTEXT() view returns (bytes32)',
  'function PERSONHOOD() view returns (address)',
  'function ordinalOf(bytes32) view returns (uint256)',
];

// ethers v6 exposes JsonRpcProvider at the top level; v5 nests it under providers.
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
  console.log('bytecode', code === '0x' ? 'MISSING — nothing deployed here' : `${(code.length - 2) / 2} bytes`);
  if (code === '0x') process.exit(1);

  const contract = new ethers.Contract(ADDRESS, ABI, provider);

  const [total, rollLen, minStatus, context, personhood] = await Promise.all([
    contract.totalPresses(),
    contract.rollLength(),
    contract.MIN_STATUS(),
    contract.CONTEXT(),
    contract.PERSONHOOD(),
  ]);

  const expectedContext = keccakUtf8('thebutton.dot');
  const expectedPersonhood = '0x000000000000000000000000000000000a010000';

  const checks = [
    ['totalPresses', total.toString(), '0'],
    ['rollLength', rollLen.toString(), '0'],
    ['MIN_STATUS', minStatus.toString(), '2'],
    ['CONTEXT', context.toLowerCase(), expectedContext.toLowerCase()],
    ['PERSONHOOD', personhood.toLowerCase(), expectedPersonhood.toLowerCase()],
  ];

  console.log('');
  let failed = 0;
  for (const [name, actual, expected] of checks) {
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(13)} ${actual}${ok ? '' : `  (expected ${expected})`}`);
  }

  console.log('');
  console.log(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('verification failed:', error.message ?? error);
  process.exit(1);
});
