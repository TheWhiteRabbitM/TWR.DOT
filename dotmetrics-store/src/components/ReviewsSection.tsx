import { motion } from 'framer-motion';
import { Star } from 'lucide-react';

const reviews = [
  {
    text: "The .dot ecosystem is incredibly promising. This directory makes it easy to discover what's being built and find tools I never knew existed.",
    name: 'Alex Chen',
    role: 'Blockchain Developer',
    initials: 'AC',
  },
  {
    text: "A beautifully curated collection of decentralized applications. The transparency of on-chain data for each app gives me confidence in what I'm exploring.",
    name: 'Sarah Williams',
    role: 'Product Designer',
    initials: 'SW',
  },
  {
    text: "Having a searchable, attributed directory of .dot apps changes everything. No more digging through block explorers to find what's actually live.",
    name: 'Marcus Johnson',
    role: 'Web3 Researcher',
    initials: 'MJ',
  },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.12 },
  },
};

const item = {
  hidden: { opacity: 0, y: 30 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: 'easeOut' as const },
  },
} as const;

export default function ReviewsSection() {
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
          Testimonials
        </motion.span>
        <motion.h2
          className="as-section-heading"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          What the community says
        </motion.h2>
        <motion.p
          className="as-section-desc"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.15 }}
        >
          Hear from developers and users exploring the .dot ecosystem
        </motion.p>
        <motion.div
          className="as-reviews-grid"
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-40px' }}
        >
          {reviews.map((r, i) => (
            <motion.div key={i} className="as-review-card" variants={item}>
              <div className="as-review-stars">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star key={j} size={16} fill="#FF9F0A" stroke="none" />
                ))}
              </div>
              <p className="as-review-text">"{r.text}"</p>
              <div className="as-review-author">
                <div className="as-review-avatar">{r.initials}</div>
                <div>
                  <div className="as-review-name">{r.name}</div>
                  <div className="as-review-role">{r.role}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
