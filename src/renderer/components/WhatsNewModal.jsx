import React, { useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { entriesSince } from '../lib/changelog.js';

const STORAGE_KEY = 'nexforge-last-seen-version';

export default function WhatsNewModal() {
  const { appVersion } = useNexForge();
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    if (!appVersion) return;
    let lastSeen = null;
    try {
      lastSeen = localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!lastSeen) {
      // Fresh install — nothing to announce, just remember this version.
      try { localStorage.setItem(STORAGE_KEY, appVersion); } catch { /* ignore */ }
      return;
    }
    if (lastSeen === appVersion) return;
    const since = entriesSince(lastSeen, appVersion);
    if (since.length) {
      setEntries(since);
    } else {
      try { localStorage.setItem(STORAGE_KEY, appVersion); } catch { /* ignore */ }
    }
  }, [appVersion]);

  if (!entries) return null;

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, appVersion); } catch { /* ignore */ }
    setEntries(null);
  }

  return (
    <div className="lock-modal">
      <div className="lock-box whatsnew-box">
        <div className="whatsnew-badge">UPDATED</div>
        <h3>What's new in v{appVersion}</h3>
        <div className="whatsnew-entries">
          {entries.map((entry) => (
            <div key={entry.version} className="whatsnew-entry">
              {entries.length > 1 && (
                <div className="whatsnew-version">v{entry.version}</div>
              )}
              <ul>
                {entry.highlights.map((h) => <li key={h}>{h}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <button className="auth-btn" style={{ marginTop: 6 }} onClick={dismiss}>
          Let's go →
        </button>
      </div>
    </div>
  );
}
