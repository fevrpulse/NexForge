const { Worker } = require('worker_threads');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const WRITE_CAP = 512 * 1024 * 1024;
const MEMORY_CAP = 256 * 1024 * 1024;

const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads');
const flag = new Int32Array(workerData.control);

function stopped() {
  return Atomics.load(flag, 0) === 2;
}

function cpu() {
  const start = Date.now();
  let x = (0x12345678 + workerData.seed) | 0;
  let a = 1.1;
  let b = 1.2;
  let c = 1.3;
  let ops = 0;
  while (Date.now() - start < workerData.ms) {
    if (stopped()) break;
    for (let i = 0; i < 256; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      a = b * c + 0.000001;
      b = c * a + 0.000001;
      c = a * b + 0.000001;
      if (a > 1e4) {
        a *= 1e-4;
        b *= 1e-4;
        c *= 1e-4;
      }
      ops++;
    }
  }
  parentPort.postMessage({
    type: 'done',
    ops,
    elapsedMs: Date.now() - start,
    sink: x + a + b + c,
  });
}

function memory() {
  const bytes = workerData.bytes;
  const a = Buffer.allocUnsafe(bytes);
  const b = Buffer.allocUnsafe(bytes);
  a.fill(1);
  let copies = 0;
  const t0 = process.hrtime.bigint();
  while (Number(process.hrtime.bigint() - t0) / 1e6 < workerData.ms) {
    if (stopped()) break;
    a.copy(b);
    copies += 1;
  }
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  parentPort.postMessage({
    type: 'done',
    copies,
    elapsedMs,
    sink: b[0] + b[bytes - 1],
  });
}

function cpuSpin() {
  let x = (0x9E3779B9 + workerData.seed) | 0;
  let a = 1.1;
  let b = 1.2;
  let c = 1.3;
  let ops = 0;
  let lastPost = Date.now();
  while (true) {
    const mode = Atomics.load(flag, 0);
    if (mode === 2) break;
    if (mode === 1) {
      if (ops) {
        parentPort.postMessage({ type: 'tick', ops });
        ops = 0;
      }
      Atomics.wait(flag, 0, 1, 250);
      continue;
    }
    const burst = Date.now();
    while (Date.now() - burst < 30) {
      for (let i = 0; i < 4096; i++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        a = b * c + 0.000001;
        b = c * a + 0.000001;
        c = a * b + 0.000001;
        if (a > 1e4) {
          a *= 1e-4;
          b *= 1e-4;
          c *= 1e-4;
        }
        ops++;
      }
    }
    if (Date.now() - lastPost > 300) {
      parentPort.postMessage({ type: 'tick', ops });
      ops = 0;
      lastPost = Date.now();
    }
  }
  parentPort.postMessage({ type: 'done', ops, sink: x + a + b + c });
}

