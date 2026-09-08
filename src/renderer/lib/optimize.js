import { isShooterGame } from './games.js';

export const HW_SCAN_KEY = 'nf_hw_scan';
export const QUALITY_ORDER = ['potato', 'low', 'medium', 'high', 'ultra'];

const GPU_RULES = [
  { re: /rtx\s*50[89]0|rtx\s*4090|rtx\s*4080|rtx\s*6000|7900\s*xtx/i, score: 97 },
  { re: /rtx\s*5070|rtx\s*4070\s*ti|rtx\s*3090|rtx\s*3080\s*ti|7900\s*xt|7800\s*xt/i, score: 90 },
  { re: /rtx\s*4070|rtx\s*3080|rtx\s*3070\s*ti|rtx\s*2080\s*ti|7700\s*xt|6800\s*xt/i, score: 82 },
  { re: /rtx\s*4060\s*ti|rtx\s*3070|rtx\s*2080|rtx\s*2070\s*super|6700\s*xt|7600\s*xt|arc\s*a770/i, score: 74 },
  { re: /rtx\s*4060|rtx\s*3060\s*ti|rtx\s*2070|rtx\s*2060\s*super|6600\s*xt|7600|arc\s*a750/i, score: 64 },
  { re: /rtx\s*3060|rtx\s*2060|rtx\s*3050|gtx\s*1660|rx\s*6600|rx\s*6500|arc\s*a580|arc\s*b580/i, score: 52 },
  { re: /gtx\s*1650|gtx\s*1060|rx\s*580|rx\s*570|rx\s*6400|arc\s*a380|mx\s*570/i, score: 36 },
  { re: /gtx\s*1050|gtx\s*960|rx\s*570|rx\s*560|mx\s*450|iris\s*xe|uhd\s*7[37]0/i, score: 24 },
  { re: /uhd|iris|hd graphics|graphics hd|adreno|mali|intel\(r\) hd/i, score: 12 },
];

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
  if (/rtx/i.test(n)) return 70;
  if (/gtx/i.test(n)) return 34;
  if (/\brx\s*[67]/i.test(n)) return 62;
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
  else if (cores >= 8) score = 68;
  else if (cores >= 6) score = 55;
  else if (cores >= 4) score = 40;
  else score = 22;

  if (/(ryzen\s*[79]|core\s*i[79]|ultra\s*[79]|xeon|threadripper)/i.test(name)) score = Math.max(score, 78);
  else if (/(ryzen\s*5|core\s*i5|ultra\s*5)/i.test(name)) score = Math.max(score, 60);
  else if (/(ryzen\s*[34]|core\s*i[34]|pentium|celeron|athlon)/i.test(name)) score = Math.min(score, 48);
  if (/x3d/i.test(name)) score = Math.min(100, score + 10);

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

export function qualityFromScan(scan) {
  const gpu = scoreGpu(scan?.gpu?.name);
  const cpu = scoreCpu(scan?.cpu);
  const ramGb = Number(scan?.ramGb) || 8;
  const ram = ramGb >= 32 ? 90 : ramGb >= 16 ? 70 : ramGb >= 12 ? 50 : ramGb >= 8 ? 32 : 14;
  const combined = gpu * 0.62 + cpu * 0.22 + ram * 0.16;
  if (combined >= 86) return 'ultra';
  if (combined >= 68) return 'high';
  if (combined >= 48) return 'medium';
  if (combined >= 30) return 'low';
  return 'potato';
}

function dropQuality(quality, steps = 1) {
  const i = QUALITY_ORDER.indexOf(quality);
  if (i < 0) return 'medium';
  return QUALITY_ORDER[Math.max(0, i - steps)];
}

function nativeLabel(display = {}) {
  const w = Number(display.width);
  const h = Number(display.height);
  if (w > 0 && h > 0) return `${w}×${h}`;
  return '1920×1080';
}

