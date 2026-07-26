import type { AbiEntry } from '@parity/product-sdk-contracts';

/**
 * ABI for contract/contracts/Handshake.sol, pasted verbatim from the solc
 * 0.8.28 output so it cannot drift from the deployed bytecode. Regenerate with:
 *   npx solc@0.8.28 --abi --output-dir <dir> contract/contracts/Handshake.sol
 */
export const HANDSHAKE_ABI = [
  { inputs: [], name: 'AlreadyMarked', type: 'error' },
  { inputs: [{ internalType: 'uint256', name: 'bytesLength', type: 'uint256' }], name: 'BadTerms', type: 'error' },
  {
    inputs: [
      { internalType: 'uint8', name: 'status', type: 'uint8' },
      { internalType: 'uint8', name: 'required', type: 'uint8' },
    ],
    name: 'NotHuman',
    type: 'error',
  },
  { inputs: [], name: 'NotParty', type: 'error' },
  { inputs: [], name: 'NotProposer', type: 'error' },
  { inputs: [], name: 'OwnProposal', type: 'error' },
  { inputs: [{ internalType: 'uint8', name: 'max', type: 'uint8' }], name: 'TooManyOpen', type: 'error' },
  { inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }], name: 'UnknownAgreement', type: 'error' },
  { inputs: [{ internalType: 'enum Handshake.State', name: 'current', type: 'uint8' }], name: 'WrongState', type: 'error' },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'id', type: 'uint256' },
      { indexed: true, internalType: 'bytes32', name: 'acceptor', type: 'bytes32' },
    ],
    name: 'Accepted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, internalType: 'uint256', name: 'id', type: 'uint256' }],
    name: 'Completed',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'id', type: 'uint256' },
      { indexed: true, internalType: 'bytes32', name: 'who', type: 'bytes32' },
    ],
    name: 'MarkedDone',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'id', type: 'uint256' },
      { indexed: true, internalType: 'bytes32', name: 'proposer', type: 'bytes32' },
    ],
    name: 'Proposed',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'id', type: 'uint256' },
      { indexed: true, internalType: 'bytes32', name: 'proposer', type: 'bytes32' },
      { indexed: true, internalType: 'bytes32', name: 'acceptor', type: 'bytes32' },
    ],
    name: 'SealedAgreement',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, internalType: 'uint256', name: 'id', type: 'uint256' }],
    name: 'Withdrawn',
    type: 'event',
  },
  { inputs: [], name: 'CONTEXT', outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'MAX_OPEN_PROPOSALS', outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'MAX_TERMS_BYTES', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'MIN_STATUS', outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'MIN_TERMS_BYTES', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'PERSONHOOD', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }], name: 'accept', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'count', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  {
    inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }],
    name: 'get',
    outputs: [
      {
        components: [
          { internalType: 'bytes32', name: 'proposer', type: 'bytes32' },
          { internalType: 'bytes32', name: 'acceptor', type: 'bytes32' },
          { internalType: 'uint8', name: 'proposerTier', type: 'uint8' },
          { internalType: 'uint8', name: 'acceptorTier', type: 'uint8' },
          { internalType: 'uint64', name: 'createdAt', type: 'uint64' },
          { internalType: 'uint64', name: 'sealedAt', type: 'uint64' },
          { internalType: 'uint64', name: 'completedAt', type: 'uint64' },
          { internalType: 'enum Handshake.State', name: 'state', type: 'uint8' },
          { internalType: 'bool', name: 'proposerDone', type: 'bool' },
          { internalType: 'bool', name: 'acceptorDone', type: 'bool' },
          { internalType: 'string', name: 'terms', type: 'string' },
        ],
        internalType: 'struct Handshake.Agreement',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  { inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }], name: 'markDone', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  {
    inputs: [
      { internalType: 'address', name: 'account', type: 'address' },
      { internalType: 'uint256', name: 'id', type: 'uint256' },
    ],
    name: 'me',
    outputs: [
      { internalType: 'uint8', name: 'status', type: 'uint8' },
      { internalType: 'bytes32', name: 'yourAlias', type: 'bytes32' },
      { internalType: 'uint8', name: 'role', type: 'uint8' },
      {
        components: [
          { internalType: 'uint32', name: 'sealedCount', type: 'uint32' },
          { internalType: 'uint32', name: 'completedCount', type: 'uint32' },
        ],
        internalType: 'struct Handshake.Record',
        name: 'yourRecord',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'contextAlias', type: 'bytes32' },
      { internalType: 'uint256', name: 'offset', type: 'uint256' },
      { internalType: 'uint256', name: 'limit', type: 'uint256' },
    ],
    name: 'mine',
    outputs: [{ internalType: 'uint256[]', name: 'ids', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'string', name: 'terms', type: 'string' }],
    name: 'propose',
    outputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'bytes32', name: 'contextAlias', type: 'bytes32' }],
    name: 'recordOf',
    outputs: [
      {
        components: [
          { internalType: 'uint32', name: 'sealedCount', type: 'uint32' },
          { internalType: 'uint32', name: 'completedCount', type: 'uint32' },
        ],
        internalType: 'struct Handshake.Record',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  { inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }], name: 'seal', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }], name: 'withdraw', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as unknown as AbiEntry[];