if (workerData.kind === 'cpu') cpu();
else if (workerData.kind === 'memory') memory();
else if (workerData.kind === 'cpu-spin') cpuSpin();
else parentPort.postMessage({ type: 'done', error: 'unknown test' });
`;

const DISK_HOST = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
function Emit([string]$s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class NfDiskBench {
  [DllImport("kernel32", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32", SetLastError=true)]
  static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32", SetLastError=true)]
  static extern bool ReadFile(IntPtr h, IntPtr buf, uint n, out uint read, IntPtr ov);
  [DllImport("kernel32", SetLastError=true)]
  static extern bool WriteFile(IntPtr h, IntPtr buf, uint n, out uint written, IntPtr ov);
  [DllImport("kernel32", SetLastError=true)]
  static extern int SetFilePointer(IntPtr h, int lo, IntPtr hi, uint method);
  static readonly IntPtr Invalid = new IntPtr(-1);
  const uint GR = 0x80000000, GW = 0x40000000, NB = 0x20000000, SEQ = 0x08000000, CA = 2, OE = 3;
  const int Chunk = 8 * 1024 * 1024;
  static IntPtr Alloc() {
    IntPtr raw = Marshal.AllocHGlobal(Chunk + 4096);
    return raw;
  }
  static IntPtr Align(IntPtr raw) {
    return new IntPtr((raw.ToInt64() + 4095) & ~4095L);
  }
  public static string WriteOnce(string path, int cap) {
    if (cap < Chunk) return "ERR small";
    cap -= cap % Chunk;
    IntPtr raw = Alloc();
    try {
      IntPtr buf = Align(raw);
      IntPtr h = CreateFile(path, GW, 0, IntPtr.Zero, CA, NB | SEQ, IntPtr.Zero);
      if (h == Invalid) return "ERR write-open " + Marshal.GetLastWin32Error();
      long written = 0;
      var sw = Stopwatch.StartNew();
      uint got;
      try {
        while (written < cap && sw.ElapsedMilliseconds < 30000) {
          if (!WriteFile(h, buf, (uint)Chunk, out got, IntPtr.Zero) || got != (uint)Chunk) {
            return "ERR write " + Marshal.GetLastWin32Error();
          }
          written += got;
        }
      } finally { CloseHandle(h); }
      return "OK write " + written + " " + Math.Max(1, (long)sw.Elapsed.TotalMilliseconds);
    } finally { Marshal.FreeHGlobal(raw); }
  }
  public static string ReadFor(string path, int ms) {
    if (ms < 200) ms = 200;
    IntPtr raw = Alloc();
    try {
      IntPtr buf = Align(raw);
      IntPtr h = CreateFile(path, GR, 1, IntPtr.Zero, OE, NB | SEQ, IntPtr.Zero);
      if (h == Invalid) return "ERR read-open " + Marshal.GetLastWin32Error();
      long read = 0;
      var sw = Stopwatch.StartNew();
      uint got;
      try {
        while (sw.ElapsedMilliseconds < ms) {
          if (!ReadFile(h, buf, (uint)Chunk, out got, IntPtr.Zero) || got == 0) {
            if (SetFilePointer(h, 0, IntPtr.Zero, 0) != 0) break;
            continue;
          }
          read += got;
        }
      } finally { CloseHandle(h); }
      return "OK read " + read + " " + Math.Max(1, (long)sw.Elapsed.TotalMilliseconds);
    } finally { Marshal.FreeHGlobal(raw); }
  }
}
'@
Emit 'READY'
while ($true) {
  $line = [Console]::In.ReadLine()
  if ([string]::IsNullOrEmpty($line) -or $line -eq 'quit') { break }
  $parts = $line.Split(' ')
  if ($parts[0] -eq 'write') { Emit ([NfDiskBench]::WriteOnce($env:NF_DISK_FILE, [int]$parts[1])) }
  elseif ($parts[0] -eq 'read') { Emit ([NfDiskBench]::ReadFor($env:NF_DISK_FILE, [int]$parts[1])) }
  else { Emit 'ERR command' }
}
`;

let current = null;

function freeBytes(dir) {
  try {
    const stat = fs.statfsSync(dir);
    return Number(stat.bavail) * Number(stat.bsize);
  } catch {
    return null;
  }
}

function diskCap(free) {
  if (free == null) return 256 * 1024 * 1024;
  if (free > 2 * 1024 ** 3) return WRITE_CAP;
  if (free > 900 * 1024 ** 2) return 256 * 1024 * 1024;
  return 0;
}

function startWorker(job, workerData) {
  return new Promise((resolve, reject) => {
    if (job.stop) {
      resolve({ stopped: true });
      return;
    }
    let settled = false;
    const worker = new Worker(WORKER_SRC, {
      eval: true,
      workerData: { ...workerData, control: job.control },
    });
    job.workers.push(worker);
    function finish(fn, value) {
      if (settled) return;
      settled = true;
      fn(value);
    }
    worker.on('message', (msg) => {
      if (msg && msg.type === 'done') finish(resolve, msg);
    });
    worker.on('error', (err) => {
      if (job.stop) finish(resolve, { stopped: true });
      else finish(reject, err);
    });
    worker.on('exit', () => {
      if (settled) return;
      if (job.stop) finish(resolve, { stopped: true });
      else finish(reject, new Error('Benchmark worker stopped early.'));
    });
  });
}

function startDiskHost(job) {
  if (process.platform !== 'win32') {
    return Promise.resolve({ skipped: 'The drive test runs on Windows.' });
  }
  const cap = diskCap(freeBytes(os.tmpdir()));
  if (!cap) return Promise.resolve({ skipped: 'Not enough free space for a safe drive test.' });
  job.diskFile = path.join(os.tmpdir(), `nexforge-bench-${process.pid}.bin`);
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      DISK_HOST,
    ], {
      env: { ...process.env, NF_DISK_FILE: job.diskFile },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    job.diskProc = child;
    let errText = '';
    child.stderr.on('data', (chunk) => {
      errText = (errText + chunk.toString('utf8')).slice(-500);
    });
    let buf = '';
    const waiters = [];
    let ready = false;
    function fail(err) {
      if (!ready) reject(err);
      waiters.splice(0).forEach((waiter) => waiter.reject(err));
    }
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        idx = buf.indexOf('\n');
        if (!line) continue;
        if (!ready && line === 'READY') {
          ready = true;
          resolve({ cap });
          continue;
        }
        const waiter = waiters.shift();
        if (waiter) waiter.resolve(line);
      }
    });
    child.on('error', fail);
    child.on('exit', () => fail(new Error(errText.trim() || 'Drive test stopped.')));
    job.diskSend = (line) => new Promise((res, rej) => {
      if (job.stop || !child.stdin.writable) {
        rej(new Error('stopped'));
        return;
      }
      waiters.push({ resolve: res, reject: rej });
      child.stdin.write(`${line}\n`);
    });
    setTimeout(() => {
      if (!ready) fail(new Error('Drive test did not start.'));
    }, 20000);
  });
}

