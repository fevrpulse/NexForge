const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');

const HIGH_PERF = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';

function execPs(script, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(String(stdout || '').trim());
      },
    );
  });
}

function prefsPath() {
  return path.join(app.getPath('userData'), 'game-boost.json');
}

function snapshotPath() {
  return path.join(app.getPath('userData'), 'game-boost-snapshot.json');
}

function readJson(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {
    /* best-effort */
  }
}

function priorityConst(name) {
  const p = os.constants?.priority || {};
  const map = {
    High: p.PRIORITY_HIGH,
    AboveNormal: p.PRIORITY_ABOVE_NORMAL,
    Normal: p.PRIORITY_NORMAL,
    BelowNormal: p.PRIORITY_BELOW_NORMAL,
    Idle: p.PRIORITY_LOW,
    Low: p.PRIORITY_LOW,
  };
  return map[name] ?? p.PRIORITY_NORMAL;
}

function priorityName(value) {
  const p = os.constants?.priority || {};
  if (value === p.PRIORITY_HIGH) return 'High';
  if (value === p.PRIORITY_ABOVE_NORMAL) return 'AboveNormal';
  if (value === p.PRIORITY_BELOW_NORMAL) return 'BelowNormal';
  if (value === p.PRIORITY_LOW) return 'Idle';
  return 'Normal';
}

class WinGameBoost {
  constructor() {
    this.enabled = true;
    this._prefsLoaded = false;
    this.active = false;
    this.snapshot = null;
    this._busy = Promise.resolve();
  }

  _loadPrefs() {
    if (this._prefsLoaded) return;
    this._prefsLoaded = true;
    this.enabled = readJson(prefsPath(), { enabled: true }).enabled !== false;
  }

  getPrefs() {
    this._loadPrefs();
    return {
      enabled: this.enabled,
      active: this.active,
      game: this.snapshot?.game || null,
    };
  }

  setEnabled(on) {
    this._loadPrefs();
    this.enabled = !!on;
    writeJson(prefsPath(), { enabled: this.enabled });
    if (!this.enabled && this.active) {
      return this.restore();
    }
    return Promise.resolve({ enabled: this.enabled, active: this.active });
  }

  async recover() {
    if (process.platform !== 'win32') return { restored: false };
    if (!fs.existsSync(snapshotPath())) return { restored: false };
    this.snapshot = readJson(snapshotPath(), null);
    if (!this.snapshot) return { restored: false };
    this.active = true;
    return this.restore();
  }

  apply(session) {
    const run = this._apply(session).catch((err) => {
      console.warn('Game boost apply failed:', err && err.message ? err.message : err);
      return { applied: false };
    });
    this._busy = this._busy.then(() => run, () => run);
    return run;
  }

  restore() {
    const run = this._restore().catch((err) => {
      console.warn('Game boost restore failed:', err && err.message ? err.message : err);
      return { restored: false };
    });
    this._busy = this._busy.then(() => run, () => run);
    return run;
  }

