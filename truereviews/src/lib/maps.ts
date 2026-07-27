/**
 * Open a place in whatever map app the device actually has.
 *
 * Why this exists: inside the Polkadot app's desktop shell an https:// link
 * opens fine, but inside the mobile wrapper neither route works — the host's
 * `navigateTo` does not answer and `window.open` produces no visible window.
 * What mobile web views almost always DO honour is a platform URL scheme
 * handed to the OS: `geo:` on Android, `maps://` on iOS. The OS, not the web
 * view, decides what opens.
 *
 * The scheme is attempted through a detached iframe rather than by assigning
 * `location.href`: if nothing on the device claims it, an iframe navigation
 * fails silently, while a top-level one can strand the app on an error page.
 */
export interface MapTarget {
  lat: number;
  lon: number;
  label: string;
}

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac, so the touch check is what catches it.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isAndroid(): boolean {
  return /Android/.test(navigator.userAgent);
}

/** True when this device has a native map app worth trying first. */
export function hasNativeMaps(): boolean {
  return isIOS() || isAndroid();
}

/** The scheme URL for this device, or null when there is no sensible one. */
export function nativeMapUrl(t: MapTarget): string | null {
  const q = encodeURIComponent(t.label);
  if (isIOS()) return `maps://?q=${q}&ll=${t.lat},${t.lon}`;
  if (isAndroid()) return `geo:${t.lat},${t.lon}?q=${t.lat},${t.lon}(${q})`;
  return null;
}

/**
 * Hand the URL to the operating system. Resolves true when the attempt was
 * made — never a promise that something opened, because a web view gives no
 * signal either way. The caller keeps its manual fallback.
 */
export function tryNativeMaps(t: MapTarget): boolean {
  const url = nativeMapUrl(t);
  if (!url) return false;
  try {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    frame.src = url;
    document.body.appendChild(frame);
    window.setTimeout(() => frame.remove(), 1500);
    return true;
  } catch {
    return false;
  }
}
