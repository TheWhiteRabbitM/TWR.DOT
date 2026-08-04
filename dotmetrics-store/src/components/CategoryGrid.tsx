import { motion } from 'framer-motion';
import {
  Code2, Layout, Gamepad2, Shield, Atom, Globe, Database, Sparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';

interface Category {
  id: string;
  name: string;
  icon: ReactNode;
  count: number;
}

const categories: Category[] = [
  { id: 'all', name: 'All Apps', icon: <Sparkles size={22} />, count: 72 },
  { id: 'published', name: 'Published', icon: <Layout size={22} />, count: 27 },
  { id: 'deployed', name: 'Deployed', icon: <Code2 size={22} />, count: 34 },
  { id: 'name', name: 'Name Only', icon: <Globe size={22} />, count: 11 },
  { id: 'declared', name: 'Contracts', icon: <Database size={22} />, count: 1 },
  { id: 'executable', name: 'Executables', icon: <Gamepad2 size={22} />, count: 20 },
  { id: 'secure', name: 'Verified', icon: <Shield size={22} />, count: 27 },
  { id: 'new', name: 'Recent', icon: <Atom size={22} />, count: 0 },
];

interface CategoryGridProps {
  onSelect: (category: string) => void;
  active: string;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
} as const;

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } },
} as const;

export default function CategoryGrid({ onSelect, active }: CategoryGridProps) {
  return (
    <section className="as-section-wrapper">
      <div className="as-section-inner">
        <motion.span
          className="as-section-label"
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          Browse by Category
        </motion.span>
        <motion.h2
          className="as-section-heading"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          Discover by category
        </motion.h2>
        <motion.p
          className="as-section-desc"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.15 }}
        >
          Find exactly what you're looking for across the .dot ecosystem
        </motion.p>
        <motion.div
          className="as-cat-grid"
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-40px' }}
        >
          {categories.map((cat) => (
            <motion.div
              key={cat.id}
              className="as-cat-card"
              variants={item}
              onClick={() => onSelect(cat.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(cat.id); } }}
              style={active === cat.id ? { borderColor: '#007AFF', boxShadow: '0 0 0 2px rgba(0,122,255,0.2)' } : {}}
            >
              <div className="as-cat-icon">
                {cat.icon}
              </div>
              <div className="as-cat-name">{cat.name}</div>
              <div className="as-cat-count">{cat.count} apps</div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
