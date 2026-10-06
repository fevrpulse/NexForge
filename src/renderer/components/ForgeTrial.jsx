import React, { useCallback, useEffect, useRef, useState } from 'react';
import { sb } from '../lib/supabase.js';
import {
  FORGE_APPROACH_MS,
  FORGE_MISS_LIMIT,
  activeBeatIndex,
  forgeTrialSchedule,
  judgeBeat,
  settledMisses,
} from '../lib/forge-schedule.js';

function formatWait(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'soon';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours <= 0) return `${Math.max(1, minutes)}m`;
  return `${hours}h ${minutes}m`;
}

function sparkLeft(beat, elapsed) {
  const start = beat.at - FORGE_APPROACH_MS;
  const t = (elapsed - start) / (FORGE_APPROACH_MS * 2);
  return Math.min(1, Math.max(0, t));
}

export default function ForgeTrial({ refreshProfile, showToast, reportCloudError }) {
  const [status, setStatus] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [trial, setTrial] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [hits, setHits] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const hitsRef = useRef([]);
  const startRef = useRef(0);
  const submittedRef = useRef(false);
  const scheduleRef = useRef(forgeTrialSchedule());
  const finishRef = useRef(null);

  const loadStatus = useCallback(async () => {
    const { data, error } = await sb.rpc('forge_trial_status');
    if (error) throw error;
    setStatus(data);
    return data;
  }, []);

  useEffect(() => {
    let alive = true;
    loadStatus().catch(async (err) => {
      if (!alive) return;
      showToast(err?.message || 'Could not open the Forge.', 'error');
      await reportCloudError(err);
    });
    return () => { alive = false; };
  }, [loadStatus, reportCloudError, showToast]);

  const finish = useCallback(async (strikeHits) => {
    if (!trial?.trial_id) return;
    setPhase('submitting');
    setBusy(true);
    try {
      const { data, error } = await sb.rpc('finish_forge_trial', {
        p_trial_id: trial.trial_id,
        p_hits: strikeHits,
      });
      if (error) throw error;
      setResult(data);
      setPhase('done');
      await refreshProfile();
      await loadStatus();
      if (data?.coins > 0) {
        showToast(`Minted ${data.coins} Forge Coins`, 'success');
      }
    } catch (err) {
      const message = String(err?.message || '');
      if (/already finished|expired/i.test(message)) {
        setPhase('idle');
        try { await loadStatus(); } catch { /* ignore */ }
      } else {
        setPhase('retry');
      }
      showToast(message || 'Could not finish the mint.', 'error');
      await reportCloudError(err);
    } finally {
      setBusy(false);
    }
  }, [loadStatus, refreshProfile, reportCloudError, showToast, trial]);

  finishRef.current = finish;

  useEffect(() => {
    if (phase !== 'running') return undefined;
    let frame = 0;
    const loop = () => {
      const now = performance.now() - startRef.current;
      setElapsed(now);
      const sched = scheduleRef.current;
      const last = sched[sched.length - 1];
      if (!submittedRef.current && now > last.at + last.window / 2 + 280) {
        submittedRef.current = true;
        finishRef.current(hitsRef.current);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const strike = useCallback(() => {
    if (phase !== 'running' || submittedRef.current) return;
    const at = Math.round(performance.now() - startRef.current);
    const previous = hitsRef.current[hitsRef.current.length - 1];
    if (previous != null && at - previous < 80) return;
    const next = hitsRef.current.concat(at);
    hitsRef.current = next;
    setHits(next);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'running') return undefined;
    const onKey = (event) => {
      if (event.repeat) return;
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      event.preventDefault();
      strike();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, strike]);

  async function startMint() {
    if (busy || phase === 'running' || phase === 'submitting') return;
    setBusy(true);
    setResult(null);
    try {
      const { data, error } = await sb.rpc('start_forge_trial');
      if (error) throw error;
      const schedule = Array.isArray(data?.schedule) ? data.schedule : forgeTrialSchedule();
      scheduleRef.current = schedule;
      const age = Math.max(0, Date.now() - Date.parse(data.started_at));
      startRef.current = performance.now() - age;
      hitsRef.current = [];
      submittedRef.current = false;
      setHits([]);
      setElapsed(age);
      setTrial(data);
      setPhase('running');
    } catch (err) {
      const message = String(err?.message || '');
      if (/cooling down|tries left/i.test(message)) {
        try { await loadStatus(); } catch { /* status toast already covered */ }
      }
      showToast(message || 'Could not start the Forge.', 'error');
      await reportCloudError(err);
    } finally {
      setBusy(false);
    }
  }

  const schedule = scheduleRef.current;
  const beatIndex = phase === 'running' ? activeBeatIndex(schedule, elapsed) : 0;
  const beat = schedule[beatIndex] || schedule[0];
  const left = sparkLeft(beat, elapsed);
  const gatePct = (beat.window / (FORGE_APPROACH_MS * 2)) * 100;
  const inGate = phase === 'running' && Math.abs(elapsed - beat.at) * 2 <= beat.window;
  const misses = phase === 'running' ? settledMisses(schedule, hits, elapsed) : (result?.misses ?? 0);
  const lead = schedule[0].at - FORGE_APPROACH_MS;
  const countdown = phase === 'running' && elapsed < lead ? Math.ceil((lead - elapsed) / 1000) : 0;
  const locked = status && (status.cooldown || status.attempts_left <= 0) && phase !== 'running';
  const attemptLabel = phase === 'running' && trial?.attempt
    ? `Try ${trial.attempt} of ${trial.max_attempts || 2}`
    : status
      ? `${status.attempts_left} of ${status.max_attempts} tries left`
      : '';

  return (
    <section className="forge-mint card">
      <div className="forge-mint-copy">
        <div className="card-title">The Forge</div>
        <p className="forge-mint-lead">
          Forge Coins are minted here. Strike once while the spark is in the gate.
          The gate tightens across 12 hits. More than {FORGE_MISS_LIMIT} misses pays nothing.
          You get two tries, then the Forge locks for 20 hours.
        </p>
        <p className="forge-mint-pays">Perfect 420 · one miss 260 · two misses 160. Match wins do not pay coins.</p>
        <div className="forge-mint-meta">
          <span>{attemptLabel}</span>
          {status?.next_at && locked ? <span>Back in {formatWait(status.next_at)}</span> : null}
          {result ? (
            <span>
              {result.coins > 0
                ? `Minted ${result.coins}`
                : `Mint failed · ${result.misses} misses`}
            </span>
          ) : null}
        </div>
      </div>

      <div className="forge-track-wrap">
        <div className="forge-pips" aria-hidden="true">
          {schedule.map((item, index) => {
            const closed = elapsed >= item.at + item.window / 2;
            let tone = '';
            if (phase === 'done' || phase === 'retry' || (phase === 'running' && closed)) {
              tone = judgeBeat(schedule, hits, index) ? 'good' : 'bad';
            } else if (phase === 'running' && index === beatIndex) {
              tone = 'now';
            }
            return <i key={item.at} className={tone} />;
          })}
        </div>
        <div className={`forge-track ${inGate ? 'hot' : ''}`}>
          <div
            className="forge-gate"
            style={{ width: `${gatePct}%` }}
          />
          <div
            className="forge-spark"
            style={{ left: `${left * 100}%` }}
          />
        </div>
        <div className="forge-track-label">
          {phase === 'running'
            ? (countdown ? `Get ready ${countdown}` : `Hit ${beatIndex + 1} of ${schedule.length} · ${misses} misses`)
            : phase === 'submitting'
              ? 'Minting…'
              : phase === 'done'
                ? (result?.coins > 0 ? `Minted ${result.coins} Forge Coins` : `Mint failed · ${result?.misses ?? 0} misses`)
                : locked
                  ? 'Forge locked'
                  : 'Spark crosses the gate. Strike once.'}
        </div>
      </div>

      <div className="forge-actions">
        {phase === 'running' ? (
          <button type="button" className="action-btn primary forge-strike" onClick={strike}>
            Strike
          </button>
        ) : phase === 'retry' ? (
          <button type="button" className="action-btn primary" onClick={() => finish(hitsRef.current)} disabled={busy}>
            {busy ? 'Minting…' : 'Send mint'}
          </button>
        ) : (
          <button
            type="button"
            className={`action-btn ${locked ? 'claimed' : 'primary'}`}
            onClick={startMint}
            disabled={busy || locked || phase === 'submitting'}
          >
            {busy ? 'Opening…' : locked ? 'Forge locked' : phase === 'done' ? 'Forge again' : 'Start the Forge'}
          </button>
        )}
      </div>
    </section>
  );
}
