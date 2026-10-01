/** NexForge Bench 3. A score of 1000 matches the baseline throughput for that part. */
export const BENCH_VERSION = 3;

export const BENCH_LIMIT_MS = 10 * 60 * 1000;
export const CPU_EASE_C = 90;
export const GPU_EASE_C = 87;

export const BENCH_BASELINE = {
  cpuSingleOps: 120e6,
  cpuMultiOps: 600e6,
  memoryGbps: 14,
  diskReadMBps: 2200,
  // Heavier Bench 3 shader. 210 keeps a fast card near its previous graphics index.
  gpuGigaSteps: 210,
};

export function formatOps(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B ops/s`;
  if (n >= 1e6) return `${Math.round(n / 1e6)}M ops/s`;
  return `${Math.round(n)} ops/s`;
}

export function formatGbps(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${n.toFixed(1)} GB/s`;
}

export function formatClock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatMBps(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${Math.round(n).toLocaleString()} MB/s`;
}

function indexOf(value, baseline) {
  if (!Number.isFinite(value) || value <= 0 || !baseline) return 0;
  return (value / baseline) * 1000;
}

function geo(nums) {
  const usable = nums.filter((n) => n > 0);
  if (!usable.length) return 0;
  const log = usable.reduce((sum, n) => sum + Math.log(n), 0) / usable.length;
  return Math.round(Math.exp(log));
}

export function scoreBenchmark(raw, gpu, meta = {}) {
  const single = indexOf(raw?.cpu?.singleOpsPerSec, BENCH_BASELINE.cpuSingleOps);
  const multi = indexOf(raw?.cpu?.multiOpsPerSec, BENCH_BASELINE.cpuMultiOps);
  const cpu = Math.round(single * 0.4 + multi * 0.6);
  const memory = raw?.memory?.skipped ? 0 : Math.round(indexOf(raw?.memory?.copyGbps, BENCH_BASELINE.memoryGbps));
  const disk = raw?.disk?.skipped ? 0 : Math.round(indexOf(raw?.disk?.readMBps, BENCH_BASELINE.diskReadMBps));
  const graphics = gpu?.skipped ? 0 : Math.round(indexOf(gpu?.gigaSteps, BENCH_BASELINE.gpuGigaSteps));
  const overall = geo([cpu, memory, disk, graphics]);
  return {
    version: BENCH_VERSION,
    at: raw?.at || Date.now(),
    cpuName: raw?.cpuName || null,
    threads: raw?.threads || null,
    cpu: {
      score: cpu,
      singleOpsPerSec: raw?.cpu?.singleOpsPerSec || 0,
      multiOpsPerSec: raw?.cpu?.multiOpsPerSec || 0,
    },
    memory: raw?.memory?.skipped
      ? { skipped: raw.memory.skipped, score: 0 }
      : { score: memory, copyGbps: raw?.memory?.copyGbps || 0 },
    disk: raw?.disk?.skipped
      ? { skipped: raw.disk.skipped, score: 0 }
      : {
        score: disk,
        readMBps: raw?.disk?.readMBps || 0,
        writeMBps: raw?.disk?.writeMBps || 0,
      },
    graphics: gpu?.skipped
      ? { skipped: gpu.skipped, score: 0 }
      : {
        score: graphics,
        gigaSteps: gpu?.gigaSteps || 0,
        method: gpu?.method || null,
        renderer: gpu?.renderer || null,
      },
    overall,
    tier: tierFor(overall),
    limit: limitNote({ cpu, memory, disk, graphics }),
    durationSec: Math.max(0, Math.round(Number(meta.durationSec) || 0)),
    eased: meta.eased || null,
    postedLocal: true,
  };
}

export function tierFor(overall) {
  if (overall >= 2200) {
    return {
      id: 'enthusiast',
      label: 'Enthusiast',
      line: 'This PC has room for high resolutions and higher settings.',
    };
  }
  if (overall >= 1500) {
    return {
      id: 'high',
      label: 'High',
      line: 'This PC is comfortable at 1440p in most games.',
    };
  }
  if (overall >= 950) {
    return {
      id: 'solid',
      label: 'Solid',
      line: 'This PC is comfortable at 1080p in most games.',
    };
  }
  if (overall >= 550) {
    return {
      id: 'casual',
      label: 'Casual',
      line: 'Lighter games will run well. Turn settings down in heavier ones.',
    };
  }
  return {
    id: 'entry',
    label: 'Entry',
    line: 'This PC is best on lighter games and lower settings.',
  };
}

const LIMITS = {
  cpu: 'The processor is the limit for games that simulate a lot or use one core hard.',
  memory: 'Memory speed is the limit. The processor and graphics are ahead of it.',
  disk: 'The drive is the limit. Games will spend more time loading.',
  graphics: 'Graphics is the limit for higher settings and resolutions.',
};

export function limitNote(scores) {
  const parts = Object.entries(scores).filter(([, score]) => score > 0);
  if (parts.length < 2) return 'Run the full test to see which part is the limit.';
  parts.sort((a, b) => a[1] - b[1]);
  const [lowKey, low] = parts[0];
  const rest = parts.slice(1).map(([, score]) => score).sort((a, b) => a - b);
  const mid = rest[Math.floor((rest.length - 1) / 2)];
  if (mid > 0 && low < mid * 0.55) return LIMITS[lowKey];
  return 'The parts are close. No single part is holding the rest back.';
}

export function formatBenchText(result) {
  if (!result) return '';
  const lines = [
    'NexForge Benchmark',
    result.cpuName,
    result.durationSec ? `Ran ${formatClock(result.durationSec)} of 10:00` : null,
    `Overall ${result.overall.toLocaleString()} · ${result.tier?.label || ''}`,
    result.tier?.line,
    result.limit,
    `Processor ${result.cpu.score.toLocaleString()} · ${formatOps(result.cpu.singleOpsPerSec)} one core · ${formatOps(result.cpu.multiOpsPerSec)} all cores`,
    result.memory.skipped
      ? `Memory — ${result.memory.skipped}`
      : `Memory ${result.memory.score.toLocaleString()} · ${formatGbps(result.memory.copyGbps)} copy`,
    result.disk.skipped
      ? `Drive — ${result.disk.skipped}`
      : `Drive ${result.disk.score.toLocaleString()} · ${formatMBps(result.disk.readMBps)} read · ${formatMBps(result.disk.writeMBps)} write`,
    result.graphics.skipped
      ? `Graphics — ${result.graphics.skipped}`
      : `Graphics ${result.graphics.score.toLocaleString()}${result.graphics.renderer ? ` · ${result.graphics.renderer}` : ''}`,
  ];
  return lines.filter(Boolean).join('\n');
}
