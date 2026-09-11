const { execFile } = require('child_process');
const os = require('os');

const CACHE_MS = 15 * 60 * 1000;

let cached = null;
let cachedAt = 0;
let inFlight = null;

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
function S($v) { if ($null -eq $v) { return $null }; $t = ([string]$v).Trim(); if ($t.Length -eq 0) { return $null }; return $t }
function Ki($v) { if ($null -eq $v) { return $null }; try { return [int]$v } catch { return $null } }
function Gb($bytes) { if ($null -eq $bytes -or [double]$bytes -le 0) { return $null }; return [math]::Round(([double]$bytes / 1GB), 1) }
function DecodeU16($arr) {
  if ($null -eq $arr) { return $null }
  $chars = @()
  foreach ($n in @($arr)) { if ($n -le 0) { break }; $chars += [char]$n }
  if ($chars.Count -eq 0) { return $null }
  return (-join $chars).Trim()
}

$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpus = @(Get-CimInstance Win32_VideoController | Where-Object {
  $_.Name -and $_.Name -notmatch 'Remote Desktop|Microsoft Basic|Microsoft Hyper-V'
})
$cs = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$board = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
$bios = Get-CimInstance Win32_BIOS | Select-Object -First 1
$enc = Get-CimInstance Win32_SystemEnclosure | Select-Object -First 1
$memArray = Get-CimInstance Win32_PhysicalMemoryArray | Select-Object -First 1

$regVram = @()
try {
  $regRoot = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'
  Get-ChildItem $regRoot -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^\\d+$' } | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    $desc = S $p.DriverDesc
    $qw = $p.'HardwareInformation.qwMemorySize'
    if ($desc -and $qw -gt 67108864) {
      $regVram += [pscustomobject]@{ name = $desc; vramGb = [math]::Round(([double]$qw / 1GB), 1) }
    }
  }
} catch {}

$disks = @()
try {
  $disks = @(Get-PhysicalDisk | ForEach-Object {
    [pscustomobject]@{
      name = S $_.FriendlyName
      media = S $_.MediaType
      bus = S $_.BusType
      health = S $_.HealthStatus
      sizeGb = if ($_.Size) { [int][math]::Round(($_.Size / 1GB), 0) } else { $null }
    }
  })
} catch {
  $disks = @(Get-CimInstance Win32_DiskDrive | Select-Object -First 6 | ForEach-Object {
    [pscustomobject]@{
      name = S $_.Model
      media = S $_.MediaType
      bus = S $_.InterfaceType
      health = $null
      sizeGb = if ($_.Size) { [int][math]::Round(($_.Size / 1GB), 0) } else { $null }
    }
  })
}

$volumes = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object -First 8 | ForEach-Object {
  [pscustomobject]@{
    letter = S $_.DeviceID
    fs = S $_.FileSystem
    sizeGb = if ($_.Size) { [int][math]::Round(($_.Size / 1GB), 0) } else { $null }
    freeGb = if ($null -ne $_.FreeSpace) { [int][math]::Round(($_.FreeSpace / 1GB), 0) } else { $null }
  }
})

$dimms = @()
try {
  $dimms = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
    $spd = Ki $_.ConfiguredClockSpeed
    if (-not $spd) { $spd = Ki $_.Speed }
    $kind = $null
    switch ([int]$_.SMBIOSMemoryType) {
      20 { $kind = 'DDR' }
      21 { $kind = 'DDR2' }
      24 { $kind = 'DDR3' }
      26 { $kind = 'DDR4' }
      34 { $kind = 'DDR5' }
    }
    [pscustomobject]@{
      slot = S $_.DeviceLocator
      manufacturer = S $_.Manufacturer
      part = S $_.PartNumber
      gb = Gb $_.Capacity
      speedMhz = $spd
      type = $kind
    }
  })
} catch {}

$gpuOut = @($gpus | ForEach-Object {
  $ramGb = $null
  if ($_.AdapterRAM -and $_.AdapterRAM -gt 67108864 -and $_.AdapterRAM -lt 4000000000) {
    $ramGb = [math]::Round(($_.AdapterRAM / 1GB), 1)
  }
  $dd = $null
  if ($_.DriverDate) {
    try { $dd = ([datetime]$_.DriverDate).ToString('yyyy-MM-dd') } catch {}
  }
  [pscustomobject]@{
    name = S $_.Name
    vendor = S $_.AdapterCompatibility
    vramGb = $ramGb
    width = Ki $_.CurrentHorizontalResolution
    height = Ki $_.CurrentVerticalResolution
    refreshHz = Ki $_.CurrentRefreshRate
    driver = S $_.DriverVersion
    driverDate = $dd
    pnp = S $_.PNPDeviceID
    dac = S $_.AdapterDACType
  }
})

