import { isShooterGame } from './games.js';

export const HW_SCAN_KEY = 'nf_hw_scan';
export const QUALITY_ORDER = ['potato', 'low', 'medium', 'high', 'ultra'];

const GPU_RULES = [
  { re: /rtx\s*50[89]0|rtx\s*4090|rtx\s*4080|rtx\s*6000|7900\s*xtx/i, score: 97 },
  { re: /rtx\s*5070|rtx\s*4070\s*ti|rtx\s*3090|rtx\s*3080\s*ti|7900\s*xt|7800\s*xt/i, score: 93 },
  { re: /rtx\s*4070|rtx\s*3080|rtx\s*3070\s*ti|rtx\s*2080\s*ti|7700\s*xt|6800\s*xt/i, score: 86 },
  { re: /rtx\s*4060\s*ti|rtx\s*3070|rtx\s*2080|rtx\s*2070\s*super|6700\s*xt|7600\s*xt|arc\s*a770/i, score: 78 },
  { re: /rtx\s*4060|rtx\s*3060\s*ti|rtx\s*2070|rtx\s*2060\s*super|6600\s*xt|7600|arc\s*a750/i, score: 68 },
  { re: /rtx\s*3060|rtx\s*2060|rtx\s*3050|gtx\s*1660|rx\s*6600|rx\s*6500|arc\s*a580|arc\s*b580/i, score: 54 },
  { re: /gtx\s*1650|gtx\s*1060|rx\s*580|rx\s*570|rx\s*6400|arc\s*a380|mx\s*570/i, score: 36 },
  { re: /gtx\s*1050|gtx\s*960|rx\s*560|mx\s*450|iris\s*xe|uhd\s*7[37]0/i, score: 24 },
  { re: /uhd|iris|hd graphics|graphics hd|adreno|mali|intel\(r\) hd/i, score: 12 },
];