function pickResolution(display, visual, goal) {
  const w = Number(display?.width) || 1920;
  const h = Number(display?.height) || 1080;
  const native = `${w}×${h}`;
  if (goal === 'competitive') {
    if (h >= 2160 && visual !== 'ultra') return { res: '1920×1080', why: '1080p keeps frame time low on a 4K screen.' };
    if (h >= 1440 && (visual === 'potato' || visual === 'low' || visual === 'medium')) {
      return { res: '1920×1080', why: '1080p on this 1440p display for a higher competitive frame rate.' };
    }
    return { res: native, why: 'Use native resolution so aiming stays sharp.' };
  }
  if (visual === 'potato' && h >= 1080) return { res: '1280×720', why: '720p is the reliable floor on this machine.' };
  if ((visual === 'low' || visual === 'potato') && h >= 1440) {
    return { res: '1920×1080', why: '1080p is smoother than native on this GPU.' };
  }
  if (visual === 'medium' && h >= 2160) return { res: '2560×1440', why: '1440p with upscaling looks better than a 4K smear.' };
  return { res: native, why: 'Native resolution for this display.' };
}

function fpsTarget(display, visual, goal) {
  const hz = Number(display?.refreshHz) || 60;
  if (goal === 'competitive') {
    if (visual === 'ultra' || visual === 'high') return hz >= 200 ? `${Math.min(hz, 360)}+` : hz >= 120 ? '144+' : 'uncapped';
    if (visual === 'medium') return hz >= 120 ? '120–144' : '60–90';
    return '60–90';
  }
  if (visual === 'potato' || visual === 'low') return '60';
  return hz >= 120 ? String(Math.min(hz, 144)) : '60';
}

function row(name, value) {
  return { name, value };
}

function upscaleValue(upscaler, visual, goal) {
  if (!upscaler) return 'Off';
  if (goal === 'competitive') {
    if (visual === 'potato' || visual === 'low') return `${upscaler} Performance`;
    if (visual === 'medium') return `${upscaler} Balanced`;
    return `${upscaler} Quality`;
  }
  if (visual === 'ultra') return `${upscaler} Quality / native`;
  if (visual === 'high') return `${upscaler} Quality`;
  if (visual === 'medium') return `${upscaler} Balanced`;
  return `${upscaler} Performance`;
}

function genericSettings(visual, goal, upscaler) {
  const map = {
    potato: ['Low', 'Low', 'Low', 'Off', 'Low', 'Off'],
    low: ['Low', 'Medium', 'Low', 'Low', 'Low', 'Off'],
    medium: ['Medium', 'Medium', 'Medium', 'Medium', 'Low', 'Off'],
    high: ['High', 'High', 'High', 'Medium', 'Medium', 'On'],
    ultra: ['Ultra', 'Ultra', 'Ultra', 'High', 'High', 'On'],
  };
  const [preset, tex, shadows, effects, foliage, rt] = map[visual] || map.medium;
  const vsync = goal === 'competitive' ? 'Off' : (visual === 'ultra' ? 'On (or Reflex + Boost)' : 'Off');
  return [
    row('Overall quality', preset),
    row('Textures', tex),
    row('Shadows', goal === 'competitive' ? (visual === 'ultra' ? 'Medium' : 'Low') : shadows),
    row('Effects / particles', goal === 'competitive' ? 'Low–Medium' : effects),
    row('Foliage / extra objects', goal === 'competitive' ? 'Low' : foliage),
    row('Anti-aliasing', goal === 'competitive' ? 'Low / FXAA' : (visual === 'low' || visual === 'potato' ? 'FXAA' : 'TAA / SMAA')),
    row('Upscaling', upscaleValue(upscaler, visual, goal)),
    row('Ray tracing / path tracing', goal === 'competitive' ? 'Off' : rt),
    row('VSync', vsync),
    row('Motion blur / film grain / chromatic', 'Off'),
  ];
}

function shooterExtras(visual, goal) {
  return [
    row('NVIDIA Reflex / Anti-Lag / Xe Low Latency', 'On + Boost if you have it'),
    row('Frame generation', goal === 'competitive' ? 'Off (adds latency)' : (visual === 'ultra' || visual === 'high' ? 'Optional' : 'Off')),
    row('Multithreaded rendering', 'On'),
  ];
}

