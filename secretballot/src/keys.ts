/**
 * The voting key, which is not your account.
 *
 * A ballot must not be signed with the key that identifies you, or the ring is
 * theatre. So a separate keypair is made for voting, kept in this browser, and
 * only its public half ever reaches the chain — attached to your mask once, at
 * enrolment, before anyone has said anything.
 *
 * It lives in localStorage, and that is a real limitation stated plainly: clear
 * the browser and you keep your vote but lose the ability to cast another one
 * in polls you have not answered yet. Deriving it from a wallet signature would
 * be better and needs a host API for signing arbitrary messages, which is not
 * the one we have.
 */
import { keccak256 } from 'ethers';
import { publicKey, useKeccak, type Pt } from './blsag';

useKeccak((b) => keccak256(b));

const KEY = 'secretballot.voting-key.v1';

export function votingSecret(): bigint {
  let hex = localStorage.getItem(KEY);
  if (!hex) {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(KEY, hex);
  }
  return BigInt('0x' + hex);
}

export function votingKey(): { secret: bigint; pub: Pt } {
  const secret = votingSecret();
  return { secret, pub: publicKey(secret) };
}
