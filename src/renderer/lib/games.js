export const KNOWN_MAIN_GAMES = [
  'Valorant','CS2','Call of Duty: Warzone','Overwatch 2','Halo Infinite',
  'Apex Legends','Fortnite','PUBG','Fall Guys','Rocket League','FIFA 25','NBA 2K25',
  'League of Legends','Dota 2','Minecraft','Roblox','GTA Online','Geometry Dash','Meccha Chameleon'
];

export const GAME_CATALOG = [
  { category: 'Shooters', games: ['Valorant', 'CS2', 'Call of Duty: Warzone', 'Overwatch 2', 'Halo Infinite'] },
  { category: 'Casual', games: ['Meccha Chameleon', 'Fall Guys', 'Geometry Dash'] },
  { category: 'Battle Royale', games: ['Apex Legends', 'Fortnite', 'PUBG'] },
  { category: 'Sports & Racing', games: ['Rocket League', 'FIFA 25', 'NBA 2K25'] },
  { category: 'MOBA & Strategy', games: ['League of Legends', 'Dota 2'] },
  { category: 'Other', games: ['Minecraft', 'Roblox', 'GTA Online'] },
];

/** Games where kills / deaths / assists are tracked (manual entry — no live game API). */
export const SHOOTER_GAMES = new Set([
  'Valorant', 'CS2', 'Call of Duty: Warzone', 'Overwatch 2', 'Halo Infinite',
  'Apex Legends', 'Fortnite', 'PUBG', 'GTA Online',
]);

export function isShooterGame(game) {
  return SHOOTER_GAMES.has(game);
}

export const GAME_MARKS = {
  'Valorant': 'VAL',
  'CS2': 'CS2',
  'Call of Duty: Warzone': 'WZ',
  'Overwatch 2': 'OW2',
  'Halo Infinite': 'HALO',
  'Apex Legends': 'APEX',
  'Fortnite': 'FN',
  'PUBG': 'PUBG',
  'Fall Guys': 'FG',
  'Rocket League': 'RL',
  'FIFA 25': 'FIFA',
  'NBA 2K25': '2K',
  'League of Legends': 'LOL',
  'Dota 2': 'DOTA',
  'Minecraft': 'MC',
  'Roblox': 'RBX',
  'GTA Online': 'GTA',
  'Geometry Dash': 'GD',
  'Meccha Chameleon': 'MCC',
};

export function gameMark(game) {
  if (GAME_MARKS[game]) return GAME_MARKS[game];
  const parts = String(game || '').replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'NF';
  if (parts.length === 1) return parts[0].slice(0, 4).toUpperCase();
  return parts.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
}

