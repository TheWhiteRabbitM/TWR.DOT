/**
 * Open an external https:// URL from wherever the app is running.
 *
 * Inside the Polkadot host the app lives in a sandboxed iframe where
 * `target="_blank"` anchors are silently swallowed — the supported escape
 * hatch is `truApi.system.navigateTo`, which opens https:// URLs in the
 * system browser. Outside the shell a plain window.open does the job.
 * Never throws.
 */
export async function openExternal(url: string): Promise<'host' | 'browser'> {
  try {
    const host = await import('@parity/product-sdk-host');
    const inside = await host.isInsideContainer().catch(() => false);
    if (inside) {
      const r = await host.navigateTo(url);
      if (r.ok) return 'host';
    }
  } catch {
    /* fall through to the browser path */
  }
  window.open(url, '_blank', 'noopener');
  return 'browser';
}
