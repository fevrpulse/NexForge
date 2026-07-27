import React, { useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { isBuiltinGame } from '../lib/games.js';

export default function OnboardingModal() {
  const {
    user, profile, guestMode, refreshProfile, showToast,
    gameCatalog, syncCommunityGames,
  } = useNexForge();

  const [gameChoice, setGameChoice] = useState(profile?.main_game || 'Valorant');
  const [isOther, setIsOther] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [saving, setSaving] = useState(false);

  if (guestMode || !user || !profile || profile.onboarding_done !== false) return null;

  function onGameSelect(value) {
    setGameChoice(value);
    setIsOther(value === '__other__');
  }

  async function finish() {
    const game = isOther ? customName.trim() : gameChoice;
    const description = isOther ? (customDesc.trim() || null) : null;
    if (!game) {
      showToast('Enter your main game name.', 'error');
      return;
    }
    setSaving(true);
    const { error } = await sb.from('profiles')
      .update({
        main_game: game,
        main_game_description: description,
        onboarding_done: true,
      })
      .eq('id', user.id);
    setSaving(false);
    if (error) {
      showToast(error.message || 'Could not save profile.', 'error');
      return;
    }
    await refreshProfile();
    if (isOther || !isBuiltinGame(game)) {
      await syncCommunityGames(game);
    }
    showToast(`Welcome — main game set to ${game}`, 'success');
  }

  return (
    <div className="lock-modal">
      <div className="lock-box" style={{ maxWidth: 440, textAlign: 'left' }}>
        <h3 style={{ textAlign: 'center' }}>Welcome to NexForge</h3>
        <p style={{ textAlign: 'center', marginBottom: 18 }}>
          Pick your main game so matchmaking and squad finder can place you correctly.
        </p>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Main Game</label>
          <select value={isOther ? '__other__' : gameChoice} onChange={(e) => onGameSelect(e.target.value)}>
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
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Game name</label>
              <input
                type="text"
                maxLength={60}
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. Deadlock, Helldivers 2"
              />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Description (optional)</label>
              <input
                type="text"
                maxLength={280}
                value={customDesc}
                onChange={(e) => setCustomDesc(e.target.value)}
                placeholder="Ranked, casual, role, etc."
              />
            </div>
          </>
        )}
        <button className="auth-btn" style={{ marginTop: 8 }} onClick={finish} disabled={saving}>
          {saving ? 'Saving…' : 'Start Competing →'}
        </button>
      </div>
    </div>
  );
}