function gameOverrides(game, visual, goal, upscaler) {
  const g = String(game || '');
  if (g === 'Valorant') {
    return [
      row('Material quality', visual === 'ultra' ? 'High' : visual === 'high' ? 'High' : 'Low'),
      row('Texture quality', visual === 'potato' || visual === 'low' ? 'Low' : 'High'),
      row('Detail quality', goal === 'competitive' ? 'Low' : (visual === 'ultra' ? 'High' : 'Medium')),
      row('UI quality', 'Medium'),
      row('Vignette / bloom / distortion', 'Off'),
      row('Anti-aliasing', 'None or MSAA 2x if you have frames to spare'),
      row('NVIDIA Reflex', 'On + Boost'),
      row('VSync', 'Off'),
      row('Limit FPS', 'Uncapped, or cap 3 under your monitor Hz'),
    ];
  }
  if (g === 'CS2') {
    return [
      row('Global shadow quality', goal === 'competitive' ? 'Low' : (visual === 'ultra' ? 'High' : 'Medium')),
      row('Model / texture detail', visual === 'potato' ? 'Low' : 'High'),
      row('Shader detail', visual === 'ultra' ? 'High' : 'Low'),
      row('Particle detail', 'Low'),
      row('Ambient occlusion', goal === 'competitive' ? 'Disabled' : 'Medium'),
      row('HDR / FidelityFX', goal === 'competitive' ? 'Performance' : 'Quality'),
      row('NVIDIA Reflex', 'Enabled'),
      row('VSync / MSAA', 'Off / 2x if frames allow'),
      row('Boost Player Contrast', 'Enabled'),
    ];
  }
  if (g === 'Fortnite' || g === 'Marvel Rivals' || g === 'The Finals') {
    return [
      row('View distance', visual === 'potato' ? 'Medium' : 'Epic'),
      row('Shadows', goal === 'competitive' ? 'Off / Low' : (visual === 'ultra' ? 'High' : 'Medium')),
      row('Anti-aliasing & super resolution', upscaleValue(upscaler, visual, goal)),
      row('Textures', visual === 'potato' ? 'Low' : visual === 'low' ? 'Medium' : 'High'),
      row('Effects', goal === 'competitive' ? 'Low' : (visual === 'ultra' ? 'High' : 'Medium')),
      row('Post processing', 'Low'),
      row('Nanite / virtual shadows', goal === 'competitive' ? 'Off' : (visual === 'ultra' ? 'On' : 'Off')),
      row('Hardware ray tracing', 'Off unless you are on Ultra Looks'),
      row('NVIDIA Reflex', 'On + Boost'),
    ];
  }
  if (g === 'Call of Duty: Warzone' || g === 'Apex Legends' || g === 'PUBG' || g === 'Overwatch 2' || g === 'Halo Infinite' || g === 'Rainbow Six Siege' || g === 'Deadlock' || g === 'Helldivers 2') {
    return [
      ...genericSettings(visual, goal, upscaler).slice(0, 8),
      row('NVIDIA Reflex / Anti-Lag', 'On'),
      row('Spot / weapon shadows', goal === 'competitive' ? 'Off' : 'Low'),
      row('On-demand texture streaming', visual === 'potato' || visual === 'low' ? 'Low / Off' : 'Normal'),
    ];
  }
  if (g === 'Minecraft') {
    return [
      row('Graphics', visual === 'potato' || visual === 'low' ? 'Fast' : 'Fancy'),
      row('Render distance', visual === 'ultra' ? '16–24 chunks' : visual === 'high' ? '12–16' : visual === 'medium' ? '8–12' : '6–8'),
      row('Simulation distance', visual === 'high' || visual === 'ultra' ? '12' : '8'),
      row('Max FPS', goal === 'competitive' ? 'Uncapped / VSync off' : 'Match monitor'),
      row('VSync', 'Off'),
      row('Graphics backend', 'Sodium / Iris if you use mods — otherwise Fabulous only on Ultra'),
      row('Entity shadows / clouds', goal === 'competitive' ? 'Off / Fast' : 'On'),
      row('Mipmaps', visual === 'potato' ? 'Off' : 'On'),
    ];
  }
  if (g === 'Roblox') {
    return [
      row('Graphics mode', 'Manual'),
      row('Quality level', visual === 'ultra' ? '10' : visual === 'high' ? '8' : visual === 'medium' ? '5' : visual === 'low' ? '3' : '1'),
      row('VSync', 'Off'),
      row('Frame rate cap', goal === 'competitive' ? 'Max your display' : '60–120'),
    ];
  }
  if (g === 'GTA Online' || g === 'Destiny 2' || g === 'Palworld' || g === 'League of Legends' || g === 'Dota 2' || g === 'Rocket League' || g === 'FIFA 25' || g === 'NBA 2K25') {
    const extra = g === 'League of Legends' || g === 'Dota 2'
      ? [row('Shadows', 'Low'), row('Character quality', visual === 'potato' ? 'Low' : 'High'), row('Effects quality', goal === 'competitive' ? 'Low' : 'High')]
      : [];
    return [...genericSettings(visual, goal, upscaler), ...extra];
  }
  return genericSettings(visual, goal, upscaler);
}

