const LOBBY = 'Player-hosted lobby';

function g(name, category, mark, load, extra = {}) {
  return { name, category, mark, load, shooter: false, ...extra };
}

/**
 * Built-in titles. Category order follows first appearance.
 * load: light | medium | heavy — used by Optimize recommendations.
 */
export const GAMES = [
  // Shooters
  g('Valorant', 'Shooters', 'VAL', 'light', { shooter: true }),
  g('CS2', 'Shooters', 'CS2', 'light', { shooter: true }),
  g('Call of Duty: Warzone', 'Shooters', 'WZ', 'heavy', { shooter: true, kit: 'br' }),
  g('Call of Duty', 'Shooters', 'COD', 'heavy', { shooter: true }),
  g('Overwatch 2', 'Shooters', 'OW2', 'light', { shooter: true, kit: 'hero' }),
  g('Halo Infinite', 'Shooters', 'HALO', 'medium', { shooter: true }),
  g('Marvel Rivals', 'Shooters', 'RIV', 'heavy', { shooter: true, kit: 'hero' }),
  g('Rainbow Six Siege', 'Shooters', 'R6', 'medium', { shooter: true }),
  g('Helldivers 2', 'Shooters', 'HD2', 'heavy', { shooter: true, kit: 'coop' }),
  g('Deadlock', 'Shooters', 'DL', 'medium', { shooter: true, kit: 'moba' }),
  g('Battlefield 6', 'Shooters', 'BF6', 'heavy', { shooter: true }),
  g('The Finals', 'Shooters', 'FIN', 'heavy', { shooter: true }),
  g('Escape from Tarkov', 'Shooters', 'EFT', 'heavy', { shooter: true, kit: 'extraction' }),
  g('Hunt: Showdown', 'Shooters', 'HUNT', 'heavy', { shooter: true, kit: 'extraction' }),
  g('Team Fortress 2', 'Shooters', 'TF2', 'light', { shooter: true }),
  g('Ready or Not', 'Shooters', 'RON', 'heavy', { shooter: true, kit: 'coop' }),
  g('Delta Force', 'Shooters', 'DF', 'heavy', { shooter: true, kit: 'extraction' }),
  g('Left 4 Dead 2', 'Shooters', 'L4D', 'medium', { shooter: true, kit: 'coop' }),
  g('Deep Rock Galactic', 'Shooters', 'DRG', 'medium', { shooter: true, kit: 'coop' }),
  g('Titanfall 2', 'Shooters', 'TF', 'medium', { shooter: true }),
  g('DOOM Eternal', 'Shooters', 'DOOM', 'medium', { shooter: true }),
  g('Borderlands 4', 'Shooters', 'BL4', 'heavy', { shooter: true, kit: 'coop' }),
  g('FragPunk', 'Shooters', 'FP', 'medium', { shooter: true }),
  g('Arc Raiders', 'Shooters', 'ARC', 'heavy', { shooter: true, kit: 'extraction' }),
  g('Ultrakill', 'Shooters', 'UK', 'light', { shooter: true }),
  g('Payday 2', 'Shooters', 'PD2', 'medium', { shooter: true, kit: 'coop' }),
  g('Insurgency: Sandstorm', 'Shooters', 'INS', 'medium', { shooter: true }),

  // Battle Royale
  g('Apex Legends', 'Battle Royale', 'APEX', 'medium', { shooter: true, kit: 'br' }),
  g('Fortnite', 'Battle Royale', 'FN', 'medium', { shooter: true, kit: 'br' }),
  g('PUBG', 'Battle Royale', 'PUBG', 'heavy', { shooter: true, kit: 'br' }),
  g('Naraka: Bladepoint', 'Battle Royale', 'NRK', 'medium', { shooter: true, kit: 'br' }),
  g('Arena Breakout Infinite', 'Battle Royale', 'ABI', 'heavy', { shooter: true, kit: 'extraction' }),

  // MOBA & Strategy
  g('League of Legends', 'MOBA & Strategy', 'LOL', 'light', { kit: 'moba' }),
  g('Dota 2', 'MOBA & Strategy', 'DOTA', 'light', { kit: 'moba' }),
  g('Teamfight Tactics', 'MOBA & Strategy', 'TFT', 'light', { kit: 'auto' }),
  g('Smite 2', 'MOBA & Strategy', 'SMT', 'medium', { kit: 'moba' }),
  g('Age of Empires IV', 'MOBA & Strategy', 'AOE4', 'light', { kit: 'strategy' }),
  g('Age of Empires II', 'MOBA & Strategy', 'AOE2', 'light', { kit: 'strategy' }),
  g('StarCraft II', 'MOBA & Strategy', 'SC2', 'light', { kit: 'strategy' }),
  g('Civilization VII', 'MOBA & Strategy', 'CIV', 'medium', { kit: 'strategy' }),

  // Sports & Racing
  g('Rocket League', 'Sports & Racing', 'RL', 'light', { kit: 'sports' }),
  g('EA Sports FC 26', 'Sports & Racing', 'FC', 'medium', { kit: 'sports' }),
  g('FIFA 25', 'Sports & Racing', 'FIFA', 'medium', { kit: 'sports' }),
  g('NBA 2K26', 'Sports & Racing', '2K', 'medium', { kit: 'sports' }),
  g('NBA 2K25', 'Sports & Racing', '2K', 'medium', { kit: 'sports' }),
  g('Madden NFL 26', 'Sports & Racing', 'MAD', 'medium', { kit: 'sports' }),
  g('F1 25', 'Sports & Racing', 'F1', 'heavy', { kit: 'racing' }),
  g('Forza Horizon 5', 'Sports & Racing', 'FH5', 'heavy', { kit: 'racing' }),
  g('Assetto Corsa Competizione', 'Sports & Racing', 'ACC', 'medium', { kit: 'racing' }),

  // Survival & Sandbox
  g('Minecraft', 'Survival & Sandbox', 'MC', 'light', { kit: 'survival' }),
  g('Roblox', 'Survival & Sandbox', 'RBX', 'light', { kit: 'party' }),
  g('Palworld', 'Survival & Sandbox', 'PAL', 'heavy', { kit: 'survival' }),
  g('Rust', 'Survival & Sandbox', 'RUST', 'heavy', { shooter: true, kit: 'survival' }),
  g('ARK: Survival Ascended', 'Survival & Sandbox', 'ARK', 'heavy', { kit: 'survival' }),
  g('Valheim', 'Survival & Sandbox', 'VALH', 'medium', { kit: 'survival' }),
  g('7 Days to Die', 'Survival & Sandbox', '7DTD', 'medium', { kit: 'survival' }),
  g('Once Human', 'Survival & Sandbox', 'OH', 'heavy', { kit: 'survival' }),
  g('Enshrouded', 'Survival & Sandbox', 'ENS', 'heavy', { kit: 'survival' }),
  g('Don\'t Starve Together', 'Survival & Sandbox', 'DST', 'light', { kit: 'survival' }),
  g('Terraria', 'Survival & Sandbox', 'TER', 'light', { kit: 'survival' }),
  g('Stardew Valley', 'Survival & Sandbox', 'SV', 'light', { kit: 'cozy' }),
  g('Lethal Company', 'Survival & Sandbox', 'LC', 'light', { kit: 'coop' }),
  g('Content Warning', 'Survival & Sandbox', 'CW', 'light', { kit: 'coop' }),
  g('R.E.P.O.', 'Survival & Sandbox', 'REPO', 'light', { kit: 'coop' }),
  g('Peak', 'Survival & Sandbox', 'PEAK', 'light', { kit: 'coop' }),
  g('Schedule I', 'Survival & Sandbox', 'SCH', 'medium', { kit: 'cozy' }),
  g('Satisfactory', 'Survival & Sandbox', 'SAT', 'medium', { kit: 'cozy' }),
  g('Factorio', 'Survival & Sandbox', 'FAC', 'light', { kit: 'strategy' }),
  g('RimWorld', 'Survival & Sandbox', 'RIM', 'light', { kit: 'strategy' }),
  g('No Man\'s Sky', 'Survival & Sandbox', 'NMS', 'medium', { kit: 'survival' }),
  g('Sea of Thieves', 'Survival & Sandbox', 'SOT', 'medium', { shooter: true, kit: 'coop' }),
  g('Sons of the Forest', 'Survival & Sandbox', 'SOTF', 'medium', { kit: 'survival' }),

  // RPGs & Adventure
  g('GTA Online', 'RPGs & Adventure', 'GTA', 'heavy', { shooter: true }),
  g('Elden Ring', 'RPGs & Adventure', 'ER', 'heavy', { kit: 'rpg' }),
  g('Baldur\'s Gate 3', 'RPGs & Adventure', 'BG3', 'heavy', { kit: 'rpg' }),
  g('Cyberpunk 2077', 'RPGs & Adventure', 'CP77', 'heavy', { kit: 'rpg' }),
  g('Red Dead Redemption 2', 'RPGs & Adventure', 'RDR', 'heavy', { kit: 'rpg' }),
  g('The Witcher 3', 'RPGs & Adventure', 'W3', 'heavy', { kit: 'rpg' }),
  g('Black Myth: Wukong', 'RPGs & Adventure', 'BMW', 'heavy', { kit: 'rpg' }),
  g('Monster Hunter Wilds', 'RPGs & Adventure', 'MHW', 'heavy', { kit: 'coop' }),
  g('Path of Exile 2', 'RPGs & Adventure', 'POE2', 'heavy', { kit: 'rpg' }),
  g('Diablo IV', 'RPGs & Adventure', 'D4', 'heavy', { kit: 'rpg' }),
  g('Skyrim', 'RPGs & Adventure', 'SKY', 'medium', { kit: 'rpg' }),
  g('Hogwarts Legacy', 'RPGs & Adventure', 'HWL', 'heavy', { kit: 'rpg' }),
  g('Starfield', 'RPGs & Adventure', 'SF', 'heavy', { kit: 'rpg' }),
  g('Hades II', 'RPGs & Adventure', 'H2', 'light', { kit: 'rpg' }),
  g('Hollow Knight: Silksong', 'RPGs & Adventure', 'HK', 'light', { kit: 'rpg' }),
  g('Resident Evil 4', 'RPGs & Adventure', 'RE4', 'medium', { kit: 'rpg' }),
  g('Dark Souls III', 'RPGs & Adventure', 'DS3', 'medium', { kit: 'rpg' }),

  // MMO & Live Service
  g('Destiny 2', 'MMO & Live Service', 'D2', 'heavy', { shooter: true, kit: 'mmo' }),
  g('World of Warcraft', 'MMO & Live Service', 'WOW', 'light', { kit: 'mmo' }),
  g('Final Fantasy XIV', 'MMO & Live Service', 'FF14', 'medium', { kit: 'mmo' }),
  g('Lost Ark', 'MMO & Live Service', 'LA', 'medium', { kit: 'mmo' }),
  g('Guild Wars 2', 'MMO & Live Service', 'GW2', 'medium', { kit: 'mmo' }),
  g('The Elder Scrolls Online', 'MMO & Live Service', 'ESO', 'medium', { kit: 'mmo' }),
  g('Warframe', 'MMO & Live Service', 'WF', 'medium', { shooter: true, kit: 'mmo' }),
  g('Genshin Impact', 'MMO & Live Service', 'GI', 'medium', { kit: 'mmo' }),
  g('Wuthering Waves', 'MMO & Live Service', 'WUWA', 'medium', { kit: 'mmo' }),
  g('Zenless Zone Zero', 'MMO & Live Service', 'ZZZ', 'medium', { kit: 'mmo' }),
  g('Honkai: Star Rail', 'MMO & Live Service', 'HSR', 'light', { kit: 'mmo' }),
  g('Old School RuneScape', 'MMO & Live Service', 'OSRS', 'light', { kit: 'mmo' }),
  g('Path of Exile', 'MMO & Live Service', 'POE', 'medium', { kit: 'rpg' }),
  g('Throne and Liberty', 'MMO & Live Service', 'TL', 'heavy', { kit: 'mmo' }),

  // Fighting
  g('Street Fighter 6', 'Fighting', 'SF6', 'medium', { kit: 'fighting' }),
  g('Tekken 8', 'Fighting', 'T8', 'medium', { kit: 'fighting' }),
  g('Mortal Kombat 1', 'Fighting', 'MK1', 'medium', { kit: 'fighting' }),
  g('Brawlhalla', 'Fighting', 'BH', 'light', { kit: 'fighting' }),

  // Horror & Party
  g('Phasmophobia', 'Horror & Party', 'PHAS', 'medium', { kit: 'horror' }),
  g('Dead by Daylight', 'Horror & Party', 'DBD', 'medium', { kit: 'horror' }),
  g('Among Us', 'Horror & Party', 'AU', 'light', { kit: 'party' }),
  g('It Takes Two', 'Horror & Party', 'ITT', 'medium', { kit: 'coop' }),
  g('Party Animals', 'Horror & Party', 'PA', 'light', { kit: 'party' }),
  g('VRChat', 'Horror & Party', 'VRC', 'medium', { kit: 'party' }),
  g('Goose Goose Duck', 'Horror & Party', 'GGD', 'light', { kit: 'party' }),

  // Casual
  g('Fall Guys', 'Casual', 'FG', 'light', { kit: 'party' }),
  g('Geometry Dash', 'Casual', 'GD', 'light', { kit: 'casual' }),
  g('Meccha Chameleon', 'Casual', 'MCC', 'light', { kit: 'party' }),
  g('The Sims 4', 'Casual', 'TS4', 'medium', { kit: 'cozy' }),
  g('Bloons TD 6', 'Casual', 'BTD', 'light', { kit: 'strategy' }),
  g('Slay the Spire', 'Casual', 'STS', 'light', { kit: 'cards' }),
  g('Hearthstone', 'Casual', 'HS', 'light', { kit: 'cards' }),
  g('Marvel Snap', 'Casual', 'SNAP', 'light', { kit: 'cards' }),
  g('Magic: The Gathering Arena', 'Casual', 'MTGA', 'light', { kit: 'cards' }),
  g('Yu-Gi-Oh! Master Duel', 'Casual', 'YGO', 'light', { kit: 'cards' }),
  g('Balatro', 'Casual', 'BAL', 'light', { kit: 'cards' }),
  g('Vampire Survivors', 'Casual', 'VS', 'light', { kit: 'casual' }),
];

