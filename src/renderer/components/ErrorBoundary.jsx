import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Renderer crash:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-screen">
        <div className="crash-box">
          <div className="auth-logo">Nex<span>Forge</span></div>
          <h3>Something went wrong</h3>
          <p>
            The app hit an unexpected error. Your account and stats are safe —
            reload to keep playing.
          </p>
          <div className="crash-detail">{String(this.state.error?.message || this.state.error)}</div>
          <button className="auth-btn" onClick={() => window.location.reload()}>
            Reload NexForge
          </button>
        </div>
      </div>
    );
  }
}
