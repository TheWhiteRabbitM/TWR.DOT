import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

export default function NewsletterSection() {
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setSubscribed(true);
      setEmail('');
    }
  };

  return (
    <section className="as-section-wrapper">
      <div className="as-section-inner">
        <motion.div
          className="as-newsletter"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <div className="as-newsletter-content">
            {subscribed ? (
              <>
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.4 }}
                >
                  <h3 className="as-newsletter-title" style={{ color: '#34C759' }}>You're subscribed!</h3>
                  <p className="as-newsletter-desc">
                    Thank you for joining. We'll keep you updated on the latest additions to the .dot ecosystem.
                  </p>
                </motion.div>
              </>
            ) : (
              <>
                <h3 className="as-newsletter-title">Stay in the loop</h3>
                <p className="as-newsletter-desc">
                  Get notified about new apps, ecosystem updates, and platform improvements.
                  No spam — we respect your inbox.
                </p>
                <form className="as-newsletter-form" onSubmit={handleSubmit}>
                  <input
                    className="as-newsletter-input"
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    aria-label="Email for newsletter"
                  />
                  <motion.button
                    type="submit"
                    className="as-newsletter-btn"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Subscribe <ArrowRight size={18} />
                  </motion.button>
                </form>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
