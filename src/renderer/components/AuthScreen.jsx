import React, { useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';

export default function AuthScreen() {
  const { enterGuest, showToast } = useNexForge();
  const [waiting, setWaiting] = useState(false);

  async function openAuth(mode) {
    if (!window.nexforge?.openAuthBrowser) {
      showToast('Browser sign in is only available in the desktop app.', 'error');
      return;
    }
    setWaiting(true);
    try {
      await window.nexforge.openAuthBrowser(mode);
    } catch (err) {
      setWaiting(false);
      showToast(err?.message || 'Could not open browser sign in.', 'error');
    }
  }

  return (
    <div id="auth-screen">
      <div className="auth-grid" />
      <div className="auth-glow" />
      <div className="auth-box">
        <div className="auth-logo">Nex<span>Forge</span></div>
        <div className="auth-tagline">// COMPETE · DOMINATE · FORGE YOUR LEGACY</div>

        <button className="auth-btn" onClick={() => openAuth('login')} disabled={waiting}>
          Sign In in Browser →
        </button>
        <button
          className="auth-btn"
          style={{ marginTop: 10, background: 'transparent', color: 'var(--text)', border: '1px solid var(--border2)' }}
          onClick={() => openAuth('signup')}
          disabled={waiting}
        >
          Create Account in Browser
        </button>

        {waiting && (
          <div style={{ marginTop: 18, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--neon)' }}>
              Waiting for browser sign in...
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted2)', marginTop: 6 }}>
              Complete sign in in your browser, then return here.
            </div>
          </div>
        )}

        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 10, letterSpacing: 1 }}>
            OR
          </div>
          <button
            onClick={enterGuest}
            style={{
              width: '100%', padding: 11, borderRadius: 8, border: '1px solid var(--border2)',
              background: 'transparent', color: 'var(--muted2)', fontFamily: 'var(--font)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Browse as Guest
          </button>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>
            Limited access · No stats saved
          </div>
        </div>
      </div>
    </div>
  );
}
