/**
 * Open a link that lives outside this app, from wherever the app is running.
 *
 * Inside the Polkadot host an app runs in a sandboxed iframe: `target="_blank"`
 * anchors and `window.open` are swallowed, and the supported escape is the
 * host's `navigateTo` (an `https://` URL opens in the system browser, a
 * `*.dot` URL deep-links to a sibling app inside the container).
 *
 * The subtlety that made an earlier version of this file useless: the TrUAPI
 * client has **no request timeout**, and its iframe transport queues frames
 * forever when the channel to the host is not established. A plain
 * `await navigateTo(url)` can therefore never settle — the fallback below it is
 * unreachable and the button looks dead. Every host call here is raced against
 * a deadline, and every path ends in something the user can see.
 *
 * The returned `trail` names what happened ("host:ok", "host:timeout>manual",
 * "host:denied>popup:blocked>manual"). It is shown in the fallback sheet, so a
 * user who reports "the button does nothing" hands over the cause with it.
 */
export type OpenVia = 'host' | 'popup' | 'manual';

export interface OpenResult {
  via: OpenVia;
  /** Breadcrumb of every strategy tried, e.g. `host:timeout>manual`. */
  trail: string;
  url: string;
}

export interface OpenOptions {
  /** Called when nothing opened by itself — show the link sheet here. */
  onFallback?: (r: OpenResult) => void;
  /** The host answered late, after we gave up: dismiss any fallback UI. */
  onLate?: () => void;
}

/** How long to wait for the host before assuming its channel is wedged. */
const HOST_DEADLINE_MS = 1500;

/**
 * Remember, for this session, that the host never answered. It matters because
 * a popup is only allowed while the user's tap is still "transiently active" —
 * a window some engines keep for seconds and others close almost immediately.
 * Waiting on a wedged host burns that window, so once we have learned the host
 * is not answering we stop asking and open the popup synchronously, before the
 * first await, while the tap is unambiguously ours.
 */
const WEDGED_KEY = 'twr.host.wedged';

