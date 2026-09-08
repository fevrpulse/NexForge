import React, { useEffect, useMemo, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { gameMark } from '../lib/games.js';
import { GameIcon, hasGameIcon } from '../components/icons.jsx';
import {
  defaultGoalForGame,
  formatRecommendationText,
  loadHwScan,
  qualityFromScan,
  recommendSettings,
  saveHwScan,
} from '../lib/optimize.js';

const QUALITY_TONE = {
  potato: 'high',
  low: 'medium',
  medium: 'medium',
  high: 'low',
  ultra: 'low',
};

function specLine(scan) {
  if (!scan) return 'Scan this PC to read CPU, GPU, RAM, and display.';
  const bits = [];
  if (scan.gpu?.name) bits.push(scan.gpu.name);
  if (scan.cpu?.name) bits.push(scan.cpu.name);
  if (scan.ramGb) bits.push(`${scan.ramGb} GB RAM`);
  const { width, height, refreshHz } = scan.display || {};
  if (width && height) bits.push(`${width}×${height}${refreshHz ? ` @ ${refreshHz} Hz` : ''}`);
  return bits.join(' · ') || 'Specs loaded.';
}

export default function Optimize() {
  const { profile, gameCatalog, liveSession, lastSessionRecap, showToast, appPlatform } = useNexForge();
  const [scan, setScan] = useState(() => loadHwScan());
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [game, setGame] = useState(
    liveSession?.game || lastSessionRecap?.game || profile?.main_game || 'Valorant',
  );
  const [goal, setGoal] = useState(() => defaultGoalForGame(
    liveSession?.game || lastSessionRecap?.game || profile?.main_game || 'Valorant',
  ));
  const [copied, setCopied] = useState(false);

  async function runScan(force = false) {
    if (!window.nexforge?.scanDeviceSpecs) {
      setScanError('Spec scan only runs in the desktop app.');
      return;
    }
    setScanning(true);
    setScanError(null);
    try {
      const next = await window.nexforge.scanDeviceSpecs({ force });
      setScan(next || null);
      if (next) saveHwScan(next);
    } catch (err) {
      setScanError(err?.message || 'Could not read this PC.');
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    runScan(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickGame(next) {
    setGame(next);
    setGoal(defaultGoalForGame(next));
  }

  const rec = useMemo(
    () => (scan ? recommendSettings(scan, game, goal) : null),
    [scan, game, goal],
  );
  const hardware = scan ? qualityFromScan(scan) : null;
  const isWindows = String(appPlatform || '').toLowerCase().includes('win');

  async function copyRec() {
    if (!rec || !scan) return;
    const text = formatRecommendationText(scan, game, rec);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast('Settings copied', 'success');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast('Could not copy — select the list and copy it', 'error');
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="coach-panel-head">
          <div>
            <div className="card-title" style={{ marginBottom: 4 }}>Rig scan</div>
            <div className="coach-sub">
              {scanning ? 'Reading CPU, GPU, RAM, and display…' : specLine(scan)}
            </div>
          </div>
          <div className="coach-panel-actions">
            {hardware && (
              <span className={`coach-tilt tilt-${QUALITY_TONE[hardware] || 'low'}`}>
                {hardware === 'potato' ? 'Entry' : hardware}
              </span>
            )}
            <button
              type="button"
              className="action-btn ghost"
              style={{ padding: '6px 12px', fontSize: 12 }}
              disabled={scanning}
              onClick={() => runScan(true)}
            >
              {scanning ? 'Scanning…' : scan ? 'Rescan' : 'Scan this PC'}
            </button>
          </div>
        </div>
        {scanError && (
          <div className="coach-empty" style={{ color: 'var(--red)' }}>{scanError}</div>
        )}
        {!isWindows && (
          <div className="coach-empty">GPU names are read on Windows. CPU and RAM still count.</div>
        )}
        {scan && (
          <div className="opt-spec-grid">
            <div className="opt-spec">
              <div className="opt-spec-label">GPU</div>
              <div className="opt-spec-val">{scan.gpu?.name || 'Not detected'}</div>
            </div>
            <div className="opt-spec">
              <div className="opt-spec-label">CPU</div>
              <div className="opt-spec-val">{scan.cpu?.name || '—'}</div>
              <div className="opt-spec-meta">
                {[scan.cpu?.cores && `${scan.cpu.cores} cores`, scan.cpu?.threads && `${scan.cpu.threads} threads`].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="opt-spec">
              <div className="opt-spec-label">RAM</div>
              <div className="opt-spec-val">{scan.ramGb ? `${scan.ramGb} GB` : '—'}</div>
            </div>
            <div className="opt-spec">
              <div className="opt-spec-label">Display</div>
              <div className="opt-spec-val">
                {scan.display?.width && scan.display?.height
                  ? `${scan.display.width}×${scan.display.height}`
                  : '—'}
              </div>
              <div className="opt-spec-meta">
                {scan.display?.refreshHz ? `${scan.display.refreshHz} Hz` : 'Refresh not reported'}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>Game you want to play</div>
        <div className="coach-sub" style={{ marginBottom: 12 }}>
          Recommendations follow this title. Competitive keeps FPS high; Looks spends frames on fidelity.
        </div>
        <div className="game-grid opt-game-grid">
          {gameCatalog.flatMap((group) =>
            group.games.map((name) => (
              <div
                key={name}
                className={`game-card ${game === name ? 'selected' : ''}`}
                onClick={() => pickGame(name)}
              >
                <div className={`game-icon ${hasGameIcon(name) ? 'game-icon-svg' : ''}`}>
                  {hasGameIcon(name) ? <GameIcon game={name} /> : gameMark(name)}
                </div>
                <div className="game-name">{name}</div>
                <div className="game-cat">{group.category}</div>
              </div>
            ))
          )}
        </div>
        <div className="opt-goal-row">
          <button
            type="button"
            className={`prize-type-btn ${goal === 'competitive' ? 'active' : ''}`}
            onClick={() => setGoal('competitive')}
          >
            Competitive
          </button>
          <button
            type="button"
            className={`prize-type-btn ${goal === 'quality' ? 'active' : ''}`}
            onClick={() => setGoal('quality')}
          >
            Looks
          </button>
        </div>
      </div>

      {rec && (
        <div className="card">
          <div className="coach-panel-head">
            <div>
              <div className="card-title" style={{ marginBottom: 4 }}>{game} settings</div>
              <div className="coach-sub">{rec.headline}</div>
            </div>
            <button
              type="button"
              className="action-btn primary"
              style={{ padding: '6px 12px', fontSize: 12 }}
              onClick={copyRec}
            >
              {copied ? 'Copied' : 'Copy settings'}
            </button>
          </div>
          <div className="opt-rec-meta">
            <span>Play at <b>{rec.resolution}</b></span>
            <span>Target <b>{rec.fpsTarget} FPS</b></span>
            {rec.upscaler && <span>Upscale <b>{rec.upscaler}</b></span>}
          </div>
          <div className="opt-res-why">{rec.resolutionWhy}</div>
          <div className="opt-settings">
            {rec.settings.map((s) => (
              <div className="opt-setting-row" key={s.name}>
                <span>{s.name}</span>
                <span>{s.value}</span>
              </div>
            ))}
          </div>
          {rec.warnings.map((w) => (
            <div key={w} className="opt-warn">{w}</div>
          ))}
          <div className="coach-empty" style={{ marginTop: 10 }}>
            Apply these in the game’s video menu. NexForge does not write game config files.
          </div>
        </div>
      )}
    </div>
  );
}
