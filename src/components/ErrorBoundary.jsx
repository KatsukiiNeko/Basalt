import { Component } from 'react';

// Our root error boundary — main.jsx wraps everything (all three
// providers) in it, so it renders outside Theme/Language/Currency and
// cannot call t() or use a themed component: the fallback ships hardcoded
// English on plain CSS tokens. The paired note lives on .error-boundary in
// src/index.css.
//
// A render crash must never white-screen a PWA that may hold the only
// copy of a user's financial history, so the fallback stays deliberately
// minimal — one message, one Reload button — and keeps recovery (reload,
// lock, re-unlock) one tap away. Details go to console.error for
// developers; the user copy never includes error internals or any crypto
// material.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Dev diagnostics for `npm run dev` and post-mortem inspection. In the
    // production build terser's drop_console strips this (see
    // vite.config.js), so there the boundary UI below is the only
    // user-facing signal — and whatever was thrown never enters that copy,
    // only the console.
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