function hostIsKnownWedged(): boolean {
  try {
    return sessionStorage.getItem(WEDGED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberHostWedged(): void {
  try {
    sessionStorage.setItem(WEDGED_KEY, '1');
  } catch {
    /* private mode: we simply pay the deadline again next time */
  }
}

/**
 * `noopener` is deliberately absent: per spec it makes window.open return null
 * even on success, which would make a working popup indistinguishable from a
 * blocked one. The opener is severed on the handle instead.
 */
function openPopup(url: string): Window | null {
  try {
    const w = window.open(url, '_blank');
    if (w) {
      try {
        w.opener = null;
      } catch {
        /* cross-origin already isolated it */
      }
    }
    return w;
  } catch {
    return null;
  }
}

/**
 * Name the host's refusal from the wire payload rather than the message text.
 * `CallErrorValue` carries a transport tag, and `Domain` wraps the versioned
 * domain error (`PermissionDenied` / `Unknown`).
 */
function classify(error: unknown): string {
  const payload = (error as { payload?: { tag?: string; value?: unknown } } | null)?.payload;
  const tag = payload?.tag;
  if (tag === 'Denied') return 'host:denied';
  if (tag === 'Unsupported') return 'host:unsupported';
  if (tag === 'Domain') {
    const inner = (payload?.value as { value?: { tag?: string } } | undefined)?.value?.tag;
    if (inner === 'PermissionDenied') return 'host:denied';
    return `host:err:${inner ?? 'unknown'}`;
  }
  return `host:err:${tag ?? 'unknown'}`;
}

export async function openExternal(url: string, opts: OpenOptions = {}): Promise<OpenResult> {
  const trail: string[] = [];

  const settle = (via: OpenVia): OpenResult => {
    const r: OpenResult = { via, trail: trail.join('>'), url };
    if (via !== 'host') console.warn('[open-external]', r.trail, url);
    // No caller-supplied UI? Fall back to the built-in overlay rather than
    // failing silently — an app should never eat a link.
    if (via === 'manual') (opts.onFallback ?? showLinkFallback)(r);
    return r;
  };

  // Synchronous fast path: still inside the tap, no await has run yet.
  if (hostIsKnownWedged()) {
    trail.push('host:skipped');
    const early = openPopup(url);
    if (early) {
      trail.push('popup:ok');
      return settle('popup');
    }
    trail.push('popup:blocked');
    trail.push('manual');
    return settle('manual');
  }

  let host: typeof import('@parity/product-sdk-host') | null = null;
  try {
    host = await import('@parity/product-sdk-host');
  } catch {
    trail.push('sdk:unavailable');
  }

  // Sync check only: the async variant merely wraps it, and this is used to
  // pick an ORDER, never to skip a fallback.
  const inside = host ? host.isInsideContainerSync() : false;

  if (host && inside) {
    try {
      const pending = host.navigateTo(url);
      const outcome = await Promise.race([
        pending.then((r) => (r.ok ? 'ok' : classify(r.error))),
        new Promise<'timeout'>((resolve) => {
          setTimeout(() => resolve('timeout'), HOST_DEADLINE_MS);
        }),
      ]);

      if (outcome === 'ok') {
        trail.push('host:ok');
        return settle('host');
      }

      trail.push(outcome === 'timeout' ? 'host:timeout' : outcome);

      if (outcome === 'timeout') {
        // The host is not answering. Fall through to the popup: the shell's
        // iframe is sandboxed WITH allow-popups (verified), so this is the one
        // route it actually grants us. A late "ok" from the host can produce a
        // second tab — a duplicate is a far smaller failure than a dead button.
        rememberHostWedged();
        void pending
          .then((r) => {
            if (r.ok) opts.onLate?.();
          })
          .catch(() => undefined);
      }
    } catch {
      trail.push('host:threw');
    }
  } else if (!inside) {
    trail.push('host:outside');
  }

  // A blocked popup returns null and throws nothing — checking the handle is
  // what turns a silent no-op into a diagnosable state.
  const opened = openPopup(url);
  if (opened) {
    trail.push('popup:ok');
    return settle('popup');
  }
  trail.push('popup:blocked');
  trail.push('manual');
  return settle('manual');
}

/** Copy text without assuming the clipboard API is reachable in the sandbox. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Framework-free fallback overlay: the default `onFallback` so any app gets a
 * working escape hatch by importing this file, with no UI wiring of its own.
 * Deliberately self-contained (inline styles, no CSS classes, no framework) so
 * it renders identically in every app in this workspace.
 */
export function showLinkFallback(result: OpenResult): void {
  const existing = document.getElementById('twr-link-fallback');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = 'twr-link-fallback';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;' +
    'justify-content:center;background:rgba(0,0,0,.45);backdrop-filter:blur(6px)';

  const panel = document.createElement('div');
  panel.style.cssText =
    'width:min(100%,520px);background:#14141a;color:#f4f4f7;border-radius:20px 20px 0 0;' +
    'padding:22px 20px calc(20px + env(safe-area-inset-bottom));font:14px/1.45 system-ui,' +
    '-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 -8px 40px rgba(0,0,0,.5)';

  const title = document.createElement('h3');
  title.textContent = 'Open this link';
  title.style.cssText = 'margin:0 0 6px;font-size:18px;font-weight:700';

  const lede = document.createElement('p');
  lede.textContent = "The app couldn't hand this to your browser by itself. Tap it below, or copy it.";
  lede.style.cssText = 'margin:0 0 14px;opacity:.7';

  const link = document.createElement('a');
  link.href = result.url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = result.url;
  link.style.cssText =
    'display:block;word-break:break-all;font-size:13px;padding:12px 14px;border-radius:12px;' +
    'background:rgba(255,255,255,.07);color:#6ab7ff;text-decoration:none;margin-bottom:14px';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy link';
  copy.style.cssText =
    'width:100%;padding:13px;border:0;border-radius:12px;background:#e6007a;color:#fff;' +
    'font-size:15px;font-weight:600;cursor:pointer;margin-bottom:8px';
  copy.onclick = () => {
    void copyText(result.url).then((ok) => {
      copy.textContent = ok ? 'Copied ✓' : 'Copy failed — select the link above';
    });
  };

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.style.cssText =
    'width:100%;padding:13px;border:0;border-radius:12px;background:rgba(255,255,255,.09);' +
    'color:inherit;font-size:15px;cursor:pointer';
  close.onclick = () => wrap.remove();

  const trail = document.createElement('p');
  trail.textContent = `couldn't open automatically · ${result.trail}`;
  trail.style.cssText = 'margin:14px 0 0;font-size:11px;text-align:center;opacity:.45';

  wrap.onclick = (e) => {
    if (e.target === wrap) wrap.remove();
  };
  panel.append(title, lede, link, copy, close, trail);
  wrap.append(panel);
  document.body.append(wrap);
}

/** Dismiss the built-in overlay (used when the host answers late). */
export function hideLinkFallback(): void {
  document.getElementById('twr-link-fallback')?.remove();
}