const PRESET_LABEL = {
  potato: 'Low (performance)',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  ultra: 'Ultra',
};

export function defaultGoalForGame(game) {
  return isShooterGame(game) ? 'competitive' : 'quality';
}

export function recommendSettings(scan, game, goal) {
  const hardware = qualityFromScan(scan);
  const want = goal === 'quality' ? 'quality' : 'competitive';
  const visual = want === 'competitive' ? dropQuality(hardware, hardware === 'ultra' ? 1 : (hardware === 'high' ? 1 : 0)) : hardware;
  const upscaler = detectUpscaler(scan?.gpu?.name);
  const { res, why } = pickResolution(scan?.display, visual, want);
  const fps = fpsTarget(scan?.display, visual, want);
  const settings = gameOverrides(game, visual, want, upscaler);
  const warnings = [];
  const ramGb = Number(scan?.ramGb) || 0;
  if (ramGb && ramGb < 12) warnings.push('RAM is tight — close browsers and overlays other than NexForge before you queue.');
  if (ramGb && ramGb < 16 && /Warzone|GTA|Palworld|Helldivers|Marvel Rivals/i.test(String(game))) {
    warnings.push(`${game} likes 16 GB+. Close Chrome and Discord hardware accel if you hitch.`);
  }
  const disks = Array.isArray(scan?.disks) ? scan.disks : [];
  const hasSsd = disks.some((d) => /ssd|nvme|solid/i.test(`${d.media || ''} ${d.name || ''}`));
  const hasHdd = disks.some((d) => /hdd|unspecified|hdd/i.test(String(d.media || '')));
  if (disks.length && !hasSsd && hasHdd) {
    warnings.push('No SSD detected — install the game on an SSD if you can. HDDs stutter in modern titles.');
  }
  if (!scan?.gpu?.name) warnings.push('GPU was not identified — recommendations are conservative. Rescan on Windows.');
  if (scan?.platform && scan.platform !== 'win32') {
    warnings.push('Full GPU scan runs on Windows. These settings use CPU/RAM only.');
  }

  const headline = want === 'competitive'
    ? `${PRESET_LABEL[visual]} · aim for ${fps} FPS`
    : `${PRESET_LABEL[visual]} · ${fps} FPS cap is enough`;

  return {
    hardware,
    visual,
    goal: want,
    headline,
    presetLabel: PRESET_LABEL[visual],
    resolution: res,
    resolutionWhy: why,
    fpsTarget: fps,
    upscaler,
    settings,
    warnings,
    summary: `${game} on this PC: ${headline}. Play at ${res}.`,
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
    `Frame target: ${rec.fpsTarget}`,
    '',
    ...rec.settings.map((s) => `${s.name}: ${s.value}`),
    rec.warnings.length ? `\nNotes:\n${rec.warnings.map((w) => `- ${w}`).join('\n')}` : null,
  ];
  return lines.filter((l) => l != null).join('\n');
}
