/**
 * Map a running Windows process to a NexForge catalog title.
 * Exact exe names win first; then window title + install path.
 * Catalog names must stay in sync with src/renderer/lib/games.js.
 */

const CATALOG = [
  'Valorant', 'CS2', 'Call of Duty: Warzone', 'Call of Duty', 'Overwatch 2', 'Halo Infinite',
  'Marvel Rivals', 'Rainbow Six Siege', 'Helldivers 2', 'Deadlock', 'Battlefield 6', 'The Finals',
  'Escape from Tarkov', 'Hunt: Showdown', 'Team Fortress 2', 'Ready or Not', 'Delta Force',
  'Left 4 Dead 2', 'Deep Rock Galactic', 'Titanfall 2', 'DOOM Eternal', 'Borderlands 4',
  'FragPunk', 'Arc Raiders', 'Ultrakill', 'Payday 2', 'Insurgency: Sandstorm',
  'Apex Legends', 'Fortnite', 'PUBG', 'Naraka: Bladepoint', 'Arena Breakout Infinite',
  'League of Legends', 'Dota 2', 'Teamfight Tactics', 'Smite 2', 'Age of Empires IV',
  'Age of Empires II', 'StarCraft II', 'Civilization VII',
  'Rocket League', 'EA Sports FC 26', 'FIFA 25', 'NBA 2K26', 'NBA 2K25', 'Madden NFL 26',
  'F1 25', 'Forza Horizon 5', 'Assetto Corsa Competizione',
  'Minecraft', 'Roblox', 'Palworld', 'Rust', 'ARK: Survival Ascended', 'Valheim',
  '7 Days to Die', 'Once Human', 'Enshrouded', "Don't Starve Together", 'Terraria',
  'Stardew Valley', 'Lethal Company', 'Content Warning', 'R.E.P.O.', 'Peak', 'Schedule I',
  'Satisfactory', 'Factorio', 'RimWorld', "No Man's Sky", 'Sea of Thieves', 'Sons of the Forest',
  'GTA Online', 'Elden Ring', "Baldur's Gate 3", 'Cyberpunk 2077', 'Red Dead Redemption 2',
  'The Witcher 3', 'Black Myth: Wukong', 'Monster Hunter Wilds', 'Path of Exile 2', 'Diablo IV',
  'Skyrim', 'Hogwarts Legacy', 'Starfield', 'Hades II', 'Hollow Knight: Silksong',
  'Resident Evil 4', 'Dark Souls III',
  'Destiny 2', 'World of Warcraft', 'Final Fantasy XIV', 'Lost Ark', 'Guild Wars 2',
  'The Elder Scrolls Online', 'Warframe', 'Genshin Impact', 'Wuthering Waves',
  'Zenless Zone Zero', 'Honkai: Star Rail', 'Old School RuneScape', 'Path of Exile',
  'Throne and Liberty',
  'Street Fighter 6', 'Tekken 8', 'Mortal Kombat 1', 'Brawlhalla',
  'Phasmophobia', 'Dead by Daylight', 'Among Us', 'It Takes Two', 'Party Animals',
  'VRChat', 'Goose Goose Duck',
  'Fall Guys', 'Geometry Dash', 'Meccha Chameleon', 'The Sims 4', 'Bloons TD 6',
  'Slay the Spire', 'Hearthstone', 'Marvel Snap', 'Magic: The Gathering Arena',
  'Yu-Gi-Oh! Master Duel', 'Balatro', 'Vampire Survivors',
];