$monitors = @()
try {
  Add-Type -AssemblyName System.Windows.Forms
  $monitors = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
    [pscustomobject]@{
      name = S $_.DeviceName
      primary = [bool]$_.Primary
      width = [int]$_.Bounds.Width
      height = [int]$_.Bounds.Height
      bits = Ki $_.BitsPerPixel
    }
  })
} catch {}

try {
  $ids = @(Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID)
  $i = 0
  foreach ($id in $ids) {
    $label = DecodeU16 $id.UserFriendlyName
    $mfr = DecodeU16 $id.ManufacturerName
    if ($label -and $monitors.Count -gt $i) {
      $monitors[$i].name = $label
      if ($mfr) { $monitors[$i] | Add-Member -NotePropertyName vendor -NotePropertyValue $mfr -Force }
    } elseif ($label) {
      $monitors += [pscustomobject]@{ name = $label; vendor = $mfr; primary = $false; width = $null; height = $null; bits = $null }
    }
    $i++
  }
} catch {}

$nics = @(Get-CimInstance Win32_NetworkAdapter | Where-Object {
  $_.NetEnabled -eq $true -and $_.Name -and $_.Name -notmatch 'Virtual|Hyper-V|VMware|VPN|TAP|Bluetooth|Loopback|WAN Miniport|Microsoft Kernel'
} | Select-Object -First 8 | ForEach-Object {
  $mbps = $null
  if ($_.Speed -and $_.Speed -gt 0 -and $_.Speed -lt 1000000000000) {
    $mbps = [int][math]::Round(($_.Speed / 1MB), 0)
  }
  $kind = S $_.AdapterType
  $nm = S $_.NetConnectionID
  if (-not $nm) { $nm = S $_.Name }
  if ($nm -match 'Wi-?Fi|Wireless|802\\.11|WLAN') { $kind = 'Wi-Fi' }
  elseif ($nm -match 'Ethernet|LAN') { $kind = 'Ethernet' }
  [pscustomobject]@{
    name = $nm
    type = $kind
    speedMbps = $mbps
  }
})

$chassisCodes = @()
try { $chassisCodes = @($enc.ChassisTypes) } catch {}
$biosDate = $null
if ($bios.ReleaseDate) {
  try { $biosDate = ([datetime]$bios.ReleaseDate).ToString('yyyy-MM-dd') } catch {}
}

