import React, { useEffect, useMemo, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import GameCatalogGrid from '../components/GameCatalogGrid.jsx';
import { GameIcon, hasGameIcon } from '../components/icons.jsx';
import { gameMark } from '../lib/games.js';
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
  if (!scan) return 'Scan this PC to read CPU, GPU, VRAM, RAM, disks, motherboard, and display.';
  const bits = [];
  if (scan.gpu?.name) bits.push(scan.gpu.vramGb ? `${scan.gpu.name} (${scan.gpu.vramGb} GB)` : scan.gpu.name);
  if (scan.cpu?.name) bits.push(scan.cpu.name);
  if (scan.ramGb) bits.push(`${scan.ramGb} GB RAM`);
  const { width, height, refreshHz } = scan.display || {};
  if (width && height) bits.push(`${width}×${height}${refreshHz ? ` @ ${refreshHz} Hz` : ''}`);
  return bits.join(' · ') || 'Specs loaded.';
}

function fmtGhz(mhz) {
  const n = Number(mhz);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} GHz`;
  return `${Math.round(n)} MHz`;
}

function fmtCache(kb, label) {
  const n = Number(kb);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1024) return `${Math.round((n / 1024) * 10) / 10} MB ${label}`;
  return `${Math.round(n)} KB ${label}`;
}

function joinMeta(parts) {
  return parts.filter(Boolean).join(' · ');
}

function machineLine(scan) {
  const sys = scan?.system || {};
  const board = scan?.board || {};
  const name = joinMeta([sys.manufacturer, sys.model]);
  const boardName = joinMeta([board.manufacturer, board.product]);
  if (name && boardName && name !== boardName) return `${name} · ${boardName}`;
  return name || boardName || null;
}

function formatRigText(scan) {
  if (!scan) return '';
  const cpu = scan.cpu || {};
  const gpu = scan.gpu || {};
  const ram = scan.ram || {};
  const lines = [
    'NexForge rig scan',
    machineLine(scan),
    scan.os && [scan.os, scan.osArch, scan.osBuild && `build ${scan.osBuild}`].filter(Boolean).join(' · '),
    cpu.name && `CPU: ${joinMeta([cpu.name, cpu.socket, cpu.cores && `${cpu.cores} cores`, cpu.threads && `${cpu.threads} threads`, fmtGhz(cpu.clockMhz), fmtCache(cpu.l3Kb, 'L3')])}`,
    gpu.name && `GPU: ${joinMeta([gpu.name, gpu.vramGb && `${gpu.vramGb} GB VRAM`, gpu.driver && `driver ${gpu.driver}`, gpu.boostMhz && `${fmtGhz(gpu.boostMhz)} boost`])}`,
    ...(Array.isArray(scan.gpus) ? scan.gpus.slice(1).map((g) => `GPU: ${joinMeta([g.name, g.vramGb && `${g.vramGb} GB VRAM`])}`) : []),
    scan.ramGb && `RAM: ${joinMeta([`${scan.ramGb} GB`, ram.type, ram.speedMhz && `${ram.speedMhz} MHz`, ram.usedSlots && ram.slots && `${ram.usedSlots}/${ram.slots} slots`])}`,
    ...(Array.isArray(ram.modules) ? ram.modules.map((m) => `  DIMM: ${joinMeta([m.slot, m.gb && `${m.gb} GB`, m.type, m.speedMhz && `${m.speedMhz} MHz`, m.manufacturer])}`) : []),
    scan.display?.width && `Display: ${scan.display.width}×${scan.display.height}${scan.display.refreshHz ? ` @ ${scan.display.refreshHz} Hz` : ''}`,
    ...(Array.isArray(scan.monitors) ? scan.monitors.map((m) => `  Monitor: ${joinMeta([m.name, m.width && m.height && `${m.width}×${m.height}`, m.primary && 'primary'])}`) : []),
    ...(Array.isArray(scan.disks) ? scan.disks.map((d) => `Disk: ${joinMeta([d.name, d.media, d.bus, d.sizeGb && `${d.sizeGb} GB`, d.health])}`) : []),
    ...(Array.isArray(scan.volumes) ? scan.volumes.map((v) => `Volume: ${joinMeta([v.letter, v.fs, v.sizeGb != null && v.freeGb != null && `${v.freeGb}/${v.sizeGb} GB free`])}`) : []),
    ...(Array.isArray(scan.network) ? scan.network.map((n) => `NIC: ${joinMeta([n.name, n.type, n.speedMbps && `${n.speedMbps} Mbps`])}`) : []),
    scan.bios?.version && `BIOS: ${joinMeta([scan.bios.vendor, scan.bios.version, scan.bios.date])}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export default function Optimize() {
  const { profile, gameCatalog, liveSession, lastSessionRecap, showToast, appPlatform } = useNexForge();
  const [scan, setScan] = useState(() => loadHwScan());
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [openGame, setOpenGame] = useState(null);
  const [goal, setGoal] = useState('quality');
  const [copied, setCopied] = useState(false);
  const [copiedRig, setCopiedRig] = useState(false);
  const [gameQuery, setGameQuery] = useState('');

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

  function openFor(name) {
    setOpenGame(name);
    setGoal(defaultGoalForGame(name));
    setCopied(false);
  }

  function closePopup() {
    setOpenGame(null);
    setCopied(false);
  }

  useEffect(() => {
    if (!openGame) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePopup();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openGame]);

  const rec = useMemo(
    () => (scan && openGame ? recommendSettings(scan, openGame, goal) : null),
    [scan, openGame, goal],
  );
  const hardware = scan ? qualityFromScan(scan) : null;
  const isWindows = String(appPlatform || '').toLowerCase().includes('win');
  const suggested = liveSession?.game || lastSessionRecap?.game || profile?.main_game || null;

  async function copyRec() {
    if (!rec || !scan || !openGame) return;
    const text = formatRecommendationText(scan, openGame, rec);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast('Settings copied', 'success');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast('Could not copy — select the list and copy it', 'error');
    }
  }

  async function copyRig() {
    if (!scan) return;
    try {
      await navigator.clipboard.writeText(formatRigText(scan));
      setCopiedRig(true);
      showToast('Rig specs copied', 'success');
      setTimeout(() => setCopiedRig(false), 1600);
    } catch {
      showToast('Could not copy specs', 'error');
    }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="coach-panel-head">
          <div>
            <div className="card-title" style={{ marginBottom: 4 }}>Rig scan</div>
            <div className="coach-sub">
              {scanning ? 'Reading this PC…' : specLine(scan)}
            </div>
          </div>
          <div className="coach-panel-actions">
            {hardware && (
              <span className={`coach-tilt tilt-${QUALITY_TONE[hardware] || 'low'}`}>
                {hardware === 'potato' ? 'Entry' : hardware}
              </span>
            )}
            {scan && (
              <button
                type="button"
                className="action-btn ghost"
                style={{ padding: '6px 12px', fontSize: 12 }}
                disabled={scanning}
                onClick={copyRig}
              >
                {copiedRig ? 'Copied' : 'Copy specs'}
              </button>
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
              <div className="opt-spec-meta">
                {joinMeta([
                  scan.gpu?.vramGb ? `${scan.gpu.vramGb} GB VRAM` : (scan.gpu?.name ? 'VRAM unknown' : null),
                  scan.gpu?.vendor,
                  scan.gpu?.tempC != null ? `${Math.round(scan.gpu.tempC)}°C` : null,
                  fmtGhz(scan.gpu?.boostMhz),
                ])}
              </div>
            </div>
            <div className="opt-spec">
              <div className="opt-spec-label">CPU</div>
              <div className="opt-spec-val">{scan.cpu?.name || '—'}</div>
              <div className="opt-spec-meta">
                {joinMeta([
                  scan.cpu?.cores && `${scan.cpu.cores} cores`,
                  scan.cpu?.threads && `${scan.cpu.threads} threads`,
                  fmtGhz(scan.cpu?.clockMhz),
                  scan.cpu?.socket,
                  fmtCache(scan.cpu?.l3Kb, 'L3'),
                ])}
              </div>
            </div>
            <div className="opt-spec">
              <div className="opt-spec-label">RAM</div>
              <div className="opt-spec-val">{scan.ramGb ? `${scan.ramGb} GB` : '—'}</div>
              <div className="opt-spec-meta">
                {joinMeta([
                  scan.ram?.type,
                  scan.ram?.speedMhz && `${scan.ram.speedMhz} MHz`,
                  scan.ram?.usedSlots && scan.ram?.slots && `${scan.ram.usedSlots}/${scan.ram.slots} slots`,
                  (scan.ram?.freeGb ?? scan.ramFreeGb) != null && `${scan.ram?.freeGb ?? scan.ramFreeGb} GB free`,
                ])}
              </div>
            </div>
            <div className="opt-spec">
              <div className="opt-spec-label">Display</div>
              <div className="opt-spec-val">
                {scan.display?.width && scan.display?.height
                  ? `${scan.display.width}×${scan.display.height}`
                  : '—'}
              </div>
              <div className="opt-spec-meta">
                {joinMeta([
                  scan.display?.refreshHz && `${scan.display.refreshHz} Hz`,
                  Array.isArray(scan.monitors) && scan.monitors.length > 1 && `${scan.monitors.length} monitors`,
                  Array.isArray(scan.monitors) && scan.monitors[0]?.name,
                ]) || 'Refresh not reported'}
              </div>
            </div>
            <div className="opt-spec">
              <div className="opt-spec-label">Machine</div>
              <div className="opt-spec-val">{machineLine(scan) || '—'}</div>
              <div className="opt-spec-meta">
                {joinMeta([
                  scan.system?.kind,
                  scan.bios?.version && `BIOS ${scan.bios.version}`,
                  scan.bios?.date,
                  scan.system?.hypervisor && 'hypervisor',
                ])}
              </div>
            </div>
            <div className="opt-spec">
              <div className="opt-spec-label">OS</div>
              <div className="opt-spec-val">{scan.os || '—'}</div>
              <div className="opt-spec-meta">
                {joinMeta([scan.osArch, scan.osBuild && `build ${scan.osBuild}`])}
              </div>
            </div>
            {Array.isArray(scan.gpus) && scan.gpus.length > 1 && (
              <div className="opt-spec opt-spec-wide">
                <div className="opt-spec-label">All GPUs</div>
                {scan.gpus.map((g) => (
                  <div className="opt-spec-meta" key={g.name}>
                    {joinMeta([g.name, g.vramGb && `${g.vramGb} GB`, g.driver && `driver ${g.driver}`])}
                  </div>
                ))}
              </div>
            )}
            {scan.gpu?.driver && !(Array.isArray(scan.gpus) && scan.gpus.length > 1) && (
              <div className="opt-spec">
                <div className="opt-spec-label">GPU driver</div>
                <div className="opt-spec-val">{scan.gpu.driver}</div>
                <div className="opt-spec-meta">{scan.gpu.driverDate || null}</div>
              </div>
            )}
            {Array.isArray(scan.ram?.modules) && scan.ram.modules.length > 0 && (
              <div className="opt-spec opt-spec-wide">
                <div className="opt-spec-label">Memory kits</div>
                {scan.ram.modules.map((m, i) => (
                  <div className="opt-spec-meta" key={`${m.slot || 'dimm'}-${i}`}>
                    {joinMeta([
                      m.slot,
                      m.gb && `${m.gb} GB`,
                      m.type,
                      m.speedMhz && `${m.speedMhz} MHz`,
                      m.manufacturer,
                      m.part,
                    ])}
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(scan.disks) && scan.disks.length > 0 && (
              <div className="opt-spec opt-spec-wide">
                <div className="opt-spec-label">Disks</div>
                {scan.disks.map((d) => (
                  <div className="opt-spec-meta" key={d.name}>
                    {joinMeta([d.name, d.media, d.bus, d.sizeGb && `${d.sizeGb} GB`, d.health])}
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(scan.volumes) && scan.volumes.length > 0 && (
              <div className="opt-spec">
                <div className="opt-spec-label">Volumes</div>
                {scan.volumes.map((v) => (
                  <div className="opt-spec-meta" key={v.letter}>
                    {joinMeta([
                      v.letter,
                      v.fs,
                      v.sizeGb != null && v.freeGb != null && `${v.freeGb} / ${v.sizeGb} GB free`,
                    ])}
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(scan.network) && scan.network.length > 0 && (
              <div className="opt-spec">
                <div className="opt-spec-label">Network</div>
                {scan.network.map((n) => (
                  <div className="opt-spec-meta" key={n.name}>
                    {joinMeta([n.name, n.type, n.speedMbps && `${n.speedMbps} Mbps`])}
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(scan.monitors) && scan.monitors.length > 1 && (
              <div className="opt-spec opt-spec-wide">
                <div className="opt-spec-label">Monitors</div>
                {scan.monitors.map((m, i) => (
                  <div className="opt-spec-meta" key={`${m.name}-${i}`}>
                    {joinMeta([
                      m.name,
                      m.width && m.height && `${m.width}×${m.height}`,
                      m.primary && 'primary',
                    ])}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 8 }}>Pick a game</div>
        <div className="coach-sub" style={{ marginBottom: 12 }}>
          Click a title for settings matched to this PC. Light games like Minecraft are not treated like Warzone.
        </div>
        <GameCatalogGrid
          catalog={gameCatalog}
          selected={suggested}
          onSelect={openFor}
          query={gameQuery}
          onQueryChange={setGameQuery}
          className="opt-game-grid"
        />
      </div>

      {openGame && rec && (
        <div
          className="lock-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePopup();
          }}
        >
          <div className="lock-box opt-popup" role="dialog" aria-modal="true" aria-labelledby="opt-popup-title">
            <div className="opt-popup-head">
              <div className="opt-popup-game">
                <div className={`game-icon ${hasGameIcon(openGame) ? 'game-icon-svg' : ''}`}>
                  {hasGameIcon(openGame) ? <GameIcon game={openGame} /> : gameMark(openGame)}
                </div>
                <div>
                  <div className="card-title" id="opt-popup-title" style={{ marginBottom: 4 }}>{openGame}</div>
                  <div className="coach-sub">{rec.headline}</div>
                </div>
              </div>
              <button type="button" className="action-btn ghost opt-popup-close" onClick={closePopup}>
                Close
              </button>
            </div>

            <div className="opt-goal-row" style={{ marginBottom: 12 }}>
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

            <div className="opt-rec-meta">
              <span>Play at <b>{rec.resolution}</b></span>
              <span>Expect <b>{rec.fpsTarget} FPS</b></span>
              {rec.fpsCap && <span>Cap <b>{rec.fpsCap}</b></span>}
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
            <div className="opt-popup-actions">
              <button type="button" className="action-btn primary" onClick={copyRec}>
                {copied ? 'Copied' : 'Copy settings'}
              </button>
              <div className="coach-empty" style={{ margin: 0 }}>
                Apply these in the game’s video menu. NexForge does not write config files.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
