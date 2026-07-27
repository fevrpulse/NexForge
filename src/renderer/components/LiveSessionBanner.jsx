import React from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { formatDuration } from '../lib/format.js';

export default function LiveSessionBanner() {
  const { liveSession } = useNexForge();

  if (!liveSession) return null;

  return (
    <div className="track-banner active">
      <div className="track-banner-left">
        <div className="track-banner-title">Tracking <span>{liveSession.game || '—'}</span></div>
        <div className="track-banner-sub">
          Live {formatDuration(liveSession.durationSec)} · probe ping (not in-game tick latency)
        </div>
      </div>
      <div className="track-metrics">
        <div>RAM <b>{liveSession.live?.ramMb != null ? `${liveSession.live.ramMb} MB` : '—'}</b></div>
        <div>CPU <b>{liveSession.live?.cpuPct != null ? `${liveSession.live.cpuPct}%` : '—'}</b></div>
        <div>GPU <b>{liveSession.live?.gpuPct != null ? `${liveSession.live.gpuPct}%` : '—'}</b></div>
        <div>Ping <b>{liveSession.live?.pingMs != null ? `${liveSession.live.pingMs} ms` : '—'}</b></div>
      </div>
    </div>
  );
}
