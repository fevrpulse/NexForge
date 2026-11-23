import { sb } from './supabase.js';

export function missingBenchRpc(err) {
  return /could not find the function|schema cache|404|not found|submit_bench_score|list_bench_leaderboard|submit_bench_part|list_bench_ranking/i
    .test(String(err?.message || err || ''));
}

function toRow(row) {
  return {
    gamer_tag: row?.gamer_tag || 'Player',
    pts: Number(row?.pts ?? row?.overall) || 0,
    duration_sec: Number(row?.duration_sec) || 0,
    cpu_name: row?.cpu_name || null,
    gpu_name: row?.gpu_name || null,
    updated_at: row?.updated_at || null,
  };
}

async function listMultiFallback() {
  const { data, error } = await sb.rpc('list_bench_leaderboard', { p_limit: 20 });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(toRow);
}

/** Best score per player for one test: 'multi', 'single', or 'gpu'. */
export async function listBenchRanking(kind) {
  const { data, error } = await sb.rpc('list_bench_ranking', { p_kind: kind, p_limit: 20 });
  if (!error) return (Array.isArray(data) ? data : []).map(toRow);
  if (kind === 'multi' && missingBenchRpc(error)) return listMultiFallback();
  throw error;
}

export async function submitBenchPart(kind, result) {
  const cpuName = result.cpuName || '';
  const gpuName = result.gpuName || '';
  if (kind === 'multi') {
    const { data, error } = await sb.rpc('submit_bench_score', {
      p_overall: result.pts,
      p_cpu: result.pts,
      p_memory: 0,
      p_disk: 0,
      p_graphics: 0,
      p_duration_sec: result.durationSec,
      p_cpu_name: cpuName,
      p_gpu_name: gpuName,
    });
    if (error) throw error;
    return data;
  }
  const { data, error } = await sb.rpc('submit_bench_part', {
    p_kind: kind,
    p_pts: result.pts,
    p_duration_sec: result.durationSec,
    p_cpu_name: cpuName,
    p_gpu_name: gpuName,
  });
  if (error) throw error;
  return data;
}
