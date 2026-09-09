import React, { useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { useVoiceCall } from '../components/VoiceCallOverlay.jsx';
import { COMPANION_URL } from '../lib/companion.js';
import { CHANGELOG } from '../lib/changelog.js';
import { eventToAccelerator, formatAccelerator } from '../lib/hotkeys.js';
import { getPreference, setPreference, activeTier, resetProbe, TIER_LABELS, TIER_HINTS } from '../lib/fx.js';
import {
  getAppPrefs,
  setAppPref,
  HOME_SCREENS,
  TOAST_MS_OPTIONS,
} from '../lib/app-prefs.js';
import { saveHwScan } from '../lib/optimize.js';

const FX_OPTIONS = ['auto', 'max', 'high', 'balanced', 'low'];

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'voice', label: 'Voice' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'account', label: 'Account' },
  { id: 'about', label: 'About' },
];

const DESK_DEFAULTS = {
  launchAtLogin: false,
  closeToTray: true,
  startMinimized: false,
  minimizeToTray: false,
  trackingEnabled: true,
  autoCheckUpdates: true,
};

function openUrl(url) {
  if (window.nexforge?.openExternalUrl) {
    window.nexforge.openExternalUrl(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
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

function SelectRow({ label, hint, value, onChange, options }) {
  return (
    <div className="row">
      <div>
        <div className="row-title">{label}</div>
        {hint ? <div className="row-sub">{hint}</div> : null}
      </div>
      <select className="settings-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
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
    applyOverlayPrefs,
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
  const voice = useVoiceCall();
  const [tab, setTab] = useState('general');
  const [listening, setListening] = useState(null);
  const [fxPref, setFxPref] = useState(() => getPreference());
  const [fxActive, setFxActive] = useState(() => activeTier());
  const [gameBoostOn, setGameBoostOn] = useState(true);
  const [hudExtras, setHudExtras] = useState({
    statusStrip: true,
    crosshair: false,
    crosshairStyle: 'cross',
    stripPosition: 'bottom',
    hudOpacity: 92,
  });
  const [prefs, setPrefs] = useState(() => getAppPrefs());
  const [desk, setDesk] = useState(DESK_DEFAULTS);
  const [probeDraft, setProbeDraft] = useState(() => getAppPrefs().pingProbeHost || '');
  const [micInputs, setMicInputs] = useState([]);
  const [speakers, setSpeakers] = useState([]);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const latest = CHANGELOG[0];
  const tag = profile?.gamer_tag || (guestMode ? 'Guest' : 'Player');
  const win = appPlatform === 'win32' || String(appPlatform || '').toLowerCase().includes('win');

  function patchPref(key, value) {
    const next = setAppPref(key, value);
    setPrefs(next);
    return next;
  }

  function patchDesk(patch) {
    setDesk((cur) => ({ ...cur, ...patch }));
    window.nexforge?.setDesktopPrefs?.(patch)
      .then((saved) => {
        if (saved) setDesk(saved);
        showToast('Saved', 'success');
      })
      .catch(() => showToast('Could not save that setting', 'error'));
  }

  function patchHud(patch) {
    setHudExtras((cur) => ({ ...cur, ...patch }));
    applyOverlayPrefs(patch)
      .then((saved) => {
        if (saved) {
          setHudExtras((cur) => ({
            ...cur,
            statusStrip: saved.statusStrip !== false,
            crosshair: !!saved.crosshair,
            crosshairStyle: saved.crosshairStyle || cur.crosshairStyle,
            stripPosition: saved.stripPosition === 'top' ? 'top' : 'bottom',
            hudOpacity: Number(saved.hudOpacity) || cur.hudOpacity,
          }));
        }
        showToast('Saved', 'success');
      })
      .catch(() => showToast('Could not save that setting', 'error'));
  }

  useEffect(() => {
    window.nexforge?.getGameBoostPrefs?.()
      .then((p) => {
        if (typeof p?.enabled === 'boolean') setGameBoostOn(p.enabled);
      })
      .catch(() => {});
    window.nexforge?.getDesktopPrefs?.()
      .then((p) => {
        if (p) setDesk((cur) => ({ ...cur, ...p }));
      })
      .catch(() => {});
    window.nexforge?.getOverlayPrefs?.()
      .then((p) => {
        if (!p) return;
        setHudExtras({
          statusStrip: p.statusStrip !== false,
          crosshair: !!p.crosshair,
          crosshairStyle: p.crosshairStyle || 'cross',
          stripPosition: p.stripPosition === 'top' ? 'top' : 'bottom',
          hudOpacity: Number(p.hudOpacity) || 92,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!listening) return undefined;
    let captured = false;
    function onKey(e) {
      if (captured || e.repeat) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        captured = true;
        setListening(null);
        return;
      }
      const acc = eventToAccelerator(e);
      if (!acc) return;
      e.preventDefault();
      e.stopPropagation();
      captured = true;
      const action = listening;
      setListening(null);
      setOverlayHotkey(action, acc).then((res) => {
        const labels = { clip: 'Clip', overlay: 'Overlay', nexai: 'NexAI' };
        if (res?.ok === false) {
          const reasons = {
            'could-not-register': 'Windows would not register that keybind. Try another combo.',
            conflict: 'That combo is already used by another NexForge keybind.',
          };
          showToast(reasons[res.reason] || 'Could not save that keybind.', 'error');
          return;
        }
        const saved = res?.accelerator || acc;
        showToast(`${labels[action] || 'Keybind'} set to ${formatAccelerator(saved)}`, 'success');
      });
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, setOverlayHotkey, showToast]);

  useEffect(() => {
    if (tab !== 'voice') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* permission prompt — still list unnamed devices */
      }
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setMicInputs(all.filter((d) => d.kind === 'audioinput'));
        setSpeakers(all.filter((d) => d.kind === 'audiooutput'));
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [tab]);

  function startListen(action) {
    setListening(action);
  }

  function chooseFx(pref) {
    resetProbe();
    const tier = setPreference(pref);
    setFxPref(pref);
    setFxActive(tier);
    showToast(
      pref === 'auto'
        ? `Visual effects on Auto — using ${TIER_LABELS[tier]}`
        : `Visual effects set to ${TIER_LABELS[pref]}`,
      'success'
    );
  }

  async function applyPingHost() {
    const cleaned = probeDraft.trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
    if (cleaned && !/^[a-zA-Z0-9.-]+$/.test(cleaned)) {
      showToast('Use a hostname or IP — no spaces or paths', 'error');
      return;
    }
    patchPref('pingProbeHost', cleaned);
    try {
      await window.nexforge?.setPingProbeHost?.(cleaned || null);
      showToast(cleaned ? `Ping probe set to ${cleaned}` : 'Ping probe back to default', 'success');
    } catch {
      showToast('Could not set ping probe', 'error');
    }
  }

  async function pickVoiceDevice(kind, id) {
    setVoiceBusy(true);
    try {
      if (kind === 'input') {
        patchPref('voiceInputId', id);
        await voice?.setInputDevice?.(id);
      } else {
        patchPref('voiceOutputId', id);
        await voice?.setOutputDevice?.(id);
      }
      showToast(kind === 'input' ? 'Microphone saved' : 'Speakers saved', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not switch device', 'error');
    } finally {
      setVoiceBusy(false);
    }
  }

  const homeOptions = HOME_SCREENS.map((s) => ({ value: s.id, label: s.label }));

  return (
    <div className="settings-shell">
      <nav className="settings-nav" aria-label="Settings sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`settings-nav-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="settings-body">
        {tab === 'general' && (
          <>
            <p className="settings-lead">Startup, updates, and where NexForge lands when you open it.</p>
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
              <SettingToggle
                on={desk.autoCheckUpdates !== false}
                onChange={(on) => patchDesk({ autoCheckUpdates: on })}
                label="Check for updates automatically"
                hint="Looks for a new installer in the background. Manual check still works either way."
              />
              <div className="settings-actions">
                <button type="button" className="action-btn primary" onClick={checkForUpdates}>
                  Check for updates
                </button>
                {!guestMode && (
                  <button type="button" className="action-btn ghost" onClick={() => openUrl(COMPANION_URL)}>
                    Open Companion
                  </button>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-title">Startup & window</div>
              <SettingToggle
                on={!!desk.launchAtLogin}
                onChange={(on) => patchDesk({ launchAtLogin: on })}
                label="Open NexForge when Windows starts"
                hint="Adds NexForge to your Windows startup apps."
              />
              <SettingToggle
                on={desk.closeToTray !== false}
                onChange={(on) => patchDesk({ closeToTray: on })}
                label="Close to tray"
                hint="The X hides NexForge in the system tray instead of quitting. Quit from the tray icon."
              />
              <SettingToggle
                on={!!desk.startMinimized}
                onChange={(on) => patchDesk({ startMinimized: on })}
                label="Start in the tray"
                hint="Next launch stays in the tray until you open it. Useful with Open at startup."
              />
              <SettingToggle
                on={!!desk.minimizeToTray}
                onChange={(on) => patchDesk({ minimizeToTray: on })}
                label="Minimize to tray"
                hint="The taskbar minimize button hides the window instead of keeping a taskbar preview."
              />
              <SelectRow
                label="Home screen"
                hint="Where you land after sign-in. Guest mode still blocks account-only pages."
                value={prefs.homeScreen || 'dashboard'}
                onChange={(id) => {
                  patchPref('homeScreen', id);
                  showToast('Home screen saved', 'success');
                }}
                options={homeOptions}
              />
            </div>
          </>
        )}

        {tab === 'appearance' && (
          <>
            <p className="settings-lead">How the desktop chrome looks and how busy the motion is.</p>
            <div className="card">
              <div className="card-title">Visual effects</div>
              <div className="row" style={{ borderBottom: 'none', paddingBottom: 4 }}>
                <div>
                  <div className="row-title">Quality</div>
                  <div className="row-sub">
                    {fxPref === 'auto'
                      ? `Auto — running ${TIER_LABELS[fxActive]} on this machine`
                      : TIER_HINTS[fxPref]}
                  </div>
                </div>
              </div>
              <div className="fx-picker">
                {FX_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`fx-opt ${fxPref === opt ? 'active' : ''}`}
                    onClick={() => chooseFx(opt)}
                  >
                    <span className="fx-opt-name">{TIER_LABELS[opt]}</span>
                    <span className="fx-opt-hint">{TIER_HINTS[opt]}</span>
                  </button>
                ))}
              </div>
              <div className="settings-actions">
                <button
                  type="button"
                  className="action-btn ghost"
                  onClick={() => {
                    resetProbe();
                    if (fxPref === 'auto') {
                      const tier = setPreference('auto');
                      setFxActive(tier);
                    }
                    showToast('Auto-detect will measure this PC again next launch', 'success');
                  }}
                >
                  Reset auto-detect
                </button>
              </div>
            </div>

            <div className="card">
              <div className="card-title">Chrome</div>
              <SettingToggle
                on={prefs.atmosphere !== false}
                onChange={(on) => patchPref('atmosphere', on)}
                label="Background atmosphere"
                hint="Grain, glow veils, and the HUD frame around the app."
              />
              <SettingToggle
                on={prefs.clickFx !== false}
                onChange={(on) => patchPref('clickFx', on)}
                label="Click bursts"
                hint="Sparks when you click. Off if you want a quieter pointer."
              />
              <SettingToggle
                on={prefs.cursorLamp !== false}
                onChange={(on) => patchPref('cursorLamp', on)}
                label="Cursor lamp"
                hint="Soft glow that follows the pointer."
              />
              <SettingToggle
                on={!!prefs.compactSidebar}
                onChange={(on) => patchPref('compactSidebar', on)}
                label="Compact sidebar"
                hint="Icons only. Hover still works; labels hide until you turn this off."
              />
              <SelectRow
                label="Toast duration"
                hint="How long in-app banners stay before they fade."
                value={String(prefs.toastMs || 3200)}
                onChange={(v) => {
                  patchPref('toastMs', Number(v));
                  showToast('Toast length saved', 'success');
                }}
                options={TOAST_MS_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
              />
            </div>
          </>
        )}

        {tab === 'overlay' && (
          <>
            <p className="settings-lead">In-game HUD, NexAI, clips, status strip, crosshair, and extra panels.</p>
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
                hint="Inside NexForge this opens the full HUD so you can drag panels. In a game it opens NexAI only."
                value={overlayHotkeys?.overlay}
                listening={listening === 'overlay'}
                onListen={() => startListen('overlay')}
              />
              <KeybindRow
                label="NexAI"
                hint="Over a game this shows only NexAI. Inside the app it opens or closes the dock."
                value={overlayHotkeys?.nexai}
                listening={listening === 'nexai'}
                onListen={() => startListen('nexai')}
              />
            </div>

            <div className="card">
              <div className="card-title">HUD extras</div>
              <SettingToggle
                on={hudExtras.statusStrip}
                onChange={(on) => patchHud({ statusStrip: on })}
                label="Persistent status strip"
                hint="Click-through clock, game, and hardware on the edge of the screen while a session is tracked. Hidden when the full HUD is open."
              />
              <SelectRow
                label="Strip position"
                hint="Where the idle strip sits. Exclusive fullscreen still cannot be drawn over."
                value={hudExtras.stripPosition}
                onChange={(v) => patchHud({ stripPosition: v })}
                options={[
                  { value: 'bottom', label: 'Bottom center' },
                  { value: 'top', label: 'Top center' },
                ]}
              />
              <SettingToggle
                on={hudExtras.crosshair}
                onChange={(on) => patchHud({ crosshair: on })}
                label="On-screen crosshair"
                hint="A click-through marker at the center of the primary display while a tracked game is running."
              />
              <SelectRow
                label="Crosshair style"
                hint="Shown only when the crosshair is on."
                value={hudExtras.crosshairStyle}
                onChange={(v) => patchHud({ crosshairStyle: v })}
                options={[
                  { value: 'cross', label: 'Cross' },
                  { value: 'plus', label: 'Plus (gap)' },
                  { value: 'dot', label: 'Dot' },
                  { value: 'circle', label: 'Circle' },
                ]}
              />
              <SelectRow
                label="HUD opacity"
                hint="Panels, strip, and crosshair. Toasts stay readable."
                value={String(hudExtras.hudOpacity)}
                onChange={(v) => patchHud({ hudOpacity: Number(v) })}
                options={[
                  { value: '70', label: '70%' },
                  { value: '85', label: '85%' },
                  { value: '92', label: '92%' },
                  { value: '100', label: '100%' },
                ]}
              />
            </div>

            <div className="card">
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
                    {clipStatus?.enabled === false
                      ? 'Off'
                      : clipStatus?.buffering
                        ? `Filling… ${clipStatus.readySeconds || 0}s`
                        : `Ready · last ${clipSeconds}s`}
                  </div>
                </div>
                <select
                  className="settings-select"
                  value={clipSeconds}
                  onChange={(e) => setClipSeconds(Number(e.target.value))}
                >
                  {[8, 10, 15, 20, 30, 45].map((n) => (
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
                  disabled={!clipEnabled || !!clipStatus?.buffering}
                >
                  {!clipEnabled ? 'Clips off' : clipStatus?.buffering ? 'Buffering…' : 'Clip now'}
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
          <>
            <p className="settings-lead">Sounds, banners, and what pops over a game.</p>
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
                hint="Pop message and call alerts over your game. Customize the HUD on Overlay."
              />
              <SettingToggle
                on={prefs.messageSounds !== false}
                onChange={(on) => patchPref('messageSounds', on)}
                label="Message sounds"
                hint="A short chirp when a new DM arrives while NexForge is open."
              />
              <SettingToggle
                on={prefs.callSounds !== false}
                onChange={(on) => patchPref('callSounds', on)}
                label="Incoming call ringtone"
                hint="Plays when a friend calls. Do Not Disturb still wins."
              />
              <SettingToggle
                on={prefs.sessionToasts !== false}
                onChange={(on) => patchPref('sessionToasts', on)}
                label="Session banners"
                hint="Toasts when a game is detected, saved, or discarded as too short."
              />
              <SettingToggle
                on={prefs.heatAlerts !== false}
                onChange={(on) => patchPref('heatAlerts', on)}
                label="Hardware heat alerts"
                hint="Overlay ping when CPU, GPU, or ping spikes during a tracked session."
              />
              <SettingToggle
                on={prefs.whatsNew !== false}
                onChange={(on) => patchPref('whatsNew', on)}
                label="What's new after updates"
                hint="Show the changelog popup the first time you open a new version."
              />
            </div>
          </>
        )}

        {tab === 'voice' && (
          <>
            <p className="settings-lead">Microphone, speakers, and capture processing for friend calls and community decks.</p>
            <div className="card">
              <div className="card-title">Devices</div>
              <div className="row">
                <div>
                  <div className="row-title">Microphone</div>
                  <div className="row-sub">{voiceBusy ? 'Switching…' : 'Used for DMs and lounge voice'}</div>
                </div>
                <select
                  className="settings-select"
                  value={prefs.voiceInputId || ''}
                  disabled={voiceBusy}
                  onChange={(e) => pickVoiceDevice('input', e.target.value)}
                >
                  <option value="">System default</option>
                  {micInputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Mic ${d.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <div>
                  <div className="row-title">Speakers / headset</div>
                  <div className="row-sub">Where you hear the other person</div>
                </div>
                <select
                  className="settings-select"
                  value={prefs.voiceOutputId || ''}
                  disabled={voiceBusy}
                  onChange={(e) => pickVoiceDevice('output', e.target.value)}
                >
                  <option value="">System default</option>
                  {speakers.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Output ${d.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings-actions">
                <button
                  type="button"
                  className="action-btn ghost"
                  onClick={async () => {
                    try {
                      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                      stream.getTracks().forEach((t) => t.stop());
                      const all = await navigator.mediaDevices.enumerateDevices();
                      setMicInputs(all.filter((d) => d.kind === 'audioinput'));
                      setSpeakers(all.filter((d) => d.kind === 'audiooutput'));
                      await voice?.refreshDevices?.();
                      showToast('Device list refreshed', 'success');
                    } catch {
                      showToast('Allow microphone access to name your devices', 'error');
                    }
                  }}
                >
                  Refresh devices
                </button>
              </div>
            </div>
            <div className="card">
              <div className="card-title">Capture</div>
              <SettingToggle
                on={prefs.echoCancellation !== false}
                onChange={(on) => patchPref('echoCancellation', on)}
                label="Echo cancellation"
                hint="Cuts speaker bleed into your mic. Applies on the next call, or immediately if you are already in one."
              />
              <SettingToggle
                on={prefs.noiseSuppression !== false}
                onChange={(on) => patchPref('noiseSuppression', on)}
                label="Noise suppression"
                hint="Damps fans and keyboard noise. Next call unless you are live."
              />
              <SettingToggle
                on={prefs.autoGainControl !== false}
                onChange={(on) => patchPref('autoGainControl', on)}
                label="Auto gain"
                hint="Keeps your volume even. Turn off if you already run a mixer."
              />
              <SettingToggle
                on={prefs.callSounds !== false}
                onChange={(on) => patchPref('callSounds', on)}
                label="Ring on incoming calls"
                hint="Same control as Notifications — here so voice setup is in one place."
              />
            </div>
          </>
        )}

        {tab === 'privacy' && (
          <>
            <p className="settings-lead">What NexForge watches on this PC and what friends can see.</p>
            <div className="card">
              <div className="card-title">Session tracking</div>
              <SettingToggle
                on={desk.trackingEnabled !== false}
                onChange={(on) => patchDesk({ trackingEnabled: on })}
                label="Track games while they run"
                hint="Detects catalog titles and logs hardware during play. Off means no live session and no auto save."
              />
              <SettingToggle
                on={prefs.sharePresence !== false}
                onChange={(on) => patchPref('sharePresence', on)}
                label="Share what you are playing"
                hint="Friends see the tracked game next to your online dot. Last-seen is still updated."
              />
              <SettingToggle
                on={prefs.winLossPrompt !== false}
                onChange={(on) => patchPref('winLossPrompt', on)}
                label="Ask won or lost after a session"
                hint="The one-tap prompt when a tracked game closes. Esc still skips it."
              />
              {win ? (
                <SettingToggle
                  on={gameBoostOn}
                  onChange={(on) => {
                    setGameBoostOn(on);
                    window.nexforge?.setGameBoostPrefs?.({ enabled: on })
                      .then(() => {
                        showToast(
                          on
                            ? 'Windows game boost on when a game launches'
                            : 'Windows game boost off',
                          'success',
                        );
                      })
                      .catch(() => showToast('Could not save game boost', 'error'));
                  }}
                  label="Boost Windows while you play"
                  hint="High-performance power plan, Game Mode, quieter Xbox capture, higher priority. Restored when the session ends."
                />
              ) : null}
              <div className="row">
                <div>
                  <div className="row-title">Ping probe host</div>
                  <div className="row-sub">Leave blank for 1.1.1.1. Used while a session is live.</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="settings-input"
                    value={probeDraft}
                    placeholder="1.1.1.1"
                    onChange={(e) => setProbeDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') applyPingHost(); }}
                  />
                  <button type="button" className="action-btn ghost" onClick={applyPingHost}>
                    Apply
                  </button>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-title">This PC</div>
              <div className="row">
                <div>
                  <div className="row-title">Hardware scan</div>
                  <div className="row-sub">Refresh CPU, GPU, RAM, and display for Optimize advice.</div>
                </div>
                <button
                  type="button"
                  className="action-btn ghost"
                  onClick={async () => {
                    try {
                      const scan = await window.nexforge?.scanDeviceSpecs?.({ force: true });
                      if (scan) saveHwScan(scan);
                      showToast(scan ? 'Hardware scan updated' : 'Scan finished with no data', scan ? 'success' : 'error');
                    } catch (err) {
                      showToast(err?.message || 'Scan failed', 'error');
                    }
                  }}
                >
                  Rescan now
                </button>
              </div>
            </div>
          </>
        )}

        {tab === 'account' && (
          <>
            <p className="settings-lead">Who is signed in on this device.</p>
            <div className="card">
              <div className="card-title">Account</div>
              <div className="row">
                <div>
                  <div className="row-title">Gamer tag</div>
                  <div className="row-sub">{guestMode ? 'Guest mode — stats are not saved' : 'Signed in on this device'}</div>
                </div>
                <span className="result" style={{ color: 'var(--neon)' }}>{tag}</span>
              </div>
              {profile?.display_name ? (
                <div className="row">
                  <div>
                    <div className="row-title">Display name</div>
                    <div className="row-sub">Shown next to your tag in social views</div>
                  </div>
                  <span className="result">{profile.display_name}</span>
                </div>
              ) : null}
              {profile?.main_game ? (
                <div className="row">
                  <div>
                    <div className="row-title">Main game</div>
                    <div className="row-sub">Change this on My Profile</div>
                  </div>
                  <span className="result">{profile.main_game}</span>
                </div>
              ) : null}
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
          </>
        )}

        {tab === 'about' && (
          <>
            <p className="settings-lead">Build info, recent notes, and folders on this PC.</p>
            <div className="card">
              <div className="card-title">NexForge</div>
              <div className="row">
                <div>
                  <div className="row-title">Version</div>
                  <div className="row-sub">Packaged desktop app</div>
                </div>
                <span className="result">{appVersion ? `v${appVersion}` : '—'}</span>
              </div>
              <div className="row">
                <div>
                  <div className="row-title">Runtime</div>
                  <div className="row-sub">Electron on {appPlatform || 'this OS'}</div>
                </div>
                <span className="result">{appPlatform || '—'}</span>
              </div>
              <div className="settings-actions">
                <button type="button" className="action-btn primary" onClick={checkForUpdates}>
                  Check for updates
                </button>
                <button
                  type="button"
                  className="action-btn ghost"
                  onClick={() => openUrl('https://github.com/fevrpulse/NexForge/releases')}
                >
                  Release notes
                </button>
                {!guestMode && (
                  <button type="button" className="action-btn ghost" onClick={() => openUrl(COMPANION_URL)}>
                    Companion site
                  </button>
                )}
              </div>
            </div>

            {latest && (
              <div className="card">
                <div className="card-title">What's new in v{latest.version}</div>
                <ul className="settings-notes">
                  {latest.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="card">
              <div className="card-title">Data on this PC</div>
              <div className="row">
                <div>
                  <div className="row-title">App data folder</div>
                  <div className="row-sub">Prefs, overlay config, and crash leftovers. Do not share this folder.</div>
                </div>
                <button
                  type="button"
                  className="action-btn ghost"
                  onClick={async () => {
                    const res = await window.nexforge?.openUserDataFolder?.();
                    if (res?.ok === false) showToast(res.reason || 'Could not open folder', 'error');
                  }}
                >
                  Open folder
                </button>
              </div>
              <div className="row">
                <div>
                  <div className="row-title">Clips</div>
                  <div className="row-sub">Saved highlights in your Videos library</div>
                </div>
                <button
                  type="button"
                  className="action-btn ghost"
                  onClick={async () => {
                    const res = await window.nexforge?.openClipsFolder?.();
                    if (res?.ok === false) showToast(res.reason || 'Could not open clips folder', 'error');
                  }}
                >
                  Open clips
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
