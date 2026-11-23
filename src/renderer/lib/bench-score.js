/** NexForge Bench 4. A score of 1000 matches a solid 1080p PC on this render. */
export const BENCH_VERSION = 4;

export const BENCH_LIMIT_MS = 10 * 60 * 1000;
export const CPU_EASE_C = 90;
export const CPU_RESUME_C = 84;
export const GPU_EASE_C = 87;
export const GPU_RESUME_C = 80;
export const UNSENSED_WORK_MS = 45000;
export const UNSENSED_REST_MS = 12000;

/** Shortest run that can be posted to the ranking. Matches the database check. */
export const POST_MIN_SEC = 45;

/**
 * Decide whether a benchmark should keep rendering.
 * A real temperature rests at easeAt and stays rested until it falls below resumeAt.
 * With no reading, work runs in short stretches, then rests, so a missing sensor
 * cannot leave a part at full load for the whole benchmark.
 */
export function nextPace({
  tempC,
  easeOn = false,
  easeAt,
  resumeAt,
  now = 0,
  blindSince = null,
  restUntil = 0,
  workMs = UNSENSED_WORK_MS,
  restMs = UNSENSED_REST_MS,
} = {}) {
  const temp = Number(tempC);
  if (Number.isFinite(temp) && temp > 0) {
    let hot = easeOn;
    if (temp >= easeAt) hot = true;
    else if (temp < resumeAt) hot = false;
    return { easeOn: hot, blindSince: null, restUntil: 0, reason: hot ? 'hot' : 'ok' };
  }
  if (now < restUntil) {
    return { easeOn: true, blindSince: null, restUntil, reason: 'unsensed-rest' };
  }
  const since = blindSince == null ? now : blindSince;
  if (now - since >= workMs) {
    return { easeOn: true, blindSince: null, restUntil: now + restMs, reason: 'unsensed-rest' };
  }
  return { easeOn: false, blindSince: since, restUntil: 0, reason: 'unsensed-work' };
}

export const BENCH_BASELINE = {
  singleSamples: 560000,
  multiSamples: 1900000,
  gpuSamples: 70000000,
};

const BASELINE_FOR = {
  single: BENCH_BASELINE.singleSamples,
  multi: BENCH_BASELINE.multiSamples,
  gpu: BENCH_BASELINE.gpuSamples,
};

export const BENCH_TESTS = [
  { id: 'multi', label: 'CPU (Multi Core)' },
  { id: 'single', label: 'CPU (Single Core)' },
  { id: 'gpu', label: 'GPU' },
];

export function testLabel(kind) {
  return BENCH_TESTS.find((test) => test.id === kind)?.label || 'Benchmark';
}

export function formatClock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Points for one test: samples per second of busy time against the baseline. */
export function benchPoints(kind, samples, ms) {
  const baseline = BASELINE_FOR[kind];
  if (!baseline || !(samples > 0) || !(ms > 0)) return 0;
  const rate = samples / (ms / 1000);
  return Math.max(0, Math.min(50000, Math.round((rate / baseline) * 1000)));
}

/**
 * How many single cores the all-core render is worth.
 * Points use different baselines, so the ratio is taken on the render rates.
 */
export function mpRatio(multiPts, singlePts) {
  if (!(multiPts > 0) || !(singlePts > 0)) return 0;
  return (multiPts * BENCH_BASELINE.multiSamples) / (singlePts * BENCH_BASELINE.singleSamples);
}

export function formatBenchSummary({ multi, single, gpu, system } = {}) {
  const pts = (row) => `${Number(row.pts).toLocaleString()} pts`;
  const ratio = mpRatio(multi?.pts, single?.pts);
  const lines = [
    'NexForge Bench',
    system?.cpu,
    system?.cores,
    system?.gpu,
    multi?.pts > 0 ? `CPU (Multi Core): ${pts(multi)}` : null,
    single?.pts > 0 ? `CPU (Single Core): ${pts(single)}` : null,
    ratio > 0 ? `MP Ratio: ${ratio.toFixed(2)} x` : null,
    gpu?.pts > 0 ? `GPU: ${pts(gpu)}${gpu.gpuName ? ` · ${gpu.gpuName}` : ''}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}
