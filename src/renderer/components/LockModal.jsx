import React from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';

export default function LockModal() {
  const { lockMessage, setLockMessage, signOut, showToast } = useNexForge();

  if (!lockMessage) return null;

  async function createAccount() {
    setLockMessage(null);
    // Exit guest mode and return to the sign-in screen to create an account.
    await signOut();
    if (!window.nexforge?.openAuthBrowser) {
      showToast('Browser sign in is only available in the desktop app.', 'error');
    }
  }

  return (
    <div className="lock-modal">
      <div className="lock-box">
        <div className="lock-icon">🔒</div>
        <h3>Account Required</h3>
        <p>{lockMessage}. Create a free NexForge account to unlock everything — it takes 30 seconds.</p>
        <div className="lock-actions">
          <button className="auth-btn" style={{ marginTop: 0 }} onClick={createAccount}>
            Create Free Account →
          </button>
          <button
            style={{
              padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--muted2)', fontFamily: 'var(--font)', fontSize: 13, cursor: 'pointer',
            }}
            onClick={() => setLockMessage(null)}
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
