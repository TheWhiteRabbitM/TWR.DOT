/**
 * Import the entire Polkadot Discourse forum (forum.polkadot.network) into a
 * static, read-only archive — original authors PRESERVED as attribution, never
 * as masks. This is the historical record; only mask holders write from now on.
 *
 * Paging shape reused from dal/scripts/ingest.mjs (getJson retry+backoff,
 * dual-termination). Discourse specifics:
 *   /categories.json                     → category_list.categories[]
 *   /c/<slug>/<id>.json?page=N           → topic_list.topics[] (30/page)
 *   /t/<id>.json                         → post_stream.posts[] (~20) + .stream[] (all ids)
 *   /t/<id>/posts.json?post_ids[]=…      → the rest, 20 at a time
 *
 * We import `cooked` (rendered HTML — `raw` markdown is not served) and the
 * threading field `reply_to_post_number`. Output under forum-app/public/ at the
 * bundle ROOT (the .li sandbox serves nested paths as the host shell):
 *   forum-index.json     categories + a light topic list (no bodies)
 *   t-<NN>.json (00..63) full threads, sharded by topicId % 64
 *
 *   node scripts/import-discourse.mjs [--sample] [--resume]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const BASE = 'https://forum.polkadot.network';
const OUT = new URL('../public/', import.meta.url);
const SHARDS = 64;
const SAMPLE = process.argv.includes('--sample');
const RESUME = process.argv.includes('--resume');

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retry/backoff fetch — honours Discourse rate limiting (429). */
async function getJson(url, tries = 5) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': 'polkadot-forum-archive/0.1' },
        signal: AbortSignal.timeout(30_000),
      });
      if (r.status === 429) {
        const wait = Number(r.headers.get('retry-after') ?? 5) * 1000;
        await sleep(wait || 5000);
        throw new Error('rate limited');
      }
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`http ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url} failed after ${tries}: ${e.message}`);
      await sleep(1500 * i);
    }
  }
}

const shardOf = (id) => String(Number(id) % SHARDS).padStart(2, '0');

/* ---------------------------------------------------------- resume state -- */
/* Threads already archived (so a re-run continues rather than restarts). */
const shardData = new Map(); // "NN" -> { topics: { id: thread } }
const haveTopic = new Set();
if (RESUME) {
  for (let n = 0; n < SHARDS; n++) {
    const nn = String(n).padStart(2, '0');
    const f = new URL(`t-${nn}.json`, OUT);
    if (existsSync(f)) {
      const j = JSON.parse(readFileSync(f, 'utf8'));
      shardData.set(nn, j);
      for (const id of Object.keys(j.topics ?? {})) haveTopic.add(Number(id));
    }
  }
  console.log(`resume: ${haveTopic.size} topics already archived`);
}
const putThread = (thread) => {
  const nn = shardOf(thread.id);
  if (!shardData.has(nn)) shardData.set(nn, { topics: {} });
  shardData.get(nn).topics[thread.id] = thread;
};
const flushShards = () => {
  for (let n = 0; n < SHARDS; n++) {
    const nn = String(n).padStart(2, '0');
    const j = shardData.get(nn) ?? { topics: {} };
    writeFileSync(new URL(`t-${nn}.json`, OUT), JSON.stringify(j));
  }
};

/* ------------------------------------------------------------ categories -- */
const catsRaw = await getJson(`${BASE}/categories.json`);
const categories = (catsRaw?.category_list?.categories ?? []).map((c) => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  color: c.color,
  description: c.description_text ?? null,
  topicCount: c.topic_count,
  postCount: c.post_count,
}));
console.log(`${categories.length} categories, ${categories.reduce((n, c) => n + c.topicCount, 0)} topics total`);

