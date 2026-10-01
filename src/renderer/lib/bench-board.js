import { sb } from './supabase.js';

export function missingBenchRpc(err) {
  return /could not find the function|schema cache|404|not found|submit_bench_score|list_bench_leaderboard/i
    .test(String(err?.message || err || ''));
}

export async function listBenchLeaderboard() {
  const { data, error } = await sb.rpc('list_bench_leaderboard', { p_limit: 20 });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function submitBenchScore(result) {
  const { data, error } = await sb.rpc('submit_bench_score', {
    p_overall: result.overall,
    p_cpu: result.cpu?.score || 0,
    p_memory: result.memory?.score || 0,
    p_disk: result.disk?.score || 0,
    p_graphics: result.graphics?.score || 0,
    p_duration_sec: result.durationSec,
    p_cpu_name: result.cpuName || '',
    p_gpu_name: result.graphics?.renderer || '',
  });
  if (error) throw error;
  return data;
}