  async _apply(session) {
    this._loadPrefs();
    if (process.platform !== 'win32' || !this.enabled) {
      return { applied: false, reason: process.platform !== 'win32' ? 'platform' : 'disabled' };
    }
    if (this.active) await this._restore();

    const gamePid = Number(session?.pid);
    const selfPid = process.pid;
    const snap = {
      game: session?.game || null,
      gamePid: Number.isFinite(gamePid) ? gamePid : null,
      selfPid,
    };

    if (Number.isFinite(gamePid) && gamePid > 0) {
      try {
        snap.gamePriority = priorityName(os.getPriority(gamePid));
        os.setPriority(gamePid, os.constants.priority.PRIORITY_HIGH);
      } catch {
        /* process may have already exited */
      }
    }

    const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$out = @{}
$schemeLine = powercfg /getactivescheme
if ($schemeLine -match '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})') {
  $out.powerScheme = $Matches[1]
}
powercfg /setactive ${HIGH_PERF} | Out-Null
$out.powerOk = [bool]$?

$bar = 'HKCU:\\Software\\Microsoft\\GameBar'
if (-not (Test-Path $bar)) { New-Item -Path $bar -Force | Out-Null }
$barProps = Get-ItemProperty -Path $bar
if ($barProps.PSObject.Properties['AutoGameModeEnabled']) { $out.gameMode = [int]$barProps.AutoGameModeEnabled }
if ($barProps.PSObject.Properties['AllowAutoGameMode']) { $out.allowAuto = [int]$barProps.AllowAutoGameMode }
New-ItemProperty -Path $bar -Name AutoGameModeEnabled -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $bar -Name AllowAutoGameMode -Value 1 -PropertyType DWord -Force | Out-Null

$dvr = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR'
if (-not (Test-Path $dvr)) { New-Item -Path $dvr -Force | Out-Null }
$dvrProps = Get-ItemProperty -Path $dvr
if ($dvrProps.PSObject.Properties['AppCaptureEnabled']) { $out.appCapture = [int]$dvrProps.AppCaptureEnabled }
New-ItemProperty -Path $dvr -Name AppCaptureEnabled -Value 0 -PropertyType DWord -Force | Out-Null

$gcs = 'HKCU:\\System\\GameConfigStore'
if (Test-Path $gcs) {
  $gcsProps = Get-ItemProperty -Path $gcs
  if ($gcsProps.PSObject.Properties['GameDVR_Enabled']) { $out.gameDvr = [int]$gcsProps.GameDVR_Enabled }
  New-ItemProperty -Path $gcs -Name GameDVR_Enabled -Value 0 -PropertyType DWord -Force | Out-Null
}

$out | ConvertTo-Json -Compress
`;
    try {
      const raw = await execPs(ps, 10000);
      const parsed = raw ? JSON.parse(raw) : {};
      Object.assign(snap, parsed);
    } catch (err) {
      console.warn('Game boost Windows tweaks failed:', err && err.message ? err.message : err);
    }

    this.snapshot = snap;
    this.active = true;
    writeJson(snapshotPath(), snap);
    return {
      applied: true,
      game: snap.game,
      power: snap.powerOk === true || snap.powerOk === 'True',
    };
  }

  async _restore() {
    const snap = this.snapshot || readJson(snapshotPath(), null);
    if (!snap) {
      this.active = false;
      return { restored: false };
    }

    if (snap.gamePid && snap.gamePriority) {
      try {
        os.setPriority(Number(snap.gamePid), priorityConst(snap.gamePriority));
      } catch {
        /* game already closed */
      }
    }

    const power = /^[0-9a-fA-F-]{36}$/.test(String(snap.powerScheme || ''))
      ? String(snap.powerScheme)
      : '';
    const gameMode = snap.gameMode == null || snap.gameMode === '' ? '' : String(Number(snap.gameMode));
    const allowAuto = snap.allowAuto == null || snap.allowAuto === '' ? '' : String(Number(snap.allowAuto));
    const appCapture = snap.appCapture == null || snap.appCapture === '' ? '' : String(Number(snap.appCapture));
    const gameDvr = snap.gameDvr == null || snap.gameDvr === '' ? '' : String(Number(snap.gameDvr));

    const ps = `
$ErrorActionPreference = 'SilentlyContinue'
${power ? `powercfg /setactive ${power} | Out-Null` : ''}
$bar = 'HKCU:\\Software\\Microsoft\\GameBar'
if (Test-Path $bar) {
  ${gameMode === '' ? '' : `New-ItemProperty -Path $bar -Name AutoGameModeEnabled -Value ${gameMode} -PropertyType DWord -Force | Out-Null`}
  ${allowAuto === '' ? '' : `New-ItemProperty -Path $bar -Name AllowAutoGameMode -Value ${allowAuto} -PropertyType DWord -Force | Out-Null`}
}
$dvr = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR'
if (Test-Path $dvr) {
  ${appCapture === '' ? '' : `New-ItemProperty -Path $dvr -Name AppCaptureEnabled -Value ${appCapture} -PropertyType DWord -Force | Out-Null`}
}
$gcs = 'HKCU:\\System\\GameConfigStore'
if (Test-Path $gcs) {
  ${gameDvr === '' ? '' : `New-ItemProperty -Path $gcs -Name GameDVR_Enabled -Value ${gameDvr} -PropertyType DWord -Force | Out-Null`}
}
`;
    try {
      await execPs(ps, 10000);
    } catch (err) {
      console.warn('Game boost restore tweaks failed:', err && err.message ? err.message : err);
    }

    this.active = false;
    this.snapshot = null;
    try { fs.unlinkSync(snapshotPath()); } catch { /* gone */ }
    return { restored: true };
  }
}

module.exports = { WinGameBoost };
