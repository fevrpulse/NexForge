const { execFile } = require('child_process');
const os = require('os');
const { EventEmitter } = require('events');

const POLL_MS = 3000;
const MIN_SESSION_SEC = 45;
const MIN_ACTIVE_RAM_MB = 80;
const DEFAULT_PROBE = '1.1.1.1';

/** Process name (no .exe) → display game name matching GAME_CATALOG */
const PROCESS_GAME_MAP = {
  'VALORANT-Win64-Shipping': 'Valorant',
  'cs2': 'CS2',
  'ModernWarfare': 'Call of Duty: Warzone',
  'cod': 'Call of Duty: Warzone',
  'Overwatch': 'Overwatch 2',
  'HaloInfinite': 'Halo Infinite',
  'r5apex': 'Apex Legends',
  'FortniteClient-Win64-Shipping': 'Fortnite',
  'TslGame': 'PUBG',
  'FallGuys_client_game': 'Fall Guys',
  'RocketLeague': 'Rocket League',
  'FIFA25': 'FIFA 25',
  'FC25': 'FIFA 25',
  'NBA2K25': 'NBA 2K25',
  'LeagueClientUx': 'League of Legends',
  'League of Legends': 'League of Legends',
  'dota2': 'Dota 2',
  'Minecraft.Windows': 'Minecraft',
  'javaw': 'Minecraft',
  'RobloxPlayerBeta': 'Roblox',
  'GTA5': 'GTA Online',
  'PlayGTAV': 'GTA Online',
  'GeometryDash': 'Geometry Dash',
  'MecchaChameleon': 'Meccha Chameleon',
  'MecchaChameleon-Win64-Shipping': 'Meccha Chameleon',
  'MECCHA CHAMELEON': 'Meccha Chameleon',
};

const GAME_PROBE_HOSTS = {
  'Valorant': '1.1.1.1',
  'CS2': '1.1.1.1',
  'Call of Duty: Warzone': '1.1.1.1',
  'Overwatch 2': '1.1.1.1',
  'Halo Infinite': '1.1.1.1',
  'Apex Legends': '1.1.1.1',
  'Fortnite': '1.1.1.1',
  'PUBG': '1.1.1.1',
  'Fall Guys': '1.1.1.1',
  'Rocket League': '1.1.1.1',
  'FIFA 25': '1.1.1.1',
  'NBA 2K25': '1.1.1.1',
  'League of Legends': '1.1.1.1',
  'Dota 2': '1.1.1.1',
  'Minecraft': '1.1.1.1',
  'Roblox': '1.1.1.1',
  'GTA Online': '1.1.1.1',
  'Geometry Dash': '1.1.1.1',
  'Meccha Chameleon': '1.1.1.1',
};

function execPs(script, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve(String(stdout || '').trim());
      }
    );
  });
}

