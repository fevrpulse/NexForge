export function mmrToRank(mmr) {
  if (mmr < 1000) return 'Bronze';
  if (mmr < 1400) return 'Silver';
  if (mmr < 1800) return 'Gold';
  if (mmr < 2200) return 'Platinum';
  if (mmr < 2700) return 'Diamond';
  if (mmr < 3200) return 'Master';
  return 'Grandmaster';
}
