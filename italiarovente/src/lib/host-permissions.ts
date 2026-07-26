/**
 * Ask the host sandbox for every permission this app needs, once, on startup.
 * Outbound network access inside the shell is permission-gated; a fetch to an
 * unapproved origin fails silently and reads as "the button did nothing".
 * Outside the container this resolves immediately and does nothing.
 */
const ORIGINS = [
  'api.open-meteo.com', // today's temperatures
];

export async function requestHostPermissions(): Promise<void> {
  try {
    const host = await import('@parity/product-sdk-host');
    const inside = await host.isInsideContainer().catch(() => false);
    if (!inside) return;
    await host.requestPermission({ tag: 'Remote', value: { domains: ORIGINS } });
  } catch {
    // Older host or no bridge - never block the app on a permission call.
  }
}

