// Rendering effort tiers. The <html data-fx> attribute is set before first
// paint by the boot script in index.html; this module keeps it in sync with
// the user's preference and with what the machine can actually sustain.

const KEY = 'nf-fx-tier';
const PROBED = 'nf-fx-probed';

export const TIERS = ['high', 'balanced', 'low'];

export const TIER_LABELS = {
  auto: 'Auto',
  high: 'High',
  balanced: 'Balanced',
  low: 'Low',
};

export const TIER_HINTS = {
  auto: 'Match effects to your hardware',
  high: 'Every effect, for strong GPUs',
  balanced: 'Full look, no heavy blur',
  low: 'Static — best for weak GPUs',
};

// Reduced-motion is deliberately not consulted: it means "less movement", not
// "weaker GPU". Stripping depth and colour from those users would be wrong, and
// the reduced-motion media queries already stop the animation.
export function detectTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (cores <= 2 || mem <= 2) return 'low';
  if (cores >= 8 && mem >= 8) return 'high';
  return 'balanced';
}

export function getPreference() {
  try {
    const v = localStorage.getItem(KEY);
    return TIERS.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function activeTier() {
  const v = document.documentElement.getAttribute('data-fx');
  return TIERS.includes(v) ? v : 'balanced';
}

export function setPreference(pref) {
  const tier = pref === 'auto' ? detectTier() : pref;
  try {
    if (pref === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* storage blocked */
  }
  document.documentElement.setAttribute('data-fx', tier);
  return tier;
}

// Core count says nothing about the GPU, so sample real frame rate once and
// step down if the machine can't hold a smooth rate. Only ever downgrades,
// only when the user hasn't chosen a tier, and only once per install.
export function probeFrameRate({ onDowngrade } = {}) {
  if (getPreference() !== 'auto') return () => {};
  try {
    if (localStorage.getItem(PROBED)) return () => {};
  } catch {
    return () => {};
  }

  const current = activeTier();
  if (current === 'low') return () => {};

  let raf = 0;
  let start = 0;
  let frames = 0;
  let cancelled = false;

  const SAMPLE_MS = 3000;
  const MIN_FPS = 40;

  // Browsers throttle rAF in hidden or occluded windows, which would look
  // exactly like a slow GPU. Any loss of visibility voids the sample.
  const abort = () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  document.addEventListener('visibilitychange', abort);

  const finish = (fps) => {
    try {
      localStorage.setItem(PROBED, String(Math.round(fps)));
    } catch {
      /* storage blocked */
    }
    if (fps >= MIN_FPS) return;
    const next = current === 'high' ? 'balanced' : 'low';
    document.documentElement.setAttribute('data-fx', next);
    onDowngrade?.(next, Math.round(fps));
  };

  const tick = (now) => {
    if (cancelled || document.hidden) return;
    if (!start) start = now;
    frames += 1;
    const elapsed = now - start;
    if (elapsed < SAMPLE_MS) {
      raf = requestAnimationFrame(tick);
      return;
    }
    // A throttled window yields far too few frames to judge; discard.
    if (frames < 30) return;
    finish((frames / elapsed) * 1000);
  };

  // Let the first render settle so startup work isn't counted as jank.
  const timer = setTimeout(() => {
    if (!document.hidden) raf = requestAnimationFrame(tick);
  }, 2500);

  return () => {
    cancelled = true;
    clearTimeout(timer);
    if (raf) cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', abort);
  };
}

export function resetProbe() {
  try {
    localStorage.removeItem(PROBED);
  } catch {
    /* storage blocked */
  }
}
