import { useEffect, useState } from 'react';
import type { ForumIndex } from './chain';
import { getSigner, createTopic, type Signer } from './forum';
import { hrefHome, hrefCategory } from './App';

/**
 * Open a new topic — the only "create" surface, and it needs a mask. The body
 * is stored on chain (chirp's method: no server, no Bulletin, nothing to
 * expire), immutable, with no moderator to remove it.
 */
export function Composer({ index, slug }: { index: ForumIndex; slug?: string }) {
  const [signer, setSigner] = useState<Signer | 'nohost' | 'nowallet' | 'nomask' | 'timeout' | 'checking' | null>(null);
  const [cat, setCat] = useState(slug ?? index.categories[0]?.slug ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [doneCat, setDoneCat] = useState<string | null>(null);

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
    if (typeof signer !== 'object' || !signer) return;
    setBusy(true);
    setMsg(null);
    try {
      await createTopic(signer, cat, title.trim(), body.trim());
      setDoneCat(cat);
      setMsg('Topic created on chain.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (doneCat) {
    return (
      <div className="panel ok">
        <h2>Your topic is on chain ✓</h2>
        <p>It is signed by your mask and it stays. No one can take it down.</p>
        <a className="primary" href={hrefCategory(doneCat)}>
          View it in {index.categories.find((c) => c.slug === doneCat)?.name ?? doneCat}
        </a>
      </div>
    );
  }

  return (
    <div className="composer">
      <div className="crumb">
        <a href={hrefHome}>Home</a> <span>›</span> New Topic
      </div>
      <h1>Open a new topic</h1>

      {typeof signer === 'object' && signer ? (
        <p className="posting-as">
          Posting as <strong>🎭 {signer.displayName}</strong>
          {signer.verified ? <span className="verified"> {signer.verified}.dot ✓</span> : null} — mask #
          {signer.mask.toString()}
        </p>
      ) : signer === 'checking' || signer === null ? (
        <p className="na">connecting to your wallet…</p>
      ) : (
        <div className="panel warn">
          {maskHint(signer)}{' '}
          {signer === 'timeout' || signer === 'nowallet' ? (
            <button className="linkbtn" onClick={() => connect(true)}>
              Retry
            </button>
          ) : null}
        </div>
      )}

      <label className="field">
        <span>Category</span>
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          {index.categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Title</span>
        <input
          type="text"
          value={title}
          maxLength={300}
          placeholder="A clear, specific title"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className="field">
        <span>Body</span>
        <textarea
          value={body}
          maxLength={8000}
          rows={12}
          placeholder="Write your post. It goes on chain and stays there."
          onChange={(e) => setBody(e.target.value)}
        />
        <span className="na">{body.length}/8000</span>
      </label>

      <div className="composer-foot">
        <span className="na">Signed by your mask. Once it is up, only you can change it.</span>
        <button
          className="primary"
          disabled={busy || typeof signer !== 'object' || !title.trim() || !body.trim()}
          onClick={submit}
        >
          {busy ? 'signing…' : 'Create topic'}
        </button>
      </div>
      {msg ? <p className="na">{msg}</p> : null}
    </div>
  );
}

function maskHint(s: 'nohost' | 'nowallet' | 'nomask' | 'timeout'): string {
  if (s === 'nohost') return "You'll need the Polkadot app to post here. Reading works anywhere.";
  if (s === 'nowallet') return 'Log in to connect your Polkadot identity, then you can post. Tap Retry (or "Log in to post" up top).';
  if (s === 'timeout') return "Your wallet didn't answer in time. Make sure you're logged in, then try again.";
  return 'Posting needs a Peoplebook mask. Claim one free on devnet at peoplebook.dot or chipr.dot, then reload.';
}
