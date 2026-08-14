import type { AbiEntry } from '@parity/product-sdk-contracts';

/**
 * The slice of DotDirectory2's ABI the page needs to WRITE with. Reads go
 * through ethers over a public RPC and need no wallet at all; this exists only
 * for the announce path, which has to be signed.
 *
 * Taken from the compiler output rather than written by hand so it cannot drift:
 *   contract/artifacts/contracts/DotDirectory2.sol/DotDirectory2.json
 */
export const DIRECTORY_ABI: AbiEntry[] = [
  {
    type: 'function',
    name: 'announce',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isListed',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'ownerOfLabel',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },
];
