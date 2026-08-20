import { useEffect, useState } from 'react';
import type { ForumIndex, ArchiveThread, ArchivePost, LivePost } from './chain';
import { profileOfMask, categoryKeyOf } from './chain';
import { getSigner, like as likeTx, reply as replyTx, type Signer } from './forum';
import { avatarUrl, initials, fmtDate, sanitize, stripModeration, isPolicyTopic } from './ui';
import { hiddenReason, muteMask, unmuteMask } from './filters';
import { WritingCheck } from './WritingCheck';
import { textOf } from './aicheck';
import { hrefHome, hrefCategory, hrefNew, MaskAvatar } from './App';

/**
 * One thread — imported (read-only, original author credited) or live (written
 * by masks, likeable and replyable). Same Discourse post layout for both:
 * avatar left, name + time, body, actions under.
 */
export function Thread({
  index,
  kind,
  archive,
  live,
}: {
  index: ForumIndex;
  kind: 'a' | 'l';
  archive: ArchiveThread | null;
  live: { topic: LivePost; replies: LivePost[] } | null;
}) {
  if (kind === 'a' && !archive) return <div className="panel err">This archived topic was not found in the bundle.</div>;
  if (kind === 'l' && !live) return <div className="panel err">This on-chain topic was not found (or was removed).</div>;

  const cat =
    kind === 'a'
      ? index.categories.find((c) => c.id === archive!.categoryId)
      : index.categories.find(
          (c) => categoryKeyOf(c.slug).toLowerCase() === live!.topic.categoryKey.toLowerCase(),
        );
  const title = kind === 'a' ? archive!.title : live!.topic.title;

  return (
    <>
      <div className="crumb">
        <a href={hrefHome}>Home</a> <span>›</span>{' '}
        {cat ? (
          <>
            <span className="cat-badge sm" style={{ background: `#${cat.color || '888'}` }} />{' '}
            <a href={hrefCategory(cat.slug)}>{cat.name}</a>
          </>
        ) : (
          'on-chain'
        )}
      </div>
      <h1 className="thread-title">
        {title}
        {kind === 'l' ? <em className="livechip">on-chain</em> : null}
      </h1>

      {kind === 'a' ? (
        <>
          <div className="archive-note">
            This thread came over from forum.polkadot.network. The original names are kept and it
            reads the way it did there. You can&apos;t reply to it here; it stays as a record. Want a
            conversation people can actually join? Start a fresh <a href={hrefNew(cat?.slug)}>topic on chain</a>.
          </div>
          {archive!.posts.map((p) => (
            <ArchivePostCard key={p.postNumber} p={p} policy={isPolicyTopic(archive!.title)} />
          ))}
        </>
      ) : (
        <LiveThreadBody topic={live!.topic} replies={live!.replies} />
      )}
    </>
  );
}

