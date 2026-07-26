import type { AbiEntry } from '@parity/product-sdk-contracts';

/**
 * ABI for contract/contracts/OpenPetition.sol, pasted verbatim from the solc
 * 0.8.28 output so it cannot drift from the deployed bytecode. Regenerate with:
 *   npx solc@0.8.28 --abi --output-dir <dir> contract/contracts/OpenPetition.sol
 */
export const OPENPETITION_ABI = [
  { inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }], name: 'AlreadySigned', type: 'error' },
  { inputs: [{ internalType: 'uint256', name: 'bytesLength', type: 'uint256' }], name: 'BadBodyCid', type: 'error' },
  { inputs: [{ internalType: 'uint256', name: 'bytesLength', type: 'uint256' }], name: 'BadTitle', type: 'error' },
  {
    inputs: [
      { internalType: 'uint8', name: 'status', type: 'uint8' },
      { internalType: 'uint8', name: 'required', type: 'uint8' },
    ],
    name: 'NotHuman',
    type: 'error',
  },
  { inputs: [{ internalType: 'uint8', name: 'max', type: 'uint8' }], name: 'TooManyPetitions', type: 'error' },
  { inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }], name: 'UnknownPetition', type: 'error' },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'id', type: 'uint256' },
      { indexed: true, internalType: 'bytes32', name: 'author', type: 'bytes32' },
      { indexed: false, internalType: 'string', name: 'title', type: 'string' },
    ],
    name: 'Created',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'id', type: 'uint256' },
      { indexed: true, internalType: 'bytes32', name: 'who', type: 'bytes32' },
      { indexed: false, internalType: 'uint8', name: 'tier', type: 'uint8' },
    ],
    name: 'Signed',
    type: 'event',
  },
  { inputs: [], name: 'CONTEXT', outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'MAX_BODY_CID_BYTES', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'MAX_PER_AUTHOR', outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'MAX_TITLE_BYTES', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'MIN_STATUS', outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'MIN_TITLE_BYTES', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'PERSONHOOD', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'count', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  {
    inputs: [
      { internalType: 'string', name: 'title', type: 'string' },
      { internalType: 'string', name: 'bodyCid', type: 'string' },
    ],
    name: 'create',
    outputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }],
    name: 'get',
    outputs: [
      {
        components: [
          { internalType: 'bytes32', name: 'author', type: 'bytes32' },
          { internalType: 'uint64', name: 'createdAt', type: 'uint64' },
          { internalType: 'uint32', name: 'fullCount', type: 'uint32' },
          { internalType: 'uint32', name: 'liteCount', type: 'uint32' },
          { internalType: 'string', name: 'title', type: 'string' },
          { internalType: 'string', name: 'bodyCid', type: 'string' },
        ],
        internalType: 'struct OpenPetition.Petition',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'account', type: 'address' },
      { internalType: 'uint256', name: 'id', type: 'uint256' },
    ],
    name: 'me',
    outputs: [
      { internalType: 'uint8', name: 'status', type: 'uint8' },
      { internalType: 'bytes32', name: 'yourAlias', type: 'bytes32' },
      { internalType: 'uint8', name: 'signedTier', type: 'uint8' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'offset', type: 'uint256' },
      { internalType: 'uint256', name: 'limit', type: 'uint256' },
    ],
    name: 'page',
    outputs: [
      {
        components: [
          { internalType: 'bytes32', name: 'author', type: 'bytes32' },
          { internalType: 'uint64', name: 'createdAt', type: 'uint64' },
          { internalType: 'uint32', name: 'fullCount', type: 'uint32' },
          { internalType: 'uint32', name: 'liteCount', type: 'uint32' },
          { internalType: 'string', name: 'title', type: 'string' },
          { internalType: 'string', name: 'bodyCid', type: 'string' },
        ],
        internalType: 'struct OpenPetition.Petition[]',
        name: 'slice',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }],
    name: 'sign',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as unknown as AbiEntry[];
