export function mmrToRank(mmr) {
  if (mmr < 1000) return 'Bronze';
  if (mmr < 1400) return 'Silver';
  if (mmr < 1800) return 'Gold';
  if (mmr < 2200) return 'Platinum';
  if (mmr < 2700) return 'Diamond';
  if (mmr < 3200) return 'Master';
  return 'Grandmaster';
}

/** Inclusive MMR bounds for squad / duo filters. */
export function rankMmrBounds(rank) {
  switch (rank) {
    case 'Bronze': return { gte: 0, lte: 999 };
    case 'Silver': return { gte: 1000, lte: 1399 };
    case 'Gold': return { gte: 1400, lte: 1799 };
    case 'Platinum': return { gte: 1800, lte: 2199 };
    case 'Diamond': return { gte: 2200, lte: 2699 };
    case 'Master': return { gte: 2700, lte: 3199 };
    case 'Grandmaster': return { gte: 3200, lte: 99999 };
    default: return null;
  }
}

export const RANK_OPTIONS = [
  'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster',
];
