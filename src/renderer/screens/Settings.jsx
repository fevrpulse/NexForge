import React, { useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { COMPANION_URL } from '../lib/companion.js';
import { CHANGELOG } from '../lib/changelog.js';
import { eventToAccelerator, formatAccelerator } from '../lib/hotkeys.js';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'account', label: 'Account' },
];

function openCompanion() {
  if (window.nexforge?.openExternalUrl) {
    window.nexforge.openExternalUrl(COMPANION_URL);
  } else {
    window.open(COMPANION_URL, '_blank', 'noopener,noreferrer');
  }
}

function SettingToggle({ on, onChange, label, hint }) {
  return (
    <div className="row">
      <div>
        <div className="row-title">{label}</div>
        {hint ? <div className="row-sub">{hint}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={`setting-switch ${on ? 'on' : ''}`}
        onClick={() => onChange(!on)}
      >
        <span className="setting-switch-knob" />
      </button>
    </div>
  );
}

function KeybindRow({ label, hint, value, listening, onListen }) {
  return (
    <div className="row">
      <div>
        <div className="row-title">{label}</div>
        {hint ? <div className="row-sub">{hint}</div> : null}
      </div>
      <button
        type="button"
        className={`settings-kbd ${listening ? 'listening' : ''}`}
        onClick={onListen}
      >
        {listening ? 'Press a key…' : formatAccelerator(value)}
      </button>
    </div>
  );
}

export default function Settings() {
  const {
    profile,
    guestMode,
    appVersion,
    appPlatform,
    dndEnabled,
    setDndEnabled,
    overlayEnabled,
    setOverlayEnabled,
    clipEnabled,
    setClipEnabled,
    clipSeconds,
    setClipSeconds,
    overlayHotkeys,
    setOverlayHotkey,
    lastClipPath,
    clipStatus,
    checkForUpdates,
    signOut,
    createAccount,
    cloudOffline,
    cloudReason,
    showToast,
  } = useNexForge();
  const [tab, setTab] = useState('general');
  const [listening, setListening] = useState(null);
  const latest = CHANGELOG[0];
  const tag = profile?.gamer_tag || (guestMode ? 'Guest' : 'Player');

  useEffect(() => {
    if (!listening) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setListening(null);
        return;
      }
      const acc = eventToAccelerator(e);
      if (!acc) return;
      e.preventDefault();
      e.stopPropagation();
      setOverlayHotkey(listening, acc).then((res) => {
        setListening(null);
        if (res?.ok === false) {
          showToast(res.reason === 'could-not-register'
            ? 'Windows would not register that keybind. Try another combo.'
            : 'Could not save that keybind.', 'error');
          return;
        }
        showToast(`${listening === 'clip' ? 'Clip' : 'Overlay'} keybind set to ${formatAccelerator(acc)}`, 'success');
      });
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, setOverlayHotkey, showToast]);

  function startListen(action) {
    setListening(action);
  }

  return (
    <div>
      <div className="shop-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`shop-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <>
          <div className="card">
            <div className="card-title">App</div>
            <div className="row">
              <div>
                <div className="row-title">Version</div>
                <div className="row-sub">Installed NexForge build</div>
              </div>
              <span className="result">{appVersion ? `v${appVersion}` : '—'}</span>
            </div>
            <div className="row">
              <div>
                <div className="row-title">Platform</div>
                <div className="row-sub">Desktop runtime</div>
              </div>
              <span className="result">{appPlatform || '—'}</span>
            </div>
            <div className="row">
              <div>
                <div className="row-title">Cloud</div>
                <div className="row-sub">{cloudOffline ? (cloudReason || 'Unreachable') : 'Connected'}</div>
              </div>
              <span className="result" style={{ color: cloudOffline ? 'var(--red)' : 'var(--neon)' }}>
                {cloudOffline ? 'Offline' : 'Online'}
              </span>
            </div>
            <div className="settings-actions">
              <button type="button" className="action-btn primary" onClick={checkForUpdates}>
                Check for updates
              </button>
              {!guestMode && (
                <button type="button" className="action-btn ghost" onClick={openCompanion}>
                  Open Companion
                </button>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title">Shortcuts</div>
            <div className="row">
              <div>
                <div className="row-title">NexAI dock</div>
                <div className="row-sub">Open or close NexAI inside the app</div>
              </div>
              <span className="settings-kbd">Ctrl + Shift + A</span>
            </div>
            <div className="row">
              <div>
                <div className="row-title">Overlay HUD</div>
                <div className="row-sub">Open, edit, and close the in-game overlay</div>
              </div>
              <span className="settings-kbd">{formatAccelerator(overlayHotkeys?.overlay)}</span>
            </div>
            <div className="row">
              <div>
                <div className="row-title">Save clip</div>
                <div className="row-sub">Dump the rolling highlight buffer</div>
              </div>
              <span className="settings-kbd">{formatAccelerator(overlayHotkeys?.clip)}</span>
            </div>
          </div>

          {latest && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="card-title">What's new in v{latest.version}</div>
              <ul className="settings-notes">
                {latest.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {tab === 'overlay' && (
        <>
          <div className="card">
            <div className="card-title">In-game overlay</div>
            <SettingToggle
              on={overlayEnabled}
              onChange={setOverlayEnabled}
              label="Show overlay while you play"
              hint="Toasts for messages and calls over borderless / windowed games. Exclusive fullscreen cannot be drawn over."
            />
            <KeybindRow
              label="Open & edit overlay"
              hint="Opens the HUD so you can drag panels, talk to NexAI, and clip. Press it again to close."
              value={overlayHotkeys?.overlay}
              listening={listening === 'overlay'}
              onListen={() => startListen('overlay')}
            />
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title">Clips</div>
            <SettingToggle
              on={clipEnabled}
              onChange={setClipEnabled}
              label="Clip buffer"
              hint="Keeps the last few seconds of your screen so you can save a kill or a clutch"
            />
            <div className="row">
              <div>
                <div className="row-title">Buffer length</div>
                <div className="row-sub">
                  {clipStatus?.buffering
                    ? `Filling… ${clipStatus.readySeconds || 0}s`
                    : `Ready · last ${clipSeconds}s`}
                </div>
              </div>
              <select
                className="settings-select"
                value={clipSeconds}
                onChange={(e) => setClipSeconds(Number(e.target.value))}
              >
                {[10, 15, 20, 30].map((n) => (
                  <option key={n} value={n}>{n} seconds</option>
                ))}
              </select>
            </div>
            <KeybindRow
              label="Save clip"
              hint="Works in-game even when the HUD is closed"
              value={overlayHotkeys?.clip}
              listening={listening === 'clip'}
              onListen={() => startListen('clip')}
            />
            {lastClipPath && (
              <div className="row">
                <div>
                  <div className="row-title">Last clip</div>
                  <div className="row-sub">{String(lastClipPath).split(/[/\\]/).pop()}</div>
                </div>
              </div>
            )}
            <div className="settings-actions">
              <button
                type="button"
                className="action-btn primary"
                onClick={() => window.nexforge?.clipNow?.()}
                disabled={!clipEnabled}
              >
                Clip now
              </button>
              <button
                type="button"
                className="action-btn ghost"
                onClick={async () => {
                  const res = await window.nexforge?.openClipsFolder?.();
                  if (res?.ok === false) showToast(res.reason || 'Could not open clips folder', 'error');
                }}
              >
                Open clips folder
              </button>
            </div>
          </div>
        </>
      )}

      {tab === 'notifications' && (
        <div className="card">
          <div className="card-title">Alerts</div>
          <SettingToggle
            on={dndEnabled}
            onChange={setDndEnabled}
            label="Do Not Disturb"
            hint="Mute message sounds, call rings, and overlay toasts"
          />
          <SettingToggle
            on={overlayEnabled}
            onChange={setOverlayEnabled}
            label="In-game overlay toasts"
            hint="Pop message and call alerts over your game. Customize the HUD on the Overlay tab."
          />
        </div>
      )}

      {tab === 'account' && (
        <div className="card">
          <div className="card-title">Account</div>
          <div className="row">
            <div>
              <div className="row-title">Gamer tag</div>
              <div className="row-sub">{guestMode ? 'Guest mode — stats are not saved' : 'Signed in on this device'}</div>
            </div>
            <span className="result" style={{ color: 'var(--neon)' }}>{tag}</span>
          </div>
          <div className="settings-actions">
            {guestMode ? (
              <button type="button" className="action-btn primary" onClick={createAccount}>
                Create Account
              </button>
            ) : (
              <button type="button" className="action-btn ghost" onClick={signOut}>
                Sign out
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