/* --------------------------------------------------------- archive post -- */
function ArchivePostCard({ p, policy }: { p: ArchivePost; policy: boolean }) {
  const name = p.name || p.username || 'unknown';
  const av = avatarUrl(p.avatar);
  const html = sanitize(policy ? stripModeration(p.cooked) : p.cooked);
  return (
    <article className={`post ${p.replyTo ? 'reply' : ''}`}>
      <div className="post-avatar">
        {av ? <img src={av} alt="" loading="lazy" decoding="async" /> : <span className="ini">{initials(name)}</span>}
      </div>
      <div className="post-body">
        <div className="post-head">
          <span className="post-name">{name}</span>
          {p.username && p.name ? <span className="post-handle">@{p.username}</span> : null}
          <span className="post-when">{fmtDate(p.createdAt)}</span>
        </div>
        <div className="cooked" dangerouslySetInnerHTML={{ __html: html }} />
        <div className="post-actions">
          <WritingCheck id={`a-${p.postNumber}-${(p.username ?? '')}`} text={textOf(p.cooked)} when={p.createdAt} />
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------ live post -- */
function LiveThreadBody({ topic, replies }: { topic: LivePost; replies: LivePost[] }) {
  const [posts, setPosts] = useState<LivePost[]>([topic, ...replies]);
  return (
    <>
      {posts.map((p, i) => (
        <LivePostCard key={p.id} p={p} isTopic={i === 0} />
      ))}
      <ReplyBox
        topicId={topic.id}
        onPosted={(np) => setPosts((cur) => [...cur, np])}
      />
    </>
  );
}

function LivePostCard({ p, isTopic }: { p: LivePost; isTopic: boolean }) {
  const [name, setName] = useState(`mask #${p.mask}`);
  const [verified, setVerified] = useState('');
  const [likes, setLikes] = useState(p.likes);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(() => hiddenReason({ mask: p.mask, title: p.title, body: p.body }));
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    profileOfMask(p.mask).then((pr) => {
      if (pr) {
        setName(pr.displayName);
        setVerified(pr.verified);
      }
    });
  }, [p.mask]);

  async function onLike() {
    setBusy(true);
    try {
      const s = await getSigner(true);
      if (typeof s === 'string') {
        alert(signerHint(s));
        return;
      }
      await likeTx(s, p.id);
      setLikes((n) => n + 1);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Collapsed, never removed: the post is still on chain and one click away.
  if (muted && !peek) {
    return (
      <div className={`post-muted ${isTopic ? '' : 'reply'}`}>
        <span className="na">Hidden — {muted}.</span>
        <button className="linkbtn" onClick={() => setPeek(true)}>
          Show anyway
        </button>
        <button
          className="linkbtn"
          onClick={() => {
            unmuteMask(p.mask);
            setMuted(null);
          }}
        >
          Unmute
        </button>
      </div>
    );
  }

  return (
    <article className={`post ${isTopic ? '' : 'reply'}`}>
      <div className="post-avatar">
        <MaskAvatar mask={p.mask} />
      </div>
      <div className="post-body">
        <div className="post-head">
          <span className="post-name">{name}</span>
          {verified ? <span className="verified" title="proven .dot name">{verified}.dot ✓</span> : null}
          <span className="post-handle">mask #{p.mask.toString()}</span>
          <span className="post-when">{new Date(p.time * 1000).toLocaleDateString()}</span>
          {p.edited ? <span className="edited">· edited</span> : null}
        </div>
        <div className="cooked plain">{p.body}</div>
        <div className="post-actions">
          <button className="act" disabled={busy} onClick={onLike}>
            ♥ {likes}
          </button>
          <WritingCheck id={`l-${p.id}`} text={p.body} when={new Date(p.time * 1000).toISOString()} />
          <button
            className="act"
            title="hide posts from this mask, for you only"
            onClick={() => {
              muteMask(p.mask);
              setMuted(`muted mask #${p.mask}`);
              setPeek(false);
            }}
          >
            ⃠ mute
          </button>
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------- reply box -- */
function ReplyBox({ topicId, onPosted }: { topicId: number; onPosted: (p: LivePost) => void }) {
  const [signer, setSigner] = useState<Signer | 'nohost' | 'nowallet' | 'nomask' | 'timeout' | 'checking' | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const connect = (fresh = false) => {
    setSigner('checking');
    getSigner(fresh)
      .then(setSigner)
      .catch(() => setSigner('timeout'));
  };
  useEffect(() => {
    connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (typeof signer === 'string' || !signer) return;
    setBusy(true);
    setMsg(null);
    try {
      await replyTx(signer, topicId, 0, text.trim());
      onPosted({
        id: Date.now(), // optimistic local id; a refresh reads the real one
        mask: signer.mask,
        author: signer.address,
        time: Math.floor(Date.now() / 1000),
        edited: 0,
        topicId,
        replyTo: 0,
        categoryKey: '0x',
        deleted: false,
        likes: 0,
        replies: 0,
        title: '',
        body: text.trim(),
      });
      setText('');
      setMsg('reply posted on chain.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="replybox">
      {typeof signer === 'object' && signer ? (
        <>
          <div className="replybox-head">
            Reply as <MaskAvatar mask={signer.mask} imgClass="reply-pfp" /> <strong>{signer.displayName}</strong>
            {signer.verified ? <span className="verified"> {signer.verified}.dot ✓</span> : null}
          </div>
          <textarea
            value={text}
            maxLength={8000}
            placeholder="Write your reply. It goes on chain and stays there."
            onChange={(e) => setText(e.target.value)}
          />
          {text.trim().length > 220 ? (
            <div className="draft-check">
              <WritingCheck id={`draft-${topicId}-${text.length}`} text={text} />
              <span className="na">read your own draft before it becomes permanent</span>
            </div>
          ) : null}
          <div className="replybox-foot">
            <span className="na">{text.length}/8000 · nothing here gets deleted</span>
            <button className="primary" disabled={busy || text.trim().length === 0} onClick={submit}>
              {busy ? 'signing…' : 'Post reply'}
            </button>
          </div>
          {msg ? <p className="na">{msg}</p> : null}
        </>
      ) : signer === 'checking' || signer === null ? (
        <p className="na">connecting to your wallet…</p>
      ) : (
        <p className="na replyhint">
          {signerHint(signer)}{' '}
          {signer === 'timeout' || signer === 'nowallet' ? (
            <button className="linkbtn" onClick={() => connect(true)}>
              Retry
            </button>
          ) : null}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- helpers ---- */
function signerHint(s: 'nohost' | 'nowallet' | 'nomask' | 'timeout'): string {
  if (s === 'nohost') return "You'll need the Polkadot app to post here. Reading works anywhere.";
  if (s === 'nowallet') return 'Log in to connect your Polkadot identity, then you can post. Tap Retry (or "Log in to post" up top).';
  if (s === 'timeout') return "Your wallet didn't answer in time. Make sure you're logged in, then try again.";
  return 'Posting needs a Peoplebook mask. Claim one free on devnet at peoplebook.dot or chipr.dot, then reload.';
}
