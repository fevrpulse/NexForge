// Must match public.forge_trial_schedule() and public._forge_score_hits() in v167-forge-trial.sql.
export const FORGE_BEAT_COUNT = 12;
export const FORGE_GAP_MS = 740;
export const FORGE_APPROACH_MS = FORGE_GAP_MS / 2;
export const FORGE_MISS_LIMIT = 2;
export const FORGE_ATTEMPTS = 2;

export function forgeTrialSchedule() {
  const beats = [];
  for (let i = 0; i < FORGE_BEAT_COUNT; i += 1) {
    beats.push({ at: 1800 + i * FORGE_GAP_MS, window: 280 - i * 14 });
  }
  return beats;
}

export function forgePayout(misses) {
  if (misses <= 0) return 420;
  if (misses === 1) return 260;
  if (misses === 2) return 160;
  return 0;
}

function regionBounds(schedule, index) {
  const beat = schedule[index];
  const start = index === 0
    ? 0
    : Math.floor((schedule[index - 1].at + beat.at) / 2);
  const end = index === schedule.length - 1
    ? beat.at + beat.window
    : Math.floor((beat.at + schedule[index + 1].at) / 2);
  return { start, end, beat };
}

export function judgeBeat(schedule, hits, index) {
  const { start, end, beat } = regionBounds(schedule, index);
  let inRegion = 0;
  let matched = 0;
  hits.forEach((hit) => {
    if (hit >= start && hit < end) {
      inRegion += 1;
      if (Math.abs(hit - beat.at) * 2 <= beat.window) matched += 1;
    }
  });
  return inRegion === 1 && matched === 1;
}

export function scoreForgeHits(hits, schedule = forgeTrialSchedule()) {
  let strikes = 0;
  let misses = 0;
  for (let i = 0; i < schedule.length; i += 1) {
    if (judgeBeat(schedule, hits, i)) strikes += 1;
    else misses += 1;
  }
  return { strikes, misses, coins: forgePayout(misses) };
}

export function activeBeatIndex(schedule, elapsed) {
  for (let i = 0; i < schedule.length; i += 1) {
    const end = i === schedule.length - 1
      ? schedule[i].at + schedule[i].window / 2
      : (schedule[i].at + schedule[i + 1].at) / 2;
    if (elapsed < end) return i;
  }
  return schedule.length - 1;
}

export function settledMisses(schedule, hits, elapsed) {
  let misses = 0;
  for (let i = 0; i < schedule.length; i += 1) {
    const deadline = schedule[i].at + schedule[i].window / 2;
    if (elapsed < deadline) break;
    if (!judgeBeat(schedule, hits, i)) misses += 1;
  }
  return misses;
}