function parseOk(line, word) {
  const parts = String(line || '').trim().split(/\s+/);
  if (parts[0] !== 'OK' || parts[1] !== word) return null;
  return { bytes: Number(parts[2]), ms: Number(parts[3]) };
}

async function prepare() {
  if (current) {
    const err = new Error('A benchmark is already running.');
    err.code = 'BUSY';
    throw err;
  }
  const control = new SharedArrayBuffer(4);
  const job = {
    stop: false,
    control,
    flag: new Int32Array(control),
    workers: [],
    diskProc: null,
    diskSend: null,
    diskFile: null,
    diskBytes: 0,
    threads: Math.max(1, Math.min(os.cpus().length || 1, 32)),
    cpuName: (os.cpus()?.[0]?.model || '').replace(/\s+/g, ' ').trim() || null,
    seed: 1,
  };
  current = job;
  const freeRam = os.freemem();
  const memoryBytes = Math.floor(Math.min(MEMORY_CAP, freeRam * 0.12));
  const memorySkip = memoryBytes < 64 * 1024 * 1024
    ? 'Not enough free memory to test without using the page file.'
    : null;
  let diskSkip = null;
  let diskWriteMBps = null;
  try {
    const host = await startDiskHost(job);
    if (host.skipped) diskSkip = host.skipped;
    else if (job.stop) diskSkip = 'Ended.';
    else {
      const line = await job.diskSend(`write ${host.cap}`);
      const parsed = parseOk(line, 'write');
      if (!parsed || parsed.bytes < 32 * 1024 * 1024) diskSkip = 'The drive test did not get a long enough sample.';
      else {
        job.diskBytes = parsed.bytes;
        diskWriteMBps = (parsed.bytes / (parsed.ms / 1000)) / 1e6;
      }
    }
  } catch (err) {
    diskSkip = 'Could not test the drive.';
    if (require.main === module) console.error(err);
  }
  return {
    cpuName: job.cpuName,
    threads: job.threads,
    memoryBytes: memorySkip ? 0 : memoryBytes,
    memorySkip,
    diskSkip,
    diskWriteMBps,
  };
}

async function runCpu(job, threads, ms) {
  const tasks = [];
  for (let i = 0; i < threads; i++) {
    job.seed += 1;
    tasks.push(startWorker(job, { kind: 'cpu', ms, seed: job.seed }));
  }
  const parts = await Promise.all(tasks);
  if (job.stop || parts.some((part) => part.stopped && !part.ops)) {
    const ops = parts.reduce((sum, part) => sum + (Number(part.ops) || 0), 0);
    const elapsedMs = parts.reduce((max, part) => Math.max(max, Number(part.elapsedMs) || 0), 0);
    return { ops, elapsedMs, stopped: job.stop, threads };
  }
  const ops = parts.reduce((sum, part) => sum + (Number(part.ops) || 0), 0);
  const elapsedMs = parts.reduce((max, part) => Math.max(max, Number(part.elapsedMs) || 0), 0) || ms;
  return { ops, elapsedMs, stopped: !!job.stop, threads };
}

function noteCpuOps(job, worker) {
  worker.on('message', (msg) => {
    if (!msg || (msg.type !== 'tick' && msg.type !== 'done')) return;
    job.cpuOps += Number(msg.ops) || 0;
  });
}

function startCpuLoad(job) {
  if (job.cpuLoad) return { threads: job.threads };
  job.cpuOps = 0;
  job.cpuBusyMs = 0;
  job.cpuMark = Date.now();
  job.cpuEased = false;
  job.cpuLoad = true;
  if (Atomics.load(job.flag, 0) !== 2) {
    Atomics.store(job.flag, 0, 0);
    Atomics.notify(job.flag, 0);
  }
  for (let i = 0; i < job.threads; i++) {
    job.seed += 1;
    const worker = new Worker(WORKER_SRC, {
      eval: true,
      workerData: { kind: 'cpu-spin', seed: job.seed, control: job.control },
    });
    noteCpuOps(job, worker);
    job.workers.push(worker);
  }
  return { threads: job.threads };
}

