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
  formatGbps,
  formatMBps,
  formatOps,
  scoreBenchmark,
} from '../lib/bench-score.js';
import { listBenchLeaderboard, missingBenchRpc, submitBenchScore } from '../lib/bench-board.js';

const HISTORY_KEY = 'nexforge.bench.v2';
const PHASES = [
  { kind: 'cpu-single', ms: 20000, label: 'Pushing one processor core' },
  { kind: 'cpu-multi', ms: 40000, label: 'Pushing every processor thread' },
  { kind: 'memory', ms: 20000, label: 'Pushing memory' },
  { kind: 'disk', ms: 20000, label: 'Reading the drive' },
  { kind: 'graphics', ms: 35000, label: 'Pushing graphics' },
];

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
    singleOps: 0,
    singleMs: 0,
    multiOps: 0,
    multiMs: 0,
    memCopies: 0,
    memMs: 0,
    diskBytes: 0,
    diskMs: 0,
    gpuGigaSeconds: 0,
    gpuSeconds: 0,
    gpuMethod: null,
    gpuName: null,
    gpuSkipped: null,
  };
}

function buildScore(prep, acc, durationSec, eased) {
  const raw = {
    at: Date.now(),
    cpuName: prep?.cpuName || null,
    threads: prep?.threads || null,
    cpu: {
      singleOpsPerSec: acc.singleMs > 0 ? acc.singleOps / (acc.singleMs / 1000) : 0,
      multiOpsPerSec: acc.multiMs > 0 ? acc.multiOps / (acc.multiMs / 1000) : 0,
    },
    memory: prep?.memorySkip
      ? { skipped: prep.memorySkip }
      : (acc.memMs > 0
        ? { copyGbps: (acc.memCopies * prep.memoryBytes) / (acc.memMs / 1000) / 1e9 }
        : { skipped: 'Ended before memory was tested.' }),
    disk: prep?.diskSkip
      ? { skipped: prep.diskSkip }
      : (acc.diskMs > 0
        ? {
          readMBps: (acc.diskBytes / (acc.diskMs / 1000)) / 1e6,
          writeMBps: prep.diskWriteMBps || 0,
        }
        : { skipped: 'Ended before the drive was tested.' }),
  };
  const gpu = acc.gpuSkipped
    ? { skipped: acc.gpuSkipped }
    : (acc.gpuSeconds > 0
      ? {
        gigaSteps: acc.gpuGigaSeconds / acc.gpuSeconds,
        method: acc.gpuMethod,
        renderer: acc.gpuName,
      }
      : { skipped: 'Ended before graphics were tested.' });
  return scoreBenchmark(raw, gpu, { durationSec, eased });
}

function canPostScore(prep, acc, durationSec) {
  if (durationSec < 45) return false;
  if (!(acc.singleMs > 0 && acc.multiMs > 0)) return false;
  if (!prep?.memorySkip && !(acc.memMs > 0)) return false;
  if (!prep?.diskSkip && !(acc.diskMs > 0)) return false;
  if (!acc.gpuSkipped && !(acc.gpuSeconds > 0)) return false;
  return true;
}

