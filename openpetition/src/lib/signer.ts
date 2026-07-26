import { useEffect, useState } from 'react';
import { SignerManager } from '@parity/product-sdk-signer';
import type { SignerState } from '@parity/product-sdk-signer';
import { APP_NAME } from './config';

let instance: SignerManager | null = null;

/** Process-wide SignerManager — one host connection, one selected account. */
export function getSignerManager(): SignerManager {
  if (!instance) {
    instance = new SignerManager({ dappName: APP_NAME });
  }
  return instance;
}

/** Subscribe to signer state; primes with a synchronous read. */
export function useSignerState(): SignerState {
  const manager = getSignerManager();
  const [state, setState] = useState<SignerState>(() => manager.getState());

  useEffect(() => {
    setState(manager.getState());
    return manager.subscribe(setState);
  }, [manager]);

  return state;
}
