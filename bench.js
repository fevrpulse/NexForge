const { Worker } = require('worker_threads');
const { execFile } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const CPU_MS = 2000;
const MULTI_MS = 2500;
const MEMORY_MS = 2000;
const DISK_MS = 2500;

const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads');

function cpu() {
  const ms = workerData.ms;
  const start = Date.now();
  let x = (0x12345678 + workerData.seed) | 0;
  let a = 1.1;
  let b = 1.2;
  let c = 1.3;
  let ops = 0;
  while (Date.now() - start < ms) {
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
    sink: (x + a + b + c),
  });
}

function memory() {
  const bytes = workerData.bytes;
  const ms = workerData.ms;
  const a = Buffer.allocUnsafe(bytes);
  const b = Buffer.allocUnsafe(bytes);
  a.fill(1);
  let copies = 0;
  const t0 = process.hrtime.bigint();
  while (Number(process.hrtime.bigint() - t0) / 1e6 < ms) {
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

if (workerData.kind === 'cpu') cpu();
else if (workerData.kind === 'memory') memory();
else parentPort.postMessage({ type: 'done', error: 'unknown test' });
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

function startWorker(job, workerData) {
  return new Promise((resolve, reject) => {
    if (job.cancelled) {
      resolve({ cancelled: true });
      return;
    }
    let settled = false;
    const worker = new Worker(WORKER_SRC, { eval: true, workerData });
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
      if (job.cancelled) finish(resolve, { cancelled: true });
      else finish(reject, err);
    });
    worker.on('exit', () => {
      if (job.cancelled) finish(resolve, { cancelled: true });
      else if (!settled) finish(reject, new Error('Benchmark worker stopped early.'));
    });
  });
}

function stopWorkers(job) {
  for (const worker of job.workers) {
    try { worker.terminate(); } catch { /* already gone */ }
  }
  if (job.diskProc) {
    try { job.diskProc.kill(); } catch { /* already gone */ }
  }
}

function report(onProgress, phase, label, pct) {
  try { onProgress?.({ phase, label, pct }); } catch { /* renderer went away */ }
}

async function runCpu(job, threads, ms, seedBase) {
  const tasks = [];
  for (let i = 0; i < threads; i++) {
    tasks.push(startWorker(job, { kind: 'cpu', ms, seed: seedBase + i * 997 }));
  }
  const parts = await Promise.all(tasks);
  if (parts.some((part) => part.cancelled) || job.cancelled) return { cancelled: true };
  const ops = parts.reduce((sum, part) => sum + (Number(part.ops) || 0), 0);
  const elapsedMs = parts.reduce((max, part) => Math.max(max, Number(part.elapsedMs) || 0), 0) || ms;
  return { opsPerSec: ops / (elapsedMs / 1000), threads };
}

function diskCap(free) {
  if (free == null) return 256 * 1024 * 1024;
  if (free > 6 * 1024 ** 3) return 1536 * 1024 * 1024;
  if (free > 3 * 1024 ** 3) return 768 * 1024 * 1024;
  if (free > 1200 * 1024 ** 2) return 256 * 1024 * 1024;
  return 0;
}

