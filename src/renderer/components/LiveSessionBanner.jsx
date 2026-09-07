import React from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { formatDuration } from '../lib/format.js';
import { formatAccelerator } from '../lib/hotkeys.js';
import { hardwareHeat } from '../lib/session.js';

function fmtRam(v) {
  return v != null ? `${Math.round(v)} MB` : '—';
}

function fmtPct(v) {
  return v != null ? `${Number(v).toFixed(0)}%` : '—';
}

export default function LiveSessionBanner() {
  const { liveSession, clipEnabled, clipStatus, overlayHotkeys } = useNexForge();

  if (!liveSession) return null;

  const live = liveSession.live || {};
  const avg = liveSession.averages || {};
  const heat = hardwareHeat(live, avg);
  const buffering = clipEnabled && clipStatus?.buffering;
  const clipLabel = overlayHotkeys?.clip
    ? `Clip now (${formatAccelerator(overlayHotkeys.clip)})`
    : 'Clip now';

  return (
    <div className={`track-banner active heat-${heat.id}`}>
      <div className="track-banner-left">
        <div className="track-banner-title">Tracking <span>{liveSession.game || '—'}</span></div>
        <div className="track-banner-sub">
          Live {formatDuration(liveSession.durationSec)} · {heat.label}
        </div>
      </div>
      <div className="track-metrics">
        <div>RAM <b>{fmtRam(live.ramMb ?? avg.ramMb)}</b></div>
        <div>CPU <b>{fmtPct(live.cpuPct ?? avg.cpuPct)}</b></div>
        <div>GPU <b>{fmtPct(live.gpuPct ?? avg.gpuPct)}</b></div>
        <div>Disk <b>{fmtPct(live.diskPct ?? avg.diskPct)}</b></div>
        <div>Wi‑Fi <b>{fmtPct(live.wifiPct ?? avg.wifiPct)}</b></div>
        <div>Ping <b>{live.pingMs != null ? `${Math.round(live.pingMs)} ms` : '—'}</b></div>
      </div>
      {clipEnabled && (
        <button
          type="button"
          className="action-btn primary track-clip-btn"
          disabled={!!buffering}
          title={clipLabel}
          onClick={() => window.nexforge?.clipNow?.()}
        >
          {buffering ? 'Buffering…' : 'Clip now'}
        </button>
      )}
    </div>
  );
}
