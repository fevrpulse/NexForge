/** Competitive rank band (kept for legacy charts / MMR context). */
export function mmrToRank(mmr) {
  const m = mmr ?? 1200;
  if (m < 1000) return 'Bronze';
  if (m < 1400) return 'Silver';
  if (m < 1800) return 'Gold';
  if (m < 2200) return 'Platinum';
  if (m < 2700) return 'Diamond';
  if (m < 3200) return 'Master';
  return 'Grandmaster';
}

/**
 * Skill tags shown on profiles / friends / sidebar.
 * Flavor ladder: Noob → Amateur → Pro → Legend.
 */
export function mmrToSkillTag(mmr) {
  const m = mmr ?? 1200;
  if (m < 1000) return 'Noob';
  if (m < 1300) return 'Rookie';
  if (m < 1600) return 'Amateur';
  if (m < 2000) return 'Competitor';
  if (m < 2400) return 'Pro';
  if (m < 2800) return 'Elite';
  if (m < 3200) return 'Master';
  return 'Legend';
}

export function skillTagClass(tag) {
  const t = String(tag || '').toLowerCase();
  if (t === 'noob' || t === 'rookie') return 'skill-tag-low';
  if (t === 'amateur' || t === 'competitor') return 'skill-tag-mid';
  if (t === 'pro' || t === 'elite') return 'skill-tag-high';
  if (t === 'master' || t === 'legend') return 'skill-tag-top';
  return 'skill-tag-mid';
}
