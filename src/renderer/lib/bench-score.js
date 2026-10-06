/** NexForge Bench 4. A score of 1000 matches a solid 1080p PC on this render. */
export const BENCH_VERSION = 4;

export const BENCH_LIMIT_MS = 10 * 60 * 1000;
export const CPU_EASE_C = 90;
export const GPU_EASE_C = 87;

export const BENCH_BASELINE = {
  singleSamples: 560000,
  multiSamples: 1900000,
  gpuSamples: 70000000,
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
  return Math.max(0, Math.min(50000, Math.round((value / baseline) * 1000)));
}

export function scoreBenchmark(acc = {}, meta = {}) {
  const singleRate = acc.singleMs > 0 ? acc.singleSamples / (acc.singleMs / 1000) : 0;
  const multiRate = acc.multiMs > 0 ? acc.multiSamples / (acc.multiMs / 1000) : 0;
  const gpuRate = !acc.gpuSkipped && acc.gpuMs > 0 ? acc.gpuSamples / (acc.gpuMs / 1000) : 0;
  const single = indexOf(singleRate, BENCH_BASELINE.singleSamples);
  const multi = indexOf(multiRate, BENCH_BASELINE.multiSamples);
  const graphics = acc.gpuSkipped ? 0 : indexOf(gpuRate, BENCH_BASELINE.gpuSamples);
  const overall = multi || single || graphics;
  const ratio = singleRate > 0 && multiRate > 0 ? multiRate / singleRate : 0;
  return {
    version: BENCH_VERSION,
    at: acc.at || Date.now(),
    cpuName: meta.cpuName || acc.cpuName || null,
    threads: meta.threads || acc.threads || null,
    cpu: {
      score: single,
      singlePts: single,
      multiPts: multi,
      ratio,
    },
    memory: { skipped: 'This render does not score memory.', score: 0 },
    disk: { skipped: 'This render does not score the drive.', score: 0 },
    graphics: acc.gpuSkipped
      ? { skipped: acc.gpuSkipped, score: 0 }
      : (gpuRate > 0
        ? { score: graphics, renderer: acc.gpuName || null }
        : (meta.finished
          ? { skipped: 'Ended before graphics were tested.', score: 0 }
          : { score: 0 })),
    overall,
    tier: tierFor(overall),
    limit: limitNote({ single, multi, graphics }),
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
  single: 'One core is the limit for games that lean on a single thread.',
  multi: 'All-core rendering is the limit for games that spread work across cores.',
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
    `Multi Core ${Number(result.cpu?.multiPts || 0).toLocaleString()} pts${result.cpu?.ratio ? ` · ${result.cpu.ratio.toFixed(1)}× one core` : ''}`,
    `Single Core ${Number(result.cpu?.singlePts || 0).toLocaleString()} pts`,
    result.graphics?.skipped
      ? `Graphics — ${result.graphics.skipped}`
      : `Graphics ${Number(result.graphics?.score || 0).toLocaleString()} pts${result.graphics?.renderer ? ` · ${result.graphics.renderer}` : ''}`,
  ];
  return lines.filter(Boolean).join('\n');
}
