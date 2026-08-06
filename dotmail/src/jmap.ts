/**
 * jmap.ts — reading an ordinary mailbox, next to the sealed one.
 *
 * WHY JMAP AND NOT IMAP
 *   IMAP is raw TCP on port 993 and a webview has no socket. Reaching it would
 *   need a bridge server holding the user's mail password and seeing every
 *   message in clear text, which is the exact arrangement this app exists to
 *   get away from. JMAP is the same mailbox over HTTP and JSON, so it needs no
 *   middleman at all: the app talks to the mail host directly, the way it talks
 *   to a chain. Measured in the container's own probe — the Remote permission
 *   is granted and fetch returns 200 — so this works where a socket cannot.
 *
 * WHAT THIS IS NOT
 *   These letters are NOT sealed. They arrived through a provider that read
 *   them, they are stored on a server that can read them, and nothing about
 *   dotmail changes that. The interface keeps them in their own place and says
 *   so on every screen, because showing an ordinary email beside a sealed one
 *   in the same style would be the single most misleading thing this app could
 *   do.
 *
 * CREDENTIALS
 *   A bearer token or app password, kept in host storage, which survives a
 *   release where localStorage does not. It is as safe as the device and no
 *   safer, and Settings says that in those words rather than implying a vault.
 *   OAuth is not offered: it needs a browser redirect, and navigateTo returns
 *   ok without opening anything on this platform (issue #14).
 */

export type JmapConfig = { host: string; token: string; email: string };

export type ClassicMail = {
  id: string;
  from: string;
  to: string;
  subject: string;
  preview: string;
  body: string;
  receivedAt: number;
  seen: boolean;
  hasAttachments: boolean;
};

/** Every failure carries what was tried, because "could not connect" sends
 *  somebody to the wrong place half the time. */
export type JmapResult<T> = { ok: true; value: T } | { ok: false; why: string; at: string };

const AUTH = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

/** The host must be granted before any fetch, or the container refuses it
 *  without telling the page why. */
export async function allowHost(host: string): Promise<boolean> {
  try {
    const h = await import('@parity/product-sdk-host').catch(() => null);
    if (!h) return true;                       // plain browser: nothing to ask
    const r = await h.requestPermission({ tag: 'Remote', value: { domains: [host] } });
    return Boolean((r as { ok?: boolean; value?: boolean })?.value);
  } catch {
    return false;
  }
}

type Session = { apiUrl: string; accountId: string };

async function session(cfg: JmapConfig): Promise<JmapResult<Session>> {
  const url = `https://${cfg.host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/.well-known/jmap`;
  let res: Response;
  try {
    res = await fetch(url, { headers: AUTH(cfg.token) });
  } catch (e) {
    return { ok: false, at: url, why: `the request never completed: ${(e as Error).message}` };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, at: url, why: 'the server rejected the token. An app password, not the account password.' };
  }
  if (!res.ok) return { ok: false, at: url, why: `the server answered HTTP ${res.status}` };

  let body: {
    apiUrl?: string;
    primaryAccounts?: Record<string, string>;
  };
  try { body = await res.json(); } catch {
    return { ok: false, at: url, why: 'the answer was not JSON, so this host is probably not speaking JMAP' };
  }
  const accountId = body.primaryAccounts?.['urn:ietf:params:jmap:mail'];
  if (!body.apiUrl || !accountId) {
    return { ok: false, at: url, why: 'the session had no mail account on it' };
  }
  // A relative apiUrl is legal in the spec and common in the wild.
  const apiUrl = new URL(body.apiUrl, url).toString();
  return { ok: true, value: { apiUrl, accountId } };
}

/**
 * The most recent letters in the inbox.
 *
 * Two method calls in one request, chained by JMAP's back-reference, so the
 * whole fetch is a single round trip rather than one per message. Same lesson
 * as the contract lens next door: the count of trips is the latency.
 */
export async function inbox(cfg: JmapConfig, limit = 40): Promise<JmapResult<ClassicMail[]>> {
  const s = await session(cfg);
  if (!s.ok) return s;

  const req = {
    using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
    methodCalls: [
      ['Email/query', {
        accountId: s.value.accountId,
        filter: { inMailboxOtherThan: [] },
        sort: [{ property: 'receivedAt', isAscending: false }],
        limit,
      }, 'q'],
      ['Email/get', {
        accountId: s.value.accountId,
        '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' },
        properties: ['id', 'from', 'to', 'subject', 'preview', 'receivedAt', 'keywords', 'hasAttachment', 'bodyValues', 'textBody'],
        fetchTextBodyValues: true,
        maxBodyValueBytes: 40_000,
      }, 'g'],
    ],
  };

  let res: Response;
  try {
    res = await fetch(s.value.apiUrl, { method: 'POST', headers: AUTH(cfg.token), body: JSON.stringify(req) });
  } catch (e) {
    return { ok: false, at: s.value.apiUrl, why: `the request never completed: ${(e as Error).message}` };
  }
  if (!res.ok) return { ok: false, at: s.value.apiUrl, why: `the server answered HTTP ${res.status}` };

  type Addr = { name?: string; email?: string };
  type Row = {
    id: string; from?: Addr[]; to?: Addr[]; subject?: string; preview?: string;
    receivedAt?: string; keywords?: Record<string, boolean>; hasAttachment?: boolean;
    bodyValues?: Record<string, { value?: string }>;
    textBody?: { partId?: string }[];
  };

  let body: { methodResponses?: [string, { list?: Row[] }, string][] };
  try { body = await res.json(); } catch {
    return { ok: false, at: s.value.apiUrl, why: 'the answer was not JSON' };
  }

  const got = body.methodResponses?.find((m) => m[0] === 'Email/get');
  if (!got) {
    const err = body.methodResponses?.find((m) => m[0] === 'error');
    return { ok: false, at: s.value.apiUrl, why: err ? `the server returned an error: ${JSON.stringify(err[1]).slice(0, 120)}` : 'no messages came back' };
  }

  const who = (a?: Addr[]) => (a ?? []).map((x) => x.name || x.email || '').filter(Boolean).join(', ');

  const list = (got[1].list ?? []).map((m): ClassicMail => {
    const partId = m.textBody?.[0]?.partId;
    const text = (partId && m.bodyValues?.[partId]?.value) || m.preview || '';
    return {
      id: m.id,
      from: who(m.from) || 'unknown',
      to: who(m.to),
      subject: m.subject ?? '',
      preview: m.preview ?? '',
      body: text,
      receivedAt: m.receivedAt ? Math.floor(Date.parse(m.receivedAt) / 1000) : 0,
      seen: Boolean(m.keywords?.$seen),
      hasAttachments: Boolean(m.hasAttachment),
    };
  });

  return { ok: true, value: list };
}
