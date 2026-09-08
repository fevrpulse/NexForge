const { execFile } = require('child_process');
const os = require('os');

const CACHE_MS = 15 * 60 * 1000;

let cached = null;
let cachedAt = 0;
let inFlight = null;

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
function S($v) { if ($null -eq $v) { return $null }; return ([string]$v).Trim() }

$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpus = @(Get-CimInstance Win32_VideoController | Where-Object {
  $_.Name -and $_.Name -notmatch 'Remote Desktop|Microsoft Basic|Microsoft Hyper-V'
})
$cs = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$disks = @()
try {
  $disks = @(Get-PhysicalDisk | ForEach-Object {
    [pscustomobject]@{
      name = S $_.FriendlyName
      media = S $_.MediaType
      sizeGb = [int][math]::Round(($_.Size / 1GB), 0)
    }
  })
} catch {
  $disks = @(Get-CimInstance Win32_DiskDrive | Select-Object -First 4 | ForEach-Object {
    [pscustomobject]@{
      name = S $_.Model
      media = $null
      sizeGb = if ($_.Size) { [int][math]::Round(($_.Size / 1GB), 0) } else { $null }
    }
  })
}

$gpuOut = @($gpus | ForEach-Object {
  $ramGb = $null
  if ($_.AdapterRAM -and $_.AdapterRAM -gt 67108864 -and $_.AdapterRAM -lt 4000000000) {
    $ramGb = [math]::Round(($_.AdapterRAM / 1GB), 1)
  }
  [pscustomobject]@{
    name = S $_.Name
    vendor = S $_.AdapterCompatibility
    vramGb = $ramGb
    width = [int]($_.CurrentHorizontalResolution)
    height = [int]($_.CurrentVerticalResolution)
    refreshHz = [int]($_.CurrentRefreshRate)
    driver = S $_.DriverVersion
  }
})

[pscustomobject]@{
  cpuName = S $cpu.Name
  cores = [int]$cpu.NumberOfCores
  threads = [int]$cpu.NumberOfLogicalProcessors
  clockMhz = [int]$cpu.MaxClockSpeed
  ramGb = [math]::Round(($cs.TotalPhysicalMemory / 1GB), 1)
  os = S $os.Caption
  gpus = $gpuOut
  disks = $disks
} | ConvertTo-Json -Compress -Depth 5
`.trim();

function execPs(script, timeoutMs = 14000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(String(stdout || '').trim());
      },
    );
  });
}

function nodeFallback() {
  const cpu = os.cpus()?.[0] || {};
  return {
    cpuName: cpu.model || null,
    cores: os.cpus()?.length || null,
    threads: os.cpus()?.length || null,
    clockMhz: cpu.speed || null,
    ramGb: Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10,
    os: `${os.type()} ${os.release()}`,
    gpus: [],
    disks: [],
  };
}

function gpuRank(gpu) {
  const n = String(gpu?.name || '').toLowerCase();
  if (/nvidia|geforce|rtx|gtx|quadro|tesla/.test(n)) return 80 + Number(gpu.vramGb || 0);
  if (/\bradeon\b|\bamd\b|\brx\s/.test(n)) return 70 + Number(gpu.vramGb || 0);
  if (/\barc\b/.test(n)) return 55 + Number(gpu.vramGb || 0);
  if (/uhd|iris|hd graphics|graphics hd|adreno|mali/.test(n)) return 8;
  return 15 + Number(gpu.vramGb || 0);
}

function pickGpu(gpus) {
  const list = (Array.isArray(gpus) ? gpus : []).filter((g) => g?.name);
  if (!list.length) return null;
  return list.slice().sort((a, b) => gpuRank(b) - gpuRank(a))[0];
}

function cleanRefresh(hz) {
  const n = Number(hz);
  if (!Number.isFinite(n) || n < 20 || n > 500) return null;
  if (n === 59 || n === 58) return 60;
  if (n === 119) return 120;
  if (n === 143) return 144;
  if (n === 164) return 165;
  if (n === 239) return 240;
  if (n >= 175 && n <= 185) return 180;
  return Math.round(n);
}

function normalize(raw, platform) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const fb = nodeFallback();
  const gpus = Array.isArray(base.gpus) ? base.gpus : (base.gpus ? [base.gpus] : []);
  const gpu = pickGpu(gpus);
  const displayGpu = gpus.find((g) => Number(g.width) > 0 && Number(g.height) > 0) || gpu;
  const ramGb = Number(base.ramGb) > 0 ? Number(base.ramGb) : fb.ramGb;
  return {
    platform,
    scannedAt: new Date().toISOString(),
    os: base.os || fb.os,
    cpu: {
      name: (base.cpuName || fb.cpuName || '').replace(/\s+/g, ' ').trim() || null,
      cores: Number(base.cores) || fb.cores,
      threads: Math.max(Number(base.threads) || 0, fb.threads || 0) || null,
      clockMhz: Number(base.clockMhz) || fb.clockMhz,
    },
    gpu: gpu
      ? {
          name: String(gpu.name || '').replace(/\s+/g, ' ').trim(),
          vendor: gpu.vendor || null,
          vramGb: Number(gpu.vramGb) > 0 ? Number(gpu.vramGb) : null,
          driver: gpu.driver || null,
        }
      : null,
    display: {
      width: Number(displayGpu?.width) > 0 ? Number(displayGpu.width) : null,
      height: Number(displayGpu?.height) > 0 ? Number(displayGpu.height) : null,
      refreshHz: cleanRefresh(displayGpu?.refreshHz),
    },
    ramGb,
    disks: (() => {
      const d = base.disks;
      const list = Array.isArray(d) ? d : (d ? [d] : []);
      return list.filter((row) => row?.name);
    })(),
    gpuCount: gpus.length,
  };
}

async function scanDeviceSpecs({ force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < CACHE_MS) return cached;
  if (inFlight && !force) return inFlight;

  inFlight = (async () => {
    const platform = process.platform;
    let raw = null;
    if (platform === 'win32') {
      try {
        const stdout = await execPs(PS_SCRIPT);
        if (stdout) raw = JSON.parse(stdout);
      } catch {
        raw = null;
      }
    }
    const result = normalize(raw, platform);
    cached = result;
    cachedAt = Date.now();
    return result;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

module.exports = { scanDeviceSpecs };