export function modeMark(name) {
  const raw = String(name || '').trim();
  const vs = raw.match(/\d+\s*v\s*\d+/i);
  if (vs) return vs[0].replace(/\s+/g, '').toUpperCase();
  const words = raw.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'MODE';
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export const GAME_MODES = {
  'Valorant':              [{icon:'⚔',name:'Ranked 5v5',desc:'Competitive ranked matchmaking with MMR on the line.',details:'Standard competitive rules. Best-of-25 rounds, agent bans enabled, and full MMR tracking for wins and losses.',server:'Custom NexForge lobby'},{icon:'🎯',name:'Unrated 5v5',desc:'Casual practice queue with no MMR impact.',details:'Same format as ranked without rank pressure. Ideal for warmups, new agents, or playing with friends.',server:'Custom NexForge lobby'},{icon:'💣',name:'Spike Rush',desc:'Fast-paced 7-round spike mode.',details:'Accelerated rounds with random loadouts. Quick matches for players who want fast action.',server:'Custom NexForge lobby'},{icon:'🏆',name:'Tournament',desc:'Bracket-style competitive event.',details:'Single-elimination bracket hosted by NexForge. Check-in required 15 minutes before start.',server:'NexForge tournament bracket'}],
  'CS2':                   [{icon:'🔫',name:'Competitive 5v5',desc:'Official ranked format on NexForge servers.',details:'MR12 competitive rules with full buy economy. MMR adjusts based on round differential and performance.',server:'NexForge custom server'},{icon:'⚡',name:'Wingman 2v2',desc:'Tight map 2v2 competitive format.',details:'Small-map duels with faster rounds. Great for aim training and duo queue practice.',server:'NexForge custom server'},{icon:'💥',name:'Deathmatch',desc:'Free-for-all warmup queue.',details:'No MMR impact. Spawn instantly and practice aim before ranked sessions.',server:'NexForge DM server'},{icon:'🏆',name:'Tournament',desc:'Bracket-style CS2 event.',details:'5v5 bracket with map veto. Prize pool events run on weekends.',server:'NexForge tournament'}],
  'Call of Duty: Warzone': [{icon:'🪂',name:'Solo BR',desc:'100-player battle royale solo queue.',details:'Drop in solo and fight for the win. Placement and eliminations affect MMR.',server:'Custom Warzone lobby'},{icon:'👥',name:'Quads',desc:'4-player squad battle royale.',details:'Queue with up to three friends. Team placement determines MMR change.',server:'Custom Warzone lobby'},{icon:'🎯',name:'Resurgence',desc:'Fast respawn battle royale mode.',details:'Smaller map with respawn windows. Faster matches with higher action density.',server:'NexForge custom lobby'},{icon:'🏆',name:'Tournament',desc:'Custom Warzone tournament lobby.',details:'Multi-game point series across custom lobbies. Top teams advance each round.',server:'NexForge bracket'}],
  'Overwatch 2':           [{icon:'⚔',name:'Ranked 5v5',desc:'Competitive role queue with MMR tracking.',details:'Standard role lock format. Tank, DPS, and Support slots enforced for balanced teams.',server:'NexForge custom lobby'},{icon:'🎭',name:'Open Queue',desc:'No role restrictions — any comp goes.',details:'Flexible hero picks without role queue. Faster queue times, less structured teams.',server:'NexForge custom lobby'},{icon:'⚡',name:'Arcade Mode',desc:'Custom ruleset arcade matches.',details:'Rotating game modes with modified rules. Fun-focused with light MMR impact.',server:'NexForge arcade server'},{icon:'🏆',name:'Tournament',desc:'Bracket-style OW2 event.',details:'Best-of-3 series on custom lobbies with map pool rotation.',server:'NexForge bracket'}],
  'Halo Infinite':         [{icon:'🤖',name:'Ranked Slayer',desc:'4v4 competitive slayer queue.',details:'Core Halo competitive experience. Slayer objectives with CSR-style MMR tracking.',server:'NexForge custom lobby'},{icon:'💣',name:'Ranked CTF',desc:'Capture the flag ranked mode.',details:'Team-based objective mode. Flag captures and defense stats tracked in match history.',server:'NexForge custom lobby'},{icon:'🎯',name:'Big Team Battle',desc:'12v12 large-scale mode.',details:'Big maps, vehicles, and chaos. Lower MMR volatility due to larger team size.',server:'NexForge BTB server'},{icon:'🏆',name:'Tournament',desc:'Halo Infinite bracket event.',details:'4v4 slayer bracket with seeding based on NexForge MMR.',server:'NexForge bracket'}],
  'Apex Legends':          [{icon:'🪂',name:'Ranked BR',desc:'Competitive battle royale queue.',details:'Standard ranked BR with RP-style MMR mapping. Placement and kills both matter.',server:'NexForge custom lobby'},{icon:'👥',name:'Trios',desc:'3-player squad matchmaking.',details:'Queue solo or as a trio. Team placement drives MMR changes.',server:'NexForge custom lobby'},{icon:'⚡',name:'Mixtape',desc:'Rotating TDM and Control modes.',details:'Shorter modes outside BR. Great for aim warmup and ability practice.',server:'NexForge custom lobby'},{icon:'🏆',name:'Tournament',desc:'20-squad custom lobby event.',details:'Multi-game ALGS-style scoring across custom lobbies.',server:'NexForge bracket'}],
  'Fortnite':              [{icon:'🏗',name:'NexForge Custom Game',desc:'Join a hosted custom Fortnite lobby.',details:'Drop into NexForge-hosted creative/competitive island. MMR tracked for eliminations and placement.',server:'NexForge Fortnite island'},{icon:'🎯',name:'Tournament Duo',desc:'Find a partner and compete in duo events.',details:'Use the duo finder to match with a partner, then queue for tournament-style duo lobbies.',server:'NexForge duo bracket'},{icon:'🪂',name:'Solo Custom',desc:'100-player hosted solo match.',details:'Full lobby solo queue on NexForge custom code. Victory Royale boosts MMR significantly.',server:'NexForge custom code'},{icon:'👥',name:'Squad Custom',desc:'Hosted squad game with friends.',details:'Queue as a squad of up to four. Team placement and combined eliminations affect MMR.',server:'NexForge squad lobby'},{icon:'🎮',name:'Creative 1v1',desc:'1v1 box fights and zone wars.',details:'Skill-based 1v1 creative maps. Direct MMR duels with fast rematch support.',server:'NexForge creative island'}],
  'PUBG':                  [{icon:'🪂',name:'Solo BR',desc:'100-player solo battle royale.',details:'Classic PUBG BR on NexForge custom lobbies. Survival time and kills tracked.',server:'NexForge custom lobby'},{icon:'👥',name:'Squad BR',desc:'4-player squad battle royale.',details:'Full squad queue with voice comms recommended. Team placement drives rank.',server:'NexForge custom lobby'},{icon:'⚡',name:'TDM Ranked',desc:'Team deathmatch ranked format.',details:'Arena-style TDM outside BR. Round-based with MMR tracking.',server:'NexForge TDM server'},{icon:'🏆',name:'Tournament',desc:'Custom PUBG tournament bracket.',details:'Multi-match point series. Top squads advance through bracket rounds.',server:'NexForge bracket'}],
  'Fall Guys':             [{icon:'🏃',name:'NexForge Race',desc:'Hosted custom Fall Guys show.',details:'Join NexForge-hosted show with custom rounds. Qualification rounds advance to finals.',server:'NexForge show code'},{icon:'👥',name:'Squad Showdown',desc:'Team-based custom show.',details:'Squad vs squad format across multiple rounds. Coordination wins crowns.',server:'NexForge squad show'},{icon:'🏆',name:'Tournament Show',desc:'Elimination bracket show.',details:'Single-elimination show bracket. Last bean standing takes the crown.',server:'NexForge bracket show'},{icon:'⚡',name:'Speed Run',desc:'Fastest time challenge queue.',details:'Time-trial focused rounds. Best times posted to NexForge leaderboards.',server:'NexForge speedrun show'}],
  'Rocket League':         [{icon:'⚽',name:'1v1 Ranked',desc:'Competitive duel queue.',details:'Standard 1v1 ranked format. Goals, saves, and demo stats tracked in match history.',server:'NexForge private match'},{icon:'👥',name:'3v3 Ranked',desc:'Standard competitive 3v3.',details:'Core RL ranked experience. Team MMR based on combined performance.',server:'NexForge private match'},{icon:'2️⃣',name:'2v2 Ranked',desc:'Doubles competitive queue.',details:'Most popular RL format. Fast rotations and duo synergy rewarded.',server:'NexForge private match'},{icon:'🏆',name:'Tournament',desc:'RL bracket event.',details:'Single-elimination 3v3 bracket. Best-of series with overtime rules.',server:'NexForge bracket'}],
  'FIFA 25':               [{icon:'⚽',name:'1v1 Ranked',desc:'Head-to-head ranked matches.',details:'Full match simulation with MMR tracking. Goals scored and possession stats recorded.',server:'NexForge match'},{icon:'🏆',name:'Tournament',desc:'Cup-style bracket event.',details:'Knockout cup format. Extra time and penalties in knockout rounds.',server:'NexForge bracket'},{icon:'👥',name:'Co-op Seasons',desc:'2v2 cooperative ranked play.',details:'Play with a friend against other duos. Shared MMR pool.',server:'NexForge lobby'},{icon:'⚡',name:'Pro Clubs',desc:'11v11 club match queue.',details:'Full squad Pro Clubs matches on NexForge-hosted lobbies.',server:'NexForge club server'}],
  'NBA 2K25':              [{icon:'🏀',name:'1v1 Ranked',desc:'Head-to-head ranked games.',details:'Park-style 1v1 with full stat tracking. Points, rebounds, and assists recorded.',server:'NexForge match'},{icon:'👥',name:'3v3 Park',desc:'Street-style 3v3 queue.',details:'Rec-style 3v3 with pick-up game energy. Team wins drive MMR.',server:'NexForge park server'},{icon:'🏆',name:'Tournament',desc:'NBA 2K bracket event.',details:'Single-elimination 1v1 or 3v3 bracket depending on event week.',server:'NexForge bracket'},{icon:'⚡',name:'5v5 Pro-Am',desc:'Full team competitive queue.',details:'Organized 5v5 with positions. Requires full team or auto-fill.',server:'NexForge pro-am'}],
  'League of Legends':     [{icon:'⚔',name:'Ranked 5v5',desc:'Solo/duo queue ranked.',details:'Standard Summoner\'s Rift ranked. Lane roles tracked in match stats.',server:'NexForge custom lobby'},{icon:'👥',name:'Flex Queue',desc:'5-stack flex ranked.',details:'Queue with up to five friends. Flexible role assignment.',server:'NexForge custom lobby'},{icon:'⚡',name:'ARAM',desc:'All Random All Mid mayhem.',details:'Quick ARAM matches on Howling Abyss. Lower MMR volatility.',server:'NexForge ARAM lobby'},{icon:'🏆',name:'Tournament',desc:'LoL bracket-style event.',details:'Draft phase included. Best-of-3 series in bracket format.',server:'NexForge bracket'}],
  'Dota 2':                [{icon:'⚔',name:'Ranked Match',desc:'Competitive ranked queue.',details:'Standard ranked with hero picks and MMR tracking. KDA and GPM recorded.',server:'NexForge lobby'},{icon:'👥',name:'Team Match',desc:'Captains mode draft queue.',details:'Full draft phase with captain picks. Coordinated team play rewarded.',server:'NexForge lobby'},{icon:'⚡',name:'Turbo',desc:'Fast-paced casual turbo mode.',details:'Accelerated gold and XP. Shorter matches with reduced MMR impact.',server:'NexForge lobby'},{icon:'🏆',name:'Tournament',desc:'Dota 2 bracket event.',details:'BO3 bracket with draft phase. Admin-hosted lobbies.',server:'NexForge bracket'}],
  'Minecraft':             [{icon:'🌍',name:'Join NexForge Server',desc:'Connect to the hosted Java server.',details:'Persistent NexForge survival SMP. Build, explore, and compete on seasonal leaderboards.',server:'play.nexforge.gg'},{icon:'⚔',name:'PvP Arena',desc:'1v1 or FFA combat arena.',details:'Kit PvP arena with MMR tracking. Queue for 1v1 duels or FFA free-for-all.',server:'play.nexforge.gg/pvp'},{icon:'🏗',name:'Build Battle',desc:'Timed build competition.',details:'Theme-based build battles judged by community votes. Winners earn MMR boosts.',server:'play.nexforge.gg/build'},{icon:'🏆',name:'Survival Tournament',desc:'Last player standing event.',details:'Hardcore survival bracket. Last player alive advances each round.',server:'play.nexforge.gg/tourney'}],
  'Roblox':                [{icon:'🎮',name:'NexForge Hub',desc:'Join the NexForge Roblox experience.',details:'Central hub for all NexForge Roblox game modes. Party up before queuing.',server:'NexForge Roblox game'},{icon:'⚔',name:'Obby Race',desc:'Obstacle course tournament queue.',details:'Timed obby races with checkpoint tracking. Fastest times win.',server:'NexForge Obby'},{icon:'👥',name:'Team Battles',desc:'Custom team-vs-team matches.',details:'Red vs Blue team battles with round-based scoring.',server:'NexForge Battle'},{icon:'🏆',name:'Tournament',desc:'Ranked Roblox competition.',details:'Multi-round elimination across NexForge Roblox experiences.',server:'NexForge bracket'}],
  'GTA Online':            [{icon:'🏎',name:'Race Series',desc:'Custom hosted street races.',details:'Point-to-point and circuit races on custom tracks. Placement and lap times tracked.',server:'NexForge race lobby'},{icon:'🔫',name:'Deathmatch',desc:'Custom DM or team DM.',details:'GTA deathmatch on custom maps. K/D ratio affects MMR.',server:'NexForge DM lobby'},{icon:'👥',name:'Adversary Mode',desc:'Custom adversary match queue.',details:'Objective-based GTA modes — capture zones, hold areas, and more.',server:'NexForge lobby'},{icon:'🏆',name:'Tournament',desc:'Multi-event GTA bracket.',details:'Race + DM combined scoring across multiple event types.',server:'NexForge bracket'}],
  'Geometry Dash':         [{icon:'💎',name:'Rated Levels',desc:'Queue for rated demon and feature levels.',details:'Jump into popular rated levels with MMR based on clears, attempts, and consistency.',server:'NexForge GD lobby'},{icon:'⚡',name:'Demon Rush',desc:'Hard demon challenge queue.',details:'Focus on Hard / Insane / Extreme demons. Completions boost MMR; fails have lighter impact.',server:'NexForge demon lobby'},{icon:'🏗',name:'Create & Share',desc:'Custom level showcase sessions.',details:'Share levels with other NexForge players and get feedback. Light MMR for engagement.',server:'NexForge creator lobby'},{icon:'🏆',name:'Tournament',desc:'Timed Geometry Dash bracket.',details:'Same levels for all players. Fastest clean clears advance through the bracket.',server:'NexForge GD bracket'}],
  'Meccha Chameleon':      [{icon:'🦎',name:'Public Lobby',desc:'Join or host a public hide-and-seek lobby.',details:'Player-hosted public match. Paint to blend in as a hider, or hunt as a seeker. Share your Steam lobby / server details so others can join.',server:'Player-hosted Steam lobby'},{icon:'🎨',name:'Private Friends',desc:'Invite-only lobby with friends.',details:'Self-organized private session. Host sets player count (about 2–10) and shares join info in NexForge chat.',server:'Private Steam lobby'},{icon:'📡',name:'Streamer Lobby',desc:'Host a viewer-participation show.',details:'Streamer or party host opens a joinable lobby. Viewers / friends drop in for paint hide-and-seek rounds.',server:'Streamer-hosted lobby'},{icon:'🏆',name:'Custom Challenge',desc:'House-rules seeker / paint challenge.',details:'Agree on map, round timer, and win conditions with your group. Report the result in NexForge after you finish.',server:'Custom player lobby'}],
};

export const DEFAULT_MODES = [
  {icon:'⚔',name:'Ranked 1v1',desc:'Compete head-to-head for MMR.',details:'Standard 1v1 ranked queue with full stat tracking.',server:'NexForge server'},
  {icon:'👥',name:'Ranked 5v5',desc:'Full team competitive queue.',details:'Team-based ranked with role assignment and MMR tracking.',server:'NexForge server'},
  {icon:'🛡',name:'Unranked',desc:'Casual practice with no rank pressure.',details:'Same rules as ranked without MMR impact. Good for learning.',server:'NexForge server'},
  {icon:'🏆',name:'Tournament',desc:'Bracket-style competitive event.',details:'Single-elimination bracket hosted by NexForge.',server:'NexForge bracket'},
];

/** How many players must share a custom "Other" main game before it goes live. */
export const COMMUNITY_GAME_THRESHOLD = 5;

export function normalizeGameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ') || null;
}

