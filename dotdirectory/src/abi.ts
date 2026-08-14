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

/**
 * The DotNS content resolver, write side.
 *
 * A name enters the directory through `announce`, but what it SAYS about itself
 * lives here: the page reads `manifest` and `category` off this resolver for
 * every row, and those records are the difference between a list of names and a
 * directory. Announce is open to anyone; these are not — the resolver only
 * accepts writes from the name's owner, which is why the form checks first
 * rather than letting the chain deliver the refusal.
 */
export const RESOLVER_ABI: AbiEntry[] = [
  {
    type: 'function',
    name: 'setText',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'text',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: '', type: 'string' }],
  },
];
