/**
 * Release highlights shown by the "What's new" popup after an update.
 * Add an entry at the top for every release (newest first).
 */
export const CHANGELOG = [
  {
    version: '3.6.4',
    highlights: [
      'Fixed tournaments list failing after escrow columns (missing SELECT grants)',
      'Fixed friend typing indicators blocked by RLS on upsert',
      'Hardened money/gameplay RPC access and Stripe Checkout tax codes',
    ],
  },
  {
    version: '3.6.3',
    highlights: [
      'Reverted the experimental voice signaling speed changes from 3.6.2',
    ],
  },
  {
    version: '3.6.2',
    highlights: [
      'Faster voice calls — Realtime signaling, instant ICE trickle, less wait before audio connects',
    ],
  },
  {
    version: '3.6.1',
    highlights: [
      'Fixed Communities voice join falsely showing Local-only mode (mic access + cloud probe)',
    ],
  },
  {
    version: '3.6.0',
    highlights: [
      'Shop cash buys open Stripe and unlock cosmetics automatically after payment',
      'Cash tournaments require bank details + Stripe prize escrow; winners are paid via Connect',
      'Auto-update install path hardened; Shop and Tournaments UI cleaned up',
    ],
  },
  {
    version: '3.5.5',
    highlights: [
      'Fixed broken desktop shortcuts — installer is now NexForge-Setup.exe (no longer clashes with the app)',
      'Desktop shortcut is recreated on every update',
    ],
  },
  {
    version: '3.5.4',
    highlights: [
      'Community voice channels are multi-person now — same mute/deafen/share controls as calls',
      'Fixed joining voice channels (ambiguous kind SQL error)',
    ],
  },
  {
    version: '3.5.3',
    highlights: [
      'Much faster voice call connect (Realtime ICE + trickle)',
      'Communities Discover home — create/join without getting stuck in a server',
      'UI polish across the app',
    ],
  },
  {
    version: '3.5.2',
    highlights: [
      'Fixed Communities crash (NavIcon is not defined) when opening or creating a server',
    ],
  },
  {
    version: '3.5.1',
    highlights: [
      'Fixed creating Communities (permission denied on membership check)',
      'Screen share preview is larger, with Enlarge and Full screen controls',
    ],
  },
  {
    version: '3.5.0',
    highlights: [
      'NexPanion AI — always available in Friends chat, powered by Groq',
      'NexPanion tab in the mobile/web Companion for tips while you play',
      'Gaming-focused answers with help on anything else too',
    ],
  },
  {
    version: '3.3.10',
    highlights: [
      'Communities tab — Discord-style servers with text & voice channels',
      'Call controls: mic/speaker pickers, screen share, and deafen',
      'Change your username and display name from My Profile',
    ],
  },
  {
    version: '3.3.9',
    highlights: [
      'Voice calls reworked — database signaling, proper TURN auth, ready-before-offer handshake',
      'Live call status shows ICE / link progress instead of spinning forever',
    ],
  },
  {
    version: '3.3.8',
    highlights: [
      'Voice calls no longer stick on Connecting — TURN relay + shared call room',
      'Incoming calls join the room immediately so ICE is not dropped',
    ],
  },
  {
    version: '3.3.6',
    highlights: [
      'More reliable voice calls — ICE candidates no longer dropped while ringing',
      'Incoming calls bring NexForge to the front',
    ],
  },
  {
    version: '3.3.4',
    highlights: [
      'Fixed a crash on launch that showed "Something went wrong" on v3.3.2 / v3.3.3',
    ],
  },
  {
    version: '3.3.2',
    highlights: [
      'Voice Call button on Friends — ring a friend in-app',
      'Accept / Decline overlay with mute and end controls',
      'In-game overlay ping for incoming calls',
    ],
  },
  {
    version: '3.3.1',
    highlights: [
      'Download NexForge.exe — one-click install, no admin needed',
      'Updates download and install automatically (no prompt)',
      'Always-latest link: github.com/fevrpulse/NexForge/releases/latest',
    ],
  },
  {
    version: '3.3.0',
    highlights: [
      'Open clan join with min MMR gates and clan settings',
      'Clan tags on names plus a Clans leaderboard',
      'Clan join bonus and weekly clan rewards',
      'Match / duel queues expire after 5 minutes',
      'Supabase hardening for tournaments and internal RPCs',
    ],
  },
  {
    version: '3.2.0',
    highlights: [
      'Ranked seasons with season MMR on Dashboard and Leaderboard',
      'Match lobbies — auto-pair, host lobby codes, ready timers',
      'Tournament brackets with check-in and host results',
      'Overlay 2.0 — party invites and lobby codes while you play',
      'Season Pass tiers + challenges in the Shop',
      'Clans — create, invite friends, leave / disband',
      'AI Coach tips from sessions, ping, and W/L streaks',
      'Verified Stats — link Riot / Steam / Tracker handles',
      'Web Companion for chat, party, lobby codes, and check-in',
    ],
  },
  {
    version: '3.1.0',
    highlights: [
      'Parties — invite friends, ready up, kick / leave / disband',
      'Party panel on Friends and Matchmaking',
      'Analytics rebuilt around Wins / Losses and recent matches',
      'Quick Match Log removed',
    ],
  },
  {
    version: '3.0.0',
    highlights: [
      'Continue with Google on browser sign-in',
      'Post-session Won/Lost prompts after game tracking',
      'USD price tags on cosmetics — cash unlock by rarity',
      'Stripe checkout for the full cosmetics catalog',
      'Self-reported matches marked as logged (no MMR)',
    ],
  },
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
