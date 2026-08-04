import { ExternalLink, Globe, Heart } from 'lucide-react';

interface StoreFooterProps {
  sourceText: React.ReactNode;
  note: string;
}

export default function StoreFooter({ sourceText, note }: StoreFooterProps) {
  return (
    <footer className="as-prem-footer">
      <div className="as-prem-footer-inner">
        <div className="as-prem-footer-grid">
          <div>
            <h3 className="as-prem-footer-brand">dot-store</h3>
            <p className="as-prem-footer-desc">
              The premier directory of the .dot ecosystem. Every app is discovered on-chain,
              verified through blockchain data, and presented with full transparency.
            </p>
            <div className="as-prem-footer-social">
              <a href="https://github.com" target="_blank" rel="noreferrer" aria-label="GitHub">
                <ExternalLink size={18} />
              </a>
              <a href="https://polkadot.network" target="_blank" rel="noreferrer" aria-label="Polkadot">
                <Globe size={18} />
              </a>
            </div>
          </div>
          <div>
            <h4 className="as-prem-footer-col-title">Explore</h4>
            <ul className="as-prem-footer-links">
              <li><a href="#">All Apps</a></li>
              <li><a href="#">Published</a></li>
              <li><a href="#">Deployed</a></li>
              <li><a href="#">New This Week</a></li>
              <li><a href="#">Categories</a></li>
            </ul>
          </div>
          <div>
            <h4 className="as-prem-footer-col-title">Resources</h4>
            <ul className="as-prem-footer-links">
              <li><a href="#">Documentation</a></li>
              <li><a href="#">API</a></li>
              <li><a href="#">Submit an App</a></li>
              <li><a href="#">Status</a></li>
              <li><a href="#">Changelog</a></li>
            </ul>
          </div>
          <div>
            <h4 className="as-prem-footer-col-title">Legal</h4>
            <ul className="as-prem-footer-links">
              <li><a href="#">Privacy</a></li>
              <li><a href="#">Terms</a></li>
              <li><a href="#">License</a></li>
              <li><a href="#">Contact</a></li>
            </ul>
          </div>
        </div>
        <hr className="as-prem-footer-divider" />
        <div className="as-prem-footer-bottom">
          <span className="as-prem-footer-copy">
            {sourceText}
          </span>
          <span className="as-prem-footer-copy" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {note} <Heart size={12} />
          </span>
        </div>
      </div>
    </footer>
  );
}
