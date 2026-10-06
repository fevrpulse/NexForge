import React, { useEffect, useRef, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { loadHwScan } from '../lib/optimize.js';
import { runGpuBench } from '../lib/gpu-bench.js';
import {
  BENCH_LIMIT_MS,
  CPU_EASE_C,
  GPU_EASE_C,
  formatBenchText,
  formatClock,
  scoreBenchmark,
} from '../lib/bench-score.js';
import { listBenchLeaderboard, missingBenchRpc, submitBenchScore } from '../lib/bench-board.js';

const HISTORY_KEY = 'nexforge.bench.v4';
const VIEW_W = 640;
const VIEW_H = 360;
const SINGLE_MS = 70000;
const GPU_MS = 70000;

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function saveHistory(result) {
  const prev = loadHistory().filter((row) => row?.at !== result.at);
  const next = [result, ...prev].slice(0, 6);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

function clearHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
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
  const [result, setResult] = useState(() => loadHistory()[0] || null);
  const [live, setLive] = useState(null);
  const [running, setRunning] = useState(false);
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

  useEffect(() => () => {
    alive.current = false;
    stopRef.current = true;
    gpuStop.current = true;
    window.nexforge?.cancelSystemBenchmark?.();
    window.nexforge?.finishSystemBenchmark?.();
  }, []);

  useEffect(() => {
    const off = window.nexforge?.onBenchTile?.((tile) => {
      if (!tilesOn.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx || !tile?.pixels || !tile.w || !tile.h) return;
      const pixels = tile.pixels instanceof Uint8Array ? tile.pixels : new Uint8Array(tile.pixels);
      if (pixels.length < tile.w * tile.h * 4) return;
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

  async function runBench() {
    if (running) return;
    if (!window.nexforge?.prepareSystemBenchmark || !window.nexforge?.runBenchPhase) {
      showToast('Benchmark only runs in the desktop app.', 'error');
      return;
    }
    stopRef.current = false;
    gpuStop.current = false;
    tilesOn.current = false;
    setResult(null);
    setRunning(true);
    setCopied(false);
    setLive(null);
    setPainted(false);
    setTemps(null);
    setBoardNote('');
    setLabel('Starting the render.');
    setElapsed(0);
    startedRef.current = Date.now();
    clearView();
    const acc = emptyAcc();
    const eased = { cpu: false, gpu: false };
    let prep = null;
    try {
      prep = await window.nexforge.prepareSystemBenchmark();
      clearHistory();
      const publish = () => {
        if (!alive.current || !prep) return;
        setLive(scoreBenchmark(acc, {
          durationSec: (Date.now() - startedRef.current) / 1000,
          eased,
          cpuName: prep.cpuName,
          threads: prep.threads,
        }));
      };
      const renderFor = async (ms, kind, text) => {
        if (stopRef.current || ms < 1500) return;
        tilesOn.current = false;
        clearView();
        setPainted(false);
        const started = await window.nexforge.runBenchPhase({
          kind: 'render-start',
          threads: kind === 'single' ? 1 : prep.threads,
        });
        if (started?.stopped || stopRef.current) return;
        tilesOn.current = true;
        let easeOn = false;
        const end = Date.now() + ms;
        while (!stopRef.current && Date.now() < end) {
          const sample = await readTemps();
          if (sample.cpuTempC >= CPU_EASE_C) easeOn = true;
          else if (sample.cpuTempC > 0 && sample.cpuTempC < 84) easeOn = false;
          if (easeOn) eased.cpu = true;
          await window.nexforge.runBenchPhase({ kind: 'render-ease', on: easeOn });
          const snap = await window.nexforge.runBenchPhase({ kind: 'render-snap' });
          if (kind === 'single') {
            acc.singleSamples = snap?.samples || 0;
            acc.singleMs = snap?.elapsedMs || 0;
          } else {
            acc.multiSamples = snap?.samples || 0;
            acc.multiMs = snap?.elapsedMs || 0;
          }
          if (alive.current) {
            setLabel(easeOn
              ? 'Resting the processor. The render continues when it is cooler.'
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

      await renderFor(Math.min(SINGLE_MS, BENCH_LIMIT_MS), 'single', 'One core.');
      const afterSingle = BENCH_LIMIT_MS - (Date.now() - startedRef.current);
      const gpuReserve = afterSingle > GPU_MS + 20000 ? GPU_MS : 0;
      await renderFor(afterSingle - gpuReserve, 'multi', 'All cores.');
      const gpuLeft = BENCH_LIMIT_MS - (Date.now() - startedRef.current);
      if (!stopRef.current && gpuLeft > 4000) {
        tilesOn.current = false;
        clearView();
        setPainted(false);
        setLabel('Graphics card, rendering the same scene.');
        const gpu = await runGpuBench({
          canvas: canvasRef.current,
          durationMs: gpuLeft,
          isCancelled: () => gpuStop.current || stopRef.current,
          onSample: (sample) => {
            if (!sample?.seconds || !(sample.samples > 0)) return;
            acc.gpuSamples = sample.samples;
            acc.gpuMs = sample.seconds * 1000;
            acc.gpuName = sample.renderer || acc.gpuName;
            acc.gpuSkipped = null;
            setPainted(true);
            publish();
          },
          onTick: async () => {
            const sample = await readTemps();
            const gpuHot = sample.gpuTempC >= GPU_EASE_C;
            if (gpuHot) eased.gpu = true;
            if (alive.current) {
              setLabel(gpuHot
                ? 'Resting the graphics card. The render continues when it is cooler.'
                : 'Graphics card, rendering the same scene.');
            }
            return gpuHot ? 'pause' : 'run';
          },
        });
        if (gpu?.skipped && gpu.skipped !== 'Cancelled.') acc.gpuSkipped = gpu.skipped;
      }
      const durationSec = Math.round((Date.now() - startedRef.current) / 1000);
      const scored = scoreBenchmark(acc, {
        durationSec,
        eased,
        finished: true,
        cpuName: prep.cpuName,
        threads: prep.threads,
      });
      const postable = scored.overall > 0 && canPostScore(acc, durationSec);
      if (alive.current) {
        setLive(null);
        setLabel('');
        if (scored.overall > 0) {
          setResult(scored);
          saveHistory(scored);
        }
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
      } else if (alive.current && scored.overall > 0 && guestMode) {
        setBoardNote('Saved on this PC. Sign in to post it to the leaderboard.');
      } else if (alive.current && !(scored.cpu?.multiPts > 0)) {
        showToast('Ended before the all-core render had a score.', 'error');
      }
    } catch (err) {
      if (alive.current && !stopRef.current) {
        if (!prep) setResult(loadHistory()[0] || null);
        showToast(err?.code === 'BUSY' ? 'A benchmark is already running.' : (err?.message || 'Benchmark failed.'), 'error');
      }
    } finally {
      tilesOn.current = false;
      await window.nexforge?.finishSystemBenchmark?.();
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
    if (!result) return;
    try {
      await navigator.clipboard.writeText(formatBenchText(result));
      setCopied(true);
      showToast('Benchmark copied', 'success');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast('Could not copy the benchmark', 'error');
    }
  }

  const shown = running ? live : result;
  const headline = shown?.cpu?.multiPts || shown?.cpu?.singlePts || shown?.overall || 0;
  const headlineName = shown?.cpu?.multiPts ? 'Multi Core' : 'Single Core';
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
              <div className="bench-viewport-note">The scene renders here, one tile at a time.</div>
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
                {!!shown.cpu?.ratio && <div className="bench-line">{shown.cpu.ratio.toFixed(1)}× one core across all threads.</div>}
                {!!shown.durationSec && !running && <div className="bench-line">Ran {formatClock(shown.durationSec)} of 10:00.</div>}
                {(shown.eased?.cpu || shown.eased?.gpu) && (
                  <div className="bench-line">Eased off when a part got hot, so the PC stayed safe.</div>
                )}
              </div>
            </div>
          )}
          {!shown && !running && (
            <p className="bench-line" style={{ marginTop: 14 }}>
              Renders one scene for 10 minutes. One core first, then every core, then the graphics card. You can end it early and keep the score. If a part gets too hot, that part rests. Fan speed stays on this PC’s own curve.
            </p>
          )}
        </div>
        <div className="bench-actions">
          {running ? (
            <button type="button" className="action-btn ghost" onClick={endRun}>End and score</button>
          ) : (
            <button type="button" className="action-btn primary" onClick={runBench}>
              {result ? 'Run again' : 'Run 10 minute render'}
            </button>
          )}
          {result && !running && (
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
            {temps?.cpuTempC == null && temps?.gpuTempC == null && temps?.cpuPct == null && temps?.gpuPct == null ? 'Temperature sensors are not reporting. The PC’s own limits still apply.' : ''}
          </div>
        </div>
      )}

      {shown && (
        <div className="bench-grid">
          <article className="card bench-part">
            <div className="opt-spec-label">Multi Core</div>
            <div className="bench-part-score">{Number(shown.cpu?.multiPts || 0).toLocaleString()}</div>
            <div className="opt-spec-meta">{shown.cpu?.ratio ? `${shown.cpu.ratio.toFixed(1)}× one core` : 'All threads render the scene'}</div>
            {shown.cpuName && <div className="opt-spec-meta">{shown.cpuName}</div>}
          </article>
          <article className="card bench-part">
            <div className="opt-spec-label">Single Core</div>
            <div className="bench-part-score">{Number(shown.cpu?.singlePts || 0).toLocaleString()}</div>
            <div className="opt-spec-meta">One thread renders the same scene</div>
          </article>
          <article className="card bench-part">
            <div className="opt-spec-label">GPU</div>
            {shown.graphics?.skipped ? (
              <div className="bench-skip">{shown.graphics.skipped}</div>
            ) : (
              <>
                <div className="bench-part-score">{Number(shown.graphics?.score || 0).toLocaleString()}</div>
                <div className="opt-spec-meta">Same scene on the graphics card</div>
                {shown.graphics?.renderer && <div className="opt-spec-meta">{shown.graphics.renderer}</div>}
              </>
            )}
          </article>
        </div>
      )}

      <div className="card bench-board">
        <div className="card-title" style={{ marginBottom: 4 }}>Leaderboard</div>
        <div className="coach-sub">Best multi-core score. A run posts after the all-core render has had time to settle.</div>
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
        1000 multi-core points is a solid 1080p PC. The 10 minutes let the processor heat up, so the score is the sustained render, and fan speed stays on this PC’s own curve.
      </p>
    </div>
  );
}
