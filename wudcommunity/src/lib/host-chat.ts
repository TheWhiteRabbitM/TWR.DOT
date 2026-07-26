/**
 * One-tap link into the Polkadot app's built-in chat.
 *
 * In-host: registers this app's community room (idempotent — "Exists" is fine)
 * and jumps to the chat surface. Outside the shell there is no chat, so the
 * caller shows a hint instead. Never throws.
 *
 * Like `host-nav.ts`, every host call is raced against a deadline: the TrUAPI
 * client has no request timeout and queues frames forever on a wedged channel,
 * so an un-raced `await` here is why this button could hang on "Opening…"
 * with nothing else happening. Registering the room and jumping to it are
 * reported separately — a registered room is still useful even when the jump
 * fails, and the user can be told exactly that.
 */
export type ChatStatus = 'opened' | 'registered' | 'outside' | 'failed';

export interface ChatResult {
  status: ChatStatus;
  /** Breadcrumb of what happened, e.g. `register:ok>nav:timeout`. */
  trail: string;
}

const HOST_DEADLINE_MS = 1500;

/** Resolve to `'timeout'` rather than hanging when the host never answers. */
function withDeadline<T>(p: Promise<T>, label: string): Promise<T | 'timeout'> {
  return Promise.race([
    p.catch(() => `${label}:threw` as unknown as T),
    new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), HOST_DEADLINE_MS);
    }),
  ]);
}

export async function openAppChat(
  roomId: string,
  name: string,
  icon = '',
): Promise<ChatResult> {
  const trail: string[] = [];
  const done = (status: ChatStatus): ChatResult => {
    const r = { status, trail: trail.join('>') };
    if (status !== 'opened') console.warn('[app-chat]', r.trail);
    return r;
  };

  let host: typeof import('@parity/product-sdk-host') | null = null;
  try {
    host = await import('@parity/product-sdk-host');
  } catch {
    trail.push('sdk:unavailable');
    return done('failed');
  }

  if (!host.isInsideContainerSync()) {
    trail.push('outside');
    return done('outside');
  }

  try {
    const chat = await withDeadline(Promise.resolve(host.getChatManager()), 'manager');
    if (chat === 'timeout' || !chat) {
      trail.push('manager:timeout');
      return done('failed');
    }

    const reg = await withDeadline(
      Promise.resolve(chat.registerRoom({ roomId, name, icon })),
      'register',
    );
    if (reg === 'timeout') {
      // The bridge is not answering at all — the jump would hang too.
      trail.push('register:timeout');
      return done('failed');
    }
    trail.push('register:ok');

    const nav = await withDeadline(host.navigateTo('polkadot://chat'), 'nav');
    if (nav === 'timeout') {
      trail.push('nav:timeout');
      return done('registered');
    }
    if (nav && typeof nav === 'object' && 'ok' in nav && nav.ok) {
      trail.push('nav:ok');
      return done('opened');
    }
    trail.push('nav:refused');
    return done('registered');
  } catch {
    trail.push('threw');
    return done('failed');
  }
}
