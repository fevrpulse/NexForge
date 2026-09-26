const { spawn, execFile } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TICK_MS = 2000;
const NVIDIA_SMI_ARGS = [
  '--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total',
  '--format=csv,noheader,nounits',
];

const PS_LOOP = [
  '$ErrorActionPreference = "SilentlyContinue"',
  '$ProgressPreference = "SilentlyContinue"',
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  '$dwmOk = $false',
  'try {',
  '  Add-Type -TypeDefinition @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class NfDwmFps {',
  '  [StructLayout(LayoutKind.Sequential)]',
  '  public struct UNSIGNED_RATIO { public uint uiNumerator; public uint uiDenominator; }',
  '  [StructLayout(LayoutKind.Sequential, Pack = 8)]',
  '  public struct DWM_TIMING_INFO {',
  '    public uint cbSize;',
  '    public UNSIGNED_RATIO rateRefresh;',
  '    public ulong qpcRefreshPeriod;',
  '    public UNSIGNED_RATIO rateCompose;',
  '    public ulong qpcVBlank;',
  '    public ulong cRefresh;',
  '    public uint cDXRefresh;',
  '    public ulong qpcCompose;',
  '    public ulong cFrame;',
  '    public uint cDXPresent;',
  '    public ulong cRefreshFrame;',
  '    public ulong cFrameSubmitted;',
  '    public uint cDXPresentSubmitted;',
  '    public ulong cFrameConfirmed;',
  '    public uint cDXPresentConfirmed;',
  '    public ulong cFramesLate;',
  '    public uint cFramesOutstanding;',
  '    public ulong cFrameDisplayed;',
  '    public ulong qpcFrameDisplayed;',
  '    public ulong cFramesDisplayed;',
  '    public ulong cFramesComplete;',
  '    public ulong qpcFrameComplete;',
  '    public ulong cFramesPending;',
  '    public ulong qpcFramePending;',
  '    public ulong cFramesAvailable;',
  '    public ulong cFramesDropped;',
  '    public ulong cFramesMissed;',
  '    public ulong cRefreshNextDisplayed;',
  '    public ulong cRefreshNextPresented;',
  '    public ulong cRefreshesDisplayed;',
  '    public ulong cRefreshesPresented;',
  '    public ulong cRefreshStarted;',
  '    public ulong cPixelsReceived;',
  '    public ulong cPixelsDrawn;',
  '    public ulong cBuffersEmpty;',
  '  }',
  '  [DllImport("dwmapi.dll")]',
  '  public static extern int DwmGetCompositionTimingInfo(IntPtr hwnd, ref DWM_TIMING_INFO info);',
  '  public static ulong Frames() {',
  '    DWM_TIMING_INFO i = new DWM_TIMING_INFO();',
  '    i.cbSize = (uint)Marshal.SizeOf(typeof(DWM_TIMING_INFO));',
  '    if (DwmGetCompositionTimingInfo(IntPtr.Zero, ref i) != 0) return 0;',
  '    return i.cFramesDisplayed;',
  '  }',
  '}',
  '"@',
  '  $dwmOk = $true',
  '} catch {}',
  '$lastFrames = [uint64]0',
  '$lastAt = Get-Date',
  '$haveLast = $false',
  'function PickTemp($vals) {',
  '  $ok = @($vals | Where-Object { $_ -ge 30 -and $_ -le 115 })',
  '  if ($ok.Count -eq 0) { return $null }',
  '  return [math]::Round(($ok | Measure-Object -Maximum).Maximum, 0)',
  '}',
  'function GpuFromWmi {',
  '  $byPhys = @{}',
  '  Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine |',
  '    Where-Object { $_.Name -match "engtype_(3D|HighPriorityCompute|Compute)" } |',
  '    ForEach-Object {',
  '      $phys = "0"',
  '      if ($_.Name -match "phys_(\\d+)") { $phys = $Matches[1] }',
  '      if (-not $byPhys.ContainsKey($phys)) { $byPhys[$phys] = 0.0 }',
  '      $byPhys[$phys] += [double]$_.UtilizationPercentage',
  '    }',
  '  $max = 0.0',
  '  foreach ($v in $byPhys.Values) { if ($v -gt $max) { $max = $v } }',
  '  if ($max -le 0) { return $null }',
  '  return [math]::Min(100, [math]::Round($max, 1))',
  '}',
  '$smiPath = $null',
  'try {',
  '  $cmd = Get-Command nvidia-smi -ErrorAction SilentlyContinue',
  '  if ($cmd) { $smiPath = $cmd.Source }',
  '} catch {}',
  'if (-not $smiPath) {',
  '  $p86 = ${env:ProgramFiles(x86)}',
  '  foreach ($c in @("$env:ProgramFiles\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe", "$p86\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe")) {',
  '    if ($c -and (Test-Path $c)) { $smiPath = $c; break }',
  '  }',
  '}',
  '$tempSource = "none"',
  'try {',
  '  $one = Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -ErrorAction Stop | Select-Object -First 1',
  '  if ($one) { $tempSource = "lhm" }',
  '} catch {}',
  'if ($tempSource -eq "none") {',
  '  try {',
  '    $one = Get-CimInstance -Namespace root/OpenHardwareMonitor -ClassName Sensor -ErrorAction Stop | Select-Object -First 1',
  '    if ($one) { $tempSource = "ohm" }',
  '  } catch {}',
  '}',
  'if ($tempSource -eq "none") { $tempSource = "counter" }',
  '$tick = 0',
  'while ($true) {',
  '  $tick++',
  '  $gpuPct = $null; $gpuTemp = $null; $cpuTemp = $null; $fps = $null',
  '  if (-not $smiPath -and ($tick % 2 -eq 0)) { try { $gpuPct = GpuFromWmi } catch {} }',
  '  $cpuTemps = @(); $gpuTemps = @()',
  '  if ($tempSource -eq "lhm") {',
  '    try {',
  '      Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor | Where-Object { $_.SensorType -eq "Temperature" } | ForEach-Object {',
  '        $n = [string]$_.Name',
  '        $v = [double]$_.Value',
  '        if ($n -match "GPU") { $gpuTemps += $v }',
  '        elseif ($n -match "CPU|Package|CCD|Tctl|Core") { $cpuTemps += $v }',
  '      }',
  '    } catch {}',
  '  } elseif ($tempSource -eq "ohm") {',
  '    try {',
  '      Get-CimInstance -Namespace root/OpenHardwareMonitor -ClassName Sensor | Where-Object { $_.SensorType -eq "Temperature" } | ForEach-Object {',
  '        $n = [string]$_.Name',
  '        $v = [double]$_.Value',
  '        if ($n -match "GPU") { $gpuTemps += $v }',
  '        elseif ($n -match "CPU|Package|CCD|Tctl|Core") { $cpuTemps += $v }',
  '      }',
  '    } catch {}',
  '  } elseif (($tick % 2) -eq 0) {',
  '    try {',
  '      $cs = Get-Counter "\\Thermal Zone Information(*)\\Temperature" -MaxSamples 1 -ErrorAction SilentlyContinue',
  '      if ($cs) {',
  '        foreach ($s in @($cs.CounterSamples)) {',
  '          $k = [double]$s.CookedValue',
  '          if ($k -gt 200) { $cpuTemps += ($k - 273.15) }',
  '          elseif ($k -ge 30 -and $k -le 115) { $cpuTemps += $k }',
  '        }',
  '      }',
  '    } catch {}',
  '  }',
  '  $cpuTemp = PickTemp $cpuTemps',
  '  if ($null -eq $gpuTemp) { $gpuTemp = PickTemp $gpuTemps }',
  '  if ($dwmOk) {',
  '    try {',
  '      $frames = [NfDwmFps]::Frames()',
  '      $now = Get-Date',
  '      if ($haveLast -and $frames -ge $lastFrames) {',
  '        $dt = ($now - $lastAt).TotalSeconds',
  '        if ($dt -ge 0.35) {',
  '          $n = [math]::Round(($frames - $lastFrames) / $dt)',
  '          if ($n -ge 1 -and $n -le 480) { $fps = $n }',
  '        }',
  '      }',
  '      $lastFrames = $frames',
  '      $lastAt = $now',
  '      $haveLast = $true',
  '    } catch {}',
  '  }',
  '  $obj = [pscustomobject]@{ gpuPct = $gpuPct; gpuTempC = $gpuTemp; cpuTempC = $cpuTemp; fps = $fps }',
  '  Write-Output (ConvertTo-Json -InputObject $obj -Compress)',
  '  [Console]::Out.Flush()',
  '  Start-Sleep -Milliseconds 2000',
  '}',
].join('\n');

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cpuSnapshot() {
  const cpus = os.cpus() || [];
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times || {};
    idle += Number(t.idle) || 0;
    total += (Number(t.user) || 0) + (Number(t.nice) || 0) + (Number(t.sys) || 0)
      + (Number(t.idle) || 0) + (Number(t.irq) || 0);
  }
  return { idle, total };
}

