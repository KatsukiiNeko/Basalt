import { Component } from 'react';

// Root error boundary. A render crash must never white-screen a PWA that
// may hold the only copy of a user's financial history — the fallback
// keeps the vault-lock entry point reachable so recovery (reload, lock,
// re-unlock) is always one tap away. Details are logged for developers;
// the user copy never includes error internals or any crypto material.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Diagnostics only — the thrown value stays out of user-facing copy.
    console.error('[Basalt] render crash:', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h1>Something went wrong</h1>
          <p>
            Your data is safe — it is encrypted and stored on this device.
            Reloading usually fixes this.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload Basalt
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
