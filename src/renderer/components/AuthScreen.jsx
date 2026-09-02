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
      <div className="auth-stage">
        <div className="auth-brand">
          <span className="auth-brand-hex" aria-hidden="true">N</span>
          <p className="auth-brand-kicker">Competitive operating system</p>
          <h1 className="auth-brand-title">Forge the<br />match.</h1>
          <p className="auth-brand-lede">
            Overlay, NexAI, tournaments, and hardware intel — one floor for the crew.
          </p>
          <ul className="auth-brand-list">
            <li>In-game overlay that stays out of the way</li>
            <li>Lobbies, brackets, and ready-up</li>
            <li>Session hardware tracked while you play</li>
          </ul>
        </div>
        <div className="auth-box">
          <div className="auth-kicker">Access</div>
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
            <div className="auth-wait">
              <div className="auth-wait-title">Waiting for browser sign in…</div>
              <div className="auth-wait-sub">Complete sign in in your browser, then return here.</div>
              <button
                className="action-btn ghost"
                type="button"
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
          <div className="auth-fineprint">Limited access · No stats saved</div>
        </div>
      </div>
    </div>
  );
}
