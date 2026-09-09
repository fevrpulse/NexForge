const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  launchAtLogin: false,
  closeToTray: true,
  startMinimized: false,
  minimizeToTray: false,
  trackingEnabled: true,
  autoCheckUpdates: true,
};

let cached = null;

function prefsPath() {
  return path.join(app.getPath('userData'), 'desktop-prefs.json');
}

function load() {
  if (cached) return cached;
  try {
    cached = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(prefsPath(), 'utf8')) };
  } catch {
    cached = { ...DEFAULTS };
  }
  return cached;
}

function save(next) {
  cached = next;
  try {
    fs.writeFileSync(prefsPath(), JSON.stringify(next, null, 2));
  } catch {
    /* best-effort */
  }
}

function sanitize(patch) {
  const next = { ...load() };
  const src = patch && typeof patch === 'object' ? patch : {};
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof src[key] === 'boolean') next[key] = src[key];
  }
  return next;
}

function applyLoginItem(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      openAsHidden: false,
    });
  } catch (err) {
    console.warn('Login item failed:', err && err.message ? err.message : err);
  }
}

function getPrefs() {
  return { ...load() };
}

function setPrefs(patch) {
  const prev = load();
  const next = sanitize(patch);
  save(next);
  if (next.launchAtLogin !== prev.launchAtLogin) applyLoginItem(next.launchAtLogin);
  return getPrefs();
}

function syncFromDisk() {
  cached = null;
  const prefs = load();
  applyLoginItem(prefs.launchAtLogin);
  return getPrefs();
}

module.exports = {
  DEFAULTS,
  getPrefs,
  setPrefs,
  syncFromDisk,
};