function avg(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function maxOf(nums) {
  if (!nums.length) return null;
  return Math.max(...nums);
}

/** Java Edition is javaw.exe — do not treat every Java app as Minecraft. */
function isJavaMinecraft(windowTitle, exePath) {
  const title = String(windowTitle || '').toLowerCase();
  const path = String(exePath || '').toLowerCase();
  // Vanilla + common clients. Skip launcher UI so opening it is not a play session.
  if (title && !title.includes('launcher')) {
    if (
      title.includes('minecraft')
      || title.includes('lunar')
      || title.includes('badlion')
      || title.includes('feather')
      || title.includes('labymod')
    ) {
      return true;
    }
  }
  return /[\\/](?:\.minecraft|minecraft|prismlauncher|multimc|modrinth|curseforge|lunarclient|lunar client|badlion|feather)[\\/]/i.test(path)
    || path.includes('.minecraft');
}

function buildTips({ avgRamMb, avgCpuPct, avgGpuPct, avgPingMs }) {
  const tips = [];
  if (avgPingMs != null && avgPingMs > 80) {
    tips.push('Average network ping was high — prefer a wired Ethernet connection and close bandwidth-heavy apps (downloads, streams).');
  } else if (avgPingMs != null && avgPingMs > 50) {
    tips.push('Ping was moderate — move closer to your router or switch to 5 GHz Wi‑Fi if you are on wireless.');
  }
  if (avgRamMb != null && avgRamMb > 6000) {
    tips.push('This game used a lot of RAM — close browsers and background apps before your next session.');
  } else if (avgRamMb != null && avgRamMb > 3500) {
    tips.push('RAM usage was elevated — free memory by closing unused apps for smoother play.');
  }
  if (avgCpuPct != null && avgCpuPct > 85) {
    tips.push('CPU was near max — lower in-game graphics settings or close CPU-heavy background programs.');
  } else if (avgCpuPct != null && avgCpuPct > 65) {
    tips.push('CPU load was high — consider lowering shadows/effects or capping FPS to reduce stutter.');
  }
  if (avgGpuPct != null && avgGpuPct > 90) {
    tips.push('GPU was near max — lower resolution/effects or enable DLSS/FSR/XeSS to reduce load.');
  } else if (avgGpuPct != null && avgGpuPct > 75) {
    tips.push('GPU load was high — try a lower graphics preset or cap FPS if you see hitching.');
  }
  if (!tips.length) {
    tips.push('Session looked solid — network, CPU, GPU, and RAM stayed in a healthy range.');
  }
  return tips.slice(0, 3);
}

class GameTracker extends EventEmitter {
  constructor() {
    super();
    this._timer = null;
    this._running = false;
    this._ticking = false;
    this._session = null;
    this._cpuPrev = null;
    this._customProbeHost = null;
    this._cores = Math.max(1, os.cpus().length);
    this._knownNames = Object.keys(PROCESS_GAME_MAP);
    this._lastGpuPct = null;
    this._gpuInFlight = null;
  }

  start() {
    if (process.platform !== 'win32') {
      console.log('Game tracker skipped (Windows only)');
      return;
    }
    if (this._running) return;
    this._running = true;
    this._tick().catch((err) => console.error('Game tracker tick error:', err));
    this._timer = setInterval(() => {
      this._tick().catch((err) => console.error('Game tracker tick error:', err));
    }, POLL_MS);
    if (this._timer.unref) this._timer.unref();
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._session) {
      this._endSession(false);
    }
  }

  setPingProbeHost(host) {
    if (!host || typeof host !== 'string') {
      this._customProbeHost = null;
      return;
    }
    const cleaned = host.trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
    this._customProbeHost = cleaned || null;
  }

  getActiveSession() {
    if (!this._session) return null;
    return this._publicSession(this._session);
  }

  _publicSession(s) {
    const ram = s.samples.map((x) => x.ramMb).filter((n) => n != null);
    const cpu = s.samples.map((x) => x.cpuPct).filter((n) => n != null);
    const gpu = s.samples.map((x) => x.gpuPct).filter((n) => n != null);
    const ping = s.samples.map((x) => x.pingMs).filter((n) => n != null);
    const last = s.samples[s.samples.length - 1] || null;
    return {
      game: s.game,
      processName: s.processName,
      pid: s.pid,
      startedAt: s.startedAt,
      durationSec: Math.max(0, Math.round((Date.now() - s.startedAtMs) / 1000)),
      live: last,
      averages: {
        ramMb: ram.length ? Math.round(avg(ram)) : null,
        cpuPct: cpu.length ? Math.round(avg(cpu) * 10) / 10 : null,
        gpuPct: gpu.length ? Math.round(avg(gpu) * 10) / 10 : null,
        pingMs: ping.length ? Math.round(avg(ping)) : null,
      },
    };
  }

  async _tick() {
    // Slow probes (ping timeouts, busy WMI) must not stack overlapping ticks.
    if (!this._running || this._ticking) return;
    this._ticking = true;
    try {
      const found = await this._findGameProcess();
      if (!found) {
        if (this._session) this._endSession(true);
        this._cpuPrev = null;
        this._lastGpuPct = null;
        return;
      }

      if (!this._session || this._session.pid !== found.pid || this._session.game !== found.game) {
        if (this._session) this._endSession(true);
        this._startSession(found);
      }

      const sample = await this._sample(found);
      if (!this._session) return; // stopped mid-sample
      this._session.samples.push(sample);
      // Keep samples bounded
      if (this._session.samples.length > 400) {
        this._session.samples = this._session.samples.slice(-300);
      }
      this.emit('sample', {
        ...this._publicSession(this._session),
        sample,
      });
    } finally {
      this._ticking = false;
    }
  }

  _startSession(found) {
    this._session = {
      game: found.game,
      processName: found.processName,
      pid: found.pid,
      startedAt: new Date().toISOString(),
      startedAtMs: Date.now(),
      samples: [],
    };
    this._cpuPrev = {
      pid: found.pid,
      cpuSeconds: found.cpuSeconds,
      at: Date.now(),
    };
    this._lastGpuPct = null;
    this.emit('started', this._publicSession(this._session));
  }

  _endSession(emitFeedback) {
    const s = this._session;
    this._session = null;
    this._cpuPrev = null;
    if (!s) return;

    const durationSec = Math.max(0, Math.round((Date.now() - s.startedAtMs) / 1000));
    if (!emitFeedback || durationSec < MIN_SESSION_SEC) {
      this.emit('cancelled', { game: s.game, durationSec });
      return;
    }

    const ram = s.samples.map((x) => x.ramMb).filter((n) => typeof n === 'number');
    const cpu = s.samples.map((x) => x.cpuPct).filter((n) => typeof n === 'number');
    const gpu = s.samples.map((x) => x.gpuPct).filter((n) => typeof n === 'number');
    const ping = s.samples.map((x) => x.pingMs).filter((n) => typeof n === 'number');

    const summary = {
      game: s.game,
      processName: s.processName,
      durationSec,
      avgRamMb: ram.length ? Math.round(avg(ram)) : null,
      maxRamMb: ram.length ? Math.round(maxOf(ram)) : null,
      avgCpuPct: cpu.length ? Math.round(avg(cpu) * 10) / 10 : null,
      maxCpuPct: cpu.length ? Math.round(maxOf(cpu) * 10) / 10 : null,
      avgGpuPct: gpu.length ? Math.round(avg(gpu) * 10) / 10 : null,
      maxGpuPct: gpu.length ? Math.round(maxOf(gpu) * 10) / 10 : null,
      avgPingMs: ping.length ? Math.round(avg(ping)) : null,
      maxPingMs: ping.length ? Math.round(maxOf(ping)) : null,
      tips: [],
      samples: s.samples.slice(-60),
      startedAt: s.startedAt,
      endedAt: new Date().toISOString(),
    };
    summary.tips = buildTips(summary);
    this.emit('ended', summary);
  }

  async _findGameProcess() {
    const namesLiteral = this._knownNames.map((n) => `'${n.replace(/'/g, "''")}'`).join(',');
    // Only track processes that actually have a visible window.
    // Launchers/crash handlers (e.g. background RobloxPlayerBeta) often stay
    // alive with MainWindowHandle 0 and would otherwise false-trigger tracking.
    const script = `
$names = @(${namesLiteral})
$minBytes = ${MIN_ACTIVE_RAM_MB} * 1MB
Get-Process -ErrorAction SilentlyContinue |
  Where-Object {
    ($names -contains $_.ProcessName) -and
    ($_.MainWindowHandle -ne 0) -and
    ($_.WorkingSet64 -ge $minBytes)
  } |
  Sort-Object WorkingSet64 -Descending |
  Select-Object -First 8 Id, ProcessName, Path, WorkingSet64, CPU, MainWindowTitle |
  ConvertTo-Json -Compress
`;
    try {
      const out = await execPs(script);
      if (!out) return null;
      const parsed = JSON.parse(out);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of rows) {
        if (!row || !row.Id) continue;
        const processName = String(row.ProcessName || '');
        const game = PROCESS_GAME_MAP[processName];
        if (!game) continue;
        if (processName.toLowerCase() === 'javaw'
            && !isJavaMinecraft(row.MainWindowTitle, row.Path)) {
          continue;
        }
        return {
          pid: Number(row.Id),
          processName,
          game,
          ramMb: Math.round(Number(row.WorkingSet64 || 0) / (1024 * 1024)),
          cpuSeconds: Number(row.CPU || 0),
          windowTitle: row.MainWindowTitle || '',
        };
      }
      return null;
    } catch (err) {
      console.error('Process scan failed:', err.message || err);
      return null;
    }
  }

  async _sample(found) {
    const now = Date.now();
    let cpuPct = null;
    if (this._cpuPrev && this._cpuPrev.pid === found.pid) {
      const dt = (now - this._cpuPrev.at) / 1000;
      const dCpu = found.cpuSeconds - this._cpuPrev.cpuSeconds;
      if (dt > 0.2 && dCpu >= 0) {
        cpuPct = Math.min(100, Math.max(0, (dCpu / dt / this._cores) * 100));
        cpuPct = Math.round(cpuPct * 10) / 10;
      }
    }
    this._cpuPrev = {
      pid: found.pid,
      cpuSeconds: found.cpuSeconds,
      at: now,
    };

    const probe = this._resolveProbe(found.game);
    const [pingMs, gpuPct] = await Promise.all([
      this._ping(probe),
      this._gpuUsage(found.pid),
    ]);

    return {
      at: new Date().toISOString(),
      ramMb: found.ramMb,
      cpuPct,
      gpuPct,
      pingMs,
      probeHost: probe,
    };
  }

  /**
   * Process GPU % from WDDM engine counters (3D + compute), same family as Task Manager.
   * Overlapping polls reuse the last reading so the 3s tick never stacks.
   */
  async _gpuUsage(pid) {
    const id = Number(pid);
    if (!Number.isFinite(id) || id <= 0) return this._lastGpuPct;

    if (this._gpuInFlight) {
      try {
        await this._gpuInFlight;
      } catch {
        /* keep last */
      }
      return this._lastGpuPct;
    }

    const script = `
$id = ${id}
$filter = "Name LIKE 'pid_${id}%'"
$sum = 0.0
$found = $false
Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Filter $filter -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'engtype_(3D|HighPriorityCompute|Compute)' } |
  ForEach-Object {
    $found = $true
    $sum += [double]$_.UtilizationPercentage
  }
if (-not $found) { '' }
else { [math]::Min(100, [math]::Round($sum, 1)) }
`;

    this._gpuInFlight = execPs(script, 6000)
      .then((out) => {
        if (!out) return this._lastGpuPct;
        const n = parseFloat(out);
        if (!Number.isFinite(n)) return this._lastGpuPct;
        this._lastGpuPct = Math.min(100, Math.max(0, n));
        return this._lastGpuPct;
      })
      .catch(() => this._lastGpuPct)
      .finally(() => {
        this._gpuInFlight = null;
      });

    return this._gpuInFlight;
  }

  _resolveProbe(game) {
    if (this._customProbeHost) return this._customProbeHost;
    return GAME_PROBE_HOSTS[game] || DEFAULT_PROBE;
  }

  async _ping(host) {
    if (!host) return null;
    const safe = String(host).replace(/[^a-zA-Z0-9.\-_]/g, '');
    if (!safe) return null;
    try {
      const script = `
$r = Test-Connection -ComputerName '${safe}' -Count 1 -ErrorAction SilentlyContinue
if ($r) {
  if ($r.Latency) { [int]$r.Latency }
  elseif ($r.ResponseTime) { [int]$r.ResponseTime }
}
`;
      const out = await execPs(script, 5000);
      if (!out) return null;
      const n = parseInt(out, 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
}

module.exports = {
  GameTracker,
  PROCESS_GAME_MAP,
  MIN_SESSION_SEC,
};
