/**
 * One-tap link into the Polkadot app's built-in chat.
 *
 * In-host: registers this app's community room (idempotent — "Exists" is fine)
 * and jumps to the chat surface. Outside the shell there is no chat, so the
 * caller shows a hint instead. Never throws.
 */
export type ChatLinkResult = 'opened' | 'registered' | 'outside' | 'failed';

export async function openAppChat(
  roomId: string,
  name: string,
  icon = '',
): Promise<ChatLinkResult> {
  try {
    const host = await import('@parity/product-sdk-host');
    const inside = await host.isInsideContainer().catch(() => false);
    if (!inside) return 'outside';
    const chat = await host.getChatManager();
    if (!chat) return 'outside';
    await chat.registerRoom({ roomId, name, icon });
    const nav = await host.navigateTo('polkadot://chat');
    return nav.ok ? 'opened' : 'registered';
  } catch {
    return 'failed';
  }
}
