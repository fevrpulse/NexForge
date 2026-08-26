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

function buildTips({ avgRamMb, avgCpuPct, avgGpuPct, avgDiskPct, avgWifiPct, avgPingMs }) {
  const tips = [];
  if (avgWifiPct != null && avgWifiPct > 70) {
    tips.push('Wi‑Fi / network was busy — pause downloads and streams, or switch to Ethernet if you can.');
  } else if (avgWifiPct != null && avgWifiPct > 40) {
    tips.push('Network usage was elevated — close cloud backups and background updates while you play.');
  }
  if (avgPingMs != null && avgPingMs > 80) {
    tips.push('Average ping was high — prefer wired Ethernet and close bandwidth-heavy apps.');
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
  if (avgDiskPct != null && avgDiskPct > 80) {
    tips.push('Disk was very busy — move the game to an SSD and pause installs/updates during play.');
  } else if (avgDiskPct != null && avgDiskPct > 50) {
    tips.push('Disk usage was high — avoid copying files or launching extra apps mid-session.');
  }
  if (!tips.length) {
    tips.push('Session looked solid — RAM, CPU, GPU, disk, and network stayed in a healthy range.');
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
    this._lastIo = { diskPct: null, wifiPct: null };
    this._ioInFlight = null;
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
    const disk = s.samples.map((x) => x.diskPct).filter((n) => n != null);
    const wifi = s.samples.map((x) => x.wifiPct).filter((n) => n != null);
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
        diskPct: disk.length ? Math.round(avg(disk) * 10) / 10 : null,
        wifiPct: wifi.length ? Math.round(avg(wifi) * 10) / 10 : null,
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
        this._lastIo = { diskPct: null, wifiPct: null };
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
    this._lastIo = { diskPct: null, wifiPct: null };
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
    const disk = s.samples.map((x) => x.diskPct).filter((n) => typeof n === 'number');
    const wifi = s.samples.map((x) => x.wifiPct).filter((n) => typeof n === 'number');
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
      avgDiskPct: disk.length ? Math.round(avg(disk) * 10) / 10 : null,
      maxDiskPct: disk.length ? Math.round(maxOf(disk) * 10) / 10 : null,
      avgWifiPct: wifi.length ? Math.round(avg(wifi) * 10) / 10 : null,
      maxWifiPct: wifi.length ? Math.round(maxOf(wifi) * 10) / 10 : null,
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
    const [pingMs, gpuPct, io] = await Promise.all([
      this._ping(probe),
      this._gpuUsage(found.pid),
      this._ioUsage(),
    ]);

    return {
      at: new Date().toISOString(),
      ramMb: found.ramMb,
      cpuPct,
      gpuPct,
      diskPct: io?.diskPct ?? null,
      wifiPct: io?.wifiPct ?? null,
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

  /**
   * System disk busy % and Wi-Fi (or busiest NIC) utilization vs link speed.
   */
  async _ioUsage() {
    if (this._ioInFlight) {
      try {
        await this._ioInFlight;
      } catch {
        /* keep last */
      }
      return this._lastIo;
    }

    const script = `
$diskPct = $null
$d = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'" -ErrorAction SilentlyContinue
if ($d) {
  $idle = 0
  try { $idle = [double]$d.PercentIdleTime } catch { $idle = -1 }
  if ($idle -ge 0 -and $idle -le 100) { $diskPct = [math]::Round(100 - $idle, 1) }
  else {
    try { $diskPct = [math]::Min(100, [math]::Round([double]$d.PercentDiskTime, 1)) } catch { $diskPct = $null }
  }
}
$wifiPct = $null
$nics = @(Get-CimInstance -ClassName Win32_PerfFormattedData_Tcpip_NetworkInterface -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notmatch 'Loopback|isatap|Teredo|VPN|Virtual|vEthernet' })
$wifi = $nics | Where-Object { $_.Name -match 'Wi-?Fi|Wireless|802\\.11|WLAN' } | Sort-Object BytesTotalPersec -Descending | Select-Object -First 1
if (-not $wifi) { $wifi = $nics | Sort-Object BytesTotalPersec -Descending | Select-Object -First 1 }
if ($wifi) {
  $bw = 0
  try { $bw = [double]$wifi.CurrentBandwidth } catch { $bw = 0 }
  if ($bw -gt 0) {
    $wifiPct = [math]::Min(100, [math]::Round(([double]$wifi.BytesTotalPersec * 8.0 / $bw) * 100, 1))
  }
}
@{ diskPct = $diskPct; wifiPct = $wifiPct } | ConvertTo-Json -Compress
`;

    this._ioInFlight = execPs(script, 6000)
      .then((out) => {
        if (!out) return this._lastIo;
        try {
          const parsed = JSON.parse(out);
          const disk = Number(parsed.diskPct);
          const wifi = Number(parsed.wifiPct);
          this._lastIo = {
            diskPct: Number.isFinite(disk) ? Math.min(100, Math.max(0, disk)) : this._lastIo.diskPct,
            wifiPct: Number.isFinite(wifi) ? Math.min(100, Math.max(0, wifi)) : this._lastIo.wifiPct,
          };
        } catch {
          /* keep last */
        }
        return this._lastIo;
      })
      .catch(() => this._lastIo)
      .finally(() => {
        this._ioInFlight = null;
      });

    return this._ioInFlight;
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
