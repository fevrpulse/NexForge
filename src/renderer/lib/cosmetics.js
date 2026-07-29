import { SUPABASE_URL } from './supabase.js';

/** Public avatar URL from profiles.avatar_path, or null. */
export function avatarPublicUrl(avatarPath) {
  if (!avatarPath) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/avatars/${avatarPath}`;
}

/** Map equipped cosmetic id → style_key for CSS classes. */
export const FRAME_STYLES = {
  frame_none: 'none',
  frame_neon: 'neon',
  frame_ice: 'ice',
  frame_ember: 'ember',
  frame_void: 'void',
  frame_gold: 'gold',
  frame_pulse: 'pulse',
  frame_spin: 'spin',
};

export const AVATAR_PRESETS = [
  { id: 'forge', label: 'Forge', color: '#C9FF00', mark: 'NF' },
  { id: 'blade', label: 'Blade', color: '#FF3D1F', mark: 'BL' },
  { id: 'pulse', label: 'Pulse', color: '#3B7EFF', mark: 'PL' },
  { id: 'circuit', label: 'Circuit', color: '#4ade80', mark: 'CK' },
  { id: 'ember', label: 'Ember', color: '#FF8C42', mark: 'EM' },
  { id: 'frost', label: 'Frost', color: '#7dd3fc', mark: 'FR' },
  { id: 'void', label: 'Void', color: '#9B5CFF', mark: 'VD' },
];

export function avatarPreset(presetId) {
  return AVATAR_PRESETS.find((p) => p.id === presetId) || null;
}

export const BANNER_STYLES = {
  banner_none: 'none',
  banner_grid: 'grid',
  banner_aurora: 'aurora',
  banner_blaze: 'blaze',
  banner_legend: 'legend',
};

export const NAMEPLATE_STYLES = {
  plate_default: 'default',
  plate_neon: 'neon',
  plate_sky: 'sky',
  plate_rose: 'rose',
  plate_gold: 'gold',
};

export function frameStyleKey(equippedFrame) {
  return FRAME_STYLES[equippedFrame] || 'none';
}

export function bannerStyleKey(equippedBanner) {
  return BANNER_STYLES[equippedBanner] || 'none';
}

export function nameplateStyleKey(equippedNameplate) {
  return NAMEPLATE_STYLES[equippedNameplate] || 'default';
}