const GAME_BY_NAME = new Map(GAMES.map((row) => [row.name, row]));

export const KNOWN_MAIN_GAMES = GAMES.map((row) => row.name);

const CATEGORY_ORDER = [];
for (const row of GAMES) {
  if (!CATEGORY_ORDER.includes(row.category)) CATEGORY_ORDER.push(row.category);
}

export const GAME_CATALOG = CATEGORY_ORDER.map((category) => ({
  category,
  games: GAMES.filter((row) => row.category === category).map((row) => row.name),
}));

/** Games where kills / deaths / assists are tracked (manual entry — no live game API). */
export const SHOOTER_GAMES = new Set(GAMES.filter((row) => row.shooter).map((row) => row.name));

export function isShooterGame(game) {
  return SHOOTER_GAMES.has(game);
}

export const GAME_MARKS = Object.fromEntries(GAMES.map((row) => [row.name, row.mark]));

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

export function gameLoadOf(game) {
  return GAME_BY_NAME.get(String(game || ''))?.load || 'medium';
}

function kitModes(...rows) {
  return rows.map(([icon, name, desc, details, server]) => ({
    icon,
    name,
    desc,
    details: details || desc,
    server: server || LOBBY,
  }));
}

const MODE_KITS = {
  fps: kitModes(
    ['⚔', 'Ranked', 'Competitive ranked matchmaking.', 'Ranked rules with full stat tracking. Share a lobby code so the squad can queue together.'],
    ['🎯', 'Unranked / Casual', 'Practice with no rank pressure.', 'Same sandbox without rank impact. Warmups, new weapons, or playing with friends.'],
    ['💥', 'Deathmatch / TDM', 'Free-for-all or team deathmatch.', 'Fast respawn aim practice. Report the scoreboard in the app after you finish.'],
    ['🏆', 'Tournament', 'Bracket-style competitive event.', 'Single-elimination bracket you organize. Check-in before start.'],
  ),
  hero: kitModes(
    ['⚔', 'Ranked', 'Role or open ranked queue.', 'Competitive hero shooter rules. Track wins, losses, and KDA if you want.'],
    ['🎭', 'Quick Play', 'Casual matches with no rank on the line.', 'Faster queues and flexible comps. Good for learning new heroes.'],
    ['⚡', 'Arcade / Custom', 'Rotating or custom rulesets.', 'House rules, mystery heroes, or custom lobbies you host yourselves.'],
    ['🏆', 'Tournament', 'Best-of series on a shared lobby.', 'Map pool and check-in agreed in the queue details.'],
  ),
  br: kitModes(
    ['🪂', 'Solo BR', 'Battle royale solo queue.', 'Drop in solo. Placement and eliminations both matter for the recap.'],
    ['👥', 'Duos / Trios / Squads', 'Squad battle royale.', 'Queue with friends. Team placement drives the result you log.'],
    ['🎯', 'Resurgence / Ranked', 'Faster or ranked BR playlist.', 'Respawn windows or ranked RP-style scoring. Share the lobby / club code.'],
    ['🏆', 'Custom Lobby', 'Hosted custom BR games.', 'Multi-game point series in a custom lobby. Top squads advance.'],
  ),
  extraction: kitModes(
    ['🎒', 'Raid / Raid', 'PvPvE extraction raid.', 'Bring gear in, extract or lose it. Share raid timing and map in the lobby details.'],
    ['👥', 'Squad Raid', 'Duo or trio extraction.', 'Coordinate loadouts and extract together. Report surviving / KIA after.'],
    ['🎯', 'PvE / Practice', 'PVE or offline practice.', 'Learn maps and audio without ranked stakes.'],
    ['🏆', 'Tournament', 'Custom raid series.', 'Agreed ruleset, kit limits, and scoring across multiple raids.'],
  ),
  coop: kitModes(
    ['👥', 'Co-op Mission', 'Play the campaign or ops together.', 'Share a Steam / in-game invite. Difficulty and mission in the queue details.'],
    ['⚔', 'Challenge Run', 'Higher difficulty or modifiers.', 'Helldive, Nightmare, or similar. Agree on the modifier list first.'],
    ['🛡', 'Casual Session', 'Unranked co-op hangout.', 'No rank pressure. Drop in, drop out, log the session after.'],
    ['🏆', 'Tournament', 'Timed or elimination co-op event.', 'Same mission for every squad. Fastest clean clear or most samples wins.'],
  ),
  moba: kitModes(
    ['⚔', 'Ranked', 'Competitive draft queue.', 'Standard ranked with roles. KDA and lane notes optional in the recap.'],
    ['👥', 'Party / Flex', 'Stack with friends.', 'Queue as a group. Flexible roles, share the lobby or Discord.'],
    ['⚡', 'ARAM / Turbo / Casual', 'Faster or all-random modes.', 'Lower rank volatility. Good for warmups.'],
    ['🏆', 'Tournament', 'Draft bracket event.', 'Best-of series with a draft phase. Admin-hosted lobbies.'],
  ),
  auto: kitModes(
    ['♟', 'Ranked', 'Auto-battler ranked ladder.', 'Standard ranked TFT / auto-chess. Placement is the score.'],
    ['⚡', 'Hyper Roll / Turbo', 'Faster rounds, same rules.', 'Shorter games for a quick session.'],
    ['👥', 'Double Up', 'Duo auto-battler.', 'Queue with a partner and share boards / items.'],
    ['🏆', 'Tournament', 'Lobby of 8, cut after rounds.', 'Custom lobby with agreed stage and round count.'],
  ),
  strategy: kitModes(
    ['⚔', 'Ranked 1v1', 'Head-to-head ranked.', 'Standard 1v1. Share the lobby or ladder link.'],
    ['👥', 'Team Game', '2v2 / 3v3 / FFA.', 'Allied or free-for-all on a shared map preset.'],
    ['🛡', 'Unranked / Custom', 'Custom civs, maps, or house rules.', 'Host sets the settings. Others join from the queue details.'],
    ['🏆', 'Tournament', 'Bo3 or Bo5 bracket.', 'Map veto and check-in in the event rules.'],
  ),
  sports: kitModes(
    ['⚽', '1v1 Ranked', 'Head-to-head ranked match.', 'Full match with rank tracking. Share the invite or arena.'],
    ['👥', '2v2 / Clubs', 'Co-op or clubs vs clubs.', 'Play with a friend against other duos or full clubs.'],
    ['⚡', 'Casual', 'Friendlies with no rank on the line.', 'Same rules, no ladder pressure.'],
    ['🏆', 'Tournament', 'Cup-style bracket.', 'Knockout format. Extra time and pens if you agree on them.'],
  ),
  racing: kitModes(
    ['🏎', 'Race', 'Circuit or point-to-point race.', 'Share the lobby code, car class, and track.'],
    ['⏱', 'Time Trial', 'Clean laps against the clock.', 'Same car and track for everyone. Fastest valid lap wins.'],
    ['👥', 'Championship', 'Multi-race points series.', 'Agree on the calendar in the queue details.'],
    ['🏆', 'Tournament', 'Bracket or league night.', 'Qualifying plus races, or single-elim match races.'],
  ),
  survival: kitModes(
    ['🌍', 'Shared World / Server', 'Join the same world or dedicated server.', 'Paste the IP, code, or Steam lobby so the group can connect.', 'Player-hosted server'],
    ['⚔', 'PvP', 'Player-versus-player on that world.', 'Kit PvP, raids, or last-team-standing. House rules in the details.', 'Player-hosted server'],
    ['🏗', 'Build / Progress', 'Co-op building and bosses.', 'Progression night — bosses, bases, or farms. No PvP unless you say so.', 'Player-hosted server'],
    ['🏆', 'Challenge', 'Timed wipe or hardcore run.', 'Hardcore, one-life, or wipe-weekend rules the host sets.', 'Player-hosted server'],
  ),
  rpg: kitModes(
    ['⚔', 'Co-op / Summon', 'Play through together.', 'Password, tavern, or Steam overlay invite in the details.'],
    ['💀', 'Boss / Raid Night', 'Farm or race a boss.', 'Agree on the boss, NG cycle, and loot rules.'],
    ['🛡', 'Casual Session', 'Explore, quest, or build.', 'No wipe, no race. Log the session when you stop.'],
    ['🏆', 'Challenge Run', 'SL1, no-hit, or speed rules.', 'Same seed / character constraints for everyone in the event.'],
  ),
  mmo: kitModes(
    ['⚔', 'Duty / Raid / Dungeon', 'Group content for the night.', 'Share data center, world, and party finder notes.'],
    ['👥', 'Open World / Farm', 'Overworld events, maps, or gold.', 'Meetup spot and voice channel in the queue details.'],
    ['🎯', 'Arena / PvP', 'Battlegrounds or ranked arena.', 'Rated or skirmish — say which ladder in the title.'],
    ['🏆', 'Static / Event', 'Scheduled raid static or world first attempt.', 'Lockout, loot rules, and start time go in details.'],
  ),
  fighting: kitModes(
    ['⚔', 'Ranked 1v1', 'Bo3 or FT2 ranked sets.', 'Standard ranked. Share Fightcade / in-game ID if needed.'],
    ['👥', 'Friendlies / Lobby', 'Casual sets in a player lobby.', 'First to X, character locks optional.'],
    ['⚡', 'Side / Crew Battle', '2v2 or crew battle.', 'Agree on the crew size and winners-stay rules.'],
    ['🏆', 'Tournament', 'Double-elim or pools.', 'Bracket hosted on NexForge. Check-in before start.'],
  ),
  horror: kitModes(
    ['👻', 'Investigation / Trial', 'Standard match as survivors or killer.', 'Share the lobby code. Difficulty and map optional.'],
    ['👥', 'Squad Night', 'Full stack of friends.', 'Voice recommended. House rules (no hiding, etc.) in details.'],
    ['⚡', 'Challenge', 'Modifiers, no evidence, or custom kits.', 'Agree on the challenge before you queue.'],
    ['🏆', 'Tournament', 'Custom lobby series.', 'Same maps and rules for every squad. Fastest extract or most gens wins.'],
  ),
  party: kitModes(
    ['🎮', 'Public Lobby', 'Drop-in lobby for the group.', 'Share the code, Discord, or Steam invite so people can join.'],
    ['👥', 'Private Friends', 'Invite-only session.', 'Host sets player count and round rules.'],
    ['📡', 'Streamer / Viewer', 'Viewer-participation or watch party.', 'Streamer opens a joinable lobby. Viewers drop in round by round.'],
    ['🏆', 'Custom Challenge', 'House-rules mini tournament.', 'Win conditions and round count in the queue details.'],
  ),
  cozy: kitModes(
    ['🌍', 'Shared Farm / World', 'Play on the same save or server.', 'Share the join code or dedicated server address.', 'Player-hosted server'],
    ['👥', 'Co-op Session', 'Build, farm, or quest together.', 'Goals for the night in the details so people know what they are joining.'],
    ['🎯', 'Challenge', 'Community center / factory / profit race.', 'Same seed or save rules. First to the goal wins.'],
    ['🏆', 'Event', 'Seasonal or themed night.', 'Decor, racing, or showcase — host sets the vibe.'],
  ),
  cards: kitModes(
    ['♠', 'Ranked', 'Ladder or ranked constructed.', 'Standard ranked. Deck type optional in the details.'],
    ['⚡', 'Casual / Unranked', 'Friendlies and new decks.', 'No ladder. Good for brewing.'],
    ['👥', 'Draft / Sealed', 'Limited format night.', 'Agree on the set and how you draft (in-client or paper-style).'],
    ['🏆', 'Tournament', 'Swiss or single-elim.', 'Decklist lock and round timer in the event rules.'],
  ),
  casual: kitModes(
    ['⚡', 'Standard', 'Normal play session.', 'Share the level, server, or lobby so others can join.'],
    ['🎯', 'Challenge', 'Harder levels or modifiers.', 'Same chart / demon / round for everyone.'],
    ['🏗', 'Create & Share', 'User levels or custom maps.', 'Drop a code or workshop link in the details.'],
    ['🏆', 'Tournament', 'Timed bracket.', 'Fastest clean clear or most points advances.'],
  ),
};

