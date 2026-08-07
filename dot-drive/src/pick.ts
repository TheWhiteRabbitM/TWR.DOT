/**
 * pick.ts — getting bytes out of a phone when the file browser will not open.
 *
 * THE PROBLEM, STATED PLAINLY
 *   Inside the Polkadot app on a phone, `<input type="file">` opens NOTHING.
 *   No chooser, no error, no event: the tap goes nowhere. chirp hit this first
 *   and the note has been sitting in dotmail's source ever since.
 *
 *   It is not a permission we forgot to ask for. The host's device permissions
 *   are exactly `Notifications, Camera, Microphone, Bluetooth, NFC, Location,
 *   Clipboard, OpenUrl, Biometrics`. There is no Files, no Storage, no Gallery.
 *   Nothing an app can request would make that input work.
 *
 * SO THERE ARE THREE DOORS, AND THE INTERFACE OFFERS ALL THREE
 *   file    the ordinary chooser. Works on desktop, does nothing on the phone,
 *           and is still offered because on desktop it is much the best.
 *   paste   whatever is on the clipboard. This is the one that actually works
 *           on a phone: copy a photo in the gallery, come back, paste. chirp
 *           proved it needs neither a chooser nor a permission.
 *   camera  a live frame. The only way to make a NEW file rather than move one
 *           that already exists, and Camera is a permission the host does grant.
 *
 * WHY NOT JUST HIDE THE BROKEN ONE ON MOBILE
 *   Because "is this a phone" is a guess, and a wrong guess takes the good path
 *   away from somebody on a tablet with a keyboard. All three are offered, and
 *   the one line of help says which to reach for when the first does nothing.
 */

export type Picked = { name: string; type: string; bytes: Uint8Array };

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export async function fromFile(f: File): Promise<Picked> {
  return {
    name: f.name || `file-${stamp()}`,
    type: f.type || 'application/octet-stream',
    bytes: new Uint8Array(await f.arrayBuffer()),
  };
}

/**
 * Whatever the clipboard is holding.
 *
 * Two routes, tried in order, because they fail in different places. The async
 * API is better when it is allowed: it can be driven by a button, which on a
 * phone is far easier than making a paste EVENT happen. When it is not allowed,
 * the caller falls back to a real paste target, which needs no permission at
 * all and is what chirp uses.
 */
export async function fromClipboard(): Promise<Picked | { why: string }> {
  try {
    await askFor('Clipboard');
  } catch { /* the read below may still be allowed; let it try */ }

  const read = (navigator.clipboard as { read?: () => Promise<ClipboardItem[]> })?.read;
  if (typeof read !== 'function') {
    return { why: 'This browser will not hand over the clipboard by itself. Long-press the box below and choose Paste.' };
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      // Anything but plain text. A copied photo, a copied PDF: whichever type
      // the phone offers, the first non-text one is the file.
      const type = item.types.find((t) => !t.startsWith('text/'));
      if (!type) continue;
      const blob = await item.getType(type);
      return {
        name: `${type.split('/')[0] || 'clipboard'}-${stamp()}.${(type.split('/')[1] || 'bin').split('+')[0]}`,
        type,
        bytes: new Uint8Array(await blob.arrayBuffer()),
      };
    }
    return { why: 'The clipboard has no file on it, only text.' };
  } catch (e) {
    const why = (e as Error)?.message ?? String(e);
    return {
      why: /denied|permission|NotAllowed/i.test(why)
        ? 'The clipboard was not granted. Long-press the box below and choose Paste instead.'
        : `The clipboard could not be read: ${why.slice(0, 120)}`,
    };
  }
}

/** Files off a real paste event, which needs no permission and is the path
 *  that works when everything else is refused. */
export async function fromPasteEvent(e: ClipboardEvent): Promise<Picked[]> {
  const files = [...(e.clipboardData?.items ?? [])]
    .filter((i) => i.kind === 'file')
    .map((i) => i.getAsFile())
    .filter(Boolean) as File[];
  return Promise.all(files.map(fromFile));
}

/* ------------------------------------------------------------------ camera */

export type Camera = {
  stream: MediaStream;
  /** Grab the current frame as a WebP. Quality is fixed: this is a document
   *  scanner more often than a photograph, and legible beats pretty. */
  shoot(video: HTMLVideoElement): Promise<Picked>;
  stop(): void;
};

export async function openCamera(): Promise<Camera | { why: string }> {
  try {
    const granted = await askFor('Camera');
    if (granted === false) return { why: 'The camera was not granted.' };
  } catch { /* some hosts do not implement it; getUserMedia will say so */ }

  if (!navigator.mediaDevices?.getUserMedia) {
    return { why: 'There is no camera available here.' };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
      audio: false,
    });
    return {
      stream,
      async shoot(video) {
        const w = video.videoWidth || 1280;
        const h = video.videoHeight || 720;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('this browser will not give us a canvas');
        ctx.drawImage(video, 0, 0, w, h);
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));
        if (!blob) throw new Error('the frame could not be encoded');
        return { name: `photo-${stamp()}.webp`, type: 'image/webp', bytes: new Uint8Array(await blob.arrayBuffer()) };
      },
      stop() { for (const t of stream.getTracks()) t.stop(); },
    };
  } catch (e) {
    return { why: (e as Error)?.message?.slice(0, 140) ?? 'the camera would not open' };
  }
}

/**
 * Ask the host for a device permission.
 *
 * `undefined` means we could not ask, which is NOT the same as refused: outside
 * the container there is no host, and the browser's own prompt still applies.
 * Treating "could not ask" as "denied" would block the camera on a desktop
 * where it works perfectly.
 */
async function askFor(kind: 'Camera' | 'Clipboard'): Promise<boolean | undefined> {
  try {
    const host = await import('@parity/product-sdk-host');
    const r = await host.requestDevicePermission?.({ tag: kind, value: undefined } as never);
    // A tagged Result: `{ok, value}`. Not the neverthrow kind.
    if (r && typeof r === 'object' && 'ok' in r) {
      return (r as { ok: boolean; value?: boolean }).ok ? (r as { value?: boolean }).value ?? true : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
