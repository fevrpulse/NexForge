import React from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { formatDuration } from '../lib/format.js';

function fmtRam(v) {
  return v != null ? `${Math.round(v)} MB` : '—';
}

function fmtPct(v) {
  return v != null ? `${Number(v).toFixed(0)}%` : '—';
}

export default function LiveSessionBanner() {
  const { liveSession } = useNexForge();

  if (!liveSession) return null;

  const live = liveSession.live || {};
  const avg = liveSession.averages || {};

  return (
    <div className="track-banner active">
      <div className="track-banner-left">
        <div className="track-banner-title">Tracking <span>{liveSession.game || '—'}</span></div>
        <div className="track-banner-sub">
          Live {formatDuration(liveSession.durationSec)} · hardware averages
        </div>
      </div>
      <div className="track-metrics">
        <div>RAM <b>{fmtRam(live.ramMb ?? avg.ramMb)}</b></div>
        <div>CPU <b>{fmtPct(live.cpuPct ?? avg.cpuPct)}</b></div>
        <div>GPU <b>{fmtPct(live.gpuPct ?? avg.gpuPct)}</b></div>
        <div>Disk <b>{fmtPct(live.diskPct ?? avg.diskPct)}</b></div>
        <div>Wi‑Fi <b>{fmtPct(live.wifiPct ?? avg.wifiPct)}</b></div>
      </div>
    </div>
  );
}