function setCpuEase(job, on) {
  if (!job.cpuLoad) return { eased: false };
  if (Atomics.load(job.flag, 0) === 2) return { eased: true };
  if (on && !job.cpuEased) {
    job.cpuBusyMs += Date.now() - job.cpuMark;
    job.cpuEased = true;
    Atomics.store(job.flag, 0, 1);
    Atomics.notify(job.flag, 0);
  } else if (!on && job.cpuEased) {
    job.cpuEased = false;
    job.cpuMark = Date.now();
    Atomics.store(job.flag, 0, 0);
    Atomics.notify(job.flag, 0);
  }
  return { eased: job.cpuEased };
}

function stopCpuLoad(job) {
  if (!job.cpuLoad) return Promise.resolve({ ops: 0, elapsedMs: 0, threads: job.threads });
  if (!job.cpuEased) job.cpuBusyMs += Date.now() - job.cpuMark;
  const elapsedMs = job.cpuBusyMs;
  Atomics.store(job.flag, 0, 2);
  Atomics.notify(job.flag, 0);
  job.cpuLoad = false;
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ ops: job.cpuOps || 0, elapsedMs, threads: job.threads, stopped: !!job.stop });
    }, 180);
  });
}

async function phase(opts = {}) {
  const job = current;
  if (!job) {
    const err = new Error('Benchmark is not running.');
    err.code = 'IDLE';
    throw err;
  }
  const ms = Math.max(500, Math.min(60000, Number(opts.ms) || 1000));
  if (job.stop && opts.kind !== 'cpu-stop') return { stopped: true };
  if (opts.kind === 'cpu-start') return startCpuLoad(job);
  if (opts.kind === 'cpu-ease') return setCpuEase(job, !!opts.on);
  if (opts.kind === 'cpu-stop') return stopCpuLoad(job);
  if (opts.kind === 'cpu-single') {
    if (Atomics.load(job.flag, 0) !== 2) Atomics.store(job.flag, 0, 0);
    return runCpu(job, 1, ms);
  }
  if (opts.kind === 'cpu-multi') return runCpu(job, job.threads, ms);
  if (opts.kind === 'memory') {
    const bytes = Math.floor(Number(opts.bytes) || 0);
    if (bytes < 64 * 1024 * 1024) return { skipped: 'Not enough free memory.' };
    const mem = await startWorker(job, { kind: 'memory', bytes, ms });
    if (mem.stopped && !mem.copies) return { stopped: true, copies: 0, elapsedMs: 0 };
    return { copies: Number(mem.copies) || 0, elapsedMs: Number(mem.elapsedMs) || 0, stopped: !!job.stop };
  }
  if (opts.kind === 'disk') {
    if (!job.diskSend || job.diskBytes < 32 * 1024 * 1024) return { skipped: 'Drive test is not running.' };
    let bytes = 0;
    let elapsed = 0;
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (job.stop) break;
      const slice = Math.min(2500, end - Date.now());
      if (slice < 400) break;
      try {
        const line = await job.diskSend(`read ${slice}`);
        const parsed = parseOk(line, 'read');
        if (!parsed) break;
        bytes += parsed.bytes;
        elapsed += parsed.ms;
      } catch {
        if (job.stop) break;
        return { skipped: 'Could not read the drive.' };
      }
    }
    return { bytes, elapsedMs: elapsed, stopped: !!job.stop };
  }
  return { skipped: 'Unknown test.' };
}

async function finish() {
  const job = current;
  current = null;
  if (!job) return { ok: true };
  job.stop = true;
  Atomics.store(job.flag, 0, 2);
  Atomics.notify(job.flag, 0);
  if (job.diskProc) {
    try { job.diskProc.stdin.write('quit\n'); } catch { /* closed */ }
    try { job.diskProc.kill(); } catch { /* already gone */ }
  }
  for (const worker of job.workers) {
    try { worker.terminate(); } catch { /* already gone */ }
  }
  if (job.diskFile) await fs.promises.unlink(job.diskFile).catch(() => {});
  return { ok: true };
}

function cancel() {
  if (!current) return { ok: true };
  current.stop = true;
  Atomics.store(current.flag, 0, 2);
  Atomics.notify(current.flag, 0);
  if (current.diskProc) {
    try { current.diskProc.kill(); } catch { /* already gone */ }
  }
  return { ok: true };
}

module.exports = { prepare, phase, finish, cancel };

if (require.main === module) {
  (async () => {
    const prep = await prepare();
    console.log('prep', prep);
    const cpu = await phase({ kind: 'cpu-single', ms: 1200 });
    console.log('cpu', { ops: cpu.ops, elapsedMs: cpu.elapsedMs });
    if (!prep.diskSkip) {
      const disk = await phase({ kind: 'disk', ms: 1200 });
      console.log('disk', disk);
    }
    await finish();
  })().catch((err) => {
    console.error(err);
    finish().finally(() => process.exit(1));
  });
}
