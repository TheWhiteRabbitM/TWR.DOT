import { useEffect, useState } from 'react';
import { SignerManager } from '@parity/product-sdk-signer';
import type { SignerState } from '@parity/product-sdk-signer';
import { CONTEXT } from './config';

let instance: SignerManager | null = null;

/**
 * Process-wide SignerManager.
 *
 * One instance for the whole app: it owns the host connection, persists the
 * selected account, and auto-reconnects when the host drops. Creating a second
 * one would race the first over the same host provider.
 *
 * Deliberately no `onConnect` resource allocation: The Button asks for exactly
 * one signature in a user's lifetime, so requesting the host's auto-signing
 * allowance would buy nothing and widen what the app is permitted to do.
 */
export function getSignerManager(): SignerManager {
  if (!instance) {
    instance = new SignerManager({ dappName: CONTEXT });
  }
  return instance;
}

/**
 * Subscribe to signer state.
 *
 * `subscribe()` does not fire with the current state, so the effect takes a
 * priming read before wiring the listener.
 */
export function useSignerState(): SignerState {
  const manager = getSignerManager();
  const [state, setState] = useState<SignerState>(() => manager.getState());

  useEffect(() => {
    setState(manager.getState());
    return manager.subscribe(setState);
  }, [manager]);

  return state;
}
