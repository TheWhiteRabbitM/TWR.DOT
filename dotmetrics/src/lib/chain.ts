import { JsonRpcProvider, Contract } from 'ethers';
import type { ReadContract } from './types';

/**
 * Public Ethereum JSON-RPC for devnet Asset Hub. Everything dotmetrics shows is
 * read through here — no wallet, no host container, no personhood. Runs in any
 * browser.
 */
const RPC = 'https://paseo-assethub-rpc.laissez-faire.trade';

let provider: JsonRpcProvider | null = null;

function getProvider(): JsonRpcProvider {
  if (!provider) provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  return provider;
}

/** A contract reader bound to the shared provider, matching {@link ReadContract}. */
export const readContract: ReadContract = (address, abi) => {
  const contract = new Contract(address, abi, getProvider());
  return new Proxy(
    {},
    {
      get(_t, method: string) {
        return (...args: unknown[]) => contract.getFunction(method)(...args);
      },
    },
  ) as ReturnType<ReadContract>;
};

/** Is the endpoint reachable? Used for a connection indicator. */
export async function ping(): Promise<boolean> {
  try {
    await getProvider().getBlockNumber();
    return true;
  } catch {
    return false;
  }
}