export function isBuiltinGame(name) {
  const key = normalizeGameKey(name);
  if (!key) return false;
  return KNOWN_MAIN_GAMES.some((g) => normalizeGameKey(g) === key);
}

export function getGameCategory(game, catalog = GAME_CATALOG) {
  for (const group of catalog) {
    if (group.games.includes(game)) return group.category;
  }
  return 'Other';
}

export function honestServerLabel(server) {
  if (!server) return 'Player-hosted lobby';
  const s = String(server).toLowerCase();
  if (s.includes('nexforge') || s.includes('custom') || s.includes('tournament bracket')) {
    return 'Player-hosted / self-organized';
  }
  return server;
}

/** Merge Supabase community_games (status=live) into the built-in catalog. */
export function mergeGameCatalog(communityGames = []) {
  const live = (communityGames || []).filter((g) => g?.status === 'live' && g?.name);
  const knownKeys = new Set(KNOWN_MAIN_GAMES.map(normalizeGameKey));
  const communityNames = [];

  for (const row of live) {
    const key = normalizeGameKey(row.name);
    if (!key || knownKeys.has(key)) continue;
    if (communityNames.some((n) => normalizeGameKey(n) === key)) continue;
    communityNames.push(row.name);
    knownKeys.add(key);
  }

  const catalog = GAME_CATALOG.map((group) => ({
    category: group.category,
    games: [...group.games],
  }));

  if (communityNames.length) {
    catalog.push({ category: 'Community', games: communityNames });
  }

  return {
    catalog,
    knownGames: [...KNOWN_MAIN_GAMES, ...communityNames],
    communityNames,
  };
}

export function modesForGame(game) {
  return GAME_MODES[game] || DEFAULT_MODES;
}
