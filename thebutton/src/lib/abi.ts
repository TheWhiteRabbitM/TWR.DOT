import type { AbiEntry } from '@parity/product-sdk-contracts';

/**
 * ABI for contracts/TheButton.sol, taken from the compiler output rather than
 * written by hand so it cannot drift from the contract.
 *
 * Regenerate after changing the contract:
 *   npx solc@0.8.28 --abi --output-dir <dir> contracts/TheButton.sol
 *
 * The custom errors matter: without them the SDK cannot decode a revert into
 * `AlreadyPressed` / `NotHuman` and surfaces raw hex instead.
 */
export const THE_BUTTON_ABI = [
  {
    type: 'error',
    name: 'AlreadyPressed',
    inputs: [{ name: 'ordinal', type: 'uint256' }],
  },
  {
    type: 'error',
    name: 'NotHuman',
    inputs: [
      { name: 'status', type: 'uint8' },
      { name: 'required', type: 'uint8' },
    ],
  },
  {
    type: 'event',
    name: 'Pressed',
    anonymous: false,
    inputs: [
      { name: 'who', type: 'bytes32', indexed: true },
      { name: 'ordinal', type: 'uint256', indexed: true },
      { name: 'pressedAt', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'CONTEXT',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'MIN_STATUS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'PERSONHOOD',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'ordinalOf',
    stateMutability: 'view',
    inputs: [{ name: 'contextAlias', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'press',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ name: 'ordinal', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'roll',
    stateMutability: 'view',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [
      {
        name: 'page',
        type: 'tuple[]',
        components: [
          { name: 'who', type: 'bytes32' },
          { name: 'pressedAt', type: 'uint64' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'rollLength',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'snapshot',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      { name: 'total', type: 'uint256' },
      { name: 'yourOrdinal', type: 'uint256' },
      { name: 'yourStatus', type: 'uint8' },
      { name: 'yourAlias', type: 'bytes32' },
    ],
  },
  {
    type: 'function',
    name: 'totalPresses',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as unknown as AbiEntry[];