function cpuPctFrom(prev, next) {
  if (!prev || !next) return null;
  const dIdle = next.idle - prev.idle;
  const dTotal = next.total - prev.total;
  if (dTotal <= 0) return null;
  return Math.round(Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100)) * 10) / 10;
}

function ramSample() {
  const total = os.totalmem();
  const free = os.freemem();
  if (!total) return { ramUsedGb: null, ramTotalGb: null, ramPct: null };
  const used = Math.max(0, total - free);
  const usedGb = Math.round((used / (1024 ** 3)) * 10) / 10;
  const totalGb = Math.round((total / (1024 ** 3)) * 10) / 10;
  const ramPct = Math.round((used / total) * 1000) / 10;
  return { ramUsedGb: usedGb, ramTotalGb: totalGb, ramPct };
}

function nvidiaSmiCandidates() {
  const out = ['nvidia-smi'];
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const p86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  out.push(path.join(pf, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'));
  out.push(path.join(p86, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'));
  return out.filter((p, i, arr) => arr.indexOf(p) === i && (i === 0 || fs.existsSync(p)));
}

function execFileAsync(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) => {
      if (err) {
        resolve('');
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

function parseNvidiaSmi(stdout) {
  const line = String(stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  if (!line) return { gpuPct: null, gpuTempC: null };
  const parts = line.split(',').map((s) => s.trim());
  return {
    gpuPct: num(parts[0]) == null ? null : Math.max(0, Math.min(100, Math.round(num(parts[0]) * 10) / 10)),
    gpuTempC: num(parts[1]) == null ? null : Math.round(num(parts[1])),
  };
}

function emptySample() {
  return {
    at: Date.now(),
    cpuPct: null,
    cpuTempC: null,
    gpuPct: null,
    gpuTempC: null,
    ramPct: null,
    ramUsedGb: null,
    ramTotalGb: null,
    fps: null,
  };
}

function createPerfMonitor({ onSample, getActiveGame } = {}) {
  let timer = null;
  let probe = null;
  let running = false;
  let prevCpu = null;
  let smiInFlight = null;
  let smiPath = nvidiaSmiCandidates()[0] || 'nvidia-smi';
  let lastSmi = { gpuPct: null, gpuTempC: null };
  let lastProbe = { gpuPct: null, gpuTempC: null, cpuTempC: null, fps: null };
  let lastSample = emptySample();
  let restartAt = 0;

  function emit() {
    const game = typeof getActiveGame === 'function' ? getActiveGame() : null;
    const gpuPct = lastSmi.gpuPct ?? lastProbe.gpuPct;
    const gpuTempC = lastSmi.gpuTempC ?? lastProbe.gpuTempC;
    lastSample = {
      at: Date.now(),
      cpuPct: lastSample.cpuPct,
      cpuTempC: lastProbe.cpuTempC ?? null,
      gpuPct,
      gpuTempC,
      ramPct: lastSample.ramPct,
      ramUsedGb: lastSample.ramUsedGb,
      ramTotalGb: lastSample.ramTotalGb,
      fps: game ? (lastProbe.fps ?? null) : null,
    };
    if (typeof onSample === 'function') onSample(lastSample);
  }

  async function pollNvidia() {
    if (smiInFlight) return smiInFlight;
    smiInFlight = execFileAsync(smiPath, NVIDIA_SMI_ARGS, 2500)
      .then((out) => {
        const parsed = parseNvidiaSmi(out);
        if (parsed.gpuPct != null || parsed.gpuTempC != null) lastSmi = parsed;
        return lastSmi;
      })
      .catch(() => lastSmi)
      .finally(() => { smiInFlight = null; });
    return smiInFlight;
  }

  function startProbe() {
    if (process.platform !== 'win32' || probe) return;
    probe = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', PS_LOOP,
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let buf = '';
    probe.stdout.setEncoding('utf8');
    probe.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
        if (!line || line[0] !== '{') continue;
        try {
          const row = JSON.parse(line);
          lastProbe = {
            gpuPct: num(row.gpuPct),
            gpuTempC: num(row.gpuTempC) == null ? null : Math.round(num(row.gpuTempC)),
            cpuTempC: num(row.cpuTempC) == null ? null : Math.round(num(row.cpuTempC)),
            fps: num(row.fps) == null ? null : Math.round(num(row.fps)),
          };
        } catch {
          /* ignore truncated lines */
        }
      }
    });
    probe.on('exit', () => {
      probe = null;
      if (!running) return;
      const wait = Math.min(15000, Math.max(2000, restartAt ? 2000 : 2500));
      restartAt = Date.now() + wait;
      setTimeout(() => {
        if (running && !probe) startProbe();
      }, wait);
    });
  }

  function tick() {
    const nextCpu = cpuSnapshot();
    const pct = cpuPctFrom(prevCpu, nextCpu);
    prevCpu = nextCpu;
    const ram = ramSample();
    lastSample = {
      ...lastSample,
      cpuPct: pct,
      ramPct: ram.ramPct,
      ramUsedGb: ram.ramUsedGb,
      ramTotalGb: ram.ramTotalGb,
    };
    pollNvidia().catch(() => {});
    emit();
  }

  function start() {
    if (running) return;
    running = true;
    prevCpu = cpuSnapshot();
    startProbe();
    tick();
    timer = setInterval(tick, TICK_MS);
    if (timer.unref) timer.unref();
  }

  function stop() {
    running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (probe) {
      try { probe.kill(); } catch { /* ignore */ }
      probe = null;
    }
  }

  function getSample() {
    return { ...lastSample };
  }

  return { start, stop, getSample };
}

module.exports = { createPerfMonitor };
