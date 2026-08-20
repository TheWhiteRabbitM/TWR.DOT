/** Small shared UI helpers: time, avatars, initials, and — load-bearing — a
 *  sanitizer for the imported `cooked` HTML. */

const FORUM = 'https://forum.polkadot.network';

/** Discourse avatar_template is "/user_avatar/…/{size}/…png" — fill the size and
 *  make it absolute. Data-URI or absolute URLs pass through. */
export function avatarUrl(template: string | null): string | null {
  if (!template) return null;
  if (/^https?:|^data:/.test(template)) return template.replace('{size}', '90');
  return `${FORUM}${template.replace('{size}', '90')}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Relative time, forum-style ("3h", "2d", "Aug '24"). */
export function fmtWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Sanitize imported `cooked` HTML before rendering it. The archive comes from a
 * moderated source, but rendering third-party HTML with dangerouslySetInnerHTML
 * is exactly where a stored-XSS would live, so this is not optional. Whitelist
 * of tags/attributes, everything else stripped, done with the browser's own
 * parser (no dependency).
 */
const ALLOWED_TAGS = new Set([
  'P', 'BR', 'HR', 'DIV', 'SPAN', 'A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'CODE', 'PRE',
  'BLOCKQUOTE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'IMG', 'TABLE', 'THEAD',
  'TBODY', 'TR', 'TD', 'TH', 'SUP', 'SUB', 'ASIDE', 'DETAILS', 'SUMMARY', 'FIGURE', 'FIGCAPTION',
]);
const ALLOWED_ATTR = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'class']);

/**
 * The imported "Welcome / Code of Conduct" topics describe the OLD forum's
 * moderation: bans, content removal, flagging, a mod team. None of that exists
 * here — there are no moderators and nothing can be removed — so on the policy
 * topics those passages are stripped, per the author's instruction. Applied
 * only to policy/welcome topics (by title), never to ordinary discussion.
 */
const MOD_RE = /\b(ban(?:ned|ning)?|moderat(?:e|ion|or|ors)?|content\s+removal|remov(?:e|ed|al)|flag(?:ging|ged|s)?|suspend(?:ed)?|mod\s+team|code\s+of\s+conduct|trolling|warn(?:ing|ed)?)\b/i;
export const isPolicyTopic = (title: string) =>
  /welcome|code of conduct|policy|policies|guideline|rules|newbie|conduct/i.test(title);

export function stripModeration(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const root = tpl.content as unknown as Element;
  for (const el of [...root.querySelectorAll('p, li, h1, h2, h3, h4, blockquote, aside')]) {
    if (MOD_RE.test(el.textContent ?? '')) el.remove();
  }
  return root.innerHTML;
}

export function sanitize(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = (node: Element) => {
    for (const el of [...node.children]) {
      if (!ALLOWED_TAGS.has(el.tagName)) {
        // keep the text, drop the tag (unwrap) unless it's clearly dangerous
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'SVG'].includes(el.tagName)) {
          el.remove();
          continue;
        }
        const span = document.createElement('span');
        span.innerHTML = el.innerHTML;
        el.replaceWith(span);
        walk(span);
        continue;
      }
      for (const a of [...el.attributes]) {
        const name = a.name.toLowerCase();
        if (!ALLOWED_ATTR.has(name) || /^on/.test(name)) {
          el.removeAttribute(a.name);
          continue;
        }
        if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(a.value)) {
          el.removeAttribute(a.name);
        }
      }
      if (el.tagName === 'A') {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noreferrer nofollow');
      }
      walk(el);
    }
  };
  walk(tpl.content as unknown as Element);
  return (tpl.content as unknown as Element).innerHTML ?? tpl.innerHTML;
}