function sleep(ms, shouldStop) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (shouldStop() || Date.now() - started >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, 200);
  });
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
  const [board, setBoard] = useState([]);
  const [boardMissing, setBoardMissing] = useState(false);
  const [boardNote, setBoardNote] = useState('');
  const stopRef = useRef(false);
  const gpuStop = useRef(false);
  const alive = useRef(true);
  const startedRef = useRef(0);

  useEffect(() => () => {
    alive.current = false;
    stopRef.current = true;
    gpuStop.current = true;
    window.nexforge?.cancelSystemBenchmark?.();
    window.nexforge?.finishSystemBenchmark?.();
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
    setRunning(true);
    setCopied(false);
    setLive(null);
    setLabel('Getting the drive ready. This writes one small file, then only reads it.');
    setElapsed(0);
    startedRef.current = Date.now();
    const acc = emptyAcc();
    const eased = { cpu: false, gpu: false };
    let prep = null;
    try {
      prep = await window.nexforge.prepareSystemBenchmark();
      if (stopRef.current) return;
      while (Date.now() - startedRef.current < BENCH_LIMIT_MS && !stopRef.current) {
        for (const step of PHASES) {
          const left = BENCH_LIMIT_MS - (Date.now() - startedRef.current);
          if (stopRef.current || left < 2000) break;
          const slice = Math.min(step.ms, left);
          setLabel(step.label);
          const sample = await readTemps();
          if ((step.kind === 'cpu-single' || step.kind === 'cpu-multi') && sample.cpuTempC >= CPU_EASE_C) {
            eased.cpu = true;
            setLabel('Letting the processor cool. The test stays inside a safe temperature.');
            await sleep(8000, () => stopRef.current);
            continue;
          }
          if (step.kind === 'graphics' && sample.gpuTempC >= GPU_EASE_C) {
            eased.gpu = true;
            setLabel('Letting the graphics card cool. The test stays inside a safe temperature.');
            await sleep(8000, () => stopRef.current);
            continue;
          }
          if (step.kind === 'memory' && prep.memorySkip) continue;
          if (step.kind === 'disk' && prep.diskSkip) continue;
          if (step.kind === 'graphics') {
            gpuStop.current = false;
            const gpu = await runGpuBench({
              durationMs: slice,
              isCancelled: () => gpuStop.current || stopRef.current,
            });
            if (gpu?.skipped && gpu.skipped !== 'Cancelled.') acc.gpuSkipped = gpu.skipped;
            else if (gpu?.gigaSteps > 0 && gpu.seconds > 0) {
              acc.gpuGigaSeconds += gpu.gigaSteps * gpu.seconds;
              acc.gpuSeconds += gpu.seconds;
              acc.gpuMethod = gpu.method;
              acc.gpuName = gpu.renderer || acc.gpuName;
              acc.gpuSkipped = null;
            }
          } else {
            const part = await window.nexforge.runBenchPhase({
              kind: step.kind,
              ms: slice,
              bytes: prep.memoryBytes,
            });
            if (part?.stopped && stopRef.current) {
              absorb(acc, step.kind, part);
              break;
            }
            absorb(acc, step.kind, part);
          }
          if (alive.current) {
            setLive(buildScore(prep, acc, (Date.now() - startedRef.current) / 1000, eased));
          }
          if (stopRef.current) break;
        }
      }
      const durationSec = Math.round((Date.now() - startedRef.current) / 1000);
      const scored = buildScore(prep, acc, durationSec, eased);
      const postable = scored.overall > 0 && canPostScore(prep, acc, durationSec);
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
      } else if (alive.current && scored.overall > 0 && !postable) {
        setBoardNote('Saved on this PC. Let it test the processor, memory, drive, and graphics to post a score.');
      } else if (alive.current && scored.overall > 0 && guestMode) {
        setBoardNote('Saved on this PC. Sign in to post it to the leaderboard.');
      } else if (alive.current) {
        showToast('Ended before there was a score.', 'error');
      }
    } catch (err) {
      if (alive.current && !stopRef.current) {
        showToast(err?.code === 'BUSY' ? 'A benchmark is already running.' : (err?.message || 'Benchmark failed.'), 'error');
      }
    } finally {
      await window.nexforge?.finishSystemBenchmark?.();
      if (alive.current) setRunning(false);
    }
  }

  function endRun() {
    stopRef.current = true;
    gpuStop.current = true;
    window.nexforge?.cancelSystemBenchmark?.();
    setLabel('Ending the run and scoring what finished…');
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
  const myTag = (profile?.gamer_tag || '').toLowerCase();

  return (
    <div>
      <div className="card bench-hero">
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>System benchmark</div>
          <div className="coach-sub">{specLine(scan)}</div>
          {liveSession && (
            <div className="opt-warn">A game is open. Quit it first if you want a clean score.</div>
          )}
          {shown && !running && (
            <div className="bench-score-wrap">
              <div className="bench-score">{shown.overall.toLocaleString()}</div>
              <div>
                <div className={`bench-tier tier-${shown.tier?.id || 'entry'}`}>{shown.tier?.label}</div>
                <div className="bench-line">{shown.tier?.line}</div>
                <div className="bench-limit">{shown.limit}</div>
                {!!shown.durationSec && <div className="bench-line">Ran {formatClock(shown.durationSec)} of 10:00.</div>}
                {(shown.eased?.cpu || shown.eased?.gpu) && (
                  <div className="bench-line">Eased off when a part got hot, so the PC stayed safe.</div>
                )}
              </div>
            </div>
          )}
          {!shown && !running && (
            <p className="bench-line" style={{ marginTop: 14 }}>
              Runs for 10 minutes and you can end it whenever you want. It loads the processor, memory, a single drive file, and the graphics card. If a sensor says a part is too hot, that part rests. The drive is written once, then only read, so it is not worn down.
            </p>
          )}
        </div>
        <div className="bench-actions">
          {running ? (
            <button type="button" className="action-btn ghost" onClick={endRun}>End and score</button>
          ) : (
            <button type="button" className="action-btn primary" onClick={runBench}>
              {result ? 'Run again' : 'Run 10 minute benchmark'}
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
          <div className="bench-progress-label">{label || 'Running…'}</div>
          <div className="bench-track" aria-hidden="true">
            <div className="bench-fill" style={{ width: `${Math.max(2, Math.min(100, (elapsed / BENCH_LIMIT_MS) * 100))}%` }} />
          </div>
          <div className="opt-spec-meta" style={{ marginTop: 8 }}>
            {temps?.cpuTempC != null ? `CPU ${Math.round(temps.cpuTempC)}° ` : ''}
            {temps?.gpuTempC != null ? `GPU ${Math.round(temps.gpuTempC)}°` : ''}
            {temps?.cpuTempC == null && temps?.gpuTempC == null ? 'Temperature sensors are not reporting. The PC’s own limits still apply.' : ''}
          </div>
        </div>
      )}

      {shown && (
        <div className="bench-grid">
          <article className="card bench-part">
            <div className="opt-spec-label">Processor</div>
            <div className="bench-part-score">{shown.cpu.score.toLocaleString()}</div>
            <div className="opt-spec-meta">
              {shown.threads ? `${shown.threads} threads · ` : ''}
              {formatOps(shown.cpu.singleOpsPerSec)} one core
            </div>
            <div className="opt-spec-meta">{formatOps(shown.cpu.multiOpsPerSec)} all threads</div>
            {shown.cpuName && <div className="opt-spec-meta">{shown.cpuName}</div>}
          </article>
          <article className="card bench-part">
            <div className="opt-spec-label">Memory</div>
            {shown.memory.skipped ? (
              <div className="bench-skip">{shown.memory.skipped}</div>
            ) : (
              <>
                <div className="bench-part-score">{shown.memory.score.toLocaleString()}</div>
                <div className="opt-spec-meta">{formatGbps(shown.memory.copyGbps)} copy</div>
              </>
            )}
          </article>
          <article className="card bench-part">
            <div className="opt-spec-label">Drive</div>
            {shown.disk.skipped ? (
              <div className="bench-skip">{shown.disk.skipped}</div>
            ) : (
              <>
                <div className="bench-part-score">{shown.disk.score.toLocaleString()}</div>
                <div className="opt-spec-meta">{formatMBps(shown.disk.readMBps)} read</div>
                <div className="opt-spec-meta">{formatMBps(shown.disk.writeMBps)} write, once</div>
              </>
            )}
          </article>
          <article className="card bench-part">
            <div className="opt-spec-label">Graphics</div>
            {shown.graphics.skipped ? (
              <div className="bench-skip">{shown.graphics.skipped}</div>
            ) : (
              <>
                <div className="bench-part-score">{shown.graphics.score.toLocaleString()}</div>
                <div className="opt-spec-meta">Timed on the graphics card.</div>
                {shown.graphics.renderer && <div className="opt-spec-meta">{shown.graphics.renderer}</div>}
              </>
            )}
          </article>
        </div>
      )}

      <div className="card bench-board">
        <div className="card-title" style={{ marginBottom: 4 }}>Leaderboard</div>
        <div className="coach-sub">Each player’s best score. A run is posted after it has tested every part.</div>
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
        1000 on a part is a solid 1080p PC. The score is the average speed across the run, so a full 10 minutes includes heat. It does not change voltages or fans.
      </p>
    </div>
  );
}

function absorb(acc, kind, part) {
  if (!part || part.skipped) return;
  if (kind === 'cpu-single' && part.ops > 0 && part.elapsedMs > 0) {
    acc.singleOps += part.ops;
    acc.singleMs += part.elapsedMs;
  }
  if (kind === 'cpu-multi' && part.ops > 0 && part.elapsedMs > 0) {
    acc.multiOps += part.ops;
    acc.multiMs += part.elapsedMs;
  }
  if (kind === 'memory' && part.copies > 0 && part.elapsedMs > 0) {
    acc.memCopies += part.copies;
    acc.memMs += part.elapsedMs;
  }
  if (kind === 'disk' && part.bytes > 0 && part.elapsedMs > 0) {
    acc.diskBytes += part.bytes;
    acc.diskMs += part.elapsedMs;
  }
}
