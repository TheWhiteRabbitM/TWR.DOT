import type { AbiEntry } from '@parity/product-sdk-contracts';

/**
 * The slice of Amazdot the page needs to WRITE with. Reads go through ethers on
 * a public RPC and need no wallet at all; this exists only for the signed paths.
 *
 * Mutable `AbiEntry[]`, not `as const` — the SDK's contract factory wants a
 * mutable array and a readonly tuple fails to assign with an error that points
 * at the wrong line entirely.
 */
export const MARKET_ABI: AbiEntry[] = [
  {
    type: 'function',
    name: 'list',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'seller', type: 'uint256' },
      { name: 'title', type: 'string' },
      { name: 'descCid', type: 'string' },
      { name: 'imageCid', type: 'string' },
      { name: 'payloadCid', type: 'string' },
      { name: 'keyCommit', type: 'bytes32' },
      { name: 'price', type: 'uint256' },
      { name: 'stock', type: 'uint32' },
      { name: 'digital', type: 'bool' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'buy',
    stateMutability: 'payable',
    inputs: [
      { name: 'listingId', type: 'uint256' },
      { name: 'sealed_', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'deliver',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderId', type: 'uint256' },
      { name: 'sealedKey', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'ship',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderId', type: 'uint256' },
      { name: 'note', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'confirm',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'orderId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'dispute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderId', type: 'uint256' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'review',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderId', type: 'uint256' },
      { name: 'stars', type: 'uint8' },
      { name: 'body', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'restock',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'stock', type: 'uint32' },
    ],
    outputs: [],
  },
];