/** Process name (no .exe), any casing. */
const PROCESS_GAME_MAP = {
  'VALORANT-Win64-Shipping': 'Valorant',
  'valorant': 'Valorant',
  'cs2': 'CS2',
  'csgo': 'CS2',
  'ModernWarfare': 'Call of Duty: Warzone',
  'cod': 'Call of Duty',
  'cod24-cod': 'Call of Duty',
  'BlackOps6': 'Call of Duty',
  'BlackOps7': 'Call of Duty',
  'BlackOpsColdWar': 'Call of Duty',
  'cod23-cod': 'Call of Duty',
  'Overwatch': 'Overwatch 2',
  'Overwatch.exe': 'Overwatch 2',
  'HaloInfinite': 'Halo Infinite',
  'Marvel-Win64-Shipping': 'Marvel Rivals',
  'MarvelRivals': 'Marvel Rivals',
  'RainbowSix': 'Rainbow Six Siege',
  'RainbowSix_Vulkan': 'Rainbow Six Siege',
  'RainbowSix_BE': 'Rainbow Six Siege',
  'helldivers2': 'Helldivers 2',
  'Helldivers2': 'Helldivers 2',
  'deadlock': 'Deadlock',
  'Deadlock': 'Deadlock',
  'bf6': 'Battlefield 6',
  'BF6': 'Battlefield 6',
  'Battlefield6': 'Battlefield 6',
  'Battlefield': 'Battlefield 6',
  'Discovery': 'The Finals',
  'TheFinals': 'The Finals',
  'EscapeFromTarkov': 'Escape from Tarkov',
  'EscapeFromTarkovArena': 'Escape from Tarkov',
  'HuntGame': 'Hunt: Showdown',
  'tf': 'Team Fortress 2',
  'tf_win64': 'Team Fortress 2',
  'tf_windows64': 'Team Fortress 2',
  'ReadyOrNotSteam-Win64-Shipping': 'Ready or Not',
  'ReadyOrNot': 'Ready or Not',
  'DeltaForceClient-Win64-Shipping': 'Delta Force',
  'DeltaForce': 'Delta Force',
  'left4dead2': 'Left 4 Dead 2',
  'FSD-Win64-Shipping': 'Deep Rock Galactic',
  'FSD': 'Deep Rock Galactic',
  'Titanfall2': 'Titanfall 2',
  'DOOMEternalx64vk': 'DOOM Eternal',
  'DOOMEternalx64': 'DOOM Eternal',
  'DOOMEternal': 'DOOM Eternal',
  'Borderlands4': 'Borderlands 4',
  'OakGame': 'Borderlands 4',
  'FragPunk': 'FragPunk',
  'FragPunk-Win64-Shipping': 'FragPunk',
  'ArcRaiders': 'Arc Raiders',
  'ArcRaiders-Win64-Shipping': 'Arc Raiders',
  'ArcRaidersClient': 'Arc Raiders',
  'ULTRAKILL': 'Ultrakill',
  'payday2_win32_release': 'Payday 2',
  'InsurgencyClient-Win64-Shipping': 'Insurgency: Sandstorm',
  'InsurgencySandstorm': 'Insurgency: Sandstorm',
  'r5apex': 'Apex Legends',
  'FortniteClient-Win64-Shipping': 'Fortnite',
  'TslGame': 'PUBG',
  'PUBG': 'PUBG',
  'NarakaBladepoint': 'Naraka: Bladepoint',
  'NARAKA': 'Naraka: Bladepoint',
  'ABIGame': 'Arena Breakout Infinite',
  'ArenaBreakoutInfinite': 'Arena Breakout Infinite',
  'League of Legends': 'League of Legends',
  'TeamfightTactics': 'Teamfight Tactics',
  'dota2': 'Dota 2',
  'SMITE2': 'Smite 2',
  'SMITE2-Win64-Shipping': 'Smite 2',
  'RelicCardinal': 'Age of Empires IV',
  'AoE2DE_s': 'Age of Empires II',
  'AoE2DE': 'Age of Empires II',
  'SC2_x64': 'StarCraft II',
  'SC2': 'StarCraft II',
  'Civ7': 'Civilization VII',
  'BaseInc': 'Civilization VII',
  'RocketLeague': 'Rocket League',
  'FC26': 'EA Sports FC 26',
  'FIFA26': 'EA Sports FC 26',
  'EASportsFC26': 'EA Sports FC 26',
  'FIFA25': 'FIFA 25',
  'FC25': 'FIFA 25',
  'NBA2K26': 'NBA 2K26',
  'NBA2K25': 'NBA 2K25',
  'Madden26': 'Madden NFL 26',
  'MaddenNFL26': 'Madden NFL 26',
  'F1_25': 'F1 25',
  'F1_2025': 'F1 25',
  'ForzaHorizon5': 'Forza Horizon 5',
  'forzahorizon5': 'Forza Horizon 5',
  'acc': 'Assetto Corsa Competizione',
  'ACS': 'Assetto Corsa Competizione',
  'Minecraft.Windows': 'Minecraft',
  'Minecraft': 'Minecraft',
  'RobloxPlayerBeta': 'Roblox',
  'RobloxPlayer': 'Roblox',
  'Roblox': 'Roblox',
  'Palworld-Win64-Shipping': 'Palworld',
  'Palworld': 'Palworld',
  'RustClient': 'Rust',
  'rust': 'Rust',
  'ArkAscended': 'ARK: Survival Ascended',
  'ArkAscended.exe': 'ARK: Survival Ascended',
  'valheim': 'Valheim',
  '7DaysToDie': '7 Days to Die',
  'OnceHuman': 'Once Human',
  'once_human': 'Once Human',
  'enshrouded': 'Enshrouded',
  'dontstarve_steam_x64': "Don't Starve Together",
  'dontstarve_dedicated': "Don't Starve Together",
  'Terraria': 'Terraria',
  'tModLoader': 'Terraria',
  'Stardew Valley': 'Stardew Valley',
  'StardewValley': 'Stardew Valley',
  'Lethal Company': 'Lethal Company',
  'LethalCompany': 'Lethal Company',
  'Content Warning': 'Content Warning',
  'ContentWarning': 'Content Warning',
  'REPO': 'R.E.P.O.',
  'PEAK': 'Peak',
  'Schedule I': 'Schedule I',
  'ScheduleI': 'Schedule I',
  'FactoryGameSteam-Win64-Shipping': 'Satisfactory',
  'FactoryGameSteam': 'Satisfactory',
  'FactoryGame': 'Satisfactory',
  'PioneerGame': 'Satisfactory',
  'factorio': 'Factorio',
  'RimWorldWin64': 'RimWorld',
  'RimWorld': 'RimWorld',
  'NMS': "No Man's Sky",
  'SoTGame': 'Sea of Thieves',
  'Athena': 'Sea of Thieves',
  'SonsOfTheForest': 'Sons of the Forest',
  'GTA5': 'GTA Online',
  'GTA5_Enhanced': 'GTA Online',
  'PlayGTAV': 'GTA Online',
  'PlayGTAV_Enhanced': 'GTA Online',
  'eldenring': 'Elden Ring',
  'bg3': "Baldur's Gate 3",
  'bg3_dx11': "Baldur's Gate 3",
  'BaldursGate3': "Baldur's Gate 3",
  'Cyberpunk2077': 'Cyberpunk 2077',
  'RDR2': 'Red Dead Redemption 2',
  'PlayRDR2': 'Red Dead Redemption 2',
  'witcher3': 'The Witcher 3',
  'b1-Win64-Shipping': 'Black Myth: Wukong',
  'b1': 'Black Myth: Wukong',
  'MonsterHunterWilds': 'Monster Hunter Wilds',
  'MonsterHunterWilds_Trial': 'Monster Hunter Wilds',
  'PathOfExile2': 'Path of Exile 2',
  'PathOfExile2_x64': 'Path of Exile 2',
  'PathOfExileSteam': 'Path of Exile',
  'PathOfExile_x64Steam': 'Path of Exile',
  'PathOfExile': 'Path of Exile',
  'Diablo IV': 'Diablo IV',
  'DiabloIV': 'Diablo IV',
  'SkyrimSE': 'Skyrim',
  'SkyrimVR': 'Skyrim',
  'TESV': 'Skyrim',
  'HogwartsLegacy': 'Hogwarts Legacy',
  'Starfield': 'Starfield',
  'Hades2': 'Hades II',
  'Hades II': 'Hades II',
  'Hollow Knight Silksong': 'Hollow Knight: Silksong',
  'Silksong': 'Hollow Knight: Silksong',
  're4': 'Resident Evil 4',
  're4exe': 'Resident Evil 4',
  'DarkSoulsIII': 'Dark Souls III',
  'DarkSouls3': 'Dark Souls III',
  'destiny2': 'Destiny 2',
  'Wow': 'World of Warcraft',
  'WowClassic': 'World of Warcraft',
  'WowT': 'World of Warcraft',
  'ffxiv_dx11': 'Final Fantasy XIV',
  'ffxiv': 'Final Fantasy XIV',
  'LOSTARK': 'Lost Ark',
  'LOSTARK.exe': 'Lost Ark',
  'Gw2-64': 'Guild Wars 2',
  'Gw2': 'Guild Wars 2',
  'eso64': 'The Elder Scrolls Online',
  'eso': 'The Elder Scrolls Online',
  'Warframe.x64': 'Warframe',
  'Warframe': 'Warframe',
  'GenshinImpact': 'Genshin Impact',
  'YuanShen': 'Genshin Impact',
  'GenshinImpact.exe': 'Genshin Impact',
  'Wuthering Waves': 'Wuthering Waves',
  'WutheringWaves': 'Wuthering Waves',
  'ZenlessZoneZero': 'Zenless Zone Zero',
  'ZenlessZoneZero.exe': 'Zenless Zone Zero',
  'StarRail': 'Honkai: Star Rail',
  'StarRail.exe': 'Honkai: Star Rail',
  'RuneLite': 'Old School RuneScape',
  'rs2client': 'Old School RuneScape',
  'OSBuddy': 'Old School RuneScape',
  'TL': 'Throne and Liberty',
  'TL.exe': 'Throne and Liberty',
  'StreetFighter6': 'Street Fighter 6',
  'StreetFighter6.exe': 'Street Fighter 6',
  'Polaris-Win64-Shipping': 'Tekken 8',
  'TEKKEN 8': 'Tekken 8',
  'Tekken8': 'Tekken 8',
  'MK12': 'Mortal Kombat 1',
  'MortalKombat1': 'Mortal Kombat 1',
  'Brawlhalla': 'Brawlhalla',
  'Phasmophobia': 'Phasmophobia',
  'DeadByDaylight-Win64-Shipping': 'Dead by Daylight',
  'DeadByDaylight': 'Dead by Daylight',
  'Among Us': 'Among Us',
  'AmongUs': 'Among Us',
  'ItTakesTwo': 'It Takes Two',
  'PartyAnimals': 'Party Animals',
  'VRChat': 'VRChat',
  'Goose Goose Duck': 'Goose Goose Duck',
  'GooseGooseDuck': 'Goose Goose Duck',
  'FallGuys_client_game': 'Fall Guys',
  'FallGuys': 'Fall Guys',
  'GeometryDash': 'Geometry Dash',
  'MecchaChameleon': 'Meccha Chameleon',
  'MecchaChameleon-Win64-Shipping': 'Meccha Chameleon',
  'MECCHA CHAMELEON': 'Meccha Chameleon',
  'TS4_x64': 'The Sims 4',
  'TS4': 'The Sims 4',
  'BloonsTD6': 'Bloons TD 6',
  'SlayTheSpire': 'Slay the Spire',
  'Hearthstone': 'Hearthstone',
  'SNAP': 'Marvel Snap',
  'MarvelSnap': 'Marvel Snap',
  'MTGA': 'Magic: The Gathering Arena',
  'masterduel': 'Yu-Gi-Oh! Master Duel',
  'masterduel.exe': 'Yu-Gi-Oh! Master Duel',
  'Balatro': 'Balatro',
  'VampireSurvivors': 'Vampire Survivors',
};

