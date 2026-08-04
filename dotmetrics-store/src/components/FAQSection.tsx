import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus } from 'lucide-react';

const faqs = [
  {
    q: 'What is the .dot ecosystem?',
    a: 'The .dot ecosystem is a collection of decentralized applications built on the Polkadot blockchain. These apps range from simple name registrations to fully published applications with on-chain manifests, executable bundles, and smart contract integrations.',
  },
  {
    q: 'How are apps indexed and verified?',
    a: 'Apps are discovered by scanning Asset Hub blocks for .dot name registrations. Each app is verified through on-chain data: its registration block, owner address, content hash, manifest records, and live contract state can all be inspected directly from the blockchain.',
  },
  {
    q: 'What do the tiers mean?',
    a: 'Tiers indicate what on-chain data exists for an app. Tier 0 (Published) apps have a readable manifest record. Tier 1 (Deployed) apps have a content hash but no manifest. Tier 2 (Name Only) apps are registered but have no additional records yet. Each tier represents increasing levels of commitment.',
  },
  {
    q: 'Can I submit my own .dot app?',
    a: 'Yes! Any .dot name registered on Asset Hub is automatically discovered by the indexer. To ensure your app appears with its full metadata, publish a manifest record and optionally declare a contract address. The indexer picks up new registrations in near real-time.',
  },
  {
    q: 'Is the data updated in real time?',
    a: 'The directory is updated by an hourly indexer that scans new blocks. A live tail connection provides near-real-time updates for new registrations and blocks. Liveness probes run periodically to check if deployed bundles are still serving content.',
  },
  {
    q: 'How is this different from a traditional app store?',
    a: 'Unlike traditional stores, there is no centralized review process or gatekeeping. Any valid .dot name is included. The quality signal comes from on-chain transparency: you can inspect an app\'s full history, its contract state, and its owner\'s other projects directly from the blockchain.',
  },
];

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

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
          FAQ
        </motion.span>
        <motion.h2
          className="as-section-heading"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          style={{ marginBottom: 48 }}
        >
          Frequently asked questions
        </motion.h2>
        <motion.div
          className="as-faq-list"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          style={{ margin: '0 auto' }}
        >
          {faqs.map((faq, i) => (
            <motion.div
              key={i}
              className={`as-faq-item${openIndex === i ? ' is-open' : ''}`}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.05 }}
            >
              <button
                className="as-faq-question"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                aria-expanded={openIndex === i}
              >
                <span>{faq.q}</span>
                <span className="as-faq-icon"><Plus size={20} /></span>
              </button>
              <AnimatePresence>
                {openIndex === i && (
                  <motion.div
                    className="as-faq-answer"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
                  >
                    {faq.a}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
