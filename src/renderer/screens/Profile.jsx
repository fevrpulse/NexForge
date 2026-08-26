import React, { useRef, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { AVATAR_PRESETS, bannerStyleKey } from '../lib/cosmetics.js';
import PlayerAvatar, { GamerTag } from '../components/PlayerAvatar.jsx';
import { isBuiltinGame } from '../lib/games.js';
import VerifiedStatsPanel from '../components/VerifiedStatsPanel.jsx';

export default function Profile() {
  const { user, profile, refreshProfile, showToast, gameCatalog, knownGames, syncCommunityGames } = useNexForge();
  const [editing, setEditing] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [displayDraft, setDisplayDraft] = useState('');
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [gameChoice, setGameChoice] = useState(profile?.main_game || 'Valorant');
  const [isOther, setIsOther] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef(null);

  if (!profile) return null;

  function openEdit() {
    const game = profile.main_game || 'Valorant';
    if (knownGames.includes(game)) {
      setGameChoice(game);
      setIsOther(false);
      setCustomName('');
      setCustomDesc('');
    } else {
      setGameChoice('__other__');
      setIsOther(true);
      setCustomName(game);
      setCustomDesc(profile.main_game_description || '');
    }
    setEditing(true);
  }

  function openIdentityEdit() {
    setUsernameDraft(profile.gamer_tag || '');
    setDisplayDraft(profile.display_name || '');
    setEditingIdentity(true);
  }

  async function saveIdentity() {
    const tag = String(usernameDraft || '').trim();
    if (tag.length < 3) {
      showToast('Username must be at least 3 characters.', 'error');
      return;
    }
    setSavingIdentity(true);
    const { error } = await sb.rpc('update_profile_identity', {
      p_gamer_tag: tag,
      p_display_name: displayDraft.trim() || null,
    });
    setSavingIdentity(false);
    if (error) {
      showToast(error.message || 'Could not update name.', 'error');
      return;
    }
    await refreshProfile();
    setEditingIdentity(false);
    showToast('Profile name updated', 'success');
  }

  function onGameSelect(value) {
    setGameChoice(value);
    setIsOther(value === '__other__');
  }

  async function saveMainGame() {
    const game = isOther ? customName.trim() : gameChoice;
    const description = isOther ? (customDesc.trim() || null) : null;
    if (!game) {
      showToast('Enter your game name for Other.', 'error');
      return;
    }
    setSaving(true);
    const { error } = await sb.from('profiles')
      .update({ main_game: game, main_game_description: description })
      .eq('id', user.id);
    setSaving(false);
    if (error) {
      showToast(error.message || 'Could not save main game.', 'error');
      return;
    }
    await refreshProfile();
    if (isOther || !isBuiltinGame(game)) {
      const live = await syncCommunityGames(game);
      const unlocked = (live || []).some(
        (g) => String(g.name || '').toLowerCase() === game.toLowerCase(),
      );
      showToast(
        unlocked
          ? `${game} is now in the Community catalog for everyone.`
          : `Main game set to ${game}. It joins matchmaking when enough players pick it (5+).`,
        'success',
      );
    } else {
      showToast(`Main game updated to ${game}`, 'success');
    }
    setEditing(false);
  }

  async function pickAvatar(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      showToast('Only PNG, JPEG, or WebP images are allowed.', 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('Image must be 2 MB or smaller.', 'error');
      return;
    }
    setUploadingAvatar(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await sb.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { error } = await sb.from('profiles')
        .update({ avatar_path: path, avatar_preset: null })
        .eq('id', user.id);
      if (error) throw error;
      await refreshProfile();
      showToast('Profile photo updated', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not upload photo.', 'error');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function removeAvatar() {
    const prev = profile.avatar_path;
    setUploadingAvatar(true);
    try {
      const { error } = await sb.from('profiles')
        .update({ avatar_path: null })
        .eq('id', user.id);
      if (error) throw error;
      if (prev) {
        sb.storage.from('avatars').remove([prev]).catch(() => {});
      }
      await refreshProfile();
      showToast('Profile photo removed', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not remove photo.', 'error');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function selectAvatarPreset(presetId) {
    setUploadingAvatar(true);
    try {
      const prev = profile.avatar_path;
      const { error } = await sb.from('profiles')
        .update({ avatar_preset: presetId, avatar_path: null })
        .eq('id', user.id);
      if (error) throw error;
      if (prev) {
        sb.storage.from('avatars').remove([prev]).catch(() => {});
      }
      await refreshProfile();
      const label = AVATAR_PRESETS.find((p) => p.id === presetId)?.label || presetId;
      showToast(`Avatar preset: ${label}`, 'success');
    } catch (err) {
      showToast(err?.message || 'Could not apply preset.', 'error');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function clearAvatarPreset() {
    setUploadingAvatar(true);
    try {
      const { error } = await sb.from('profiles')
        .update({ avatar_preset: null })
        .eq('id', user.id);
      if (error) throw error;
      await refreshProfile();
      showToast('Avatar preset cleared', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not clear preset.', 'error');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function toggleHideMatchHistory(next) {
    setSavingPrivacy(true);
    const { error } = await sb.from('profiles')
      .update({ hide_match_history: next })
      .eq('id', user.id);
    setSavingPrivacy(false);
    if (error) {
      showToast(error.message || 'Could not update privacy setting.', 'error');
      return;
    }
    await refreshProfile();
    showToast(
      next ? 'Session history hidden from friends' : 'Session history visible to friends',
      'success',
    );
  }

  const since = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '—';

  return (
    <div>
      <div className={`profile-hero banner-${bannerStyleKey(profile.equipped_banner)}`}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <PlayerAvatar profile={profile} size={84} />
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={pickAvatar}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              className="action-btn ghost"
              style={{ padding: '6px 10px', fontSize: 11 }}
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
            >
              {uploadingAvatar ? '…' : 'Change photo'}
            </button>
            {profile.avatar_path && (
              <button
                type="button"
                className="action-btn ghost"
                style={{ padding: '6px 10px', fontSize: 11 }}
                onClick={removeAvatar}
                disabled={uploadingAvatar}
              >
                Remove
              </button>
            )}
          </div>
          <div className="avatar-preset-row" style={{ justifyContent: 'center' }}>
            {AVATAR_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`avatar-preset-btn ${profile.avatar_preset === p.id ? 'active' : ''}`}
                style={{ background: `${p.color}22`, color: p.color }}
                title={p.label}
                disabled={uploadingAvatar}
                onClick={() => selectAvatarPreset(p.id)}
              >
                {p.mark}
              </button>
            ))}
          </div>
          {profile.avatar_preset && (
            <button
              type="button"
              className="action-btn ghost"
              style={{ padding: '4px 8px', fontSize: 10, marginTop: 4 }}
              onClick={clearAvatarPreset}
              disabled={uploadingAvatar}
            >
              Clear preset
            </button>
          )}
        </div>
        <div>
          <div className="profile-name"><GamerTag profile={profile} showUsername /></div>
          <div className="profile-sub">
            @{profile.gamer_tag || 'player'} · Member since {since} · {profile.platform || 'PC'} · {profile.main_game || '—'}
          </div>
          <div className="profile-tags">
            <span className="badge badge-muted">{profile.platform || 'PC'}</span>
            {profile.main_game ? <span className="badge badge-blue">{profile.main_game}</span> : null}
          </div>
        </div>
      </div>

      <VerifiedStatsPanel />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Username &amp; Display name</div>
        {!editingIdentity ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                {String(profile.display_name || '').trim() || profile.gamer_tag || '—'}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', marginTop: 6, lineHeight: 1.5 }}>
                Username @{profile.gamer_tag || '—'}
                {String(profile.display_name || '').trim()
                  ? ' · Display name shown to others'
                  : ' · No display name — username is shown'}
              </div>
            </div>
            <button className="action-btn ghost" style={{ padding: '8px 14px', flexShrink: 0 }} onClick={openIdentityEdit}>
              Change
            </button>
          </div>
        ) : (
          <div>
            <div className="field">
              <label>Username</label>
              <input
                type="text"
                maxLength={20}
                value={usernameDraft}
                onChange={(e) => setUsernameDraft(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))}
                placeholder="Unique handle"
              />
              <div className="field-hint">3–20 letters, numbers, underscores. Used for friend search.</div>
            </div>
            <div className="field">
              <label>Display name</label>
              <input
                type="text"
                maxLength={32}
                value={displayDraft}
                onChange={(e) => setDisplayDraft(e.target.value.slice(0, 32))}
                placeholder="Optional name shown everywhere"
              />
              <div className="field-hint">Optional. Leave blank to show your username.</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="action-btn ghost full" onClick={() => setEditingIdentity(false)}>Cancel</button>
              <button type="button" className="action-btn primary full" onClick={saveIdentity} disabled={savingIdentity}>
                {savingIdentity ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Main Game</div>
        {!editing ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{profile.main_game || '—'}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', marginTop: 6, lineHeight: 1.5 }}>
                {profile.main_game_description || 'No description'}
              </div>
            </div>
            <button className="action-btn ghost" style={{ padding: '8px 14px', flexShrink: 0 }} onClick={openEdit}>
              Change
            </button>
          </div>
        ) : (
          <div>
            <div className="field">
              <label>Main Game</label>
              <select value={gameChoice} onChange={(e) => onGameSelect(e.target.value)}>
                {gameCatalog.map((group) => (
                  <optgroup label={group.category} key={group.category}>
                    {group.games.map((g) => <option value={g} key={g}>{g}</option>)}
                  </optgroup>
                ))}
                <optgroup label="Not listed">
                  <option value="__other__">Other — type your own</option>
                </optgroup>
              </select>
            </div>
            {isOther && (
              <>
                <div className="field">
                  <label>Game name</label>
                  <input
                    type="text" maxLength={60} placeholder="e.g. Deadlock, Helldivers 2"
                    value={customName} onChange={(e) => setCustomName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Description (optional)</label>
                  <textarea
                    maxLength={280} placeholder="What do you usually play — ranked, casual, role, etc."
                    value={customDesc} onChange={(e) => setCustomDesc(e.target.value)}
                  />
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="action-btn ghost full" onClick={() => setEditing(false)}>Cancel</button>
              <button className="action-btn primary full" onClick={saveMainGame} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Privacy</div>
        <div className="row" style={{ borderBottom: 'none' }}>
          <span>Hide session history from friends</span>
          <label style={{ cursor: savingPrivacy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={!!profile.hide_match_history}
              disabled={savingPrivacy}
              onChange={(e) => toggleHideMatchHistory(e.target.checked)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