const LIGHT_GAMES = new Set([
  'Minecraft', 'Valorant', 'League of Legends', 'Dota 2', 'Roblox', 'Rocket League',
  'CS2', 'Overwatch 2', 'Geometry Dash', 'Fall Guys', 'Meccha Chameleon',
]);
const HEAVY_GAMES = new Set([
  'Call of Duty: Warzone', 'Marvel Rivals', 'Helldivers 2', 'GTA Online', 'Palworld', 'PUBG',
]);

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function loadHwScan() {
  try {
    const raw = localStorage.getItem(HW_SCAN_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveHwScan(scan) {
  try {
    if (scan) localStorage.setItem(HW_SCAN_KEY, JSON.stringify(scan));
  } catch {
    /* quota */
  }
}

export function hwScanNote(scan) {
  if (!scan) return null;
  const bits = [];
  if (scan.gpu?.name) bits.push(scan.gpu.name);
  if (scan.cpu?.name) bits.push(scan.cpu.name.replace(/\s+/g, ' ').slice(0, 48));
  if (scan.ramGb) bits.push(`${scan.ramGb} GB RAM`);
  const { width, height, refreshHz } = scan.display || {};
  if (width && height) bits.push(`${width}×${height}${refreshHz ? `@${refreshHz}` : ''}`);
  return bits.length ? `PC specs: ${bits.join(' · ')}` : null;
}

export function scoreGpu(name) {
  const n = String(name || '');
  if (!n) return 20;
  for (const rule of GPU_RULES) {
    if (rule.re.test(n)) return rule.score;
  }
  if (/rtx\s*50/i.test(n)) return 92;
  if (/rtx/i.test(n)) return 74;
  if (/gtx/i.test(n)) return 34;
  if (/\brx\s*[67]/i.test(n)) return 66;
  if (/\brx\s*[45]/i.test(n)) return 38;
  return 28;
}

export function scoreCpu(cpu = {}) {
  const name = String(cpu.name || '');
  const cores = Number(cpu.cores) || 4;
  const threads = Number(cpu.threads) || cores;
  let score = 30;
  if (cores >= 16 || threads >= 24) score = 90;
  else if (cores >= 12 || threads >= 16) score = 80;
  else if (cores >= 8) score = 70;
  else if (cores >= 6) score = 62;
  else if (cores >= 4) score = 42;
  else score = 22;

  if (/(ryzen\s*[79]|core\s*i[79]|ultra\s*[79]|xeon|threadripper)/i.test(name)) score = Math.max(score, 80);
  else if (/(ryzen\s*5|core\s*i5|ultra\s*5)/i.test(name)) score = Math.max(score, 66);
  else if (/(ryzen\s*[34]|core\s*i[34]|pentium|celeron|athlon)/i.test(name)) score = Math.min(score, 48);
  if (/x3d/i.test(name)) score = Math.min(100, score + 12);

  const gen = name.match(/\b(12|13|14|15)th\b|\b(12|13|14|15)\d{2}\b|\b[79]\d{3}\b/i);
  if (gen) score = Math.min(100, score + 6);
  return clamp(score, 8, 98);
}

export function detectUpscaler(gpuName) {
  const n = String(gpuName || '').toLowerCase();
  if (/rtx\s*(20|21|30|40|50)/.test(n) || /rtx\s*a/.test(n)) return 'DLSS';
  if (/\barc\b/.test(n)) return 'XeSS';
  if (/\bradeon\b|\brx\s/.test(n)) return 'FSR';
  if (/nvidia|geforce|gtx/.test(n)) return 'FSR';
  return 'FSR';
}

export function gameLoad(game) {
  const g = String(game || '');
  if (LIGHT_GAMES.has(g)) return 'light';
  if (HEAVY_GAMES.has(g)) return 'heavy';
  return 'medium';
}

export function qualityFromScan(scan) {
  const gpu = scoreGpu(scan?.gpu?.name);
  const cpu = scoreCpu(scan?.cpu);
  const ramGb = Number(scan?.ramGb) || 8;
  const ram = ramGb >= 32 ? 92 : ramGb >= 16 ? 78 : ramGb >= 12 ? 55 : ramGb >= 8 ? 32 : 14;
  const combined = gpu * 0.64 + cpu * 0.22 + ram * 0.14;
  if (combined >= 80) return 'ultra';
  if (combined >= 64) return 'high';
  if (combined >= 46) return 'medium';
  if (combined >= 28) return 'low';
  return 'potato';
}

function raiseQuality(quality, steps = 1) {
  const i = QUALITY_ORDER.indexOf(quality);
  if (i < 0) return 'high';
  return QUALITY_ORDER[Math.min(QUALITY_ORDER.length - 1, i + steps)];
}

function pickResolution(display, visual, goal, load) {
  const w = Number(display?.width) || 1920;
  const h = Number(display?.height) || 1080;
  const native = `${w}×${h}`;
  if (visual === 'potato' && h >= 1440) {
    return { res: '1920×1080', why: '1080p is the floor on this GPU — skip 720p unless you are on iGPU.' };
  }
  if (load === 'heavy' && goal === 'competitive' && h >= 2160 && visual !== 'ultra') {
    return { res: '2560×1440', why: '1440p on a 4K screen keeps this heavy title in a high-FPS range.' };
  }
  if (load === 'heavy' && goal === 'competitive' && h >= 1440 && (visual === 'low' || visual === 'potato')) {
    return { res: '1920×1080', why: '1080p for this heavy title until the GPU is stronger.' };
  }
  if (visual === 'potato' && load === 'heavy' && h >= 1080) {
    return { res: '1920×1080', why: 'Stay native 1080p. 720p is only worth it on old iGPUs.' };
  }
  return { res: native, why: 'Native resolution — this GPU can drive this display.' };
}

function expectedFps(scan, game, visual, load) {
  const gpu = scoreGpu(scan?.gpu?.name);
  const h = Number(scan?.display?.height) || 1080;
  const hz = Number(scan?.display?.refreshHz) || 60;
  let pts = gpu;
  if (h >= 2160) pts -= 26;
  else if (h >= 1440) pts -= 10;
  if (load === 'light') pts += 22;
  if (load === 'heavy') pts -= 16;
  if (visual === 'ultra') pts -= 4;
  if (visual === 'potato' || visual === 'low') pts += 8;

  let range;
  if (pts >= 110) range = '400–600+';
  else if (pts >= 95) range = '300–500+';
  else if (pts >= 82) range = '200–350';
  else if (pts >= 70) range = '144–240';
  else if (pts >= 55) range = '100–165';
  else if (pts >= 40) range = '70–120';
  else range = '50–80';

  if (String(game) === 'Minecraft' && gpu >= 64) range = visual === 'potato' || visual === 'low' ? '250–400+' : '400–600+';
  if (String(game) === 'Valorant' && gpu >= 50) range = '400–600+';
  if (String(game) === 'League of Legends' && gpu >= 40) range = '300–500+';
  if (String(game) === 'Roblox' && gpu >= 50) range = '200–360';

  const cap = hz >= 144 ? `${hz} Hz or uncapped` : 'uncapped';
  return { range, cap };
}

function row(name, value) {
  return { name, value };
}

function upscaleValue(upscaler, visual, goal, load, height) {
  const h = Number(height) || 1080;
  if (!upscaler) return 'Off';
  if (load === 'light' && h <= 1080 && visual !== 'potato') return 'Off — native is cheaper than upscaling here';
  if (load !== 'heavy' && h <= 1080 && (visual === 'ultra' || visual === 'high')) return 'Off (native)';
  if (goal === 'competitive' && load === 'heavy') {
    if (visual === 'potato' || visual === 'low') return `${upscaler} Performance`;
    if (h >= 1440) return `${upscaler} Quality`;
    return `${upscaler} Quality or native`;
  }
  if (visual === 'ultra') return h >= 1440 ? `${upscaler} Quality` : 'Off (native)';
  if (visual === 'high') return h >= 1440 ? `${upscaler} Quality` : 'Off or Quality';
  if (visual === 'medium') return `${upscaler} Balanced`;
  return `${upscaler} Performance`;
}

function genericSettings(visual, goal, upscaler, load, height) {
  const map = {
    potato: ['Low', 'Medium', 'Low', 'Low', 'Low', 'Off'],
    low: ['Medium', 'High', 'Low', 'Medium', 'Low', 'Off'],
    medium: ['High', 'High', 'Medium', 'Medium', 'Medium', 'Off'],
    high: ['High', 'Ultra', 'High', 'High', 'High', 'Off'],
    ultra: ['Ultra', 'Ultra', 'Ultra', 'Ultra', 'High', goal === 'quality' ? 'Optional' : 'Off'],
  };
  const [preset, tex, shadowsLooks, effectsLooks, foliageLooks, rt] = map[visual] || map.high;
  const competitiveVis = goal === 'competitive';
  return [
    row('Overall quality', preset),
    row('Textures', tex),
    row('Shadows', competitiveVis ? (load === 'light' ? 'Low (visibility)' : (visual === 'ultra' ? 'Medium' : 'Low')) : shadowsLooks),
    row('Effects / particles', competitiveVis && load !== 'light' ? 'Medium' : effectsLooks),
    row('Foliage / extra objects', competitiveVis && load === 'heavy' ? 'Medium' : foliageLooks),
    row('Anti-aliasing', competitiveVis ? (visual === 'potato' ? 'FXAA' : 'SMAA / TAA Low') : (visual === 'potato' ? 'FXAA' : 'TAA / SMAA')),
    row('Upscaling', upscaleValue(upscaler, visual, goal, load, height)),
    row('Ray tracing / path tracing', competitiveVis ? 'Off' : rt),
    row('VSync', 'Off'),
    row('NVIDIA Reflex / Anti-Lag', 'On + Boost if available'),
    row('Motion blur / film grain / chromatic', 'Off'),
  ];
}

function gameOverrides(game, visual, goal, upscaler, load, height) {
  const g = String(game || '');
  if (g === 'Valorant') {
    return [
      row('Material quality', goal === 'competitive' ? 'Low (player outlines stay cleaner)' : (visual === 'low' || visual === 'potato' ? 'Medium' : 'High')),
      row('Texture quality', visual === 'potato' ? 'Medium' : 'High'),
      row('Detail quality', goal === 'competitive' ? 'Low (visibility)' : (visual === 'ultra' ? 'High' : 'Medium')),
      row('UI quality', 'High'),
      row('Vignette / bloom / distortion / MSAA', goal === 'competitive' ? 'Off / None' : 'Off / 2x if you want it'),
      row('NVIDIA Reflex', 'On + Boost'),
      row('VSync', 'Off'),
      row('FPS cap', 'Uncapped — this title will sit far above your refresh rate'),
    ];
  }
  if (g === 'CS2') {
    return [
      row('Global shadow quality', goal === 'competitive' ? 'Low (visibility)' : (visual === 'ultra' ? 'High' : 'Medium')),
      row('Model / texture detail', visual === 'potato' ? 'Medium' : 'High'),
      row('Shader detail', visual === 'ultra' || visual === 'high' ? 'High' : 'Low'),
      row('Particle detail', goal === 'competitive' ? 'Low' : 'High'),
      row('Ambient occlusion', goal === 'competitive' ? 'Disabled' : 'Medium'),
      row('FidelityFX / upscaling', load === 'light' && height <= 1080 ? 'Disabled (native)' : upscaleValue(upscaler, visual, goal, load, height)),
      row('NVIDIA Reflex', 'Enabled'),
      row('Boost Player Contrast', 'Enabled'),
      row('FPS cap', 'Uncapped, or 3 under monitor Hz'),
    ];
  }
  if (g === 'Minecraft') {
    const chunks = {
      potato: '12–16',
      low: '16–20',
      medium: '24–28',
      high: '32',
      ultra: '32',
    }[visual] || '32';
    const sim = visual === 'ultra' || visual === 'high' ? '12–16' : visual === 'medium' ? '12' : '8';
    return [
      row('Graphics', visual === 'potato' ? 'Fast' : (goal === 'quality' && (visual === 'ultra' || visual === 'high') ? 'Fabulous' : 'Fancy')),
      row('Render distance', `${chunks} chunks — this GPU is not the limit even at 32`),
      row('Simulation distance', `${sim} chunks`),
      row('Max FPS', 'Unlimited (expect hundreds of FPS at 32 chunks on this class of GPU)'),
      row('VSync', 'Off — cap at monitor Hz only if the GPU fan bothers you'),
      row('Graphics mods', 'Sodium / Iris if you already use Fabric — vanilla is still fine here'),
      row('Entity shadows / clouds', goal === 'competitive' ? 'On is fine; Off if you want a flatter view' : 'On'),
      row('Mipmap levels', visual === 'potato' ? '1' : '4'),
      row('Biome blend', visual === 'potato' || visual === 'low' ? '5×5' : '15×15'),
    ];
  }
  if (g === 'Fortnite' || g === 'Marvel Rivals') {
    const view = visual === 'potato' ? 'Medium' : visual === 'low' ? 'High' : 'Epic';
    return [
      row('View distance', view),
      row('Shadows', goal === 'competitive' ? 'Low' : (visual === 'ultra' ? 'High' : 'Medium')),
      row('Anti-aliasing & super resolution', upscaleValue(upscaler, visual, goal, load, height)),
      row('Textures', visual === 'potato' ? 'Medium' : 'High / Epic'),
      row('Effects', goal === 'competitive' ? 'Medium' : (visual === 'ultra' ? 'High' : 'Medium')),
      row('Post processing', goal === 'competitive' ? 'Low' : 'Medium'),
      row('Nanite / virtual shadows', goal === 'competitive' ? 'Off' : (visual === 'ultra' ? 'On' : 'Off')),
      row('Hardware ray tracing', goal === 'quality' && visual === 'ultra' && height <= 1080 ? 'Reflections only if you still have headroom' : 'Off'),
      row('NVIDIA Reflex', 'On + Boost'),
      row('FPS cap', goal === 'competitive' ? 'Uncapped or monitor Hz' : 'Match monitor Hz'),
    ];
  }
  if (g === 'Roblox') {
    return [
      row('Graphics mode', 'Manual'),
      row('Quality level', visual === 'ultra' || visual === 'high' ? '10' : visual === 'medium' ? '8' : visual === 'low' ? '5' : '3'),
      row('VSync', 'Off'),
      row('Frame rate cap', 'Maximum — this engine is CPU-light on modern PCs'),
    ];
  }
  if (g === 'League of Legends' || g === 'Dota 2') {
    return [
      row('Character quality', visual === 'potato' ? 'Medium' : 'High / Very High'),
      row('Environment / effects', goal === 'competitive' ? 'Medium (skillshots stay readable)' : 'High'),
      row('Shadows', goal === 'competitive' ? 'Low' : 'High'),
      row('Anti-aliasing', visual === 'potato' ? 'Off' : 'On'),
      row('Frame rate cap', 'Uncapped or monitor Hz'),
      row('VSync', 'Off'),
    ];
  }
  if (g === 'Call of Duty: Warzone' || g === 'Apex Legends' || g === 'PUBG' || g === 'Overwatch 2' || g === 'Halo Infinite' || g === 'Rainbow Six Siege' || g === 'Deadlock' || g === 'Helldivers 2') {
    return genericSettings(visual, goal, upscaler, load, height);
  }
  if (g === 'GTA Online' || g === 'Destiny 2' || g === 'Palworld' || g === 'Rocket League' || g === 'FIFA 25' || g === 'NBA 2K25') {
    return genericSettings(visual, goal, upscaler, load, height);
  }
  return genericSettings(visual, goal, upscaler, load, height);
}

const PRESET_LABEL = {
  potato: 'Low',
  low: 'Low–Medium',
  medium: 'Medium–High',
  high: 'High',
  ultra: 'Ultra / maxed',
};

export function defaultGoalForGame(game) {
  return isShooterGame(game) ? 'competitive' : 'quality';
}

function visualForGame(hardware, load, goal) {
  let visual = hardware;
  if (load === 'light') visual = raiseQuality(hardware, hardware === 'ultra' ? 0 : 1);
  if (load === 'heavy' && goal === 'competitive' && hardware === 'ultra') visual = 'high';
  if (load === 'heavy' && goal === 'competitive' && hardware === 'high') visual = 'high';
  return visual;
}

export function recommendSettings(scan, game, goal) {
  const hardware = qualityFromScan(scan);
  const want = goal === 'quality' ? 'quality' : 'competitive';
  const load = gameLoad(game);
  const visual = visualForGame(hardware, load, want);
  const upscaler = detectUpscaler(scan?.gpu?.name);
  const height = scan?.display?.height;
  const { res, why } = pickResolution(scan?.display, visual, want, load);
  const fps = expectedFps(scan, game, visual, load);
  const settings = gameOverrides(game, visual, want, upscaler, load, height);
  const warnings = [];
  const ramGb = Number(scan?.ramGb) || 0;
  if (ramGb && ramGb < 8) warnings.push('RAM is very low — close browsers before you play.');
  if (ramGb && ramGb < 12 && load === 'heavy') {
    warnings.push(`${game} wants 16 GB. Close Chrome if you hitch.`);
  }
  const disks = Array.isArray(scan?.disks) ? scan.disks : [];
  const hasSsd = disks.some((d) => /ssd|nvme|solid/i.test(`${d.media || ''} ${d.name || ''}`));
  const hasHdd = disks.some((d) => /^hdd$/i.test(String(d.media || '')));
  if (disks.length && !hasSsd && hasHdd) {
    warnings.push('No SSD detected — install the game on an SSD if you can.');
  }
  if (!scan?.gpu?.name) warnings.push('GPU was not identified — recommendations are conservative. Rescan on Windows.');
  if (scan?.platform && scan.platform !== 'win32') {
    warnings.push('Full GPU scan runs on Windows. These settings use CPU/RAM only.');
  }

  const headline = `${PRESET_LABEL[visual]} · expect ${fps.range} FPS`;

  return {
    hardware,
    visual,
    load,
    goal: want,
    headline,
    presetLabel: PRESET_LABEL[visual],
    resolution: res,
    resolutionWhy: why,
    fpsTarget: fps.range,
    fpsCap: fps.cap,
    upscaler,
    settings,
    warnings,
    summary: `${game} on this PC: ${headline} at ${res}.`,
  };
}

export function formatRecommendationText(scan, game, rec) {
  const lines = [
    `NexForge optimize — ${game} · ${rec.goal === 'competitive' ? 'Competitive' : 'Looks'}`,
    rec.summary,
    scan?.gpu?.name ? `GPU: ${scan.gpu.name}` : null,
    scan?.cpu?.name ? `CPU: ${scan.cpu.name}` : null,
    scan?.ramGb ? `RAM: ${scan.ramGb} GB` : null,
    `Resolution: ${rec.resolution}`,
    `Expected FPS: ${rec.fpsTarget}`,
    rec.fpsCap ? `Cap: ${rec.fpsCap}` : null,
    '',
    ...rec.settings.map((s) => `${s.name}: ${s.value}`),
    rec.warnings.length ? `\nNotes:\n${rec.warnings.map((w) => `- ${w}`).join('\n')}` : null,
  ];
  return lines.filter((l) => l != null).join('\n');
}
