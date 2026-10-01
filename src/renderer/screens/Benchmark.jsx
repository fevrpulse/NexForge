import React, { useEffect, useRef, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { loadHwScan } from '../lib/optimize.js';
import { runGpuBench } from '../lib/gpu-bench.js';
import {
  formatBenchText,
  formatGbps,
  formatMBps,
  formatOps,
  scoreBenchmark,
} from '../lib/bench-score.js';

const HISTORY_KEY = 'nexforge.bench.v1';

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
  if (!scan) return 'Scores this PC. Close games first so the numbers are the machine, not the game.';
  const bits = [];
  if (scan.cpu?.name) bits.push(scan.cpu.name);
  if (scan.gpu?.name) bits.push(scan.gpu.name);
  if (scan.ramGb) bits.push(`${scan.ramGb} GB RAM`);
  return bits.join(' · ') || 'Scores this PC. Close games first so the numbers are the machine, not the game.';
}

function ago(at) {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

export default function Benchmark() {
  const { showToast, liveSession } = useNexForge();
  const [scan] = useState(() => loadHwScan());
  const [history, setHistory] = useState(loadHistory);
  const [result, setResult] = useState(() => loadHistory()[0] || null);
  const [running, setRunning] = useState(false);
  const [label, setLabel] = useState('');
  const [pct, setPct] = useState(0);
  const [copied, setCopied] = useState(false);
  const cancelGpu = useRef(false);
  const unsub = useRef(null);
  const alive = useRef(true);

  useEffect(() => () => {
    alive.current = false;
    cancelGpu.current = true;
    unsub.current?.();
    window.nexforge?.cancelSystemBenchmark?.();
  }, []);

  async function runBench() {
    if (running) return;
    if (!window.nexforge?.runSystemBenchmark) {
      showToast('Benchmark only runs in the desktop app.', 'error');
      return;
    }
    cancelGpu.current = false;
    setRunning(true);
    setCopied(false);
    setPct(4);
    setLabel('Starting…');
    unsub.current?.();
    unsub.current = window.nexforge.onBenchmarkProgress?.((p) => {
      if (!alive.current) return;
      if (p?.label) setLabel(p.label);
      if (Number.isFinite(p?.pct)) setPct(p.pct);
    }) || null;
    try {
      const raw = await window.nexforge.runSystemBenchmark();
      if (!alive.current) return;
      if (!raw || raw.cancelled) {
        setLabel('');
        setPct(0);
        return;
      }
      setLabel('Testing graphics…');
      setPct(86);
      const gpu = await runGpuBench({
        isCancelled: () => cancelGpu.current,
        onProgress: (t) => {
          if (alive.current) setPct(86 + Math.round(t * 14));
        },
      });
      if (!alive.current) return;
      if (cancelGpu.current || gpu?.skipped === 'Cancelled.') {
        setLabel('');
        setPct(0);
        return;
      }
      const scored = scoreBenchmark(raw, gpu);
      setResult(scored);
      setHistory(saveHistory(scored));
      setPct(100);
      setLabel('Done');
    } catch (err) {
      if (err?.code === 'BUSY' || /already running/i.test(err?.message || '')) {
        showToast('A benchmark is already running.', 'error');
      } else {
        showToast(err?.message || 'Benchmark failed.', 'error');
      }
    } finally {
      unsub.current?.();
      unsub.current = null;
      setRunning(false);
    }
  }

  function stop() {
    cancelGpu.current = true;
    window.nexforge?.cancelSystemBenchmark?.();
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

  const previous = history.find((row) => row.at !== result?.at);

  return (
    <div>
      <div className="card bench-hero">
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>System benchmark</div>
          <div className="coach-sub">{specLine(scan)}</div>
          {liveSession && (
            <div className="opt-warn">A game is open. Quit it first if you want a clean score.</div>
          )}
          {result && !running && (
            <div className="bench-score-wrap">
              <div className="bench-score">{result.overall.toLocaleString()}</div>
              <div>
                <div className={`bench-tier tier-${result.tier?.id || 'entry'}`}>{result.tier?.label}</div>
                <div className="bench-line">{result.tier?.line}</div>
                <div className="bench-limit">{result.limit}</div>
              </div>
            </div>
          )}
          {!result && !running && (
            <p className="bench-line" style={{ marginTop: 14 }}>
              About 15 seconds. Fans may get loud. The score is NexForge Bench 1 — 1000 on a part matches a solid 1080p PC.
            </p>
          )}
        </div>
        <div className="bench-actions">
          {running ? (
            <button type="button" className="action-btn ghost" onClick={stop}>Stop</button>
          ) : (
            <button type="button" className="action-btn primary" onClick={runBench}>
              {result ? 'Run again' : 'Run benchmark'}
            </button>
          )}
          {result && !running && (
            <button type="button" className="action-btn ghost" onClick={copyResult}>
              {copied ? 'Copied' : 'Copy result'}
            </button>
          )}
          {previous && result && !running && (
            <div className="bench-delta">
              Last score {previous.overall.toLocaleString()} · {ago(previous.at)}
              {' · '}
              {result.overall === previous.overall
                ? 'same'
                : `${result.overall > previous.overall ? '+' : ''}${(result.overall - previous.overall).toLocaleString()}`}
            </div>
          )}
        </div>
      </div>

      {running && (
        <div className="card bench-progress">
          <div className="bench-progress-label">{label || 'Running…'}</div>
          <div className="bench-track" aria-hidden="true">
            <div className="bench-fill" style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
          </div>
        </div>
      )}

      {result && (
        <div className="bench-grid">
          <article className="card bench-part">
            <div className="opt-spec-label">Processor</div>
            <div className="bench-part-score">{result.cpu.score.toLocaleString()}</div>
            <div className="opt-spec-meta">
              {result.threads ? `${result.threads} threads · ` : ''}
              {formatOps(result.cpu.singleOpsPerSec)} one core
            </div>
            <div className="opt-spec-meta">{formatOps(result.cpu.multiOpsPerSec)} all cores</div>
            {result.cpuName && <div className="opt-spec-meta">{result.cpuName}</div>}
          </article>
          <article className="card bench-part">
            <div className="opt-spec-label">Memory</div>
            {result.memory.skipped ? (
              <div className="bench-skip">{result.memory.skipped}</div>
            ) : (
              <>
                <div className="bench-part-score">{result.memory.score.toLocaleString()}</div>
                <div className="opt-spec-meta">{formatGbps(result.memory.copyGbps)} copy</div>
              </>
            )}
          </article>
          <article className="card bench-part">
            <div className="opt-spec-label">Drive</div>
            {result.disk.skipped ? (
              <div className="bench-skip">{result.disk.skipped}</div>
            ) : (
              <>
                <div className="bench-part-score">{result.disk.score.toLocaleString()}</div>
                <div className="opt-spec-meta">{formatMBps(result.disk.readMBps)} read</div>
                <div className="opt-spec-meta">{formatMBps(result.disk.writeMBps)} write</div>
              </>
            )}
          </article>
          <article className="card bench-part">
            <div className="opt-spec-label">Graphics</div>
            {result.graphics.skipped ? (
              <div className="bench-skip">{result.graphics.skipped}</div>
            ) : (
              <>
                <div className="bench-part-score">{result.graphics.score.toLocaleString()}</div>
                <div className="opt-spec-meta">
                  {result.graphics.method === 'frames'
                    ? 'Timed in the window, so this score sits a bit lower.'
                    : 'Timed on the graphics card.'}
                </div>
                {result.graphics.renderer && <div className="opt-spec-meta">{result.graphics.renderer}</div>}
              </>
            )}
          </article>
        </div>
      )}

      {result && (
        <p className="bench-foot">
          1000 on a part is a solid 1080p PC. Scores compare NexForge Bench 1 runs. They are not 3DMark or another lab test.
          {result.graphics?.method === 'frames' ? ' This graphics score used the window timer.' : ''}
        </p>
      )}
    </div>
  );
}