const SKIP_PROCESSES = new Set([
  'chrome', 'msedge', 'msedgewebview2', 'firefox', 'brave', 'opera', 'iexplore',
  'chromium', 'vivaldi', 'waterfox', 'librewolf', 'arc',
  'discord', 'discordptb', 'discordcanary', 'slack', 'telegram', 'whatsapp',
  'spotify', 'code', 'cursor', 'devenv', 'notepad', 'notepad++',
  'explorer', 'dwm', 'searchhost', 'applicationframehost', 'systemsettings',
  'textinputhost', 'runtimebroker', 'shellexperiencehost', 'startmenuexperiencehost',
  'phoneexperiencehost', 'widgetservice', 'widgets',
  'steam', 'steamwebhelper', 'steamservice', 'gameoverlayui',
  'epicgameslauncher', 'epicwebhelper', 'unrealcefsubprocess',
  'eadesktop', 'ealauncher', 'origin', 'originwebhelperservice',
  'battle.net', 'agent', 'galaxyclient', 'upc', 'ubisoftconnect', 'ubisoftgamelauncher',
  'riotclientservices', 'riotclientux', 'leagueclient', 'leagueclientux', 'leagueclientuxrender',
  'bethesda.net_launcher', 'gog galaxy',
  'nexforge', 'electron', 'powershell', 'pwsh', 'cmd', 'windowsterminal',
  'conhost', 'dllhost', 'svchost', 'taskmgr', 'mmc',
  'nvidia overlay', 'nvidia web helper', 'nvcontainer', 'nvidia share',
  'radeonsoftware', 'amdfreelivesdk',
  'crashreportclient', 'crashpad_handler', 'unitycrashhandler64', 'unitycrashhandler32',
  'easyanticheat_eos', 'easyanticheat', 'beService',
  'vgtray', 'faceit', 'faceitclient', 'esportal',
  'obs64', 'obs32', 'streamlabs obs', 'streamlabs',
  'nvidia broadcast', 'nvidia-smi',
  'onedrive', 'dropbox', 'googledrivefs',
  'minecraftlauncher', 'githubdesktop', 'overwolf', 'overwolfhelper64',
].map((s) => s.toLowerCase()));

