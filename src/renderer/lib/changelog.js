/**
 * Release highlights shown by the "What's new" popup after an update.
 * Add an entry at the top for every release (newest first).
 */
export const CHANGELOG = [
  {
    version: '1.2.4',
    highlights: [
      'New Friends system — search players, send requests, build your roster',
      'Direct messaging — chat with friends right inside NexForge',
      'Fresh rounded look — the whole app now uses the Nunito font',
      'New "What\'s new" popup shows release highlights after every update',
    ],
  },
  {
    version: '1.2.3',
    highlights: [
      'Custom logos for every section — Dashboard, Matchmaking, Tournaments, and more',
      'Every game in the matchmaking catalog got its own icon',
    ],
  },
  {
    version: '1.2.2',
    highlights: [
      'Game sessions now save reliably no matter which screen is open',
      'The app remembers your window size and position',
      'New "Check for updates" button in the sidebar',
      'Session history now shows performance tips and peak stats',
    ],
  },
  {
    version: '1.2.1',
    highlights: [
      'Average and peak GPU usage tracked in every game session',
    ],
  },
];

/** Compare dotted versions: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Entries newer than lastSeen, up to and including current (newest first). */
export function entriesSince(lastSeen, current) {
  return CHANGELOG.filter(
    (e) => compareVersions(e.version, lastSeen) > 0 && compareVersions(e.version, current) <= 0,
  ).slice(0, 3);
}
