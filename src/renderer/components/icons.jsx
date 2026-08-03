import React from 'react';

/**
 * Inline SVG icon set. Everything draws with currentColor so icons inherit
 * hover/active/neon states from surrounding CSS. Game marks are original
 * geometric logos evoking each game — not trademark copies.
 */

function Svg({ size = 18, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

const NAV_ICONS = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  matchmaking: (
    <>
      <circle cx="12" cy="12" r="7" />
      <line x1="12" y1="2.5" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="21.5" />
      <line x1="2.5" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="21.5" y2="12" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  tournaments: (
    <>
      <path d="M8 3.5h8V10a4 4 0 0 1-8 0V3.5z" />
      <path d="M8 5.5H4.8c-.4 0-.8.3-.8.8C4 8.8 5.7 10.5 8 10.8" />
      <path d="M16 5.5h3.2c.4 0 .8.3.8.8 0 2.5-1.7 4.2-4 4.5" />
      <line x1="12" y1="14" x2="12" y2="17.5" />
      <path d="M8.5 20.5h7" />
      <path d="M9.5 17.5h5v3h-5z" />
    </>
  ),
  leaderboard: (
    <>
      <rect x="9" y="4" width="6" height="16.5" rx="1" />
      <rect x="2.5" y="10.5" width="6" height="10" rx="1" />
      <rect x="15.5" y="13.5" width="6" height="7" rx="1" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c0-4 3.4-6.3 7.5-6.3s7.5 2.3 7.5 6.3" />
    </>
  ),
  analytics: (
    <>
      <path d="M3 20.5h18" />
      <path d="M4 16l5-6 3.5 3 6.5-8" />
      <path d="M14.5 5H19v4.5" />
    </>
  ),
  squad: (
    <>
      <circle cx="9" cy="9" r="3.5" />
      <path d="M2.5 20c0-3.4 2.9-5.6 6.5-5.6s6.5 2.2 6.5 5.6" />
      <circle cx="17.2" cy="10" r="2.8" />
      <path d="M18 14.7c2.3.7 3.8 2.5 3.8 5" />
    </>
  ),
  friends: (
    <>
      <path d="M21 11.3c0 3.9-4 7-9 7-1 0-2-.1-2.9-.4L4.2 19.7l1.1-3.2C3.9 15.1 3 13.3 3 11.3c0-3.9 4-7 9-7s9 3.1 9 7z" />
      <circle cx="8.3" cy="11.3" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11.3" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.7" cy="11.3" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  shop: (
    <>
      <path d="M6 8h12l-1 12.5H7L6 8z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
      <path d="M10 12v4M14 12v4" />
    </>
  ),
  clans: (
    <>
      <path d="M12 3.5l2.2 4.4 4.8.7-3.5 3.4.8 4.8L12 14.6l-4.3 2.2.8-4.8-3.5-3.4 4.8-.7L12 3.5z" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  communities: (
    <>
      <rect x="3.5" y="4" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="4" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
};

const GAME_ICONS = {
  'Valorant': (
    <path d="M4 5h4.2l3.8 5.6L15.8 5H20l-8 12L4 5z" fill="currentColor" stroke="none" />
  ),
  'CS2': (
    <>
      <circle cx="10.5" cy="14" r="6.5" fill="currentColor" stroke="none" />
      <path d="M14.5 8.5l2.5-2.5" />
      <path d="M18.5 2.5v3.4M16.8 4.2h3.4" strokeWidth="1.6" />
    </>
  ),
  'Call of Duty: Warzone': (
    <>
      <path d="M4 9.5a8 8 0 0 1 16 0v.5H4v-.5z" fill="currentColor" stroke="none" />
      <path d="M5.5 10l4.5 5.5M18.5 10L14 15.5M10.5 10l1 5.5M13.5 10l-.5 5.5" strokeWidth="1.2" />
      <rect x="9.8" y="15.5" width="4.4" height="4.5" rx="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  'Overwatch 2': (
    <>
      <path d="M5.5 9.2a7.5 7.5 0 0 1 13 0" strokeWidth="3" />
      <path d="M19.2 13.5a7.5 7.5 0 0 1-14.4 0" strokeWidth="3" />
    </>
  ),
  'Halo Infinite': (
    <>
      <path d="M3.5 9.5C3.5 8 4.5 7 6 7h12c1.5 0 2.5 1 2.5 2.5l-1.4 5c-.4 1.4-1.3 2.2-2.8 2.2H7.7c-1.5 0-2.4-.8-2.8-2.2l-1.4-5z" />
      <path d="M6 11.5h12" />
    </>
  ),
  'Apex Legends': (
    <path d="M12 3l7.5 17h-4.6L12 12.6 9.1 20H4.5L12 3z" fill="currentColor" stroke="none" />
  ),
  'Fortnite': (
    <path d="M13.5 2L5 14.5h5.2L8 22l8.5-12.5h-5.2L13.5 2z" fill="currentColor" stroke="none" />
  ),
  'PUBG': (
    <>
      <circle cx="10" cy="10" r="6.5" fill="currentColor" stroke="none" />
      <path d="M15 15l5.5 5.5" strokeWidth="3" />
    </>
  ),
  'Fall Guys': (
    <>
      <path d="M12 3.5c4 0 6 3.4 6 7.8S16 21 12 21s-6-5.3-6-9.7 2-7.8 6-7.8z" />
      <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="10" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  'Rocket League': (
    <>
      <circle cx="17" cy="7.5" r="3.8" />
      <path d="M2.5 16.5l8.5-5 5.5 2.7-2.2 4.8H4.5l-2-2.5z" fill="currentColor" stroke="none" />
    </>
  ),
  'FIFA 25': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.6l3.2 2.3-1.2 3.8H10l-1.2-3.8L12 8.6z" fill="currentColor" stroke="none" />
      <path d="M12 8.6V3.5M15.2 10.9l4.9-1.6M14 14.7l3 4M10 14.7l-3 4M8.8 10.9L3.9 9.3" strokeWidth="1.4" />
    </>
  ),
  'NBA 2K25': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5v17" strokeWidth="1.4" />
      <path d="M6 6c3.3 3.3 3.3 8.7 0 12M18 6c-3.3 3.3-3.3 8.7 0 12" strokeWidth="1.4" />
    </>
  ),
  'League of Legends': (
    <path d="M7 3v14.2L9.8 20H20l-2.8-3.8H10.5V3H7z" fill="currentColor" stroke="none" />
  ),
  'Dota 2': (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" />
      <path d="M4.5 4.5l15 15" />
      <path d="M13 4.5l6.5 6.5" strokeWidth="1.4" />
    </>
  ),
  'Minecraft': (
    <>
      <path d="M12 2.5l8.5 4.7L12 12 3.5 7.2 12 2.5z" fill="currentColor" stroke="none" />
      <path d="M3.5 7.2V17l8.5 4.7V12L3.5 7.2z" fill="currentColor" stroke="none" opacity="0.55" />
      <path d="M20.5 7.2V17L12 21.7V12l8.5-4.8z" fill="currentColor" stroke="none" opacity="0.3" />
    </>
  ),
  'Roblox': (
    <path
      fillRule="evenodd"
      d="M7.2 2L2 17l14.8 5L22 7 7.2 2zm3 7.4l4.8 1.6-1.6 4.8-4.8-1.6 1.6-4.8z"
      fill="currentColor"
      stroke="none"
    />
  ),
  'GTA Online': (
    <path
      d="M12 2.5l2.8 6 6.7.8-5 4.5 1.4 6.6L12 17l-5.9 3.4 1.4-6.6-5-4.5 6.7-.8 2.8-6z"
      fill="currentColor"
      stroke="none"
    />
  ),
  'Geometry Dash': (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <rect x="8" y="9" width="2.6" height="2.6" fill="currentColor" stroke="none" />
      <rect x="13.4" y="9" width="2.6" height="2.6" fill="currentColor" stroke="none" />
      <path d="M8.5 15.5h7" />
    </>
  ),
  'Meccha Chameleon': (
    <>
      <path d="M4 15.5C4 9.7 7.6 6 12 6s8 3.2 8 7.6c0 4-2.8 6.9-6.2 6.9-2.6 0-4.3-1.7-4.3-3.8 0-1.9 1.4-3.2 3-3.2 1.3 0 2.2.8 2.2 2 0 .9-.6 1.5-1.4 1.5" />
      <circle cx="14.8" cy="10.2" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
};

export function NavIcon({ id, size = 18 }) {
  const glyph = NAV_ICONS[id];
  if (!glyph) return null;
  return <Svg size={size}>{glyph}</Svg>;
}

export function GameIcon({ game, size = 22 }) {
  const glyph = GAME_ICONS[game];
  if (!glyph) return null;
  return <Svg size={size}>{glyph}</Svg>;
}

export function hasGameIcon(game) {
  return !!GAME_ICONS[game];
}
