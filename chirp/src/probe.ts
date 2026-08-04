/**
 * What the container actually does — measured, not inferred.
 *
 * WHY THIS EXISTS. Three limits were about to be reported to Parity on the
 * strength of symptoms: a picture upload that failed, an image that did not
 * render, a link that did not open. Every one of those symptoms turned out to
 * have, or could have had, a cause on OUR side — a key encoded two bytes over a
 * contract limit, a gas figure sized for a different kind of write, a permission
 * we never checked the answer to. Filing a bug report built on a guess wastes
 * the time of the people who could fix the real one.
 *
 * So each claim gets a test that produces evidence a stranger can check, and
 * nothing is reported that a test did not show.
 *
 * It runs inside the app because that is the only place these questions have
 * answers: outside the container every one of them is trivially "no host".
 */

export type Finding = {
  what: string;
  result: 'yes' | 'no' | 'unknown';
  detail: string;
};

const ms = () => Date.now();

async function host() {
  return import('@parity/product-sdk-host').catch(() => null);
}

/** Does a file input open anything? Only a person can answer, so this reports
 *  what the platform SAYS it supports and leaves the verdict to the tap. */
async function fileInput(): Promise<Finding> {
  const el = document.createElement('input');
  el.type = 'file';
  const supported = el.type === 'file';
  return {
    what: 'file input: element accepted by the webview',
    result: supported ? 'yes' : 'no',
    detail: supported
      ? 'The element exists and accepts type="file". Whether a chooser opens is only knowable by tapping it — the probe screen has a real one to tap, and reports the file it receives.'
      : 'The webview refused type="file" outright.',
  };
}

/** Was the Remote permission actually granted? Everything about images hangs
 *  on this, and it was never checked. */
async function remoteGrant(domains: string[]): Promise<Finding> {
  const h = await host();
  if (!h) return { what: 'Remote permission', result: 'unknown', detail: 'no host' };
  const t = ms();
  try {
    const r = await h.requestPermission({ tag: 'Remote', value: { domains } });
    const ok = Boolean((r as { ok?: boolean; value?: boolean }).ok && (r as { value?: boolean }).value);
    return {
      what: 'Remote permission granted for ' + domains.join(', '),
      result: ok ? 'yes' : 'no',
      detail: `answered in ${ms() - t}ms: ${JSON.stringify(r)}`,
    };
  } catch (e) {
    return { what: 'Remote permission', result: 'unknown', detail: `threw: ${(e as Error)?.message}` };
  }
}

/** With the permission in hand, do fetch and <img> behave the same? This is the
 *  claim that Remote covers one and not the other — it needs both, back to back,
 *  against the same url, or it proves nothing. */
async function imageVsFetch(url: string): Promise<Finding[]> {
  const viaFetch = await (async () => {
    const t = ms();
    try {
      const r = await fetch(url, { referrerPolicy: 'no-referrer', mode: 'cors' });
      return { ok: r.ok, detail: `HTTP ${r.status} in ${ms() - t}ms` };
    } catch (e) {
      return { ok: false, detail: `threw in ${ms() - t}ms: ${(e as Error)?.message}` };
    }
  })();

  const viaImg = await new Promise<{ ok: boolean; detail: string }>((res) => {
    const t = ms();
    const i = new Image();
    i.referrerPolicy = 'no-referrer';
    i.onload = () => res({ ok: i.naturalWidth > 1, detail: `${i.naturalWidth}x${i.naturalHeight} in ${ms() - t}ms` });
    i.onerror = () => res({ ok: false, detail: `error in ${ms() - t}ms` });
    setTimeout(() => res({ ok: false, detail: 'no answer in 8s' }), 8000);
    i.src = url;
  });

  return [
    { what: `fetch ${url}`, result: viaFetch.ok ? 'yes' : 'no', detail: viaFetch.detail },
    { what: `<img> ${url}`, result: viaImg.ok ? 'yes' : 'no', detail: viaImg.detail },
  ];
}

/** What navigateTo actually returns, and how long it takes to say it. The claim
 *  was that it neither opens nor answers; this records which. */
async function navigate(url: string): Promise<Finding> {
  const h = await host();
  if (!h) return { what: 'navigateTo', result: 'unknown', detail: 'no host' };
  const t = ms();
  const raced = await Promise.race([
    h.navigateTo(url).then((r) => ({ settled: true, r })).catch((e) => ({ settled: true, r: `threw: ${(e as Error)?.message}` })),
    new Promise<{ settled: false }>((res) => setTimeout(() => res({ settled: false }), 6000)),
  ]);
  return {
    what: `navigateTo(${url})`,
    result: raced.settled ? 'yes' : 'no',
    detail: raced.settled
      ? `settled in ${ms() - t}ms: ${JSON.stringify((raced as { r: unknown }).r)}`
      : 'did not settle within 6s — neither opened nor answered',
  };
}

/** Preimages: the permission, then a real round trip. The only upload path a
 *  user has, and we have never proven it returns what it stored. */
