import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { loadHwScan, saveHwScan } from '../lib/optimize.js';
import { runGpuBench } from '../lib/gpu-bench.js';
import {
  BENCH_LIMIT_MS,
  BENCH_TESTS,
  BENCH_VERSION,
  CPU_EASE_C,
  CPU_RESUME_C,
  GPU_EASE_C,
  GPU_RESUME_C,
  POST_MIN_SEC,
  benchPoints,
  formatBenchSummary,
  formatClock,
  mpRatio,
  nextPace,
  testLabel,
} from '../lib/bench-score.js';
import { listBenchRanking, missingBenchRpc, submitBenchPart } from '../lib/bench-board.js';

const KEYS = {
  multi: 'nexforge.bench4.multi',
  single: 'nexforge.bench4.single',
  gpu: 'nexforge.bench4.gpu',
};
const FRAME_KEY = 'nexforge.bench4.frame';
const OLD_HISTORY_KEY = 'nexforge.bench.v4';
const OLD_CPU_KEY = 'nexforge.bench.cpu.v4';
const OLD_GPU_KEY = 'nexforge.bench.gpu.v4';
const VIEW_W = 1280;
const VIEW_H = 720;
const VIEW_BG = '#1b1d22';
const SCAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RANK_ROWS = 15;

function readJson(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Split the one-run CPU result from 5.7.x into the separate Multi Core and Single Core tests. */
function migrateOldResults() {
  let history = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(OLD_HISTORY_KEY) || '[]');
    if (Array.isArray(parsed)) history = parsed;
  } catch { /* ignore */ }
  const oldCpu = readJson(OLD_CPU_KEY) || history.find((row) => row?.cpu?.multiPts || row?.cpu?.singlePts) || null;
  const oldGpu = readJson(OLD_GPU_KEY) || history.find((row) => row?.graphics?.score > 0) || null;
  if (!oldCpu && !oldGpu) return;
  const carry = (row, kind, pts, extra = {}) => ({
    version: BENCH_VERSION,
    kind,
    at: row.at || Date.now(),
    pts,
    durationSec: Number(row.durationSec) || 0,
    passes: 0,
    threads: row.threads || null,
    cpuName: row.cpuName || null,
    gpuName: null,
    eased: { hot: !!(row.eased?.cpu || row.eased?.gpu), blind: !!row.eased?.blind },
    ...extra,
  });
  let ok = true;
  if (oldCpu?.cpu?.multiPts > 0 && !readJson(KEYS.multi)) {
    ok = writeJson(KEYS.multi, carry(oldCpu, 'multi', oldCpu.cpu.multiPts)) && ok;
  }
  if (oldCpu?.cpu?.singlePts > 0 && !readJson(KEYS.single)) {
    ok = writeJson(KEYS.single, carry(oldCpu, 'single', oldCpu.cpu.singlePts, {
      durationSec: Math.min(20, Number(oldCpu.durationSec) || 20),
      threads: 1,
    })) && ok;
  }
  if (oldGpu?.graphics?.score > 0 && !readJson(KEYS.gpu)) {
    ok = writeJson(KEYS.gpu, carry(oldGpu, 'gpu', oldGpu.graphics.score, {
      gpuName: oldGpu.graphics.renderer || null,
      cpuName: null,
      threads: null,
    })) && ok;
  }
  if (!ok) return;
  [OLD_HISTORY_KEY, OLD_CPU_KEY, OLD_GPU_KEY].forEach((key) => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  });
}

let migrated = false;

function readResult(kind) {
  const row = readJson(KEYS[kind]);
  return row && row.pts > 0 ? row : null;
}

function loadResults() {
  if (!migrated) {
    migrated = true;
    migrateOldResults();
  }
  return { multi: readResult('multi'), single: readResult('single'), gpu: readResult('gpu') };
}

function saveResult(kind, result) {
  writeJson(KEYS[kind], result);
  window.dispatchEvent(new CustomEvent('nexforge-bench-saved'));
}

function clearResult(kind) {
  try { localStorage.removeItem(KEYS[kind]); } catch { /* ignore */ }
}

let benchBusy = false;