const DISK_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Globalization;
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
  public static string Run(string path, int cap, int ms) {
    const uint GR = 0x80000000, GW = 0x40000000, NB = 0x20000000, SEQ = 0x08000000, CA = 2, OE = 3;
    int chunk = 8 * 1024 * 1024;
    if (cap < chunk) return "ERR small";
    cap -= cap % chunk;
    IntPtr raw = Marshal.AllocHGlobal(chunk + 4096);
    IntPtr buf = new IntPtr((raw.ToInt64() + 4095) & ~4095L);
    IntPtr invalid = new IntPtr(-1);
    try {
      IntPtr h = CreateFile(path, GW, 0, IntPtr.Zero, CA, NB | SEQ, IntPtr.Zero);
      if (h == invalid) return "ERR write-open " + Marshal.GetLastWin32Error();
      long written = 0;
      var sw = Stopwatch.StartNew();
      uint got;
      while (written < cap && sw.ElapsedMilliseconds < ms) {
        if (!WriteFile(h, buf, (uint)chunk, out got, IntPtr.Zero) || got != (uint)chunk) {
          int code = Marshal.GetLastWin32Error();
          CloseHandle(h);
          return "ERR write " + code;
        }
        written += got;
      }
      CloseHandle(h);
      double writeMs = Math.Max(1, sw.Elapsed.TotalMilliseconds);
      h = CreateFile(path, GR, 1, IntPtr.Zero, OE, NB | SEQ, IntPtr.Zero);
      if (h == invalid) return "ERR read-open " + Marshal.GetLastWin32Error();
      long read = 0;
      sw.Restart();
      while (sw.ElapsedMilliseconds < ms) {
        if (!ReadFile(h, buf, (uint)chunk, out got, IntPtr.Zero) || got == 0) {
          if (SetFilePointer(h, 0, IntPtr.Zero, 0) != 0) break;
          continue;
        }
        read += got;
      }
      CloseHandle(h);
      double readMs = Math.Max(1, sw.Elapsed.TotalMilliseconds);
      double w = written / (writeMs / 1000.0) / 1e6;
      double r = read / (readMs / 1000.0) / 1e6;
      return "OK " + w.ToString("F1", CultureInfo.InvariantCulture) + " " + r.ToString("F1", CultureInfo.InvariantCulture);
    } finally {
      Marshal.FreeHGlobal(raw);
    }
  }
}
'@
Write-Output ([NfDiskBench]::Run($env:NF_DISK_FILE, [int]$env:NF_DISK_CAP, [int]$env:NF_DISK_MS))
`;

function runDisk(job, file, cap, ms) {
  if (process.platform !== 'win32') {
    return Promise.resolve({ skipped: 'The drive test runs on Windows.' });
  }
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      DISK_SCRIPT,
    ], {
      env: {
        ...process.env,
        NF_DISK_FILE: file,
        NF_DISK_CAP: String(cap),
        NF_DISK_MS: String(ms),
      },
      windowsHide: true,
      timeout: ms * 3 + 20000,
    }, (err, stdout) => {
      if (job.cancelled) {
        resolve({ cancelled: true });
        return;
      }
      if (err) {
        reject(err);
        return;
      }
      const line = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
      const parts = line.split(/\s+/);
      if (parts[0] !== 'OK') {
        reject(new Error(line || 'Drive test failed.'));
        return;
      }
      resolve({
        writeMBps: Number(parts[1]),
        readMBps: Number(parts[2]),
      });
    });
    job.diskProc = child;
  });
}

async function run({ onProgress } = {}) {
  if (current) {
    const err = new Error('A benchmark is already running.');
    err.code = 'BUSY';
    throw err;
  }
  const job = { cancelled: false, workers: [] };
  current = job;
  const threads = Math.max(1, Math.min(os.cpus().length || 1, 32));
  const cpuName = (os.cpus()?.[0]?.model || '').replace(/\s+/g, ' ').trim() || null;
  const file = path.join(os.tmpdir(), `nexforge-bench-${process.pid}.bin`);
  try {
    report(onProgress, 'cpu-single', 'Testing one processor core…', 6);
    const single = await runCpu(job, 1, CPU_MS, 1);
    if (single.cancelled || job.cancelled) return { cancelled: true };

    report(onProgress, 'cpu-multi', `Testing all ${threads} threads…`, 28);
    const multi = await runCpu(job, threads, MULTI_MS, 100);
    if (multi.cancelled || job.cancelled) return { cancelled: true };

    report(onProgress, 'memory', 'Testing memory…', 52);
    const freeRam = os.freemem();
    const ramBytes = Math.floor(Math.min(384 * 1024 * 1024, freeRam * 0.2));
    let memory = null;
    if (ramBytes < 48 * 1024 * 1024) {
      memory = { skipped: 'Not enough free memory to test.' };
    } else {
      const mem = await startWorker(job, { kind: 'memory', bytes: ramBytes, ms: MEMORY_MS });
      if (mem.cancelled || job.cancelled) return { cancelled: true };
      const gbps = (mem.copies * ramBytes) / (mem.elapsedMs / 1000) / 1e9;
      memory = { copyGbps: gbps, bytes: ramBytes };
    }

    report(onProgress, 'disk', 'Testing the drive…', 70);
    const dir = os.tmpdir();
    const free = freeBytes(dir);
    const cap = diskCap(free);
    let disk = null;
    if (!cap) {
      disk = { skipped: 'Not enough free space on the temp drive.' };
    } else {
      try {
        const raw = await runDisk(job, file, cap, DISK_MS);
        if (raw.cancelled || job.cancelled) return { cancelled: true };
        if (raw.skipped) disk = { skipped: raw.skipped };
        else if (!(raw.readMBps > 0)) disk = { skipped: 'The drive test did not get a long enough sample.' };
        else disk = { readMBps: raw.readMBps, writeMBps: raw.writeMBps };
      } catch {
        disk = { skipped: 'Could not test the drive.' };
      }
    }

    report(onProgress, 'done', 'Processor, memory, and drive are done.', 82);
    return {
      version: 1,
      at: Date.now(),
      cpuName,
      threads,
      cpu: {
        singleOpsPerSec: single.opsPerSec,
        multiOpsPerSec: multi.opsPerSec,
      },
      memory,
      disk,
    };
  } finally {
    stopWorkers(job);
    fs.promises.unlink(file).catch(() => {});
    if (current === job) current = null;
  }
}

function cancel() {
  if (!current) return { ok: true };
  current.cancelled = true;
  stopWorkers(current);
  return { ok: true };
}

module.exports = { run, cancel };

if (require.main === module) {
  run({ onProgress: (p) => console.log(`${p.pct} ${p.label}`) })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