async function preimage(): Promise<Finding[]> {
  const h = await host();
  if (!h) return [{ what: 'preimage', result: 'unknown', detail: 'no host' }];
  const out: Finding[] = [];

  const p = await h.requestPermission({ tag: 'PreimageSubmit', value: undefined }).catch((e) => e);
  out.push({
    what: 'PreimageSubmit permission',
    result: (p as { ok?: boolean; value?: boolean })?.ok && (p as { value?: boolean }).value ? 'yes' : 'no',
    detail: JSON.stringify(p),
  });

  const mgr = await h.getPreimageManager().catch(() => null);
  if (!mgr) { out.push({ what: 'getPreimageManager', result: 'no', detail: 'returned null' }); return out; }

  // Unique bytes, so a hit cannot be somebody else's earlier upload.
  const bytes = new TextEncoder().encode('chirp-probe-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  let key = '';
  const t = ms();
  try {
    key = await mgr.submit(bytes);
    out.push({ what: 'preimage submit', result: 'yes', detail: `key ${key} in ${ms() - t}ms` });
  } catch (e) {
    out.push({ what: 'preimage submit', result: 'no', detail: `threw: ${(e as Error)?.message}` });
    return out;
  }

  const back = await new Promise<Uint8Array | null>((res) => {
    let done = false;
    const finish = (v: Uint8Array | null) => { if (!done) { done = true; try { sub?.unsubscribe(); } catch { /* gone */ } res(v); } };
    const timer = setTimeout(() => finish(null), 15000);
    let sub: { unsubscribe(): void } | undefined;
    try { sub = mgr.lookup(key as `0x${string}`, (b) => { if (b) { clearTimeout(timer); finish(b); } }); }
    catch { clearTimeout(timer); finish(null); }
  });
  out.push({
    what: 'preimage lookup of what we just submitted',
    result: back ? 'yes' : 'no',
    detail: back
      ? `${back.length} bytes back, identical: ${back.length === bytes.length && back.every((b, i) => b === bytes[i])}`
      : 'nothing within 15s — submitted but not retrievable',
  });
  return out;
}

/**
 * Can THIS person store on Bulletin?
 *
 * Issue #9 says apps cannot get storage authorised. That has been argued from
 * failures — a publish that drew an unauthorised pool account, an upload that
 * did not come back. There is a proper answer available:
 * `checkAuthorization(address)` reads `TransactionStorage.Authorizations` and
 * returns the quota, the remaining bytes and the expiry.
 *
 * A number beats an anecdote. If this says `authorized: false` for an ordinary
 * account, that is the issue, stated in the chain's own terms.
 */
async function bulletinQuota(address: string): Promise<Finding> {
  if (!address) return { what: 'Bulletin storage authorisation', result: 'unknown', detail: 'no account to ask about' };
  try {
    const cs = await import('@parity/product-sdk-cloud-storage');
    // A read-only question, but the client wants a signer; a stub is enough,
    // because checkAuthorization only queries storage.
    const client = await (cs as any).CloudStorageClient.create({
      environment: 'devnet',
      signer: { publicKey: new Uint8Array(32), signTx: async () => new Uint8Array(), signBytes: async () => new Uint8Array() },
    });
    const r = await client.checkAuthorization(address);
    const v = r?.value ?? r;
    await client.destroy?.().catch(() => undefined);
    return {
      what: `Bulletin storage authorisation for ${address.slice(0, 10)}…`,
      result: v?.authorized ? 'yes' : 'no',
      detail: JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)),
    };
  } catch (e) {
    return { what: 'Bulletin storage authorisation', result: 'unknown', detail: `threw: ${(e as Error)?.message}` };
  }
}

/** Host storage: does it survive, and does it hold what we put in it? */
async function storage(): Promise<Finding> {
  const h = await host();
  if (!h) return { what: 'host localStorage', result: 'unknown', detail: 'no host' };
  const s = await h.getHostLocalStorage().catch(() => null);
  if (!s) return { what: 'host localStorage', result: 'no', detail: 'returned null' };
  const v = 'probe-' + Date.now();
  try {
    await s.writeString('chirp.probe', v);
    const back = await s.readString('chirp.probe');
    return {
      what: 'host localStorage write then read',
      result: back === v ? 'yes' : 'no',
      detail: back === v ? 'round trip exact' : `wrote "${v}", read "${back}"`,
    };
  } catch (e) {
    return { what: 'host localStorage', result: 'no', detail: `threw: ${(e as Error)?.message}` };
  }
}

/** Everything, in order, with the permission asked BEFORE the things that
 *  depend on it — otherwise the image result means nothing. */
export async function runProbe(onStep: (f: Finding) => void, address = ''): Promise<Finding[]> {
  const all: Finding[] = [];
  const add = (f: Finding) => { all.push(f); onStep(f); };

  const h = await host();
  add({
    what: 'inside the Polkadot app',
    result: h ? (await h.isInsideContainer().catch(() => false)) ? 'yes' : 'no' : 'no',
    detail: h ? 'host module loaded' : 'no host module — this is a plain browser, and every answer below is meaningless',
  });

  add(await fileInput());
  add(await remoteGrant(['media.tenor.com', 'i.giphy.com']));
  for (const f of await imageVsFetch('https://i.giphy.com/3o7abKhOpu0NwenH3O.gif')) add(f);
  add(await navigate('https://polkadot.com'));
  for (const f of await preimage()) add(f);
  add(await bulletinQuota(address));
  add(await storage());
  return all;
}

/**
 * The report as text, for pasting into an issue.
 *
 * `tapped` carries what the real file input received, because that is the one
 * finding a person produces rather than the code — and it was missing from the
 * copied report entirely, so the answer stayed on screen and never reached
 * anyone who needed it.
 */
export const probeReport = (all: Finding[], tapped = '') =>
  ['chirp container probe', new Date().toISOString(), navigator.userAgent, '']
    .concat(all.map((f) => `[${f.result.toUpperCase().padEnd(7)}] ${f.what}\n           ${f.detail}`))
    .concat([
      `[${(tapped ? 'YES' : 'UNTESTED').padEnd(7)}] file chooser opened when tapped`,
      `           ${tapped || 'nobody tapped the file input on the probe screen'}`,
    ])
    .join('\n');
