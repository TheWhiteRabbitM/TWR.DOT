import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight, Star } from 'lucide-react';
import type { AppEntry } from '../lib/types';
import { gatewayUrl } from '../lib/directory';
import { TIER_KEY, TIER_CLASS, t } from '../lib/i18n';

interface AppCardProps {
  entry: AppEntry;
  isOpen: boolean;
  onToggle: () => void;
  shot: { file: string; w: number; h: number } | null;
}

function AppIcon({ entry }: { entry: AppEntry }) {
  const mono = (entry.displayName ?? entry.id).trim().slice(0, 1) || '?';
  const src = entry.iconCid ? gatewayUrl(entry.iconCid) : null;

  return (
    <span style={{ width: 40, height: 40, flex: 'none', borderRadius: 10, background: '#f5f5f7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, color: '#666', overflow: 'hidden', textTransform: 'uppercase' }}>
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" /> : mono}
    </span>
  );
}

export default function AppCard({ entry, isOpen, onToggle, shot }: AppCardProps) {
  const title = entry.displayName ?? entry.name ?? entry.id;
  const tier = entry.tier;
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <motion.div
      layout
      className={`as-card${isOpen ? ' is-open' : ''}`}
      onClick={onToggle}
      tabIndex={0}
      role="button"
      aria-expanded={isOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      whileHover={{ y: -6, boxShadow: '0 20px 60px rgba(0,0,0,0.1)' }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {shot && (
        <div className="as-card-shot">
          {!imgLoaded && (
            <div style={{ width: '100%', height: 320, background: 'linear-gradient(180deg, #f5f5f7 0%, #e8e8ed 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid #e8e8ed', borderTopColor: '#007AFF', animation: 'spin 0.8s linear infinite' }} />
            </div>
          )}
          <motion.img
            src={`${import.meta.env.BASE_URL}${shot.file}`}
            alt=""
            width={shot.w}
            height={shot.h}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            style={{ display: imgLoaded ? 'block' : 'none' }}
          />
        </div>
      )}

      <div className="as-card-body">
        <div className="as-card-top">
          <AppIcon entry={entry} />
          <div style={{ minWidth: 0 }}>
            <div className="as-card-name">{title}</div>
            <div className="as-card-domain">{entry.domain}</div>
          </div>
        </div>

        <span className={`as-card-tier ${TIER_CLASS[tier]}`}>{t(TIER_KEY[tier])}</span>
        <div className="as-card-desc">{entry.description || (entry.read ? t(entry.tagline) : 'No manifest available')}</div>

        {entry.hasExecutable && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 12, color: '#34C759' }}>
            <Star size={12} /> Ready to use
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, opacity: 0.6, fontSize: 12, color: '#666' }}>
          <span>{entry.owner ? `${entry.owner.slice(0, 6)}…${entry.owner.slice(-4)}` : 'Unknown'}</span>
          {entry.contract && <span>· Contract</span>}
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="as-detail"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{entry.owner || 'No owner'}</span>
              <a
                href={entry.url}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 500, color: '#007AFF' }}
                onClick={(e) => e.stopPropagation()}
              >
                Open <ArrowUpRight size={14} />
              </a>
            </div>

            {entry.description && (
              <p style={{ fontSize: 14, lineHeight: 1.6, color: '#666', margin: '0 0 12px' }}>{entry.description}</p>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, fontSize: 13 }}>
              <div>
                <span style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8C8C8C', marginBottom: 4 }}>Content Hash</span>
                <span style={{ fontFamily: 'ui-monospace, monospace', color: '#666', wordBreak: 'break-all' }}>{entry.contenthash || 'None'}</span>
              </div>
              {entry.firstSeenBlock && (
                <div>
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8C8C8C', marginBottom: 4 }}>First Seen</span>
                  <span style={{ color: '#666' }}>Block #{entry.firstSeenBlock}</span>
                </div>
              )}
              <div>
                <span style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#8C8C8C', marginBottom: 4 }}>Executable</span>
                <span style={{ color: entry.hasExecutable ? '#34C759' : '#8C8C8C' }}>{entry.hasExecutable ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
