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
  optimize: (
    <>
      <path d="M4 16.5l4.2-4.2 2.6 2.6L20 5.5" />
      <path d="M4 20.5h16" />
      <path d="M14.5 8.2l2.2-2.2 2.4 2.4-2.2 2.2" />
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
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.2v1.8M12 19v1.8M3.2 12h1.8M19 12h1.8M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M18.4 5.6l-1.3 1.3M6.9 17.1l-1.3 1.3" />
      <path d="M12 6.6A5.4 5.4 0 1 1 6.6 12" />
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
  'Marvel Rivals': (
    <>
      <path d="M12 3.5l3.2 6.4 7 .9-5.2 4.7 1.4 6.8L12 18.6 5.6 22.3l1.4-6.8L1.8 10.8l7-.9L12 3.5z" />
      <circle cx="12" cy="13" r="2.2" fill="currentColor" stroke="none" />
    </>
  ),
  'Helldivers 2': (
    <>
      <path d="M12 3l2.2 5.4H20l-4.6 3.4 1.8 5.6L12 14.2 6.8 17.4l1.8-5.6L4 8.4h5.8L12 3z" fill="currentColor" stroke="none" />
    </>
  ),
  'Rainbow Six Siege': (
    <>
      <path d="M12 3.2l7.5 3.2v6.2c0 4.4-3.2 7.4-7.5 8.8C7.7 20 4.5 17 4.5 12.6V6.4L12 3.2z" />
      <path d="M12 8v8M8.5 12h7" />
    </>
  ),
  'Destiny 2': (
    <>
      <path d="M12 3.5L14.8 9l6.2.7-4.6 4.2 1.3 6.1L12 16.8 6.3 20l1.3-6.1L3 9.7 9.2 9 12 3.5z" fill="currentColor" stroke="none" />
    </>
  ),
  'Palworld': (
    <>
      <circle cx="12" cy="13" r="6.5" />
      <path d="M8 7.2C8 4.8 9.6 3.2 12 3.2S16 4.8 16 7.2" />
      <circle cx="9.8" cy="12.4" r=".9" fill="currentColor" stroke="none" />
      <circle cx="14.2" cy="12.4" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  'Deadlock': (
    <>
      <path d="M4 12l8-8 8 8-8 8-8-8z" />
      <path d="M12 4v16M4 12h16" strokeWidth="1.4" />
    </>
  ),
  'Call of Duty': (
    <>
      <path d="M12 3.5l2 5.2 5.5.6-4.1 3.7 1.2 5.5L12 15.6 7.4 18.5l1.2-5.5-4.1-3.7 5.5-.6L12 3.5z" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  'Battlefield 6': (
    <>
      <path d="M3.5 16.5L12 4.5l8.5 12H3.5z" />
      <path d="M12 8.5v8" />
    </>
  ),
  'The Finals': (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 8h8M8 12h5M8 16h8" />
    </>
  ),
  'Escape from Tarkov': (
    <>
      <path d="M5 19V6.5L12 3.5l7 3V19" />
      <path d="M8.5 19v-6h7v6" />
    </>
  ),
  'Elden Ring': (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  'Baldur\'s Gate 3': (
    <>
      <path d="M12 3.5c4.5 2 7.5 5.4 7.5 9.8S16.2 21 12 21 4.5 17.7 4.5 13.3 7.5 5.5 12 3.5z" />
      <path d="M8 13.5c1.2 1.6 2.6 2.4 4 2.4s2.8-.8 4-2.4" />
    </>
  ),
  'Cyberpunk 2077': (
    <>
      <path d="M3.5 12h17" />
      <path d="M6 7.5h12l1.5 4.5-1.5 4.5H6L4.5 12 6 7.5z" />
      <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  'Red Dead Redemption 2': (
    <>
      <path d="M12 4l2.4 4.8 5.3.6-3.9 3.6 1.1 5.2L12 15.8 7.1 18.2l1.1-5.2-3.9-3.6 5.3-.6L12 4z" fill="currentColor" stroke="none" />
    </>
  ),
  'The Witcher 3': (
    <>
      <path d="M12 3.2l2.8 5.2 1.6-1.2 1.2 3.4 3.4.4-2.6 2.6.8 3.4-3.4-.6L12 20.5 8.2 16.4l-3.4.6.8-3.4-2.6-2.6 3.4-.4 1.2-3.4 1.6 1.2L12 3.2z" />
    </>
  ),
  'Black Myth: Wukong': (
    <>
      <circle cx="12" cy="10" r="5" />
      <path d="M7 15.5c1.6 3 8.4 3 10 0" />
      <path d="M12 5V2.8M9 6.2 7.4 4.4M15 6.2l1.6-1.8" />
    </>
  ),
  'Monster Hunter Wilds': (
    <>
      <path d="M4 18.5L12 4l8 14.5H4z" />
      <path d="M9.5 14.5h5" />
    </>
  ),
  'Path of Exile 2': (
    <>
      <path d="M12 2.8L20 8v8l-8 5.2L4 16V8l8-5.2z" />
      <path d="M12 8v8" />
    </>
  ),
  'Diablo IV': (
    <>
      <path d="M12 3c4 3.2 7 7 7 11.2C19 18.4 16 21 12 21S5 18.4 5 14.2C5 10 8 6.2 12 3z" fill="currentColor" stroke="none" />
    </>
  ),
  'World of Warcraft': (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 5.5v13M5.5 12h13" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'Final Fantasy XIV': (
    <>
      <path d="M12 3.5l8 16.5H4L12 3.5z" />
      <path d="M8.2 16.2h7.6" />
    </>
  ),
  'Genshin Impact': (
    <>
      <path d="M12 3l2.6 6.4H21l-5.2 3.8 2 6.3L12 16.2 6.2 19.5l2-6.3L3 9.4h6.4L12 3z" fill="currentColor" stroke="none" />
    </>
  ),
  'Rust': (
    <>
      <path d="M4.5 17.5h15l-2.2-9.2H6.7L4.5 17.5z" />
      <path d="M8 8.3V5.5h8v2.8" />
    </>
  ),
  'EA Sports FC 26': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.6l3.2 2.3-1.2 3.8H10l-1.2-3.8L12 8.6z" fill="currentColor" stroke="none" />
      <path d="M12 8.6V3.5M15.2 10.9l4.9-1.6M14 14.7l3 4M10 14.7l-3 4M8.8 10.9L3.9 9.3" strokeWidth="1.4" />
    </>
  ),
  'NBA 2K26': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5v17" strokeWidth="1.4" />
      <path d="M6 6c3.3 3.3 3.3 8.7 0 12M18 6c-3.3 3.3-3.3 8.7 0 12" strokeWidth="1.4" />
    </>
  ),
  'Forza Horizon 5': (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
    </>
  ),
  'Street Fighter 6': (
    <>
      <path d="M5 18.5c2.4-5 4.6-9.6 7-14.5 2.4 4.9 4.6 9.5 7 14.5" />
      <path d="M7.5 13h9" />
    </>
  ),
  'Tekken 8': (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M8 8v8M8 12h4.5a2.5 2.5 0 0 0 0-5H8" />
    </>
  ),
  'Dead by Daylight': (
    <>
      <path d="M12 3.5v17" />
      <path d="M7 8.5h10M8.5 13.5h7" />
      <circle cx="12" cy="3.5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  'Phasmophobia': (
    <>
      <path d="M12 4.2c3.6 0 6.2 2.6 6.2 6.4 0 4.4-3 7.6-6.2 9.4-3.2-1.8-6.2-5-6.2-9.4 0-3.8 2.6-6.4 6.2-6.4z" />
      <circle cx="10" cy="10.4" r=".9" fill="currentColor" stroke="none" />
      <circle cx="14" cy="10.4" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  'Among Us': (
    <>
      <path d="M8.2 6.5h7.4c1.6 0 2.9 2.4 2.9 6.2s-1.3 6.8-2.9 6.8H9.8c-2 0-3.3-2.6-3.3-6.8 0-2.6.7-4.8 1.7-6.2z" />
      <rect x="4.2" y="10.2" width="4.2" height="5.2" rx="1.2" />
      <ellipse cx="14.4" cy="10.4" rx="3.2" ry="2" />
    </>
  ),
  'Teamfight Tactics': (
    <>
      <rect x="4" y="4" width="6.2" height="6.2" rx="1" />
      <rect x="13.8" y="4" width="6.2" height="6.2" rx="1" />
      <rect x="4" y="13.8" width="6.2" height="6.2" rx="1" />
      <rect x="13.8" y="13.8" width="6.2" height="6.2" rx="1" />
    </>
  ),
  'Hearthstone': (
    <>
      <rect x="5.5" y="3.5" width="13" height="17" rx="2" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  'Stardew Valley': (
    <>
      <path d="M12 4.2c2.6 3.2 6.5 6.4 6.5 9.6 0 3.2-2.8 5.5-6.5 5.5S5.5 17 5.5 13.8c0-3.2 3.9-6.4 6.5-9.6z" fill="currentColor" stroke="none" />
    </>
  ),
  'Terraria': (
    <>
      <rect x="3.5" y="10" width="17" height="10.5" rx="1" />
      <path d="M8 10V7.2a4 4 0 0 1 8 0V10" />
    </>
  ),
  'Lethal Company': (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 14.2c.8 1.4 2 2.1 3.5 2.1s2.7-.7 3.5-2.1" />
      <circle cx="9.2" cy="10.2" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="10.2" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  'Warframe': (
    <>
      <path d="M12 3.2L19.5 8v8L12 20.8 4.5 16V8L12 3.2z" />
      <path d="M12 8.2v7.6" />
    </>
  ),
  'Old School RuneScape': (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M8 15.2c1.2-3.4 2.5-6.4 4-9.4 1.5 3 2.8 6 4 9.4" />
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
