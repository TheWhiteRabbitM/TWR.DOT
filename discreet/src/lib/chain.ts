import { DISCREET_CONTRACT, DEVNET_EVM_RPC } from './config';

/**
 * Live reads from the deployed Discreet contract — the app talks to its own
 * suite on every load, from any browser. Zero dependencies: raw JSON-RPC
 * eth_call with selectors computed at build time. Writes (book/list/settle)
 * are personhood-gated by the contract and signed inside the Polkadot host.
 */
const SEL_SERVICE_COUNT = '0x06237526'; // serviceCount()
const SEL_BOOKING_COUNT = '0x6d759172'; // bookingCount()

async function ethCall(data: string, timeoutMs = 8000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(DEVNET_EVM_RPC, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: DISCREET_CONTRACT, data }, 'latest'],
      }),
    });
    if (!res.ok) throw new Error(`RPC ${res.status}`);
    const j = (await res.json()) as { result?: string; error?: { message?: string } };
    if (!j.result) throw new Error(j.error?.message ?? 'no result');
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

export interface OnChainStatus {
  services: number;
  bookings: number;
}

/** Read the live contract state. Throws when the RPC is unreachable. */
export async function readContractStatus(): Promise<OnChainStatus> {
  const [s, b] = await Promise.all([ethCall(SEL_SERVICE_COUNT), ethCall(SEL_BOOKING_COUNT)]);
  return { services: Number.parseInt(s, 16) || 0, bookings: Number.parseInt(b, 16) || 0 };
}
