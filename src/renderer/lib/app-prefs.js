/** Renderer UI preferences. Desktop/window prefs live in desktop-prefs.js (main). */

const KEY = 'nexforge_app_prefs';

export const HOME_SCREENS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'matchmaking', label: 'Matchmaking' },
  { id: 'optimize', label: 'Optimize' },
  { id: 'tournaments', label: 'Tournaments' },
  { id: 'friends', label: 'Friends' },
  { id: 'communities', label: 'Communities' },
  { id: 'clans', label: 'Clans' },
  { id: 'shop', label: 'Shop' },
  { id: 'profile', label: 'My Profile' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'squad', label: 'Squad Finder' },
];

export const TOAST_MS_OPTIONS = [
  { value: 2000, label: '2 seconds' },
  { value: 3200, label: '3 seconds' },
  { value: 5000, label: '5 seconds' },
  { value: 8000, label: '8 seconds' },
];

export const DEFAULT_APP_PREFS = {
  clickFx: true,
  cursorLamp: true,
  compactSidebar: false,
  atmosphere: true,
  toastMs: 3200,
  messageSounds: true,
  callSounds: true,
  sessionToasts: true,
  heatAlerts: true,
  winLossPrompt: true,
  sharePresence: true,
  whatsNew: true,
  pingProbeHost: '',
  homeScreen: 'dashboard',
  voiceInputId: '',
  voiceOutputId: '',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const listeners = new Set();

function readRaw() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function clampToastMs(n) {
  const v = Number(n);
  if (v === 2000 || v === 3200 || v === 5000 || v === 8000) return v;
  return DEFAULT_APP_PREFS.toastMs;
}

function sanitize(patch, base = DEFAULT_APP_PREFS) {
  const next = { ...base };
  const src = patch && typeof patch === 'object' ? patch : {};
  for (const key of Object.keys(DEFAULT_APP_PREFS)) {
    if (!(key in src)) continue;
    const value = src[key];
    if (typeof DEFAULT_APP_PREFS[key] === 'boolean') next[key] = !!value;
    else if (key === 'toastMs') next[key] = clampToastMs(value);
    else if (key === 'homeScreen') {
      next[key] = HOME_SCREENS.some((s) => s.id === value) ? value : 'dashboard';
    } else if (key === 'pingProbeHost' || key === 'voiceInputId' || key === 'voiceOutputId') {
      next[key] = String(value || '').trim().slice(0, 180);
    }
  }
  return next;
}

export function getAppPrefs() {
  return sanitize(readRaw());
}

export function getAppPref(key) {
  const prefs = getAppPrefs();
  return key in prefs ? prefs[key] : DEFAULT_APP_PREFS[key];
}

export function applyAppChrome(prefs = getAppPrefs()) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (prefs.compactSidebar) root.setAttribute('data-compact-nav', '1');
  else root.removeAttribute('data-compact-nav');
  if (prefs.atmosphere === false) root.setAttribute('data-atmosphere', 'off');
  else root.removeAttribute('data-atmosphere');
}

export function setAppPrefs(patch) {
  const next = sanitize({ ...readRaw(), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  applyAppChrome(next);
  listeners.forEach((fn) => {
    try { fn(next); } catch { /* ignore */ }
  });
  return next;
}

export function setAppPref(key, value) {
  return setAppPrefs({ [key]: value });
}

export function subscribeAppPrefs(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resolveHomeScreen(guestMode = false, locked = []) {
  const id = getAppPref('homeScreen') || 'dashboard';
  if (guestMode && locked.includes(id)) return 'dashboard';
  if (!HOME_SCREENS.some((s) => s.id === id)) return 'dashboard';
  return id;
}

if (typeof document !== 'undefined') applyAppChrome();
