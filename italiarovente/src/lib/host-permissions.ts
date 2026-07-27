/**
 * Ask the host sandbox for every permission this app needs, once, on startup.
 * Outbound network access inside the shell is permission-gated; a fetch to an
 * unapproved origin fails silently and reads as "the button did nothing".
 * Outside the container this resolves immediately and does nothing.
 */
const ORIGINS = [
  'api.open-meteo.com', // today's temperatures
];

/**
 * Device permissions are a separate axis from network origins, and just as
 * silent when missing. `OpenUrl` is what lets the app hand a link to the
 * browser — the web shell grants it implicitly, a shell that prompts will
 * refuse an unrequested navigation without saying so. `Clipboard` is what the
 * copy buttons need. Asked here, at startup, so they appear in the same prompt
 * the user already expects rather than mid-gesture.
 */
const DEVICE_PERMISSIONS = ['OpenUrl', 'Clipboard'] as const;

export async function requestHostPermissions(): Promise<void> {
  try {
    const host = await import('@parity/product-sdk-host');
    const inside = await host.isInsideContainer().catch(() => false);
    if (!inside) return;
    await host.requestPermission({ tag: 'Remote', value: { domains: ORIGINS } });
    // Bounded: host calls can queue forever on a wedged channel, and startup
    // must not be one of the things that waits on it.
    await Promise.race([
      Promise.all(
        DEVICE_PERMISSIONS.map((kind) =>
          host.requestDevicePermission(kind).catch(() => undefined),
        ),
      ),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {
    // Older host or no bridge - never block the app on a permission call.
  }
}

