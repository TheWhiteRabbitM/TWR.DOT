/**
 * The slice of AppReviews the store needs in order to WRITE.
 *
 * Reads go through hand-rolled eth_call in chain.ts with build-time selectors,
 * which keeps the browsing bundle free of any chain library. Writing is
 * different: it needs metadata, encoding and a signer, so it uses the SDK's
 * contract layer — and that layer wants an ABI.
 *
 * The custom errors are here on purpose. Without them a revert surfaces as an
 * opaque `0x...` blob; with them the user is told "you have already reviewed
 * this app" instead.
 */
export const APP_REVIEWS_ABI = [
  {
    type: 'function',
    name: 'review',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'rating', type: 'uint8' },
      { name: 'body', type: 'string' },
    ],
    outputs: [{ name: 'key', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'me',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'key', type: 'bytes32' },
    ],
    outputs: [
      { name: 'status', type: 'uint8' },
      { name: 'required', type: 'uint8' },
      { name: 'yourAuthor', type: 'bytes32' },
      { name: 'yourRating', type: 'uint8' },
    ],
  },
  {
    type: 'function',
    name: 'keyFor',
    stateMutability: 'pure',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  { type: 'error', name: 'NotHuman', inputs: [
    { name: 'status', type: 'uint8' },
    { name: 'required', type: 'uint8' },
  ] },
  { type: 'error', name: 'AlreadyReviewed', inputs: [{ name: 'key', type: 'bytes32' }] },
  { type: 'error', name: 'BadRating', inputs: [{ name: 'rating', type: 'uint8' }] },
  { type: 'error', name: 'BadLabel', inputs: [{ name: 'bytesLength', type: 'uint256' }] },
  { type: 'error', name: 'BadName', inputs: [{ name: 'bytesLength', type: 'uint256' }] },
  { type: 'error', name: 'BadBody', inputs: [{ name: 'bytesLength', type: 'uint256' }] },
  { type: 'error', name: 'UnknownApp', inputs: [{ name: 'key', type: 'bytes32' }] },
  { type: 'error', name: 'NotOwner', inputs: [] },
] as const;
