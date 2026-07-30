/**
 * Release highlights shown by the "What's new" popup after an update.
 * Add an entry at the top for every release (newest first).
 */
export const CHANGELOG = [
  {
    version: '1.2.10',
    highlights: [
      'Pulse and Orbit rings need high MMR and more Forge Coins',
      'Cash checkout option to skip ring requirements (Stripe)',
      'Cleaned up Analytics career stats',
    ],
  },
  {
    version: '1.2.9',
    highlights: [
      'Skill tags, cosmetics shop, and profile photos',
      'Win rewards — +25 Forge Coins per match win',
      'Animated legendary frames',
      'Avatar presets',
      'Gift cosmetics to friends',
      'Dashboard loadout showcase',
      'Leaderboard shows frames, presets, and skill tags',
    ],
  },
  {
    version: '1.2.8',
    highlights: [
      'Friend profiles — view a friend\'s stats, recent matches, and sessions',
      'Proper NexForge icon in the taskbar and system tray',
      'Block and report players from friend chat',
      'Shared duels — see duels you played together on a friend\'s profile',
      'Profile badges for wins, rank, and activity',
      'Privacy toggle to hide your match history from friends',
      'Close to system tray — NexForge stays running in the background',
      'Dashboard friend activity rows open that friend\'s chat',
      'Copy gamer tag from friend profiles',
    ],
  },
  {
    version: '1.2.7',
    highlights: [
      'Task Manager shows NexForge instead of Electron',
      'Do Not Disturb mutes message sounds and overlay toasts',
      'Ctrl+Shift+O peeks unread messages on the overlay',
      'Online friends: pin favorites, custom status, typing indicator, chat search',
      'Friend activity feed on the Dashboard',
      'Compare two performance sessions side-by-side in Analytics',
    ],
  },
  {
    version: '1.2.6',
    highlights: [
      'In-game overlay — see incoming NexForge messages while you play',
      'Online status + "now playing" — see which friends are on and what they\'re in',
      'Emoji reactions, message deletion, and a new-message sound in chat',
      'Challenge a friend to a duel straight from your conversation',
      'Click any session in Analytics for RAM / CPU / GPU / ping graphs',
    ],
  },
  {
    version: '1.2.5',
    highlights: [
      'Reply to messages — hover any message and hit the reply arrow',
      'Send photos in chat — attach images up to 5 MB, click to view full size',
    ],
  },
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
