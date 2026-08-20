/**
 * Reading the forum: the live board off chain via ethers, the imported archive
 * from the bundle. Reads need no wallet — anyone can browse. Writing lives in
 * forum.ts and needs a mask.
 *
 * Two sources, one shape. A `Topic` is either `live` (a post in the ForumBoard
 * contract, written by a mask) or `archived` (imported from
 * forum.polkadot.network, original author credited, NOT a mask). The UI shows
 * both in one list and tags which is which — never blends the provenance.
 */
import { Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';

/** ForumBoard, deployed & proven on devnet 2026-08-18 (topic+reply+like written
 *  and read back; the mask gate holds). */
export const FORUM_BOARD = '0x6B877c9AD59B6fd0818A0369F9Bd0F256228C60d';
/** PeoplebookMasks2 — the identity gate, same registry chirp & the complaint
 *  rail use. */
export const MASKS = '0x4c1fe8F4D4fa617aC421cE54b4c8441AB8d0bD4a';

const RPCS = [
  'https://paseo-assethub-rpc.laissez-faire.trade',
  'https://eth-rpc-testnet.polkadot.io',
  'https://services.polkadothub-rpc.com/testnet',
];

const FORUM_ABI = [
  'function count() view returns (uint256)',
  'function topicCount() view returns (uint256)',
  'function categoryTopicCount(bytes32) view returns (uint256)',
  'function lastChangedAt() view returns (uint256)',
  'function meta(uint256 id) view returns (uint256 mask, address author, uint40 time, uint40 edited, uint256 topicId, uint256 replyTo, bytes32 categoryKey, bool deleted, uint256 likes, uint256 replies)',
  'function title(uint256 id) view returns (string)',
  'function body(uint256 id) view returns (string)',
  'function likeCount(uint256) view returns (uint256)',
  'function replyCount(uint256) view returns (uint256)',
  'function liked(uint256, address) view returns (bool)',
  'function pageTopics(uint256 start, uint256 size) view returns (uint256[])',
  'function pageCategory(bytes32 categoryKey, uint256 start, uint256 size) view returns (uint256[])',
];

const MASKS_ABI = [
  'function maskOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function verifiedName(uint256) view returns (string)',
  'function profileOf(uint256 id) view returns (string displayName, string telegram, string x, string bio)',
];

let cached: Promise<JsonRpcProvider> | null = null;
export function connect(): Promise<JsonRpcProvider> {
  cached ??= (async () => {
    for (const url of RPCS) {
      try {
        const p = new JsonRpcProvider(url, undefined, { batchMaxCount: 40, staticNetwork: true });
        await p.getBlockNumber();
        return p;
      } catch {
        /* next */
      }
    }
    cached = null;
    throw new Error('no eth-rpc endpoint answered');
  })();
  return cached;
}

export const categoryKeyOf = (slug: string) => keccak256(toUtf8Bytes(slug));

/** Morpheus is mask #27; his posts wear the PFP instead of the generic glyph. */
export const MORPHEUS_MASK = 27n;
export const pfpForMask = (mask: bigint): string | null =>
  mask === MORPHEUS_MASK ? `${import.meta.env.BASE_URL}morpheus.svg` : null;

/* ------------------------------------------------------------- archive ---- */

export interface ArchiveCategory {
  id: number;
  name: string;
  slug: string;
  color: string;
  description: string | null;
  topicCount: number;
  postCount: number;
}
export interface ArchiveTopicRow {
  id: number;
  title: string;
  slug: string;
  categoryId: number;
  categorySlug: string;
  postsCount: number;
  replyCount: number;
  views: number;
  likeCount: number;
  createdAt: string;
  lastPostedAt: string;
  pinned: boolean;
  closed: boolean;
  tags: string[];
  author: { username: string; name: string | null; avatar: string | null } | null;
}
export interface ArchivePost {
  postNumber: number;
  username: string | null;
  name: string | null;
  createdAt: string | null;
  cooked: string;
  replyTo: number | null;
  avatar: string | null;
}
export interface ArchiveThread {
  id: number;
  title: string;
  slug: string;
  categoryId: number;
  createdAt: string | null;
  posts: ArchivePost[];
}
export interface ForumIndex {
  categories: ArchiveCategory[];
  topics: ArchiveTopicRow[];
  generatedAt: string;
  source: string;
}

const base = (f: string) => `${import.meta.env.BASE_URL}${f}`;

/** Fetch a bundle JSON file, RAW. (Gzip'd variants were tried to shrink the DAG,
 *  but the .dot.li app sandbox did not serve the `.gz` shards reliably — archived
 *  topics came back "not found" — so the archive ships uncompressed.) */
async function fetchDataFile(name: string, _gz?: boolean): Promise<unknown> {
  const r = await fetch(base(name));
  if (!r.ok) throw new Error(`${name} — HTTP ${r.status}`);
  return r.json();
}

async function fetchIndex(file: string, gz: boolean): Promise<ForumIndex> {
  const j = (await fetchDataFile(file, gz)) as ForumIndex;
  // Discourse serves tags as {id,name,slug} objects; the whole app treats tags
  // as strings, so normalize once here.
  for (const t of j.topics) {
    t.tags = ((t.tags ?? []) as unknown[]).map((x) =>
      typeof x === 'string' ? x : (x as { name?: string; slug?: string })?.name ?? (x as { slug?: string })?.slug ?? '',
    );
  }
  return j;
}

let indexCache: Promise<ForumIndex> | null = null;
/** The SLIM home index — categories + the most recent ~500 topics only (~250 KB
 *  vs ~1.8 MB), so the home paints fast. Uncompressed (first-paint path). Root
 *  path, never nested: the .li sandbox serves nested bundle paths as the shell. */
export function loadIndex(): Promise<ForumIndex> {
  indexCache ??= fetchIndex('forum-home.json', false).catch((e) => {
    indexCache = null;
    throw e;
  });
  return indexCache;
}

let fullCache: Promise<ForumIndex> | null = null;
/** The FULL topic index (all topics), gzip'd in production. Loaded in the
 *  background to upgrade category browsing and search after the home paints. */
export function loadFullIndex(): Promise<ForumIndex> {
  fullCache ??= fetchIndex('forum-index.json', true).catch((e) => {
    fullCache = null;
    throw e;
  });
  return fullCache;
}

const shardCache = new Map<string, Promise<Record<string, ArchiveThread>>>();
export function loadArchiveThread(id: number): Promise<ArchiveThread | null> {
  const nn = String(id % 64).padStart(2, '0');
  if (!shardCache.has(nn)) {
    shardCache.set(
      nn,
      fetchDataFile(`t-${nn}.json`, true)
        .then((j) => (j as { topics?: Record<string, ArchiveThread> }).topics ?? {})
        .catch(() => {
          shardCache.delete(nn);
          return {};
        }),
    );
  }
  return shardCache.get(nn)!.then((topics) => topics[String(id)] ?? null);
}

/* ---------------------------------------------------------------- live ---- */

export interface LivePost {
  id: number;
  mask: bigint;
  author: string;
  time: number;
  edited: number;
  topicId: number;
  replyTo: number;
  categoryKey: string;
  deleted: boolean;
  likes: number;
  replies: number;
  title: string;
  body: string;
}

async function readPost(c: Contract, id: number, withText = true): Promise<LivePost> {
  const m = await c.meta(id);
  const [title, body] = withText ? await Promise.all([m.topicId === 0n ? c.title(id) : '', c.body(id)]) : ['', ''];
  return {
    id,
    mask: m.mask,
    author: m.author,
    time: Number(m.time),
    edited: Number(m.edited),
    topicId: Number(m.topicId),
    replyTo: Number(m.replyTo),
    categoryKey: m.categoryKey,
    deleted: m.deleted,
    likes: Number(m.likes),
    replies: Number(m.replies),
    title,
    body,
  };
}

/** Live topics in a category (newest first), lightweight (no body). */
export async function liveTopicsInCategory(slug: string, limit = 60): Promise<LivePost[]> {
  const provider = await connect();
  const c = new Contract(FORUM_BOARD, FORUM_ABI, provider);
  const key = categoryKeyOf(slug);
  const total: bigint = await c.categoryTopicCount(key);
  if (total === 0n) return [];
  const n = Number(total);
  const start = Math.max(0, n - limit);
  const ids: bigint[] = await c.pageCategory(key, start, limit);
  const posts = await Promise.all(ids.map((id) => readPost(c, Number(id))));
  return posts.filter((p) => !p.deleted).reverse();
}

/** Every live topic across all categories (newest first). */
export async function liveTopicsAll(limit = 60): Promise<LivePost[]> {
  const provider = await connect();
  const c = new Contract(FORUM_BOARD, FORUM_ABI, provider);
  const total: bigint = await c.topicCount();
  if (total === 0n) return [];
  const n = Number(total);
  const start = Math.max(0, n - limit);
  const ids: bigint[] = await c.pageTopics(start, limit);
  const posts = await Promise.all(ids.map((id) => readPost(c, Number(id))));
  return posts.filter((p) => !p.deleted).reverse();
}

/** A live thread: the topic root + all its replies, with bodies. */
export async function liveThread(topicId: number): Promise<{ topic: LivePost; replies: LivePost[] } | null> {
  const provider = await connect();
  const c = new Contract(FORUM_BOARD, FORUM_ABI, provider);
  const total = Number(await c.count());
  const topic = await readPost(c, topicId);
  if (topic.deleted || topic.topicId !== 0) return null;
  // walk every post id, keep the ones whose topicId is this topic. Fine for a
  // young board; when it grows, index replies per topic in the contract.
  const replies: LivePost[] = [];
  const ids = Array.from({ length: total }, (_, i) => i + 1).filter((i) => i !== topicId);
  const metas = await Promise.all(ids.map((id) => readPost(c, id, false)));
  const mine = metas.filter((p) => p.topicId === topicId && !p.deleted).map((p) => p.id);
  const bodied = await Promise.all(mine.map((id) => readPost(c, id)));
  replies.push(...bodied.sort((a, b) => a.id - b.id));
  return { topic, replies };
}

export async function maskOf(address: string): Promise<bigint> {
  const provider = await connect();
  return new Contract(MASKS, MASKS_ABI, provider).maskOf(address).catch(() => 0n);
}

export async function likedBy(postId: number, address: string): Promise<boolean> {
  const provider = await connect();
  return new Contract(FORUM_BOARD, FORUM_ABI, provider).liked(postId, address).catch(() => false);
}

/** The mask's picture, the same one chirp and peoplebook show. Two systems, tried
 *  in chirp's order:
 *    1. FACE.faceOf(mask) — the image bytes are ON CHAIN. No key, no Bulletin, no
 *       host: this resolves for EVERY reader, logged in or not.
 *    2. PFP.pfpOf(mask) — the older scheme: what is on chain is a Bulletin
 *       preimage KEY, and the bytes come through the host's preimage manager, so
 *       it only resolves inside the Polkadot app.
 *  Neither → null, and the caller falls back to Morpheus's SVG or the glyph.
 *  Cached per mask. */
const FACE = '0xbc11688b1421bdde1fa1be5ea5bf02e9bb49be03';
const PFP = '0x6f3f9d84161f0bd0eb9d6524a5a2e5089b565470';

/** hex bytes → a webp data URL, chunked so a big picture cannot blow the stack. */
function webpFromHex(hex: string): string | null {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (body.length < 8) return null;
  let bin = '';
  for (let i = 0; i < body.length; i += 2) bin += String.fromCharCode(parseInt(body.slice(i, i + 2), 16));
  return `data:image/webp;base64,${btoa(bin)}`;
}
const pfpCache = new Map<string, Promise<string | null>>();
export function pfpOfMask(mask: bigint): Promise<string | null> {
  const id = mask.toString();
  if (mask === 0n) return Promise.resolve(null);
  if (!pfpCache.has(id)) {
    pfpCache.set(
      id,
      (async (): Promise<string | null> => {
        try {
          const provider = await connect();

          // 1) the picture itself, straight off Asset Hub — works for everyone.
          const faceHex: string = await new Contract(FACE, ['function faceOf(uint256) view returns (bytes)'], provider)
            .faceOf(mask)
            .catch(() => '0x');
          if (faceHex && faceHex.length > 8) {
            const url = webpFromHex(faceHex);
            if (url) return url;
          }

          // 2) older scheme: a Bulletin key, resolvable only inside the app.
          const key: string = await new Contract(PFP, ['function pfpOf(uint256) view returns (bytes)'], provider)
            .pfpOf(mask)
            .catch(() => '0x');
          if (!key || key === '0x' || key.length < 6) return null;
          const host = await import('@parity/product-sdk-host').catch(() => null);
          const mgr = host ? await host.getPreimageManager().catch(() => null) : null;
          if (!mgr) return null;
          const bytes = await new Promise<Uint8Array | null>((resolve) => {
            let done = false;
            let sub: { unsubscribe(): void } | undefined;
            const finish = (v: Uint8Array | null) => {
              if (done) return;
              done = true;
              try {
                sub?.unsubscribe();
              } catch {
                /* gone */
              }
              clearTimeout(timer);
              resolve(v);
            };
            const timer = setTimeout(() => finish(null), 10_000);
            try {
              sub = (mgr as { lookup(k: string, cb: (b: Uint8Array | null) => void): { unsubscribe(): void } }).lookup(
                key,
                (b) => b && finish(b),
              );
            } catch {
              finish(null);
            }
          });
          if (!bytes || !bytes.length) return null;
          let bin = '';
          for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
          return `data:image/webp;base64,${btoa(bin)}`;
        } catch {
          return null;
        }
      })(),
    );
  }
  return pfpCache.get(id)!;
}

export interface MaskProfile {
  id: string;
  displayName: string;
  verified: string;
}
/** Resolve a mask id → its display name + proven .dot, for showing who wrote a
 *  live post. Cached per mask. */
const profileCache = new Map<string, Promise<MaskProfile | null>>();
export function profileOfMask(mask: bigint): Promise<MaskProfile | null> {
  const key = mask.toString();
  if (mask === 0n) return Promise.resolve(null);
  if (!profileCache.has(key)) {
    profileCache.set(
      key,
      (async () => {
        try {
          const provider = await connect();
          const reg = new Contract(MASKS, MASKS_ABI, provider);
          const [profile, verified] = await Promise.all([
            reg.profileOf(mask).catch(() => null),
            reg.verifiedName(mask).catch(() => ''),
          ]);
          return {
            id: key,
            displayName: profile?.displayName || `mask #${key}`,
            verified: verified || '',
          };
        } catch {
          return null;
        }
      })(),
    );
  }
  return profileCache.get(key)!;
}
