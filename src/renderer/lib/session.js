import { formatDuration } from './format.js';

export function hardwareHeat(live = {}, avg = {}) {
  const cpu = Number(live.cpuPct ?? avg.cpuPct);
  const gpu = Number(live.gpuPct ?? avg.gpuPct);
  const ping = Number(live.pingMs ?? avg.pingMs);
  if ((Number.isFinite(cpu) && cpu >= 92) || (Number.isFinite(gpu) && gpu >= 95) || (Number.isFinite(ping) && ping >= 120)) {
    return { id: 'hot', label: 'Running hot' };
  }
  if ((Number.isFinite(cpu) && cpu >= 80) || (Number.isFinite(gpu) && gpu >= 85) || (Number.isFinite(ping) && ping >= 70)) {
    return { id: 'warm', label: 'Warm' };
  }
  return { id: 'ok', label: 'Stable' };
}

export function recapFromSummary(summary) {
  if (!summary?.game) return null;
  return {
    game: summary.game,
    durationSec: summary.durationSec,
    avgCpuPct: summary.avgCpuPct,
    avgGpuPct: summary.avgGpuPct,
    avgRamMb: summary.avgRamMb,
    avgPingMs: summary.avgPingMs,
    tip: Array.isArray(summary.tips) ? summary.tips[0] : null,
    endedAt: summary.endedAt || new Date().toISOString(),
  };
}

export function lastSessionStorageKey(userId) {
  return `nf_last_session_${userId}`;
}

export function nexAiSessionNote(liveSession, lastRecap) {
  if (liveSession?.game) {
    const live = liveSession.live || {};
    const avg = liveSession.averages || {};
    const bits = [`Currently in ${liveSession.game}`];
    if (liveSession.durationSec != null) bits.push(formatDuration(liveSession.durationSec));
    const cpu = live.cpuPct ?? avg.cpuPct;
    const gpu = live.gpuPct ?? avg.gpuPct;
    const ping = live.pingMs ?? avg.pingMs;
    if (cpu != null) bits.push(`CPU ${Number(cpu).toFixed(0)}%`);
    if (gpu != null) bits.push(`GPU ${Number(gpu).toFixed(0)}%`);
    if (ping != null) bits.push(`ping ${Math.round(Number(ping))}ms`);
    bits.push(hardwareHeat(live, avg).label);
    return bits.join(' · ');
  }
  if (lastRecap?.game) {
    const bits = [`Last session: ${lastRecap.game}`];
    if (lastRecap.durationSec != null) bits.push(formatDuration(lastRecap.durationSec));
    if (lastRecap.avgCpuPct != null) bits.push(`CPU ${Number(lastRecap.avgCpuPct).toFixed(0)}%`);
    if (lastRecap.avgGpuPct != null) bits.push(`GPU ${Number(lastRecap.avgGpuPct).toFixed(0)}%`);
    if (lastRecap.avgPingMs != null) bits.push(`ping ${Math.round(Number(lastRecap.avgPingMs))}ms`);
    if (lastRecap.tip) bits.push(String(lastRecap.tip));
    return bits.join(' · ');
  }
  return null;
}

export function withSessionHistory(history, note) {
  if (!note) return history || [];
  return [
    { role: 'user', content: `Session context: ${note}` },
    { role: 'assistant', content: 'Got it — I will use that session context.' },
    ...(history || []),
  ];
}