/* -------------------------------------------------------------- one topic -- */
async function importTopic(t) {
  if (haveTopic.has(t.id)) return null;
  const head = await getJson(`${BASE}/t/${t.id}.json`);
  if (!head) return null;
  const ps = head.post_stream ?? {};
  const stream = ps.stream ?? [];
  const byNum = new Map();
  for (const p of ps.posts ?? []) byNum.set(p.id, p);
  // fetch the posts not in the first page, 20 ids at a time
  const missing = stream.filter((id) => !byNum.has(id));
  for (let i = 0; i < missing.length; i += 20) {
    const ids = missing.slice(i, i + 20);
    const qs = ids.map((id) => `post_ids[]=${id}`).join('&');
    const more = await getJson(`${BASE}/t/${t.id}/posts.json?${qs}`);
    for (const p of more?.post_stream?.posts ?? []) byNum.set(p.id, p);
    await sleep(200);
  }
  const posts = stream
    .map((id) => byNum.get(id))
    .filter(Boolean)
    .map((p) => ({
      postNumber: p.post_number,
      username: p.username ?? null,
      name: p.name ?? null,
      createdAt: p.created_at ?? null,
      cooked: p.cooked ?? '',
      replyTo: p.reply_to_post_number ?? null,
      avatar: p.avatar_template ?? null,
    }));
  return {
    id: t.id,
    title: t.title,
    slug: t.slug,
    categoryId: t.category_id,
    createdAt: t.created_at ?? null,
    posts,
  };
}

/* ----------------------------------------------------- walk each category -- */
const indexTopics = [];
let done = 0;
for (const cat of categories) {
  for (let page = 0; ; page++) {
    const listing = await getJson(`${BASE}/c/${cat.slug}/${cat.id}.json?page=${page}`);
    const topics = listing?.topic_list?.topics ?? [];
    if (!topics.length) break;
    for (const t of topics) {
      const poster = (t.posters ?? [])[0];
      indexTopics.push({
        id: t.id,
        title: t.title,
        slug: t.slug,
        categoryId: cat.id,
        categorySlug: cat.slug,
        postsCount: t.posts_count,
        replyCount: t.reply_count,
        views: t.views,
        likeCount: t.like_count,
        createdAt: t.created_at,
        lastPostedAt: t.last_posted_at,
        pinned: !!t.pinned,
        closed: !!t.closed,
        tags: t.tags ?? [],
      });
      // On a --resume refresh, existing threads stay as archived; skip the fetch
      // AND the rate-limit sleep so only genuinely new topics cost time.
      if (haveTopic.has(t.id)) continue;
      try {
        const thread = await importTopic(t);
        if (thread) {
          putThread(thread);
          done += 1;
          if (done % 25 === 0) {
            process.stdout.write(`\r  ${cat.slug}: archived ${done} threads   `);
            flushShards(); // checkpoint
          }
        }
      } catch (e) {
        console.log(`\n  topic ${t.id} failed: ${String(e.message).slice(0, 60)}`);
      }
      await sleep(220);
    }
    if (SAMPLE) break; // one page per category in sample mode
    if (!listing.topic_list.more_topics_url) break;
  }
  console.log(`\r  ${cat.slug}: done (${done} total)          `);
  if (SAMPLE) break;
}

flushShards();

/* attach the first-post author to each index row from the shards we built */
const authorOf = (id) => {
  const th = shardData.get(shardOf(id))?.topics?.[id];
  const p0 = th?.posts?.[0];
  return p0 ? { username: p0.username, name: p0.name, avatar: p0.avatar } : null;
};
for (const row of indexTopics) row.author = authorOf(row.id);

writeFileSync(
  new URL('forum-index.json', OUT),
  JSON.stringify({
    $v: 1,
    generatedAt: new Date().toISOString(),
    source: 'forum.polkadot.network (Discourse) — read-only archive, original authors credited, not masks',
    categories,
    topics: indexTopics,
  }),
);

console.log(`\ndone: ${indexTopics.length} topics indexed, ${done} threads archived across ${SHARDS} shards`);
console.log('wrote public/forum-index.json + public/t-00..63.json');