function claimRun() {
  if (benchBusy) return false;
  benchBusy = true;
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function restLabel(pace, part) {
  if (pace?.reason === 'unsensed-rest') return `No temperature reading, so the ${part} is resting.`;
  return `Resting the ${part} until it cools.`;
}

function systemInfo(scan, results) {
  const cpu = scan?.cpu || {};
  const threads = cpu.threads || results.multi?.threads || null;
  const ghz = cpu.clockMhz ? (cpu.clockMhz / 1000).toFixed(2) : null;
  const coreBits = [cpu.cores && `${cpu.cores} Cores`, threads && `${threads} Threads`].filter(Boolean).join(', ');
  const os = scan?.os ? String(scan.os).replace(/^Microsoft\s+/i, '') : null;
  return {
    cpu: cpu.name || results.multi?.cpuName || results.single?.cpuName || null,
    cores: coreBits ? `${coreBits}${ghz ? ` @ ${ghz} GHz` : ''}` : null,
    os: os ? `${os}${scan.osBuild ? ` (build ${scan.osBuild})` : ''}` : null,
    gpu: scan?.gpu?.name || results.gpu?.gpuName || null,
  };
}

function hwKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\((r|tm)\)/g, ' ')
    .replace(/@.*$/, ' ')
    .replace(/\b(nvidia|amd|intel|ati)\b/g, ' ')
    .replace(/\b\d+-core\b|\bprocessor\b|\bcpu\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function shortHw(name) {
  return String(name || '')
    .replace(/\((r|tm)\)/gi, '')
    .replace(/\s+\d+-core processor\s*$/i, '')
    .replace(/\s+(cpu\s+)?@\s*[\d.]+\s*ghz\s*$/i, '')
    .replace(/\s+processor\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function rankRows(kind, board, mine, system, myTag) {
  const nameOf = (row) => shortHw(kind === 'gpu' ? row.gpu_name : row.cpu_name);
  const mineName = kind === 'gpu' ? (mine?.gpuName || system.gpu) : (mine?.cpuName || system.cpu);
  const myHw = hwKey(mineName);
  const rows = (board || []).filter((row) => row.pts > 0).map((row, i) => ({
    key: `p-${row.gamer_tag}-${i}`,
    name: nameOf(row) || (kind === 'gpu' ? 'Graphics card' : 'Processor'),
    who: row.gamer_tag,
    pts: row.pts,
    mine: !!myTag && String(row.gamer_tag || '').toLowerCase() === myTag,
    current: false,
    same: !!myHw && hwKey(nameOf(row)) === myHw,
  }));
  if (mine?.pts > 0) {
    const posted = rows.find((row) => row.mine && row.pts === mine.pts);
    if (posted) {
      posted.current = true;
    } else {
      rows.push({
        key: 'this-pc',
        name: shortHw(mineName) || 'This PC',
        who: 'This PC',
        pts: mine.pts,
        mine: true,
        current: true,
        same: true,
      });
    }
  }
  rows.sort((a, b) => b.pts - a.pts);
  rows.forEach((row, i) => { row.rank = i + 1; });
  if (rows.length <= RANK_ROWS) return rows;
  const top = rows.slice(0, RANK_ROWS - 1);
  const current = rows.find((row) => row.current);
  return [...top, current && current.rank >= RANK_ROWS ? current : rows[RANK_ROWS - 1]];
}

function sensorText(kind, temps) {
  if (!kind || !temps) return '';
  const gpu = kind === 'gpu';
  const pct = gpu ? temps.gpuPct : temps.cpuPct;
  const temp = gpu ? temps.gpuTempC : temps.cpuTempC;
  const load = `${gpu ? 'GPU' : 'CPU'}${pct != null ? ` ${Math.round(pct)}%` : ''}`;
  return `${load} · ${temp != null && temp > 0 ? `${Math.round(temp)}°C` : 'no temperature reading'}`;
}

function testMeta(kind, on, row) {
  const who = kind === 'gpu' ? 'Graphics card' : kind === 'single' ? 'One thread' : 'All threads';
  if (on) {
    if (kind === 'gpu') return row?.frames ? `Frame ${row.frames}` : 'Starting';
    return row?.pass ? `${who} · Pass ${row.pass}` : who;
  }
  if (!row) return who;
  const bits = [row.durationSec ? `Ran ${formatClock(row.durationSec)}` : null];
  if (row.eased?.hot) bits.push('rested when hot');
  else if (row.eased?.blind) bits.push('rested on a timer');
  return bits.filter(Boolean).join(' · ');
}

export default function Benchmark() {
  const { showToast, liveSession, user, guestMode, profile } = useNexForge();
  const [scan, setScan] = useState(() => loadHwScan());
  const [results, setResults] = useState(() => loadResults());
  const [running, setRunning] = useState(null);
  const [live, setLive] = useState(null);
  const [status, setStatus] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [temps, setTemps] = useState(null);
  const [painted, setPainted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rankKind, setRankKind] = useState('multi');
  const [boards, setBoards] = useState({ multi: null, single: null, gpu: null });
  const [boardErr, setBoardErr] = useState({});
  const [boardNote, setBoardNote] = useState('');
  const stopRef = useRef(false);
  const gpuStop = useRef(false);
  const alive = useRef(true);
  const startedRef = useRef(0);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const tilesOn = useRef(false);
  const passSeen = useRef(0);
  const inflight = useRef(new Map());
  const overlayPending = useRef(false);
  const paintedRef = useRef(false);
  const runningRef = useRef(null);
  const boardLoading = useRef(new Set());
  const system = systemInfo(scan, results);
  const systemRef = useRef(system);
  systemRef.current = system;
  runningRef.current = running;

  useEffect(() => {
    alive.current = true;
    stopRef.current = false;
    gpuStop.current = false;
    return () => {
      alive.current = false;
      stopRef.current = true;
      gpuStop.current = true;
      window.nexforge?.cancelSystemBenchmark?.();
    };
  }, []);

  useEffect(() => {
    const sync = () => {
      if (alive.current) setResults(loadResults());
    };
    window.addEventListener('nexforge-bench-saved', sync);
    return () => window.removeEventListener('nexforge-bench-saved', sync);
  }, []);

  useEffect(() => {
    if (!window.nexforge?.scanDeviceSpecs) return undefined;
    const age = scan?.scannedAt ? Date.now() - Date.parse(scan.scannedAt) : Infinity;
    if (scan?.cpu?.name && age < SCAN_MAX_AGE_MS) return undefined;
    let stop = false;
    window.nexforge.scanDeviceSpecs({ force: false })
      .then((next) => {
        if (stop || !next) return;
        setScan(next);
        saveHwScan(next);
      })
      .catch(() => { /* the panel falls back to what the benchmark reports */ });
    return () => { stop = true; };
  }, []);

  const clearView = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = VIEW_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const drawOverlay = useCallback(() => {
    if (overlayPending.current) return;
    overlayPending.current = true;
    requestAnimationFrame(() => {
      overlayPending.current = false;
      const canvas = overlayRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!inflight.current.size) return;
      const arm = 9;
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const t of inflight.current.values()) {
        const x0 = t.x + 1.5;
        const y0 = t.y + 1.5;
        const x1 = t.x + t.w - 1.5;
        const y1 = t.y + t.h - 1.5;
        ctx.moveTo(x0, y0 + arm); ctx.lineTo(x0, y0); ctx.lineTo(x0 + arm, y0);
        ctx.moveTo(x1 - arm, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + arm);
        ctx.moveTo(x1, y1 - arm); ctx.lineTo(x1, y1); ctx.lineTo(x1 - arm, y1);
        ctx.moveTo(x0 + arm, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - arm);
      }
      ctx.stroke();
    });
  }, []);

  useEffect(() => {
    clearView();
    let url = null;
    try { url = localStorage.getItem(FRAME_KEY); } catch { /* ignore */ }
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      if (!alive.current || runningRef.current) return;
      canvasRef.current?.getContext('2d')?.drawImage(img, 0, 0, VIEW_W, VIEW_H);
      paintedRef.current = true;
      setPainted(true);
    };
    img.src = url;
  }, [clearView]);

  useEffect(() => {
    const off = window.nexforge?.onBenchTile?.((tile) => {
      if (!tilesOn.current || !tile?.w || !tile?.h) return;
      const key = `${tile.x},${tile.y}`;
      if (tile.kind === 'start') {
        if (tile.pass !== passSeen.current) {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (ctx && passSeen.current > 0) {
            ctx.fillStyle = 'rgba(27,29,34,.62)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          passSeen.current = tile.pass || 0;
        }
        inflight.current.set(key, tile);
        drawOverlay();
        return;
      }
      inflight.current.delete(key);
      drawOverlay();
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx || !tile.pixels) return;
      const pixels = tile.pixels instanceof Uint8Array ? tile.pixels : new Uint8Array(tile.pixels);
      if (pixels.length < tile.w * tile.h * 4) return;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), tile.w, tile.h), tile.x || 0, tile.y || 0);
      if (!paintedRef.current) {
        paintedRef.current = true;
        setPainted(true);
      }
    });
    return () => off?.();
  }, [drawOverlay]);

  const loadBoard = useCallback(async (kind) => {
    if (boardLoading.current.has(kind)) return;
    boardLoading.current.add(kind);
    try {
      const rows = await listBenchRanking(kind);
      if (!alive.current) return;
      setBoards((prev) => ({ ...prev, [kind]: rows }));
      setBoardErr((prev) => ({ ...prev, [kind]: null }));
    } catch (err) {
      if (!alive.current) return;
      setBoards((prev) => ({ ...prev, [kind]: [] }));
      setBoardErr((prev) => ({ ...prev, [kind]: missingBenchRpc(err) ? 'missing' : 'error' }));
    } finally {
      boardLoading.current.delete(kind);
    }
  }, []);

  useEffect(() => {
    if (boards[rankKind] == null) loadBoard(rankKind);
  }, [rankKind, boards, loadBoard]);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setElapsed(Date.now() - startedRef.current), 250);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!running) return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const sample = await window.nexforge?.getPerfSample?.();
        if (!stop && sample) setTemps(sample);
      } catch {
        /* sensors are optional */
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [running]);

  async function readTemps() {
    try {
      const sample = await window.nexforge?.getPerfSample?.();
      if (sample && alive.current) setTemps(sample);
      return sample || {};
    } catch {
      return {};
    }
  }

  function setPart(kind, value) {
    setResults((prev) => ({ ...prev, [kind]: value }));
  }

  function saveFrame() {
    try {
      const url = canvasRef.current?.toDataURL('image/jpeg', 0.85);
      if (url && url.length < 1500000) localStorage.setItem(FRAME_KEY, url);
    } catch { /* quota */ }
  }

  function beginRun(kind) {
    stopRef.current = false;
    gpuStop.current = false;
    tilesOn.current = false;
    passSeen.current = 0;
    paintedRef.current = false;
    inflight.current.clear();
    drawOverlay();
    setRunning(kind);
    setRankKind(kind);
    setCopied(false);
    setLive(null);
    setPainted(false);
    setTemps(null);
    setBoardNote('');
    setStatus(kind === 'gpu' ? 'Starting the graphics card…' : 'Starting the processor…');
    setElapsed(0);
    startedRef.current = Date.now();
    clearView();
  }

  async function postResult(kind, result) {
    if (result.durationSec < POST_MIN_SEC) {
      if (alive.current) setBoardNote(`Saved on this PC. Runs shorter than ${POST_MIN_SEC} seconds are not posted.`);
      return;
    }
    if (!user?.id || guestMode) {
      if (alive.current) setBoardNote('Saved on this PC. Sign in to post it to the ranking.');
      return;
    }
    try {
      const posted = await submitBenchPart(kind, result);
      boardLoading.current.delete(kind);
      await loadBoard(kind);
      if (!alive.current) return;
      setBoardNote(posted?.posted
        ? `Posted. You are #${posted.rank || '—'} in ${testLabel(kind)}.`
        : `Your best in ${testLabel(kind)} is still ${Number(posted?.best || 0).toLocaleString()} pts.`);
    } catch (err) {
      if (!alive.current) return;
      setBoardNote(missingBenchRpc(err)
        ? 'Saved on this PC. This ranking is not live yet.'
        : 'Saved on this PC. It could not be posted.');
    }
  }

  async function runCpu(kind) {
    if (running || !claimRun()) {
      showToast('A benchmark is already running.', 'error');
      return;
    }
    if (!window.nexforge?.prepareSystemBenchmark || !window.nexforge?.runBenchPhase) {
      benchBusy = false;
      showToast('The CPU benchmark only runs in the desktop app.', 'error');
      return;
    }
    const previous = results[kind];
    const part = kind === 'single' ? 'processor core' : 'processor';
    beginRun(kind);
    const eased = { hot: false, blind: false };
    let samples = 0;
    let busyMs = 0;
    let pass = 0;
    let saved = null;
    let failed = false;
    try {
      const prep = await window.nexforge.prepareSystemBenchmark();
      if (stopRef.current) return;
      clearResult(kind);
      setPart(kind, null);
      const threads = kind === 'single' ? 1 : prep.threads;
      let easeOn = false;
      let blindSince = null;
      let restUntil = 0;
      const paceFrom = (sample) => {
        const pace = nextPace({
          tempC: sample.cpuTempC,
          easeOn,
          easeAt: CPU_EASE_C,
          resumeAt: CPU_RESUME_C,
          now: Date.now(),
          blindSince,
          restUntil,
        });
        easeOn = pace.easeOn;
        blindSince = pace.blindSince;
        restUntil = pace.restUntil;
        if (pace.reason === 'hot') eased.hot = true;
        if (pace.reason === 'unsensed-rest') eased.blind = true;
        return pace;
      };
      const timeLeft = () => BENCH_LIMIT_MS - (Date.now() - startedRef.current);

      while (!stopRef.current && timeLeft() > 0) {
        const pace = paceFrom(await readTemps());
        if (!pace.easeOn) break;
        if (alive.current) setStatus(restLabel(pace, part));
        await sleep(400);
      }
      if (!stopRef.current && timeLeft() > 0) {
        tilesOn.current = true;
        const started = await window.nexforge.runBenchPhase({ kind: 'render-start', threads });
        while (!started?.stopped && !stopRef.current && timeLeft() > 0) {
          const pace = paceFrom(await readTemps());
          const ease = await window.nexforge.runBenchPhase({ kind: 'render-ease', on: pace.easeOn });
          if (ease?.stopped || stopRef.current) break;
          const snap = await window.nexforge.runBenchPhase({ kind: 'render-snap' });
          if (snap?.stopped) break;
          samples = snap?.samples || 0;
          busyMs = snap?.elapsedMs || 0;
          pass = snap?.pass || pass;
          if (alive.current) {
            setStatus(pace.easeOn ? restLabel(pace, part) : `Rendering (Pass ${pass || 1})`);
            setLive({ pts: benchPoints(kind, samples, busyMs), pass });
          }
          await sleep(350);
        }
        const end = await window.nexforge.runBenchPhase({ kind: 'render-stop' });
        samples = end?.samples || samples;
        busyMs = end?.elapsedMs || busyMs;
      }

      const durationSec = Math.round((Date.now() - startedRef.current) / 1000);
      const pts = benchPoints(kind, samples, busyMs);
      if (pts > 0) {
        saved = {
          version: BENCH_VERSION,
          kind,
          at: Date.now(),
          pts,
          durationSec,
          passes: pass,
          threads,
          cpuName: prep.cpuName || systemRef.current.cpu || null,
          gpuName: systemRef.current.gpu || null,
          eased,
        };
        saveResult(kind, saved);
        saveFrame();
      } else if (alive.current) {
        showToast(eased.hot
          ? 'The processor stayed too hot to finish a score.'
          : 'Stopped before the render had a score.', 'error');
      }
    } catch (err) {
      failed = true;
      if (alive.current && !stopRef.current) {
        showToast(err?.code === 'BUSY' ? 'A benchmark is already running.' : (err?.message || 'Benchmark failed.'), 'error');
      }
    } finally {
      tilesOn.current = false;
      inflight.current.clear();
      drawOverlay();
      await window.nexforge?.finishSystemBenchmark?.();
      if (!saved && previous) saveResult(kind, previous);
      benchBusy = false;
      if (alive.current) {
        setResults(loadResults());
        setRunning(null);
        setLive(null);
        setStatus(saved
          ? `Finished · ${testLabel(kind)} ${saved.pts.toLocaleString()} pts`
          : (failed ? 'The benchmark stopped.' : 'Stopped'));
      }
    }
    if (saved) await postResult(kind, saved);
  }

  async function runGpu() {
    if (running || !claimRun()) {
      showToast('A benchmark is already running.', 'error');
      return;
    }
    const previous = results.gpu;
    beginRun('gpu');
    const eased = { hot: false, blind: false };
    let saved = null;
    let failed = false;
    try {
      clearResult('gpu');
      setPart('gpu', null);
      let easeOn = false;
      let blindSince = null;
      let restUntil = 0;
      let frames = 0;
      const gpu = await runGpuBench({
        canvas: canvasRef.current,
        durationMs: BENCH_LIMIT_MS,
        isCancelled: () => gpuStop.current || stopRef.current,
        onSample: (sample) => {
          if (!sample?.seconds || !(sample.samples > 0)) return;
          frames = sample.frames || frames;
          if (!alive.current) return;
          if (!paintedRef.current) {
            paintedRef.current = true;
            setPainted(true);
          }
          setLive({ pts: benchPoints('gpu', sample.samples, sample.seconds * 1000), frames });
          if (!easeOn) setStatus(`Rendering (Frame ${frames || 1})`);
        },
        onTick: async () => {
          const sample = await readTemps();
          const pace = nextPace({
            tempC: sample.gpuTempC,
            easeOn,
            easeAt: GPU_EASE_C,
            resumeAt: GPU_RESUME_C,
            now: Date.now(),
            blindSince,
            restUntil,
          });
          easeOn = pace.easeOn;
          blindSince = pace.blindSince;
          restUntil = pace.restUntil;
          if (pace.reason === 'hot') eased.hot = true;
          if (pace.reason === 'unsensed-rest') eased.blind = true;
          if (alive.current && pace.easeOn) setStatus(restLabel(pace, 'graphics card'));
          return pace.easeOn ? 'pause' : 'run';
        },
      });
      const durationSec = Math.round((Date.now() - startedRef.current) / 1000);
      const pts = gpu?.skipped ? 0 : benchPoints('gpu', gpu?.samples, (gpu?.seconds || 0) * 1000);
      if (pts > 0) {
        saved = {
          version: BENCH_VERSION,
          kind: 'gpu',
          at: Date.now(),
          pts,
          durationSec,
          frames: gpu.frames || frames,
          cpuName: systemRef.current.cpu || null,
          gpuName: gpu.renderer || systemRef.current.gpu || null,
          eased,
        };
        saveResult('gpu', saved);
        saveFrame();
      } else if (alive.current) {
        showToast(gpu?.skipped && gpu.skipped !== 'Cancelled.'
          ? gpu.skipped
          : 'Stopped before the graphics card rendered a frame.', 'error');
      }
    } catch (err) {
      failed = true;
      if (alive.current && !stopRef.current) showToast(err?.message || 'Benchmark failed.', 'error');
    } finally {
      if (!saved && previous) saveResult('gpu', previous);
      benchBusy = false;
      if (alive.current) {
        setResults(loadResults());
        setRunning(null);
        setLive(null);
        setStatus(saved
          ? `Finished · GPU ${saved.pts.toLocaleString()} pts`
          : (failed ? 'The benchmark stopped.' : 'Stopped'));
      }
    }
    if (saved) await postResult('gpu', saved);
  }

  function startTest(kind) {
    if (kind === 'gpu') runGpu();
    else runCpu(kind);
  }

  function stopRun() {
    stopRef.current = true;
    gpuStop.current = true;
    window.nexforge?.cancelSystemBenchmark?.();
    setStatus('Stopping and scoring what finished…');
  }

  async function copySummary() {
    const text = formatBenchSummary({ ...results, system });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast('Benchmark copied', 'success');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast('Could not copy the benchmark', 'error');
    }
  }

  const ratio = mpRatio(results.multi?.pts, results.single?.pts);
  const hasAny = !!(results.multi || results.single || results.gpu);
  const myTag = (profile?.gamer_tag || '').toLowerCase();
  const rows = rankRows(rankKind, boards[rankKind], running === rankKind ? null : results[rankKind], system, myTag);
  const top = rows.reduce((max, row) => Math.max(max, row.pts), 0) || 1;
  const progress = running ? Math.min(100, (elapsed / BENCH_LIMIT_MS) * 100) : 0;
  const statusText = running ? (status || 'Rendering') : (status || (hasAny ? 'Ready' : 'Ready. Close games first for a clean score.'));

  return (
    <div className="bench">
      <aside className="bench-side">
        <div className="bench-brand">
          <div>
            <strong>NexForge <span>Bench</span></strong>
            <small>Render benchmark · Bench {BENCH_VERSION}</small>
          </div>
          {hasAny && !running && (
            <button type="button" className="bench-link" onClick={copySummary}>{copied ? 'Copied' : 'Copy'}</button>
          )}
        </div>
        {liveSession && <div className="bench-warn">A game is open. Close it for a clean score.</div>}

        <div className="bench-tests">
          {BENCH_TESTS.map((test) => {
            const on = running === test.id;
            const row = on ? live : results[test.id];
            const pts = row?.pts || 0;
            return (
              <div className={`bench-test ${on ? 'on' : ''}`} key={test.id}>
                <div className="bench-test-name">{test.label}</div>
                <button
                  type="button"
                  className={`bench-start ${on ? 'stop' : ''}`}
                  disabled={!!running && !on}
                  onClick={() => (on ? stopRun() : startTest(test.id))}
                >
                  {on ? 'Stop' : 'Start'}
                </button>
                <div className="bench-test-pts">
                  {pts > 0 ? pts.toLocaleString() : '---'}
                  <small>pts</small>
                </div>
                <div className="bench-test-meta">{testMeta(test.id, on, row)}</div>
              </div>
            );
          })}
          <div className="bench-ratio">
            <span>MP Ratio</span>
            <b>{ratio > 0 ? `${ratio.toFixed(2)} x` : '---'}</b>
          </div>
        </div>

        <section className="bench-section">
          <h3>Your System</h3>
          <dl className="bench-sys">
            <dt>Processor</dt><dd>{system.cpu || '—'}</dd>
            <dt>Cores x GHz</dt><dd>{system.cores || '—'}</dd>
            <dt>OS</dt><dd>{system.os || '—'}</dd>
            <dt>GFX Board</dt><dd>{system.gpu || '—'}</dd>
          </dl>
        </section>

        <section className="bench-section bench-ranking">
          <h3>
            Ranking
            <select
              className="bench-rank-select"
              value={rankKind}
              onChange={(e) => setRankKind(e.target.value)}
              aria-label="Ranking"
            >
              {BENCH_TESTS.map((test) => (
                <option key={test.id} value={test.id}>{test.label}</option>
              ))}
            </select>
          </h3>
          {boards[rankKind] == null && rows.length === 0 ? (
            <div className="bench-note">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="bench-note">No scores yet. Press Start to add this PC.</div>
          ) : (
            <div className="bench-rank">
              {rows.map((row) => (
                <div
                  key={row.key}
                  className={`bench-rank-row ${row.current ? 'current' : row.same ? 'same' : ''}`}
                  title={`${row.name} · ${row.who}`}
                >
                  <span className="bench-rank-pos">{row.rank}.</span>
                  <span className="bench-rank-bar">
                    <i style={{ width: `${Math.max(6, (row.pts / top) * 100)}%` }} />
                    <span className="bench-rank-label">{row.name}<em>{row.who}</em></span>
                  </span>
                  <span className="bench-rank-pts">{row.pts.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
          <div className="bench-legend">
            <span><i className="current" />Your Score</span>
            <span><i className="same" />Identical System</span>
          </div>
          {boardErr[rankKind] === 'missing' && (
            <div className="bench-note">Only this PC is shown until this ranking goes live.</div>
          )}
          {boardErr[rankKind] === 'error' && <div className="bench-note">The ranking could not load.</div>}
          {boardNote && <div className="bench-note">{boardNote}</div>}
        </section>
      </aside>

      <div className="bench-stage">
        <div className="bench-view">
          <canvas ref={canvasRef} width={VIEW_W} height={VIEW_H} />
          <canvas ref={overlayRef} className="bench-buckets" width={VIEW_W} height={VIEW_H} aria-hidden="true" />
          {!painted && !running && (
            <div className="bench-view-idle">Press Start on a test. The scene renders here.</div>
          )}
        </div>
        <div className="bench-progress" aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </div>
        <div className="bench-status">
          <span className="bench-status-main">{statusText}</span>
          <span className="bench-status-side">
            {sensorText(running, temps)}
            {running ? <b>{formatClock(elapsed / 1000)} / {formatClock(BENCH_LIMIT_MS / 1000)}</b> : null}
          </span>
        </div>
        <p className="bench-foot">
          Each test renders the same original NexForge scene for up to 10 minutes, and Stop scores what has finished.
          NexForge points do not compare with Cinebench points. The processor rests at {CPU_EASE_C}°C and the graphics
          card rests at {GPU_EASE_C}°C. Fan speed, voltage, and power limits are never changed.
        </p>
      </div>
    </div>
  );
}