const SKIP_TITLE = /^(steam|discord|epic games|riot client|battle\.net|ea app|ubisoft connect|xbox|microsoft store|settings|file explorer)$/i;

/** Extra title/path phrases that are not just the catalog name. */
const EXTRA_NEEDLES = [
  ['CS2', ['counter-strike 2', 'counter-strike']],
  ['Call of Duty: Warzone', ['warzone']],
  ['Call of Duty', ['black ops 6', 'black ops 7', 'black ops', 'modern warfare']],
  ['Overwatch 2', ['overwatch']],
  ['Rainbow Six Siege', ['rainbow six', 'rainbowsix']],
  ['Helldivers 2', ['helldivers']],
  ['Battlefield 6', ['battlefield 6', 'bf6']],
  ['The Finals', ['the finals']],
  ['Escape from Tarkov', ['escape from tarkov', 'tarkov']],
  ['Hunt: Showdown', ['hunt showdown', 'hunt: showdown']],
  ['Team Fortress 2', ['team fortress']],
  ['Ready or Not', ['ready or not']],
  ['Delta Force', ['delta force']],
  ['Left 4 Dead 2', ['left 4 dead']],
  ['Deep Rock Galactic', ['deep rock']],
  ['Titanfall 2', ['titanfall']],
  ['DOOM Eternal', ['doom eternal', 'doometernal']],
  ['Borderlands 4', ['borderlands 4', 'borderlands']],
  ['Insurgency: Sandstorm', ['insurgency sandstorm', 'insurgency']],
  ['Apex Legends', ['apex legends']],
  ['PUBG', ['battlegrounds', 'pubg: battlegrounds']],
  ['Naraka: Bladepoint', ['naraka']],
  ['Arena Breakout Infinite', ['arena breakout']],
  ['League of Legends', ['league of legends']],
  ['Teamfight Tactics', ['teamfight tactics']],
  ['Dota 2', ['dota 2']],
  ['Age of Empires IV', ['age of empires iv', 'age of empires 4']],
  ['Age of Empires II', ['age of empires ii', 'age of empires 2', 'aoe2']],
  ['StarCraft II', ['starcraft ii', 'starcraft 2']],
  ['Civilization VII', ['civilization vii', 'civilization 7', 'civ 7', 'civ7']],
  ['EA Sports FC 26', ['ea sports fc 26', 'fc 26', 'ea sports fc']],
  ['FIFA 25', ['fifa 25', 'fc 25']],
  ['NBA 2K26', ['nba 2k26']],
  ['NBA 2K25', ['nba 2k25']],
  ['Madden NFL 26', ['madden']],
  ['F1 25', ['f1 25', 'f1 2025']],
  ['Forza Horizon 5', ['forza horizon']],
  ['Assetto Corsa Competizione', ['assetto corsa competizione', 'assetto corsa']],
  ['Minecraft', ['lunar client', 'badlion', 'feather client', 'labymod']],
  ['ARK: Survival Ascended', ['survival ascended', 'arkascended']],
  ['7 Days to Die', ['7 days to die']],
  ["Don't Starve Together", ["don't starve", 'dont starve']],
  ['Stardew Valley', ['stardew']],
  ['Lethal Company', ['lethal company']],
  ['Content Warning', ['content warning']],
  ['R.E.P.O.', ['r.e.p.o', 'repo']],
  ['Schedule I', ['schedule i']],
  ['Sons of the Forest', ['sons of the forest']],
  ["No Man's Sky", ["no man's sky", 'nomanssky']],
  ['Sea of Thieves', ['sea of thieves']],
  ['GTA Online', ['grand theft auto v', 'gta v', 'gtav', 'gta 5', 'gta online']],
  ['Elden Ring', ['elden ring']],
  ["Baldur's Gate 3", ["baldur's gate 3", 'baldurs gate 3', 'baldur’s gate 3']],
  ['Cyberpunk 2077', ['cyberpunk']],
  ['Red Dead Redemption 2', ['red dead redemption', 'red dead']],
  ['The Witcher 3', ['witcher 3', 'thewitcher3']],
  ['Black Myth: Wukong', ['black myth', 'wukong']],
  ['Monster Hunter Wilds', ['monster hunter wilds', 'monster hunter']],
  ['Path of Exile 2', ['path of exile 2', 'poe2']],
  ['Path of Exile', ['path of exile']],
  ['Diablo IV', ['diablo iv', 'diablo 4']],
  ['Hogwarts Legacy', ['hogwarts']],
  ['Hades II', ['hades ii', 'hades 2']],
  ['Hollow Knight: Silksong', ['silksong', 'hollow knight']],
  ['Resident Evil 4', ['resident evil 4']],
  ['Dark Souls III', ['dark souls iii', 'dark souls 3']],
  ['World of Warcraft', ['world of warcraft']],
  ['Final Fantasy XIV', ['final fantasy xiv', 'ffxiv']],
  ['The Elder Scrolls Online', ['elder scrolls online']],
  ['Genshin Impact', ['genshin']],
  ['Wuthering Waves', ['wuthering waves']],
  ['Zenless Zone Zero', ['zenless']],
  ['Honkai: Star Rail', ['star rail', 'honkai: star rail']],
  ['Old School RuneScape', ['old school runescape', 'runelite', 'osrs']],
  ['Throne and Liberty', ['throne and liberty']],
  ['Street Fighter 6', ['street fighter 6', 'street fighter']],
  ['Tekken 8', ['tekken 8']],
  ['Mortal Kombat 1', ['mortal kombat']],
  ['Dead by Daylight', ['dead by daylight']],
  ['It Takes Two', ['it takes two']],
  ['Party Animals', ['party animals']],
  ['Goose Goose Duck', ['goose goose duck']],
  ['The Sims 4', ['the sims 4', 'sims 4']],
  ['Bloons TD 6', ['bloons td', 'bloons']],
  ['Slay the Spire', ['slay the spire']],
  ['Marvel Snap', ['marvel snap']],
  ['Magic: The Gathering Arena', ['mtg arena', 'magic: the gathering', 'mtga']],
  ['Yu-Gi-Oh! Master Duel', ['master duel', 'yu-gi-oh', 'yugioh']],
  ['Vampire Survivors', ['vampire survivors']],
  ['Geometry Dash', ['geometry dash']],
  ['Meccha Chameleon', ['meccha chameleon']],
  ['Fall Guys', ['fall guys']],
  ['Marvel Rivals', ['marvel rivals']],
  ['Halo Infinite', ['halo infinite']],
  ['Once Human', ['once human']],
  ['Arc Raiders', ['arc raiders']],
  ['FragPunk', ['fragpunk']],
  ['Rocket League', ['rocketleague']],
  ['Palworld', ['palworld-win64']],
  ['Warframe', ['warframe.x64']],
  ['Phasmophobia', ['phasmophobia']],
  ['VRChat', ['vrchat']],
  ['Balatro', ['balatro']],
  ['Hearthstone', ['hearthstone']],
];

