import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';

interface StoreHeroProps {
  title: string;
  subtitle: string;
  exploreLabel: string;
  learnLabel: string;
  onExplore: () => void;
  onLearn: () => void;
  totalApps: number;
}

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.8, delay, ease: 'easeOut' as const } },
});

const floatDur = 20;

export default function StoreHero({ title, subtitle, exploreLabel, learnLabel, onExplore, onLearn, totalApps }: StoreHeroProps) {
  return (
    <section className="as-hero" style={{ position: 'relative', background: 'linear-gradient(180deg, #FAFAFA 0%, #FFFFFF 100%)', padding: '120px 48px 80px', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <motion.div
          animate={{ y: [0, -20, 0], opacity: [0.4, 0.6, 0.4] }}
          transition={{ duration: floatDur, repeat: Infinity, ease: 'easeInOut' }}
          style={{ position: 'absolute', top: '15%', left: '8%', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,122,255,0.08) 0%, transparent 70%)' }}
        />
        <motion.div
          animate={{ y: [0, 20, 0], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: floatDur + 5, repeat: Infinity, ease: 'easeInOut' }}
          style={{ position: 'absolute', top: '50%', right: '10%', width: 250, height: 250, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,122,255,0.06) 0%, transparent 70%)' }}
        />
        <motion.div
          animate={{ y: [0, -15, 0], opacity: [0.2, 0.4, 0.2] }}
          transition={{ duration: floatDur + 10, repeat: Infinity, ease: 'easeInOut' }}
          style={{ position: 'absolute', bottom: '20%', left: '50%', width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,122,255,0.04) 0%, transparent 70%)' }}
        />
      </div>

      <div style={{ position: 'relative', maxWidth: 1280, margin: '0 auto', textAlign: 'center' }}>
        <motion.div {...fadeUp(0)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 24 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 20, background: 'rgba(0,122,255,0.1)', color: '#007AFF', fontSize: 13, fontWeight: 600 }}>
            <Sparkles size={14} />
            {totalApps} curated apps
          </span>
        </motion.div>

        <motion.h1 {...fadeUp(0.1)} style={{ fontSize: 72, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.05, color: '#111', margin: '0 0 20px', maxWidth: 900, marginLeft: 'auto', marginRight: 'auto' }}>
          {title}
        </motion.h1>

        <motion.p {...fadeUp(0.2)} style={{ fontSize: 22, lineHeight: 1.5, color: '#666', maxWidth: 640, margin: '0 auto 40px', fontWeight: 400 }}>
          {subtitle}
        </motion.p>

        <motion.div {...fadeUp(0.3)} style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <motion.button
            onClick={onExplore}
            className="as-btn as-btn-primary"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {exploreLabel} <ArrowRight size={18} />
          </motion.button>
          <motion.button
            onClick={onLearn}
            className="as-btn as-btn-secondary"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {learnLabel}
          </motion.button>
        </motion.div>
      </div>
    </section>
  );
}
