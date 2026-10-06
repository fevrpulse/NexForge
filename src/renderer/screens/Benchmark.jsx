import React, { useEffect, useRef, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { loadHwScan } from '../lib/optimize.js';
import { runGpuBench } from '../lib/gpu-bench.js';
import {
  BENCH_LIMIT_MS,
  CPU_EASE_C,
  CPU_RESUME_C,
  GPU_EASE_C,
  GPU_RESUME_C,
  formatBenchText,
  nextPace,
  formatClock,
  scoreBenchmark,
} from '../lib/bench-score.js';
import { listBenchLeaderboard, missingBenchRpc, submitBenchScore } from '../lib/bench-board.js';

const HISTORY_KEY = 'nexforge.bench.v4';
const CPU_KEY = 'nexforge.bench.cpu.v4';
const GPU_KEY = 'nexforge.bench.gpu.v4';
const VIEW_W = 640;
const VIEW_H = 360;
const SINGLE_MS = 20000;

function loadJson(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function loadOldHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadCpuResult() {
  return loadJson(CPU_KEY) || loadOldHistory().find((row) => row?.cpu?.multiPts || row?.cpu?.singlePts) || null;
}

function loadGpuResult() {
  const saved = loadJson(GPU_KEY);
  if (saved) return saved;
  const old = loadOldHistory().find((row) => row?.graphics?.score > 0);
  if (!old) return null;
  const gpu = { ...old, mode: 'gpu', overall: old.graphics.score };
  try { localStorage.setItem(GPU_KEY, JSON.stringify(gpu)); } catch { /* ignore */ }
  return gpu;
}

function savePart(key, result) {
  try {
    localStorage.setItem(key, JSON.stringify(result));
    localStorage.removeItem(HISTORY_KEY);
    window.dispatchEvent(new CustomEvent('nexforge-bench-saved'));
  } catch { /* ignore quota */ }
}

let benchBusy = false;

function claimRun() {
  if (benchBusy) return false;
  benchBusy = true;
  return true;
}

function clearPart(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  if (key === CPU_KEY) {
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
  }
}

function restLabel(part, pace) {
  if (pace?.reason === 'unsensed-rest') return `No temperature reading, so the ${part} is resting.`;
  return `Resting the ${part}. The scene starts again when it is cooler.`;
}

function specLine(scan) {
  if (!scan) return 'Close games first so the score is this PC, not the game.';
  const bits = [];
  if (scan.cpu?.name) bits.push(scan.cpu.name);
  if (scan.gpu?.name) bits.push(scan.gpu.name);
  if (scan.ramGb) bits.push(`${scan.ramGb} GB RAM`);
  return bits.join(' · ') || 'Close games first so the score is this PC, not the game.';
}

function emptyAcc() {
  return {
    at: Date.now(),
    singleSamples: 0,
    singleMs: 0,
    multiSamples: 0,
    multiMs: 0,
    gpuSamples: 0,
    gpuMs: 0,
    gpuFrames: 0,
    gpuName: null,
    gpuSkipped: null,
  };
}

function canPostScore(acc, durationSec) {
  return durationSec >= 45 && acc.multiMs > 0 && acc.multiSamples > 0;
}

export default function Benchmark() {
  const { showToast, liveSession, user, guestMode, profile } = useNexForge();
  const [scan] = useState(() => loadHwScan());
  const [cpuResult, setCpuResult] = useState(() => loadCpuResult());
  const [gpuResult, setGpuResult] = useState(() => loadGpuResult());
  const [live, setLive] = useState(null);
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState(() => {
    const cpu = loadCpuResult();
    const gpu = loadGpuResult();
    if (cpu?.at && gpu?.at) return cpu.at >= gpu.at ? 'cpu' : 'gpu';
    return gpu && !cpu ? 'gpu' : 'cpu';
  });
  const [label, setLabel] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [temps, setTemps] = useState(null);
  const [copied, setCopied] = useState(false);
  const [painted, setPainted] = useState(false);
  const [board, setBoard] = useState([]);
  const [boardMissing, setBoardMissing] = useState(false);
  const [boardNote, setBoardNote] = useState('');
  const stopRef = useRef(false);
  const gpuStop = useRef(false);
  const alive = useRef(true);
  const startedRef = useRef(0);
  const canvasRef = useRef(null);
  const tilesOn = useRef(false);
  const passSeen = useRef(0);
  const gpuHotRef = useRef(false);

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
      if (!alive.current) return;
      setCpuResult(loadCpuResult());
      setGpuResult(loadGpuResult());
    };
    window.addEventListener('nexforge-bench-saved', sync);
    return () => window.removeEventListener('nexforge-bench-saved', sync);
  }, []);

  useEffect(() => {
    const off = window.nexforge?.onBenchTile?.((tile) => {
      if (!tilesOn.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx || !tile?.pixels || !tile.w || !tile.h) return;
      const pixels = tile.pixels instanceof Uint8Array ? tile.pixels : new Uint8Array(tile.pixels);
      if (pixels.length < tile.w * tile.h * 4) return;
      if (tile.pass !== passSeen.current) {
        passSeen.current = tile.pass || 0;
        ctx.fillStyle = '#14161c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      const image = new ImageData(new Uint8ClampedArray(pixels), tile.w, tile.h);
      ctx.putImageData(image, tile.x || 0, tile.y || 0);
      setPainted(true);
    });
    return () => off?.();
  }, []);

  useEffect(() => {
    let stop = false;
    listBenchLeaderboard()
      .then((rows) => { if (!stop) setBoard(rows); })
      .catch((err) => {
        if (stop) return;
        if (missingBenchRpc(err)) setBoardMissing(true);
      });
    return () => { stop = true; };
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => {
      setElapsed(Date.now() - startedRef.current);
    }, 250);
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

  function clearView() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#14161c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  async function readTemps() {
    try {
      const sample = await window.nexforge?.getPerfSample?.();
      if (sample && alive.current) setTemps(sample);
      return sample || {};
    } catch {
      return {};
    }
  }

  function beginRun(kind) {
    stopRef.current = false;
    gpuStop.current = false;
    tilesOn.current = false;
    passSeen.current = 0;
    gpuHotRef.current = false;
    setActive(kind);
    setRunning(true);
    setCopied(false);
    setLive(null);
    setPainted(false);
    setTemps(null);
    setBoardNote('');
    setLabel(kind === 'gpu' ? 'Starting the graphics card.' : 'Starting the processor.');
    setElapsed(0);
    startedRef.current = Date.now();
    clearView();
  }

  async function runCpuBench() {
    if (running || !claimRun()) {
      showToast('A benchmark is already running.', 'error');
      return;
    }
    if (!window.nexforge?.prepareSystemBenchmark || !window.nexforge?.runBenchPhase) {
      benchBusy = false;
      showToast('Benchmark only runs in the desktop app.', 'error');
      return;
    }
    const previous = cpuResult;
    beginRun('cpu');
    setCpuResult(null);
    const acc = emptyAcc();
    const eased = { cpu: false, gpu: false };
    let prep = null;
    try {
      prep = await window.nexforge.prepareSystemBenchmark();
      if (stopRef.current) {
        if (alive.current) {
          setCpuResult(previous);
          setLive(null);
          setLabel('');
        }
        return;
      }
      clearPart(CPU_KEY);
      const publish = () => {
        if (!alive.current || !prep) return;
        setLive(scoreBenchmark(acc, {
          mode: 'cpu',
          durationSec: (Date.now() - startedRef.current) / 1000,
          eased,
          cpuName: prep.cpuName,
          threads: prep.threads,
        }));
      };
      const renderFor = async (ms, kind, text) => {
        if (stopRef.current || ms < 1500) return;
        const end = Date.now() + ms;
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
          if (pace.reason === 'hot') eased.cpu = true;
          if (pace.reason === 'unsensed-rest') eased.blind = true;
          return pace;
        };
        while (!stopRef.current && Date.now() < end) {
          const sample = await readTemps();
          const pace = paceFrom(sample);
          if (!pace.easeOn) break;
          if (alive.current) setLabel(restLabel('processor', pace));
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        if (stopRef.current || Date.now() >= end) return;
        tilesOn.current = false;
        passSeen.current = 0;
        clearView();
        setPainted(false);
        const started = await window.nexforge.runBenchPhase({
          kind: 'render-start',
          threads: kind === 'single' ? 1 : prep.threads,
        });
        if (started?.stopped || stopRef.current) return;
        tilesOn.current = true;
        while (!stopRef.current && Date.now() < end) {
          const sample = await readTemps();
          const pace = paceFrom(sample);
          const ease = await window.nexforge.runBenchPhase({ kind: 'render-ease', on: pace.easeOn });
          if (ease?.stopped || stopRef.current) break;
          const snap = await window.nexforge.runBenchPhase({ kind: 'render-snap' });
          if (snap?.stopped) break;
          if (kind === 'single') {
            acc.singleSamples = snap?.samples || 0;
            acc.singleMs = snap?.elapsedMs || 0;
          } else {
            acc.multiSamples = snap?.samples || 0;
            acc.multiMs = snap?.elapsedMs || 0;
          }
          if (alive.current) {
            setLabel(pace.easeOn
              ? restLabel('processor', pace)
              : `${text} Pass ${snap?.pass || 1}.`);
            publish();
          }
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
        const part = await window.nexforge.runBenchPhase({ kind: 'render-stop' });
        if (kind === 'single') {
          acc.singleSamples = part?.samples || acc.singleSamples;
          acc.singleMs = part?.elapsedMs || acc.singleMs;
        } else {
          acc.multiSamples = part?.samples || acc.multiSamples;
          acc.multiMs = part?.elapsedMs || acc.multiMs;
        }
        publish();
      };

      await renderFor(Math.min(SINGLE_MS, BENCH_LIMIT_MS), 'single', 'One core. The scene keeps starting over.');
      const afterSingle = BENCH_LIMIT_MS - (Date.now() - startedRef.current);
      await renderFor(afterSingle, 'multi', 'All cores. The scene keeps starting over.');
      const durationSec = Math.round((Date.now() - startedRef.current) / 1000);
      const scored = scoreBenchmark(acc, {
        mode: 'cpu',
        durationSec,
        eased,
        finished: true,
        cpuName: prep.cpuName,
        threads: prep.threads,
      });
      const postable = scored.overall > 0 && canPostScore(acc, durationSec);
      if (scored.overall > 0) {
        savePart(CPU_KEY, scored);
        if (alive.current) setCpuResult(scored);
      } else if (previous) {
        savePart(CPU_KEY, previous);
        if (alive.current) setCpuResult(previous);
      } else if (alive.current) {
        setCpuResult(null);
      }
      if (alive.current) {
        setLive(null);
        setLabel('');
      }
      if (postable && user?.id && !guestMode) {
        try {
          const posted = await submitBenchScore(scored);
          const rows = await listBenchLeaderboard();
          if (alive.current) {
            setBoard(rows);
            setBoardMissing(false);
            setBoardNote(posted?.posted
              ? `Posted. You are #${posted.rank || '—'}.`
              : `Your best on the board is still ${Number(posted?.best || 0).toLocaleString()}.`);
          }
        } catch (err) {
          if (alive.current) {
            setBoardNote(missingBenchRpc(err)
              ? 'Score saved on this PC. The leaderboard still needs v164-bench-leaderboard.sql in Supabase.'
              : 'Score saved on this PC. It could not be posted.');
          }
        }
      } else if (alive.current && scored.cpu?.multiPts > 0 && !postable) {
        setBoardNote('Saved on this PC. Let the all-core render run a bit longer to post it.');
      } else if (alive.current && postable && guestMode) {
        setBoardNote('Saved on this PC. Sign in to post the CPU score.');
      } else if (alive.current && !(scored.cpu?.multiPts > 0)) {
        showToast(eased.cpu
          ? 'The processor stayed too hot to finish a score.'
          : 'Ended before the all-core render had a score.', 'error');
      }
    } catch (err) {
      if (previous) {
        savePart(CPU_KEY, previous);
        if (alive.current) setCpuResult(previous);
      } else if (alive.current) {
        setCpuResult(null);
      }
      if (alive.current && !stopRef.current) {
        showToast(err?.code === 'BUSY' ? 'A benchmark is already running.' : (err?.message || 'Benchmark failed.'), 'error');
      }
    } finally {
      tilesOn.current = false;
      await window.nexforge?.finishSystemBenchmark?.();
      benchBusy = false;
      if (alive.current) setRunning(false);
    }
  }

  async function runGpuBenchOnly() {
    if (running || !claimRun()) {
      showToast('A benchmark is already running.', 'error');
      return;
    }
    const previous = gpuResult;
    beginRun('gpu');
    setGpuResult(null);
    const acc = emptyAcc();
    const eased = { cpu: false, gpu: false };
    try {
      clearPart(GPU_KEY);
      const publish = () => {
        if (!alive.current) return;
        setLive(scoreBenchmark(acc, {
          mode: 'gpu',
          durationSec: (Date.now() - startedRef.current) / 1000,
          eased,
          finished: false,
        }));
      };
      let gpuEaseOn = false;
      let gpuBlindSince = null;
      let gpuRestUntil = 0;
      const gpu = await runGpuBench({
        canvas: canvasRef.current,
        durationMs: BENCH_LIMIT_MS,
        isCancelled: () => gpuStop.current || stopRef.current,
        onSample: (sample) => {
          if (!sample?.seconds || !(sample.samples > 0)) return;
          acc.gpuSamples = sample.samples;
          acc.gpuMs = sample.seconds * 1000;
          acc.gpuFrames = sample.frames || acc.gpuFrames;
          acc.gpuName = sample.renderer || acc.gpuName;
          acc.gpuSkipped = null;
          setPainted(true);
          if (alive.current) {
            setLabel(gpuHotRef.current
              ? restLabel('graphics card', { reason: gpuHotRef.reason })
              : `Graphics card. Frame ${sample.frames || 1}.`);
          }
          publish();
        },
        onTick: async () => {
          const sample = await readTemps();
          const pace = nextPace({
            tempC: sample.gpuTempC,
            easeOn: gpuEaseOn,
            easeAt: GPU_EASE_C,
            resumeAt: GPU_RESUME_C,
            now: Date.now(),
            blindSince: gpuBlindSince,
            restUntil: gpuRestUntil,
          });
          gpuEaseOn = pace.easeOn;
          gpuBlindSince = pace.blindSince;
          gpuRestUntil = pace.restUntil;
          gpuHotRef.current = pace.easeOn;
          gpuHotRef.reason = pace.reason;
          if (pace.reason === 'hot') eased.gpu = true;
          if (pace.reason === 'unsensed-rest') eased.blind = true;
          if (alive.current && pace.easeOn) setLabel(restLabel('graphics card', pace));
          return pace.easeOn ? 'pause' : 'run';
        },
      });
      if (gpu?.skipped && gpu.skipped !== 'Cancelled.') acc.gpuSkipped = gpu.skipped;
      const durationSec = Math.round((Date.now() - startedRef.current) / 1000);
      const scored = scoreBenchmark(acc, {
        mode: 'gpu',
        durationSec,
        eased,
        finished: true,
      });
      if (scored.graphics?.score > 0) {
        savePart(GPU_KEY, scored);
        if (alive.current) setGpuResult(scored);
      } else if (previous) {
        savePart(GPU_KEY, previous);
        if (alive.current) setGpuResult(previous);
      } else if (alive.current) {
        setGpuResult(null);
      }
      if (alive.current) {
        setLive(null);
        setLabel('');
        if (scored.graphics?.score > 0) {
          setBoardNote('GPU score saved on this PC. The leaderboard is the CPU all-core score.');
        } else if (acc.gpuSkipped) {
          showToast(acc.gpuSkipped, 'error');
        } else {
          showToast('Ended before the graphics card rendered a frame.', 'error');
        }
      }
    } catch (err) {
      if (previous) {
        savePart(GPU_KEY, previous);
        if (alive.current) setGpuResult(previous);
      } else if (alive.current) {
        setGpuResult(null);
      }
      if (alive.current && !stopRef.current) {
        showToast(err?.message || 'Benchmark failed.', 'error');
      }
    } finally {
      benchBusy = false;
      if (alive.current) setRunning(false);
    }
  }

  function endRun() {
    stopRef.current = true;
    gpuStop.current = true;
    window.nexforge?.cancelSystemBenchmark?.();
    setLabel('Ending the render and scoring what finished…');
  }

  async function copyResult() {
    const parts = [cpuResult, gpuResult].filter(Boolean);
    if (!parts.length) return;
    try {
      await navigator.clipboard.writeText(parts.map(formatBenchText).join('\n\n'));
      setCopied(true);
      showToast('Benchmark copied', 'success');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast('Could not copy the benchmark', 'error');
    }
  }

  const cpuShown = running && active === 'cpu' ? live : cpuResult;
  const gpuShown = running && active === 'gpu' ? live : gpuResult;
  const shown = running ? live : (active === 'gpu' ? gpuResult : cpuResult);
  const headline = active === 'gpu'
    ? (shown?.graphics?.score || 0)
    : (shown?.cpu?.multiPts || shown?.cpu?.singlePts || 0);
  const headlineName = active === 'gpu' ? 'GPU' : (shown?.cpu?.multiPts ? 'Multi Core' : 'Single Core');
  const hasSaved = !!(cpuResult || gpuResult);
  const myTag = (profile?.gamer_tag || '').toLowerCase();

  return (
    <div>
      <div className="card bench-hero">
        <div style={{ width: '100%' }}>
          <div className="card-title" style={{ marginBottom: 4 }}>System benchmark</div>
          <div className="coach-sub">{specLine(scan)}</div>
          {liveSession && (
            <div className="opt-warn">A game is open. Quit it first if you want a clean score.</div>
          )}
          <div className="bench-viewport">
            <canvas ref={canvasRef} width={VIEW_W} height={VIEW_H} />
            {!painted && !running && (
              <div className="bench-viewport-note">The scene keeps rendering here until you end the benchmark.</div>
            )}
          </div>
          {shown && (
            <div className="bench-score-wrap">
              <div>
                <div className="opt-spec-label">{headlineName}</div>
                <div className="bench-score">{Number(headline).toLocaleString()}</div>
              </div>
              <div>
                <div className={`bench-tier tier-${shown.tier?.id || 'entry'}`}>{shown.tier?.label}</div>
                <div className="bench-line">{shown.tier?.line}</div>
                {active !== 'gpu' && !!shown.cpu?.ratio && <div className="bench-line">{shown.cpu.ratio.toFixed(1)}× one core across all threads.</div>}
                {active === 'gpu' && !!shown.graphics?.renderer && <div className="bench-line">{shown.graphics.renderer}</div>}
                {!!shown.durationSec && !running && <div className="bench-line">Ran {formatClock(shown.durationSec)} of 10:00.</div>}
                {(shown.eased?.cpu || shown.eased?.gpu) && (
                  <div className="bench-line">Rested while a part was hot. Fan speed, voltage, and power limits stayed as they were.</div>
                )}
                {shown.eased?.blind && !shown.eased?.cpu && !shown.eased?.gpu && (
                  <div className="bench-line">Rested on a timer because temperature could not be read.</div>
                )}
              </div>
            </div>
          )}
          {!shown && !running && (
            <p className="bench-line" style={{ marginTop: 14 }}>
              CPU and GPU are separate, so both are never under load together. Each one keeps painting the same scene for up to 10 minutes. A hot part rests until it cools, and if temperature cannot be read the benchmark rests on a timer. Fan speed, voltage, and power limits are left alone.
            </p>
          )}
        </div>
        <div className="bench-actions">
          {running ? (
            <button type="button" className="action-btn ghost" onClick={endRun}>End and score</button>
          ) : (
            <>
              <button type="button" className="action-btn primary" onClick={runCpuBench}>
                {cpuResult ? 'Run CPU again' : 'Run CPU'}
              </button>
              <button type="button" className="action-btn primary" onClick={runGpuBenchOnly}>
                {gpuResult ? 'Run GPU again' : 'Run GPU'}
              </button>
            </>
          )}
          {hasSaved && !running && (
            <button type="button" className="action-btn ghost" onClick={copyResult}>
              {copied ? 'Copied' : 'Copy result'}
            </button>
          )}
          {running && <div className="bench-clock">{formatClock(elapsed / 1000)} / 10:00</div>}
        </div>
      </div>

      {running && (
        <div className="card bench-progress">
          <div className="bench-progress-label">{label || 'Rendering…'}</div>
          <div className="bench-track" aria-hidden="true">
            <div className="bench-fill" style={{ width: `${Math.min(100, (elapsed / BENCH_LIMIT_MS) * 100)}%` }} />
          </div>
          <div className="opt-spec-meta" style={{ marginTop: 8 }}>
            {temps?.cpuPct != null ? `CPU ${Math.round(temps.cpuPct)}% ` : ''}
            {temps?.cpuTempC != null ? `${Math.round(temps.cpuTempC)}°  ` : ''}
            {temps?.gpuPct != null ? `GPU ${Math.round(temps.gpuPct)}% ` : ''}
            {temps?.gpuTempC != null ? `${Math.round(temps.gpuTempC)}°` : ''}
            {temps && (active === 'gpu' ? temps.gpuTempC == null : temps.cpuTempC == null) ? 'Temperature is not reporting, so this benchmark rests on a timer. Fan speed and voltage stay untouched.' : ''}
          </div>
        </div>
      )}

      {(cpuShown || gpuShown || running) && (
        <div className="bench-grid">
          <article className="card bench-part">
            <div className="opt-spec-label">Multi Core</div>
            {running && active === 'cpu' && !cpuShown?.cpu?.multiOn ? (
              <>
                <div className="bench-part-score">Next</div>
                <div className="opt-spec-meta">Starts after the one-core pass</div>
              </>
            ) : cpuShown?.cpu?.multiOn || cpuShown?.cpu?.multiPts ? (
              <>
                <div className="bench-part-score">{Number(cpuShown.cpu?.multiPts || 0).toLocaleString()}</div>
                <div className="opt-spec-meta">{cpuShown.cpu?.ratio ? `${cpuShown.cpu.ratio.toFixed(1)}× one core` : 'All threads render the scene'}</div>
                {cpuShown.cpuName && <div className="opt-spec-meta">{cpuShown.cpuName}</div>}
              </>
            ) : (
              <div className="bench-skip">Run the CPU benchmark for this score.</div>
            )}
          </article>
          <article className="card bench-part">
            <div className="opt-spec-label">Single Core</div>
            {cpuShown?.cpu?.singlePts ? (
              <>
                <div className="bench-part-score">{Number(cpuShown.cpu.singlePts).toLocaleString()}</div>
                <div className="opt-spec-meta">One thread renders the same scene</div>
              </>
            ) : (
              <div className="bench-skip">{running && active === 'cpu' ? 'Starting…' : 'Run the CPU benchmark for this score.'}</div>
            )}
          </article>
          <article className="card bench-part">
            <div className="opt-spec-label">GPU</div>
            {gpuShown?.graphics?.skipped ? (
              <div className="bench-skip">{gpuShown.graphics.skipped}</div>
            ) : gpuShown?.graphics?.score > 0 ? (
              <>
                <div className="bench-part-score">{Number(gpuShown.graphics.score).toLocaleString()}</div>
                <div className="opt-spec-meta">Same scene, frame after frame</div>
                {gpuShown.graphics?.renderer && <div className="opt-spec-meta">{gpuShown.graphics.renderer}</div>}
              </>
            ) : (
              <div className="bench-skip">{running && active === 'gpu' ? 'Starting…' : 'Run the GPU benchmark for this score.'}</div>
            )}
          </article>
        </div>
      )}

      <div className="card bench-board">
        <div className="card-title" style={{ marginBottom: 4 }}>Leaderboard</div>
        <div className="coach-sub">Best CPU all-core score. The GPU benchmark stays on this PC.</div>
        {boardNote && <div className="bench-line" style={{ marginTop: 8 }}>{boardNote}</div>}
        {boardMissing && (
          <div className="bench-skip">The leaderboard needs v164-bench-leaderboard.sql applied in Supabase.</div>
        )}
        {!boardMissing && board.length === 0 && (
          <div className="bench-skip">No scores yet.</div>
        )}
        {board.length > 0 && (
          <div className="bench-table">
            <div className="bench-row head">
              <span>#</span><span>Player</span><span>Score</span><span>Time</span><span>PC</span>
            </div>
            {board.map((row, i) => (
              <div
                className={`bench-row ${myTag && String(row.gamer_tag || '').toLowerCase() === myTag ? 'me' : ''}`}
                key={`${row.gamer_tag}-${row.updated_at || i}`}
              >
                <span>{i + 1}</span>
                <span>{row.gamer_tag || 'Player'}</span>
                <span>{Number(row.overall || 0).toLocaleString()}</span>
                <span>{formatClock(row.duration_sec)}</span>
                <span>{[row.cpu_name, row.gpu_name].filter(Boolean).join(' · ') || '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="bench-foot">
        1000 multi-core points is a solid 1080p PC. The processor rests at 90°C and the graphics card rests at 87°C. Nothing here changes fans, voltage, or power limits.
      </p>
    </div>
  );
}
