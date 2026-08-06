/**
 * reach.ts — where one person is reachable across the suite.
 *
 * THIS IS THE PART THAT CANNOT BE COPIED
 *   A stylesheet takes an afternoon to lift. This does not, because it is not a
 *   design: it is a set of reads across contracts that only exist because we
 *   deployed them, resolved through a mask that cannot be transferred. Anybody
 *   can draw these rows. Filling them in truthfully requires being us.
 *
 * AND IT IS HONEST ABOUT WHAT IT CANNOT SEE
 *   Three answers, never two. Reachable, not reachable, and could-not-ask. The
 *   third is the one every dashboard quietly renders as the second, and it is
 *   the difference between "this person has no mailbox" and "the node did not
 *   answer me just now".
 */
import { HANDLES, DOTMAIL_KEYS, contractRuntime } from './chain';

export type Where = {
  app: string;
  /** What the app calls you there, when it calls you anything. */
  as: string;
  /** `true` reachable, `false` asked and not, `null` could not ask. */
  on: boolean | null;
  /** One line the person can act on. */
  note: string;
};

const HANDLES_ABI = [
  { inputs: [{ name: 'mask', type: 'uint256' }], name: 'handleOf',
    outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
];
const KEYS_ABI = [
  { inputs: [{ name: 'mask', type: 'uint256' }], name: 'keyOf',
    outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view', type: 'function' },
];

/** Where this mask can be found, app by app, read live. */
export async function reachOf(mask: number): Promise<Where[]> {
  const rt = await contractRuntime();
  if (!rt) {
    return [
      { app: 'chirp', as: '', on: null, note: 'the chain could not be reached just now' },
      { app: 'dotmail', as: '', on: null, note: 'the chain could not be reached just now' },
    ];
  }

  const read = async <T>(addr: string, abi: unknown, fn: string): Promise<T | null> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = (rt.sdk as any).createContract(rt.rt, addr, abi, {});
      const r = await c[fn].query(BigInt(mask));
      return r?.value === undefined ? null : (r.value as T);
    } catch { return null; }
  };

  const handle = await read<string>(HANDLES, HANDLES_ABI, 'handleOf');
  const key = await read<unknown>(DOTMAIL_KEYS, KEYS_ABI, 'keyOf');

  const keyHex = key === null ? null
    : String((key as { asHex?: () => string })?.asHex?.() ?? key ?? '');
  const hasKey = keyHex === null ? null : Boolean(keyHex) && !/^0x0+$/.test(keyHex);

  return [
    {
      app: 'chirp',
      as: handle ? `@${handle}` : '',
      on: handle === null ? null : Boolean(handle.trim()),
      note: handle === null
        ? 'the handle registry did not answer'
        : handle.trim()
          ? 'people can find you and reply to you by this name'
          : 'claim a handle in chirp and it becomes your name everywhere',
    },
    {
      app: 'dotmail',
      as: handle ? `@${handle}` : '',
      on: hasKey,
      note: hasKey === null
        ? 'the mailbox registry did not answer'
        : hasKey
          ? 'sealed letters addressed to your name will reach you'
          : 'publish a mailbox key in dotmail and letters can be sealed to you',
    },
  ];
}
