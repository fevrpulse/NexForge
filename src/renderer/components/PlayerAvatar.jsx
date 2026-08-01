import React, { useMemo } from 'react';
import { avatarPublicUrl, avatarPreset, frameStyleKey, nameplateStyleKey } from '../lib/cosmetics.js';

function initialsFrom(tag) {
  return String(tag || '?').slice(0, 2).toUpperCase();
}

/**
 * Avatar with optional cosmetic frame.
 * Priority: uploaded photo → preset icon → initials.
 */
export default function PlayerAvatar({
  profile,
  size = 36,
  className = '',
  onClick,
  title,
  showPresence = false,
  online = false,
}) {
  const tag = profile?.gamer_tag || 'Player';
  const url = useMemo(() => avatarPublicUrl(profile?.avatar_path), [profile?.avatar_path]);
  const preset = useMemo(() => avatarPreset(profile?.avatar_preset), [profile?.avatar_preset]);
  const frame = frameStyleKey(profile?.equipped_frame);
  const animated = frame === 'pulse' || frame === 'spin' || frame === 'gold' || frame === 'void';

  return (
    <div
      className={`player-av-wrap frame-${frame} ${animated ? 'frame-animated' : ''} ${className}`}
      style={{ width: size, height: size }}
      onClick={onClick}
      title={title}
    >
      {url ? (
        <img className="player-av-img" src={url} alt="" />
      ) : preset ? (
        <div
          className="player-av player-av-fallback player-av-preset"
          style={{
            width: '100%',
            height: '100%',
            fontSize: Math.max(9, size * 0.28),
            background: `${preset.color}22`,
            color: preset.color,
          }}
        >
          {preset.mark}
        </div>
      ) : (
        <div className="player-av player-av-fallback" style={{ width: '100%', height: '100%', fontSize: Math.max(10, size * 0.32) }}>
          {initialsFrom(tag)}
        </div>
      )}
      {showPresence && online && <span className="presence-dot" />}
    </div>
  );
}

export function GamerTag({ profile, className = '' }) {
  const plate = nameplateStyleKey(profile?.equipped_nameplate);
  const clanTag = profile?.clan_tag ? String(profile.clan_tag).trim().toUpperCase() : '';
  return (
    <span className={`gamer-tag-text nameplate-${plate} ${className}`}>
      {clanTag ? <span className="clan-tag-prefix">[{clanTag}]</span> : null}
      {clanTag ? ' ' : ''}
      {profile?.gamer_tag || 'Player'}
    </span>
  );
}