const CATEGORY_KIT = {
  Shooters: 'fps',
  'Battle Royale': 'br',
  'MOBA & Strategy': 'moba',
  'Sports & Racing': 'sports',
  'Survival & Sandbox': 'survival',
  'RPGs & Adventure': 'rpg',
  'MMO & Live Service': 'mmo',
  Fighting: 'fighting',
  'Horror & Party': 'party',
  Casual: 'casual',
};

export const GAME_MODES = {
  'Valorant':              [{icon:'⚔',name:'Ranked 5v5',desc:'Competitive ranked matchmaking with rank on the line.',details:'Standard competitive rules. Best-of-25 rounds, agent bans enabled, and full rank tracking for wins and losses.',server:'Player-hosted lobby'},{icon:'🎯',name:'Unrated 5v5',desc:'Casual practice queue with no rank impact.',details:'Same format as ranked without rank pressure. Ideal for warmups, new agents, or playing with friends.',server:'Player-hosted lobby'},{icon:'💣',name:'Spike Rush',desc:'Fast-paced 7-round spike mode.',details:'Accelerated rounds with random loadouts. Quick matches for players who want fast action.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'Bracket-style competitive event.',details:'Single-elimination bracket player-organized. Check-in required 15 minutes before start.',server:'Player-hosted lobby'}],
  'CS2':                   [{icon:'🔫',name:'Competitive 5v5',desc:'Official ranked format in player-hosted lobbies.',details:'MR12 competitive rules with full buy economy. Standings adjust based on round differential and performance.',server:'Player-hosted lobby'},{icon:'⚡',name:'Wingman 2v2',desc:'Tight map 2v2 competitive format.',details:'Small-map duels with faster rounds. Great for aim training and duo queue practice.',server:'Player-hosted lobby'},{icon:'💥',name:'Deathmatch',desc:'Free-for-all warmup queue.',details:'No rank impact. Spawn instantly and practice aim before ranked sessions.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'Bracket-style CS2 event.',details:'5v5 bracket with map veto. Prize pool events run on weekends.',server:'Player-hosted lobby'}],
  'Call of Duty: Warzone': [{icon:'🪂',name:'Solo BR',desc:'100-player battle royale solo queue.',details:'Drop in solo and fight for the win. Placement and eliminations affect rank.',server:'Player-hosted lobby'},{icon:'👥',name:'Quads',desc:'4-player squad battle royale.',details:'Queue with up to three friends. Team placement determines rank change.',server:'Player-hosted lobby'},{icon:'🎯',name:'Resurgence',desc:'Fast respawn battle royale mode.',details:'Smaller map with respawn windows. Faster matches with higher action density.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'Custom Warzone tournament lobby.',details:'Multi-game point series across custom lobbies. Top teams advance each round.',server:'Player-hosted lobby'}],
  'Overwatch 2':           [{icon:'⚔',name:'Ranked 5v5',desc:'Competitive role queue with rank tracking.',details:'Standard role lock format. Tank, DPS, and Support slots enforced for balanced teams.',server:'Player-hosted lobby'},{icon:'🎭',name:'Open Queue',desc:'No role restrictions — any comp goes.',details:'Flexible hero picks without role queue. Faster queue times, less structured teams.',server:'Player-hosted lobby'},{icon:'⚡',name:'Arcade Mode',desc:'Custom ruleset arcade matches.',details:'Rotating game modes with modified rules. Fun-focused with light rank impact.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'Bracket-style OW2 event.',details:'Best-of-3 series on custom lobbies with map pool rotation.',server:'Player-hosted lobby'}],
  'Halo Infinite':         [{icon:'🤖',name:'Ranked Slayer',desc:'4v4 competitive slayer queue.',details:'Core Halo competitive experience. Slayer objectives with CSR-style rank tracking.',server:'Player-hosted lobby'},{icon:'💣',name:'Ranked CTF',desc:'Capture the flag ranked mode.',details:'Team-based objective mode. Flag captures and defense stats tracked in match history.',server:'Player-hosted lobby'},{icon:'🎯',name:'Big Team Battle',desc:'12v12 large-scale mode.',details:'Big maps, vehicles, and chaos. Lower rank volatility due to larger team size.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'Halo Infinite bracket event.',details:'4v4 slayer bracket with seeding based on your NexForge rank.',server:'Player-hosted lobby'}],
  'Apex Legends':          [{icon:'🪂',name:'Ranked BR',desc:'Competitive battle royale queue.',details:'Standard ranked BR with RP-style rank mapping. Placement and kills both matter.',server:'Player-hosted lobby'},{icon:'👥',name:'Trios',desc:'3-player squad matchmaking.',details:'Queue solo or as a trio. Team placement drives rank changes.',server:'Player-hosted lobby'},{icon:'⚡',name:'Mixtape',desc:'Rotating TDM and Control modes.',details:'Shorter modes outside BR. Great for aim warmup and ability practice.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'20-squad custom lobby event.',details:'Multi-game ALGS-style scoring across custom lobbies.',server:'Player-hosted lobby'}],
  'Fortnite':              [{icon:'🏗',name:'Custom Game',desc:'Join a hosted custom Fortnite lobby.',details:'Drop into player-hosted creative/competitive island. Results tracked for eliminations and placement.',server:'Player-hosted lobby'},{icon:'🎯',name:'Tournament Duo',desc:'Find a partner and compete in duo events.',details:'Use the duo finder to match with a partner, then queue for tournament-style duo lobbies.',server:'Player-hosted lobby'},{icon:'🪂',name:'Solo Custom',desc:'100-player hosted solo match.',details:'Full lobby solo queue with a shared custom code. Victory Royale boosts rank significantly.',server:'Player-hosted lobby'},{icon:'👥',name:'Squad Custom',desc:'Hosted squad game with friends.',details:'Queue as a squad of up to four. Team placement and combined eliminations affect rank.',server:'Player-hosted lobby'},{icon:'🎮',name:'Creative 1v1',desc:'1v1 box fights and zone wars.',details:'Skill-based 1v1 creative maps. Direct rank duels with fast rematch support.',server:'Player-hosted lobby'}],
  'PUBG':                  [{icon:'🪂',name:'Solo BR',desc:'100-player solo battle royale.',details:'Classic PUBG BR in player-hosted custom lobbies. Survival time and kills tracked.',server:'Player-hosted lobby'},{icon:'👥',name:'Squad BR',desc:'4-player squad battle royale.',details:'Full squad queue with voice comms recommended. Team placement drives rank.',server:'Player-hosted lobby'},{icon:'⚡',name:'TDM Ranked',desc:'Team deathmatch ranked format.',details:'Arena-style TDM outside BR. Round-based with rank tracking.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'Custom PUBG tournament bracket.',details:'Multi-match point series. Top squads advance through bracket rounds.',server:'Player-hosted lobby'}],
  'Fall Guys':             [{icon:'🏃',name:'Custom Race',desc:'Hosted custom Fall Guys show.',details:'Join player-hosted show with custom rounds. Qualification rounds advance to finals.',server:'Player-hosted lobby'},{icon:'👥',name:'Squad Showdown',desc:'Team-based custom show.',details:'Squad vs squad format across multiple rounds. Coordination wins crowns.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament Show',desc:'Elimination bracket show.',details:'Single-elimination show bracket. Last bean standing takes the crown.',server:'Player-hosted lobby'},{icon:'⚡',name:'Speed Run',desc:'Fastest time challenge queue.',details:'Time-trial focused rounds. Best times posted on NexForge session stats.',server:'Player-hosted lobby'}],
  'Rocket League':         [{icon:'⚽',name:'1v1 Ranked',desc:'Competitive duel queue.',details:'Standard 1v1 ranked format. Goals, saves, and demo stats tracked in match history.',server:'Player-hosted lobby'},{icon:'👥',name:'3v3 Ranked',desc:'Standard competitive 3v3.',details:'Core RL ranked experience. Team rank based on combined performance.',server:'Player-hosted lobby'},{icon:'2️⃣',name:'2v2 Ranked',desc:'Doubles competitive queue.',details:'Most popular RL format. Fast rotations and duo synergy rewarded.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'RL bracket event.',details:'Single-elimination 3v3 bracket. Best-of series with overtime rules.',server:'Player-hosted lobby'}],
  'FIFA 25':               [{icon:'⚽',name:'1v1 Ranked',desc:'Head-to-head ranked matches.',details:'Full match simulation with rank tracking. Goals scored and possession stats recorded.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'Cup-style bracket event.',details:'Knockout cup format. Extra time and penalties in knockout rounds.',server:'Player-hosted lobby'},{icon:'👥',name:'Co-op Seasons',desc:'2v2 cooperative ranked play.',details:'Play with a friend against other duos. Shared rank pool.',server:'Player-hosted lobby'},{icon:'⚡',name:'Pro Clubs',desc:'11v11 club match queue.',details:'Full squad Pro Clubs matches on player-hosted lobbies.',server:'Player-hosted lobby'}],
  'NBA 2K25':              [{icon:'🏀',name:'1v1 Ranked',desc:'Head-to-head ranked games.',details:'Park-style 1v1 with full stat tracking. Points, rebounds, and assists recorded.',server:'Player-hosted lobby'},{icon:'👥',name:'3v3 Park',desc:'Street-style 3v3 queue.',details:'Rec-style 3v3 with pick-up game energy. Team wins drive rank.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'NBA 2K bracket event.',details:'Single-elimination 1v1 or 3v3 bracket depending on event week.',server:'Player-hosted lobby'},{icon:'⚡',name:'5v5 Pro-Am',desc:'Full team competitive queue.',details:'Organized 5v5 with positions. Requires full team or auto-fill.',server:'Player-hosted lobby'}],
  'League of Legends':     [{icon:'⚔',name:'Ranked 5v5',desc:'Solo/duo queue ranked.',details:'Standard Summoner\'s Rift ranked. Lane roles tracked in match stats.',server:'Player-hosted lobby'},{icon:'👥',name:'Flex Queue',desc:'5-stack flex ranked.',details:'Queue with up to five friends. Flexible role assignment.',server:'Player-hosted lobby'},{icon:'⚡',name:'ARAM',desc:'All Random All Mid mayhem.',details:'Quick ARAM matches on Howling Abyss. Lower rank volatility.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'LoL bracket-style event.',details:'Draft phase included. Best-of-3 series in bracket format.',server:'Player-hosted lobby'}],
  'Dota 2':                [{icon:'⚔',name:'Ranked Match',desc:'Competitive ranked queue.',details:'Standard ranked with hero picks and rank tracking. KDA and GPM recorded.',server:'Player-hosted lobby'},{icon:'👥',name:'Team Match',desc:'Captains mode draft queue.',details:'Full draft phase with captain picks. Coordinated team play rewarded.',server:'Player-hosted lobby'},{icon:'⚡',name:'Turbo',desc:'Fast-paced casual turbo mode.',details:'Accelerated gold and XP. Shorter matches with reduced rank impact.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'Dota 2 bracket event.',details:'BO3 bracket with draft phase. Admin-hosted lobbies.',server:'Player-hosted lobby'}],
  'Minecraft':             [{icon:'🌍',name:'Join Shared Server',desc:'Share your Minecraft server address with the group.',details:'Coordinate a shared Minecraft world or server with your group.',server:'Player-hosted Minecraft server'},{icon:'⚔',name:'PvP Arena',desc:'1v1 or FFA combat arena.',details:'Kit PvP arena with rank tracking. Queue for 1v1 duels or FFA free-for-all.',server:'Player-hosted Minecraft server'},{icon:'🏗',name:'Build Battle',desc:'Timed build competition.',details:'Theme-based build battles judged by community votes. Winners earn rank boosts.',server:'Player-hosted Minecraft server'},{icon:'🏆',name:'Survival Tournament',desc:'Last player standing event.',details:'Hardcore survival bracket. Last player alive advances each round.',server:'Player-hosted Minecraft server'}],
  'Roblox':                [{icon:'🎮',name:'Roblox Hub',desc:'Share your Roblox experience link with the group.',details:'Central hub for Roblox modes you organize. Party up before queuing.',server:'Player-hosted Roblox experience'},{icon:'⚔',name:'Obby Race',desc:'Obstacle course tournament queue.',details:'Timed obby races with checkpoint tracking. Fastest times win.',server:'Player-hosted lobby'},{icon:'👥',name:'Team Battles',desc:'Custom team-vs-team matches.',details:'Red vs Blue team battles with round-based scoring.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'Ranked Roblox competition.',details:'Multi-round elimination across shared Roblox experiences.',server:'Player-hosted lobby'}],
  'GTA Online':            [{icon:'🏎',name:'Race Series',desc:'Custom hosted street races.',details:'Point-to-point and circuit races on custom tracks. Placement and lap times tracked.',server:'Player-hosted lobby'},{icon:'🔫',name:'Deathmatch',desc:'Custom DM or team DM.',details:'GTA deathmatch on custom maps. K/D ratio affects rank.',server:'Player-hosted lobby'},{icon:'👥',name:'Adversary Mode',desc:'Custom adversary match queue.',details:'Objective-based GTA modes — capture zones, hold areas, and more.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'Multi-event GTA bracket.',details:'Race + DM combined scoring across multiple event types.',server:'Player-hosted lobby'}],
  'Geometry Dash':         [{icon:'💎',name:'Rated Levels',desc:'Queue for rated demon and feature levels.',details:'Jump into popular rated levels with rank based on clears, attempts, and consistency.',server:'Player-hosted lobby'},{icon:'⚡',name:'Demon Rush',desc:'Hard demon challenge queue.',details:'Focus on Hard / Insane / Extreme demons. Completions boost rank; fails have lighter impact.',server:'Player-hosted lobby'},{icon:'🏗',name:'Create & Share',desc:'Custom level showcase sessions.',details:'Share levels with other players and get feedback. Light rank for engagement.',server:'Player-hosted lobby'},{icon:'🏆',name:'Tournament',desc:'Timed Geometry Dash bracket.',details:'Same levels for all players. Fastest clean clears advance through the bracket.',server:'Player-hosted lobby'}],
  'Meccha Chameleon':      [{icon:'🦎',name:'Public Lobby',desc:'Join or host a public hide-and-seek lobby.',details:'Player-hosted public match. Paint to blend in as a hider, or hunt as a seeker. Share your Steam lobby / server details so others can join.',server:'Player-hosted lobby'},{icon:'🎨',name:'Private Friends',desc:'Invite-only lobby with friends.',details:'Self-organized private session. Host sets player count (about 2–10) and shares join info in the lobby details.',server:'Player-hosted lobby'},{icon:'📡',name:'Streamer Lobby',desc:'Host a viewer-participation show.',details:'Streamer or party host opens a joinable lobby. Viewers / friends drop in for paint hide-and-seek rounds.',server:'Player-hosted lobby'},{icon:'🏆',name:'Custom Challenge',desc:'House-rules seeker / paint challenge.',details:'Agree on map, round timer, and win conditions with your group. Report the result in the app after you finish.',server:'Player-hosted lobby'}],
};

GAME_MODES['EA Sports FC 26'] = GAME_MODES['FIFA 25'];
GAME_MODES['NBA 2K26'] = GAME_MODES['NBA 2K25'];

export const DEFAULT_MODES = [
  {icon:'⚔',name:'Ranked 1v1',desc:'Compete head-to-head for rank.',details:'Standard 1v1 ranked queue with full stat tracking.',server:'Player-hosted lobby'},
  {icon:'👥',name:'Ranked 5v5',desc:'Full team competitive queue.',details:'Team-based ranked with role assignment and rank tracking.',server:'Player-hosted lobby'},
  {icon:'🛡',name:'Unranked',desc:'Casual practice with no rank pressure.',details:'Same rules as ranked without rank impact. Good for learning.',server:'Player-hosted lobby'},
  {icon:'🏆',name:'Tournament',desc:'Bracket-style competitive event.',details:'Single-elimination bracket player-organized.',server:'Player-hosted lobby'},
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
  return KNOWN_MAIN_GAMES.some((gName) => normalizeGameKey(gName) === key);
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
  const live = (communityGames || []).filter((row) => row?.status === 'live' && row?.name);
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
  if (GAME_MODES[game]) return GAME_MODES[game];
  const def = GAME_BY_NAME.get(game);
  const kitName = def?.kit || CATEGORY_KIT[def?.category];
  return (kitName && MODE_KITS[kitName]) || DEFAULT_MODES;
}

export function filterGameCatalog(catalog, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return catalog;
  return catalog
    .map((group) => ({
      category: group.category,
      games: group.games.filter((name) => String(name).toLowerCase().includes(q)),
    }))
    .filter((group) => group.games.length);
}