const PROCESS_LOOKUP = new Map();
for (const [proc, game] of Object.entries(PROCESS_GAME_MAP)) {
  PROCESS_LOOKUP.set(proc.toLowerCase().replace(/\.exe$/i, ''), game);
}

const NEEDLES = [];
for (const game of CATALOG) {
  NEEDLES.push({ game, needle: game.toLowerCase() });
}
for (const [game, extras] of EXTRA_NEEDLES) {
  for (const needle of extras) NEEDLES.push({ game, needle: needle.toLowerCase() });
}
NEEDLES.sort((a, b) => b.needle.length - a.needle.length);

function isJavaMinecraft(windowTitle, exePath) {
  const title = String(windowTitle || '').toLowerCase();
  const path = String(exePath || '').toLowerCase();
  if (title && !title.includes('launcher')) {
    if (
      title.includes('minecraft')
      || title.includes('lunar')
      || title.includes('badlion')
      || title.includes('feather')
      || title.includes('labymod')
      || title.includes('prism')
      || title.includes('modrinth')
    ) {
      return true;
    }
  }
  return /[\\/](?:\.minecraft|minecraft|prismlauncher|multimc|modrinth|curseforge|lunarclient|lunar client|badlion|feather)[\\/]/i.test(path)
    || path.includes('.minecraft');
}

