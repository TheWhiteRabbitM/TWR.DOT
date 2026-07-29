/**
 * Ask the host sandbox for what this app needs, once, on startup — and nothing
 * more than that.
 *
 * Inside the Polkadot shell, apps run in a sandboxed iframe and outbound network
 * access is permission-gated: a fetch to an unapproved origin fails silently,
 * which reads as "the button did nothing". Requesting the origins up front turns
 * that into one explicit host prompt. Outside the container this resolves
 * immediately and does nothing.
 *
 * The list below is the store's OWN, not the one it was cloned with. dot-store
 * never contacts OpenStreetMap, Nominatim, Wikimedia or a tile server; carrying
 * those over would have asked a reader to approve six origins the app has no
 * intention of calling. An over-broad permission request is not a harmless
 * default — it is the thing that teaches people to click Allow without reading.
 */
const ORIGINS = [
  // The only gateway that serves our CIDs: app icons, and screenshots an app's
  // owner declared in their `screenshots` record.
  'devnet-ipfs.api.polkadotcommunity.foundation',
  // eth_call against AppReviews for every rating on screen.
  'paseo-assethub-rpc.laissez-faire.trade',
];

/**
 * Device permissions are a separate axis from network origins, and just as
 * silent when missing. `OpenUrl` is what lets the app hand a link to the
 * browser — the web shell grants it implicitly, a shell that prompts will refuse
 * an unrequested navigation without saying so. Every card here has an Open
 * button, so this one is asked for up front and is justified by the first thing
 * a visitor sees.
 *
 * `Clipboard` is deliberately NOT here. It is only needed by the link fallback
 * when a navigation cannot be handed off, so it is requested at that moment
 * instead — see copyText() in host-nav.ts. Asked at startup it produced a modal
 * saying "Read text and data from your clipboard — granting this permission will
 * reload the application" over a storefront with no copy button on it, which is
 * a prompt a reader is right to refuse.
 */
const DEVICE_PERMISSIONS = ['OpenUrl'] as const;

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
    // Older host or no bridge — never block the app on a permission call.
  }
}