[pscustomobject]@{
  cpuName = S $cpu.Name
  cpuVendor = S $cpu.Manufacturer
  cores = Ki $cpu.NumberOfCores
  threads = Ki $cpu.NumberOfLogicalProcessors
  clockMhz = Ki $cpu.MaxClockSpeed
  currentMhz = Ki $cpu.CurrentClockSpeed
  socket = S $cpu.SocketDesignation
  l2Kb = Ki $cpu.L2CacheSize
  l3Kb = Ki $cpu.L3CacheSize
  cpuArch = Ki $cpu.AddressWidth
  virtualization = [bool]$cpu.VirtualizationFirmwareEnabled
  ramGb = Gb $cs.TotalPhysicalMemory
  ramFreeGb = if ($os.FreePhysicalMemory) { [math]::Round(($os.FreePhysicalMemory / 1024 / 1024), 1) } else { $null }
  ramSlots = Ki $memArray.MemoryDevices
  os = S $os.Caption
  osVersion = S $os.Version
  osBuild = S $os.BuildNumber
  osArch = S $os.OSArchitecture
  systemManufacturer = S $cs.Manufacturer
  systemModel = S $cs.Model
  systemType = Ki $cs.PCSystemType
  hypervisor = [bool]$cs.HypervisorPresent
  chassis = $chassisCodes
  boardManufacturer = S $board.Manufacturer
  boardProduct = S $board.Product
  biosVendor = S $bios.Manufacturer
  biosVersion = S $bios.SMBIOSBIOSVersion
  biosDate = $biosDate
  gpus = $gpuOut
  disks = $disks
  volumes = $volumes
  dimms = $dimms
  monitors = $monitors
  nics = $nics
  regVram = $regVram
} | ConvertTo-Json -Compress -Depth 6
`.trim();

function execFileAsync(file, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve('');
        resolve(String(stdout || '').trim());
      },
    );
  });
}

function execPs(script, timeoutMs = 20000) {
  return execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    timeoutMs,
  );
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function text(v) {
  const s = String(v || '').replace(/\s+/g, ' ').trim();
  return s || null;
}

function asList(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return [v];
  return [];
}

function nodeFallback() {
  const cpus = os.cpus() || [];
  const cpu = cpus[0] || {};
  const nics = [];
  const ifaces = os.networkInterfaces() || {};
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!Array.isArray(addrs)) continue;
    if (addrs.every((a) => a.internal)) continue;
    nics.push({ name, type: null, speedMbps: null });
    if (nics.length >= 6) break;
  }
  return {
    cpuName: cpu.model || null,
    cores: cpus.length || null,
    threads: cpus.length || null,
    clockMhz: cpu.speed || null,
    ramGb: Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10,
    ramFreeGb: Math.round((os.freemem() / (1024 ** 3)) * 10) / 10,
    os: `${os.type()} ${os.release()}`,
    osArch: os.arch() || null,
    gpus: [],
    disks: [],
    volumes: [],
    dimms: [],
    monitors: [],
    nics,
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
  const list = gpus.filter((g) => g?.name);
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

function lookupNamed(list, name) {
  const n = String(name || '').toLowerCase().replace(/nvidia\s+|amd\s+|intel\(r\)\s+|intel\s+/g, '').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  const rows = asList(list);
  const score = (row) => String(row?.name || '').toLowerCase().replace(/nvidia\s+|amd\s+|intel\(r\)\s+|intel\s+/g, '').replace(/\s+/g, ' ').trim();
  const exact = rows.find((r) => score(r) === n);
  if (exact) return exact;
  return rows.find((r) => {
    const k = score(r);
    return k && (n.includes(k) || k.includes(n));
  }) || null;
}

function snapVram(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const nearest = Math.round(n);
  if (Math.abs(n - nearest) < 0.2) return nearest;
  return Math.round(n * 10) / 10;
}

function parseNvidiaSmi(stdout) {
  if (!stdout) return [];
  return stdout.split(/\r?\n/).map((line) => {
    const parts = line.split(',').map((s) => s.trim());
    if (parts.length < 2) return null;
    const [name, mem, driver, gpuClock, memClock, temp] = parts;
    const mb = Number(mem);
    return {
      name: text(name),
      vramGb: Number.isFinite(mb) && mb > 0 ? Math.round((mb / 1024) * 10) / 10 : null,
      driver: text(driver),
      boostMhz: num(gpuClock),
      memMhz: num(memClock),
      tempC: num(temp),
    };
  }).filter((row) => row?.name);
}

async function nvidiaSmiGpus() {
  const stdout = await execFileAsync(
    'nvidia-smi',
    ['--query-gpu=name,memory.total,driver_version,clocks.max.gr,clocks.max.mem,temperature.gpu', '--format=csv,noheader,nounits'],
    4500,
  );
  return parseNvidiaSmi(stdout);
}

function systemKind(type, chassis) {
  const codes = asList(chassis).map((n) => Number(n)).filter((n) => Number.isFinite(n));
  if (codes.some((c) => c === 8 || c === 9 || c === 10 || c === 11 || c === 14 || c === 30 || c === 31 || c === 32)) {
    return 'laptop';
  }
  const t = Number(type);
  if (t === 2 || t === 8 || t === 9) return 'laptop';
  if (t === 1 || t === 3) return 'desktop';
  return null;
}

function normalizeGpu(gpu, extras) {
  const name = text(gpu.name);
  const smiList = asList(extras.smi);
  let smi = lookupNamed(smiList, name);
  if (!smi && smiList.length === 1 && /nvidia|geforce|rtx|gtx|quadro/i.test(name || '')) smi = smiList[0];
  const reg = lookupNamed(extras.regVram, name);
  const vram = snapVram(smi?.vramGb || reg?.vramGb || gpu.vramGb);
  return {
    name,
    vendor: text(gpu.vendor),
    vramGb: vram,
    driver: text(smi?.driver) || text(gpu.driver),
    driverDate: text(gpu.driverDate),
    boostMhz: num(smi?.boostMhz),
    memMhz: num(smi?.memMhz),
    tempC: num(smi?.tempC),
    pnp: text(gpu.pnp),
    width: num(gpu.width),
    height: num(gpu.height),
    refreshHz: cleanRefresh(gpu.refreshHz),
  };
}

function normalize(raw, platform, extras = {}) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const fb = nodeFallback();
  const gpus = asList(base.gpus).map((g) => normalizeGpu(g, extras)).filter((g) => g.name);
  if (!gpus.length && extras.smi?.length) {
    for (const row of extras.smi) {
      gpus.push({
        name: row.name,
        vendor: 'NVIDIA',
        vramGb: snapVram(row.vramGb),
        driver: row.driver,
        driverDate: null,
        boostMhz: row.boostMhz,
        memMhz: row.memMhz,
        tempC: row.tempC,
        pnp: null,
        width: null,
        height: null,
        refreshHz: null,
      });
    }
  }
  const gpu = pickGpu(gpus);
  const monitors = asList(base.monitors)
    .map((m) => ({
      name: text(m.name) || (m.primary ? 'Primary' : 'Display'),
      vendor: text(m.vendor),
      primary: !!m.primary,
      width: num(m.width),
      height: num(m.height),
    }))
    .filter((m) => m.width || m.name);
  const displayGpu = gpus.find((g) => g.width && g.height) || gpu;
  const primaryMon = monitors.find((m) => m.primary && m.width && m.height) || monitors.find((m) => m.width && m.height);
  const dimms = asList(base.dimms)
    .map((d) => ({
      slot: text(d.slot),
      manufacturer: text(d.manufacturer),
      part: text(d.part),
      gb: num(d.gb),
      speedMhz: num(d.speedMhz),
      type: text(d.type),
    }))
    .filter((d) => d.gb || d.slot);
  const ramSpeeds = dimms.map((d) => d.speedMhz).filter(Boolean);
  const ramTypes = [...new Set(dimms.map((d) => d.type).filter(Boolean))];
  const ramGb = num(base.ramGb) || fb.ramGb;
  const ramFreeGb = num(base.ramFreeGb) || (platform !== 'win32' ? fb.ramFreeGb : null);

  return {
    platform,
    scannedAt: new Date().toISOString(),
    os: text(base.os) || fb.os,
    osVersion: text(base.osVersion),
    osBuild: text(base.osBuild),
    osArch: text(base.osArch) || fb.osArch,
    system: {
      manufacturer: text(base.systemManufacturer),
      model: text(base.systemModel),
      kind: systemKind(base.systemType, base.chassis),
      hypervisor: !!base.hypervisor,
    },
    board: {
      manufacturer: text(base.boardManufacturer),
      product: text(base.boardProduct),
    },
    bios: {
      vendor: text(base.biosVendor),
      version: text(base.biosVersion),
      date: text(base.biosDate),
    },
    cpu: {
      name: text(base.cpuName || fb.cpuName),
      vendor: text(base.cpuVendor),
      cores: num(base.cores) || fb.cores,
      threads: Math.max(num(base.threads) || 0, fb.threads || 0) || null,
      clockMhz: num(base.clockMhz) || fb.clockMhz,
      currentMhz: num(base.currentMhz),
      socket: text(base.socket),
      l2Kb: num(base.l2Kb),
      l3Kb: num(base.l3Kb),
      arch: num(base.cpuArch),
      virtualization: base.virtualization == null ? null : !!base.virtualization,
    },
    gpu: gpu
      ? {
          name: gpu.name,
          vendor: gpu.vendor,
          vramGb: gpu.vramGb,
          driver: gpu.driver,
          driverDate: gpu.driverDate,
          boostMhz: gpu.boostMhz,
          memMhz: gpu.memMhz,
          tempC: gpu.tempC,
        }
      : null,
    gpus: gpus.map((g) => ({
      name: g.name,
      vendor: g.vendor,
      vramGb: g.vramGb,
      driver: g.driver,
    })),
    display: {
      width: primaryMon?.width || displayGpu?.width || null,
      height: primaryMon?.height || displayGpu?.height || null,
      refreshHz: displayGpu?.refreshHz || null,
    },
    monitors,
    ramGb,
    ramFreeGb,
    ram: {
      totalGb: ramGb,
      freeGb: ramFreeGb,
      speedMhz: ramSpeeds.length ? Math.max(...ramSpeeds) : null,
      type: ramTypes[0] || null,
      slots: num(base.ramSlots) || dimms.length || null,
      usedSlots: dimms.length || null,
      modules: dimms,
    },
    disks: asList(base.disks)
      .map((row) => ({
        name: text(row.name),
        media: text(row.media),
        bus: text(row.bus),
        health: text(row.health),
        sizeGb: num(row.sizeGb) ? Math.round(Number(row.sizeGb)) : null,
      }))
      .filter((row) => row.name),
    volumes: asList(base.volumes)
      .map((row) => ({
        letter: text(row.letter),
        fs: text(row.fs),
        sizeGb: num(row.sizeGb) ? Math.round(Number(row.sizeGb)) : null,
        freeGb: row.freeGb == null ? null : Math.round(Number(row.freeGb)),
      }))
      .filter((row) => row.letter),
    network: asList(base.nics).length
      ? asList(base.nics)
        .map((row) => ({
          name: text(row.name),
          type: text(row.type),
          speedMbps: num(row.speedMbps),
        }))
        .filter((row) => row.name)
      : fb.nics,
    gpuCount: gpus.length,
  };
}

async function scanDeviceSpecs({ force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < CACHE_MS) return cached;
  if (inFlight && !force) return inFlight;

  inFlight = (async () => {
    const platform = process.platform;
    let raw = null;
    let smi = [];
    if (platform === 'win32') {
      const [stdout, smiRows] = await Promise.all([
        execPs(PS_SCRIPT),
        nvidiaSmiGpus(),
      ]);
      smi = smiRows;
      if (stdout) {
        try {
          raw = JSON.parse(stdout);
        } catch {
          raw = null;
        }
      }
    }
    const result = normalize(raw, platform, { smi, regVram: raw?.regVram });
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
