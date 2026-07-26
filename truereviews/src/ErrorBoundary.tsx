import { Component, type ReactNode } from 'react';

/**
 * Last line of defence: inside the host shell an uncaught render error used to
 * kill the app with a blank screen and no explanation. This catches it, says
 * what happened, and offers a reload — a crash must never be silent again.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '48px 24px', textAlign: 'center', fontFamily: 'inherit' }}>
          <div style={{ fontSize: 44 }}>🫤</div>
          <h2 style={{ margin: '10px 0 6px', fontSize: 19 }}>Something broke</h2>
          <p style={{ margin: '0 0 6px', opacity: 0.7, fontSize: 14 }}>{this.state.error}</p>
          <p style={{ margin: '0 0 18px', opacity: 0.5, fontSize: 12 }}>
            If this happened inside the Polkadot app, it is most likely a sandbox restriction.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              border: 'none',
              borderRadius: 12,
              padding: '12px 22px',
              fontSize: 16,
              fontWeight: 600,
              background: '#0a84ff',
              color: '#fff',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
