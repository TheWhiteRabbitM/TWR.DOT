/**
 * Ask the host sandbox for every permission this app needs, once, on startup.
 *
 * Inside the Polkadot shell, apps run in a sandboxed iframe and outbound
 * network access is permission-gated: a fetch to an unapproved origin fails
 * silently, which reads as "the button did nothing". Requesting the origins up
 * front turns that into one explicit host prompt. Outside the container this
 * resolves immediately and does nothing.
 */
const ORIGINS = [
  'nominatim.openstreetmap.org', // business search
  'www.openstreetmap.org', // embedded map
  'dweb.link', // Bulletin/IPFS gateway (seed data)
  'ipfs.io',
  'commons.wikimedia.org', // place photos
  'upload.wikimedia.org',
  'tile.openstreetmap.org', // map tiles (plain <img>, no iframe)
  'paseo-assethub-rpc.laissez-faire.trade', // ReviewRegistry eth_call
];

export async function requestHostPermissions(): Promise<void> {
  try {
    const host = await import('@parity/product-sdk-host');
    const inside = await host.isInsideContainer().catch(() => false);
    if (!inside) return;
    await host.requestPermission({ tag: 'Remote', value: { domains: ORIGINS } });
  } catch {
    // Older host or no bridge â€” never block the app on a permission call.
  }
}