function hayHas(hay, needle) {
  if (!needle) return false;
  const h = hay.replace(/:/g, ' ').replace(/\s+/g, ' ');
  const n = needle.replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return false;
  if (n.length >= 8) return h.includes(n);
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(h);
}

function normalizeHay(processName, windowTitle, exePath) {
  return `${windowTitle || ''} ${exePath || ''} ${processName || ''}`
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/:/g, ' ')
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ');
}

function disambiguate(game, hay) {
  if (game === 'League of Legends' && hayHas(hay, 'teamfight tactics')) return 'Teamfight Tactics';
  if (game === 'Call of Duty' && hayHas(hay, 'warzone')) return 'Call of Duty: Warzone';
  if (game === 'Call of Duty: Warzone' && !hayHas(hay, 'warzone') && /black ops|modern warfare|call of duty/.test(hay)) {
    return 'Call of Duty';
  }
  if (game === 'Path of Exile' && (hayHas(hay, 'path of exile 2') || hay.includes('pathofexile2') || hayHas(hay, 'poe2'))) {
    return 'Path of Exile 2';
  }
  if (game === 'FIFA 25' && (hayHas(hay, 'fc 26') || hay.includes('fc26'))) return 'EA Sports FC 26';
  if (game === 'NBA 2K25' && (hayHas(hay, 'nba 2k26') || hay.includes('nba2k26'))) return 'NBA 2K26';
  return game;
}

