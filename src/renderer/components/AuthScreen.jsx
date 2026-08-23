import React, { useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';

const WAIT_MS = 5 * 60 * 1000;

export default function AuthScreen() {
  const { enterGuest, showToast } = useNexForge();
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!waiting) return undefined;
    const t = setTimeout(() => {
      setWaiting(false);
      showToast('Sign in timed out. Open the browser again when you are ready.', 'error');
    }, WAIT_MS);
    return () => clearTimeout(t);
  }, [waiting, showToast]);

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
        <div className="auth-kicker">Competitive OS</div>
        <div className="auth-logo">Nex<span>Forge</span></div>
        <div className="auth-tagline">// COMPETE · DOMINATE · FORGE YOUR LEGACY</div>

        <button className="auth-btn" onClick={() => openAuth('login')} disabled={waiting}>
          Sign in with Browser →
        </button>
        <button
          className="auth-btn ghost"
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
            <button
              className="action-btn ghost"
              style={{ marginTop: 12, padding: '8px 14px', fontSize: 12 }}
              onClick={() => setWaiting(false)}
            >
              Cancel
            </button>
          </div>
        )}

        <div className="auth-or">or</div>
        <button
          type="button"
          className="auth-guest-btn"
          onClick={enterGuest}
          disabled={waiting}
        >
          Browse as Guest
        </button>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>
          Limited access · No stats saved
        </div>
      </div>
    </div>
  );
}