function matchNeedles(hay) {
  let best = null;
  let bestLen = 0;
  for (const { game, needle } of NEEDLES) {
    if (needle.length < bestLen) continue;
    if (!hayHas(hay, needle)) continue;
    best = game;
    bestLen = needle.length;
  }
  return best ? disambiguate(best, hay) : null;
}

function identifyGame(processName, windowTitle, exePath) {
  const proc = String(processName || '').replace(/\.exe$/i, '');
  const procKey = proc.toLowerCase();
  const title = String(windowTitle || '');
  const path = String(exePath || '');
  const hay = normalizeHay(proc, title, path);

  if (SKIP_PROCESSES.has(procKey)) return null;
  if (SKIP_TITLE.test(title.trim())) return null;
  if (procKey === 'leagueclient' || procKey === 'leagueclientux' || procKey === 'leagueclientuxrender') return null;

  if (procKey === 'javaw' || procKey === 'java') {
    return isJavaMinecraft(title, path) ? 'Minecraft' : null;
  }

  if (procKey === 'client-win64-shipping') {
    if (/wuthering|wuwa/.test(hay)) return 'Wuthering Waves';
    return matchNeedles(hay);
  }

  if (procKey === 'shootergame') {
    if (/ark|asa|survival ascended/.test(hay)) return 'ARK: Survival Ascended';
    return matchNeedles(hay);
  }

  if (procKey === 'start_protected_game') {
    if (/elden/.test(hay)) return 'Elden Ring';
    return matchNeedles(hay);
  }

  const mapped = PROCESS_LOOKUP.get(procKey);
  if (mapped) return disambiguate(mapped, hay);

  return matchNeedles(hay);
}

module.exports = {
  CATALOG,
  PROCESS_GAME_MAP,
  identifyGame,
  isJavaMinecraft,
};
