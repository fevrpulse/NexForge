import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { mmrToSkillTag } from '../lib/ranks.js';
import PlayerAvatar from '../components/PlayerAvatar.jsx';

const SLOTS = [
  { id: 'frame', label: 'Frames' },
  { id: 'banner', label: 'Banners' },
  { id: 'nameplate', label: 'Nameplates' },
];

export default function Shop() {
  const { user, profile, refreshProfile, showToast, reportCloudError, guestMode } = useNexForge();
  const [catalog, setCatalog] = useState([]);
  const [owned, setOwned] = useState(new Set());
  const [slot, setSlot] = useState('frame');
  const [busyId, setBusyId] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [friendOptions, setFriendOptions] = useState([]);
  const [giftTarget, setGiftTarget] = useState(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [{ data: items, error }, { data: inv, error: invErr }] = await Promise.all([
        sb.from('cosmetics').select('*').order('price', { ascending: true }),
        sb.from('user_cosmetics').select('cosmetic_id').eq('user_id', user.id),
      ]);
      if (error) throw error;
      if (invErr) throw invErr;
      setCatalog(items || []);
      setOwned(new Set((inv || []).map((r) => r.cosmetic_id)));
    } catch (err) {
      await reportCloudError(err);
    }
  }, [user, reportCloudError]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const { data, error } = await sb
          .from('friendships')
          .select('requester_id,addressee_id,status')
          .eq('status', 'accepted');
        if (error) throw error;
        const otherIds = [...new Set(
          (data || []).map((r) => (r.requester_id === user.id ? r.addressee_id : r.requester_id)),
        )];
        if (!otherIds.length) {
          if (active) setFriendOptions([]);
          return;
        }
        const { data: profs, error: pErr } = await sb
          .from('profiles')
          .select('id,gamer_tag')
          .in('id', otherIds);
        if (pErr) throw pErr;
        if (active) setFriendOptions(profs || []);
      } catch (err) {
        await reportCloudError(err);
      }
    })();
    return () => { active = false; };
  }, [user, reportCloudError]);

  const filtered = useMemo(
    () => catalog.filter((c) => c.slot === slot),
    [catalog, slot],
  );

  const mmr = profile?.mmr || 1200;
  const coins = profile?.forge_coins ?? 0;
  const equipped = {
    frame: profile?.equipped_frame || 'frame_none',
    banner: profile?.equipped_banner || 'banner_none',
    nameplate: profile?.equipped_nameplate || 'plate_default',
  };

  function isOwned(item) {
    if (owned.has(item.id)) return true;
    if (item.price === 0 && item.min_mmr === 0) return true;
    if (item.price === 0 && mmr >= item.min_mmr) return true;
    return false;
  }

  async function buyOrEquip(item) {
    if (!user || busyId) return;
    setBusyId(item.id);
    try {
      if (!isOwned(item) && item.price > 0) {
        const { data, error } = await sb.rpc('buy_cosmetic', { p_cosmetic_id: item.id });
        if (error) throw error;
        if (data?.forge_coins != null) {
          showToast(`Purchased ${item.name} (−${item.price} coins)`, 'success');
        }
      }
      const { error: eqErr } = await sb.rpc('equip_cosmetic', { p_cosmetic_id: item.id });
      if (eqErr) throw eqErr;
      await refreshProfile();
      await load();
      showToast(`Equipped ${item.name}`, 'success');
    } catch (err) {
      showToast(err?.message || 'Shop action failed.', 'error');
      await reportCloudError(err);
    } finally {
      setBusyId(null);
    }
  }

  function openGiftPicker(item) {
    if (!friendOptions.length) {
      showToast('Add friends first to gift cosmetics.', 'error');
      return;
    }
    setGiftTarget({ cosmetic: item });
  }

  async function giftCosmetic(friendId, item) {
    if (!user || busyId) return;
    setBusyId(item.id);
    try {
      const { error } = await sb.rpc('gift_cosmetic', {
        p_friend_id: friendId,
        p_cosmetic_id: item.id,
      });
      if (error) throw error;
      await refreshProfile();
      await load();
      const friend = friendOptions.find((f) => f.id === friendId);
      showToast(`Gifted ${item.name} to ${friend?.gamer_tag || 'friend'}`, 'success');
      setGiftTarget(null);
    } catch (err) {
      showToast(err?.message || 'Gift failed.', 'error');
      await reportCloudError(err);
    } finally {
      setBusyId(null);
    }
  }

  async function claimDaily() {
    if (claiming) return;
    setClaiming(true);
    try {
      const { data, error } = await sb.rpc('claim_daily_forge_coins');
      if (error) throw error;
      await refreshProfile();
      showToast(`+${data?.gained || 50} Forge Coins claimed`, 'success');
    } catch (err) {
      showToast(err?.message || 'Could not claim daily coins.', 'error');
    } finally {
      setClaiming(false);
    }
  }

  if (guestMode) {
    return (
      <div className="card">
        <div className="card-title">Cosmetics Shop</div>
        <div className="friends-empty">Sign in to buy frames, banners, and nameplates.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="shop-hero card">
        <div className="shop-hero-left">
          <div className={`profile-banner banner-${(catalog.find((c) => c.id === equipped.banner)?.style_key) || 'none'}`}>
            <PlayerAvatar profile={profile} size={72} />
            <div>
              <div className="shop-preview-name">
                <span className={`gamer-tag-text nameplate-${(catalog.find((c) => c.id === equipped.nameplate)?.style_key) || 'default'}`}>
                  {profile?.gamer_tag || 'Player'}
                </span>
              </div>
              <div className="shop-preview-meta">
                {mmrToSkillTag(mmr)} · {mmr} MMR · {coins} Forge Coins
              </div>
            </div>
          </div>
        </div>
        <button className="action-btn primary" onClick={claimDaily} disabled={claiming}>
          {claiming ? 'Claiming…' : 'Claim +50 Daily Coins'}
        </button>
      </div>

      <div className="shop-tabs">
        {SLOTS.map((s) => (
          <button
            key={s.id}
            className={`shop-tab ${slot === s.id ? 'active' : ''}`}
            onClick={() => setSlot(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="shop-grid">
        {filtered.map((item) => {
          const ownedItem = isOwned(item);
          const lockedMmr = mmr < item.min_mmr;
          const canBuy = !lockedMmr && (item.price === 0 || coins >= item.price);
          const showGift = ownedItem || canBuy;
          const active = equipped[item.slot] === item.id;
          const giftingThis = giftTarget?.cosmetic?.id === item.id;
          return (
            <div key={item.id} className={`shop-card rarity-${item.rarity} ${active ? 'equipped' : ''}`}>
              <div className={`shop-card-preview slot-${item.slot} style-${item.style_key}`}>
                {item.slot === 'frame' && <PlayerAvatar profile={{ ...profile, equipped_frame: item.id }} size={48} />}
                {item.slot === 'banner' && <div className={`banner-swatch banner-${item.style_key}`} />}
                {item.slot === 'nameplate' && (
                  <span className={`gamer-tag-text nameplate-${item.style_key}`}>Aa</span>
                )}
              </div>
              <div className="shop-card-name">{item.name}</div>
              <div className="shop-card-desc">{item.description}</div>
              <div className="shop-card-meta">
                <span className={`rarity-pill rarity-${item.rarity}`}>{item.rarity}</span>
                {item.min_mmr > 0 && <span>{item.min_mmr}+ MMR</span>}
                <span>{item.price > 0 ? `${item.price} coins` : 'Free'}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className={`action-btn ${active ? 'ghost' : 'primary'} full`}
                  style={{ flex: 1 }}
                  disabled={!!busyId || lockedMmr || (item.price > 0 && !ownedItem && coins < item.price)}
                  onClick={() => buyOrEquip(item)}
                >
                  {busyId === item.id && !giftingThis
                    ? '…'
                    : lockedMmr
                      ? `Need ${item.min_mmr} MMR`
                      : active
                        ? 'Equipped'
                        : ownedItem || item.price === 0
                          ? 'Equip'
                          : `Buy · ${item.price}`}
                </button>
                {showGift && (
                  <button
                    type="button"
                    className="action-btn ghost"
                    style={{ padding: '8px 10px', fontSize: 11, flexShrink: 0 }}
                    disabled={!!busyId}
                    onClick={() => openGiftPicker(item)}
                  >
                    Gift
                  </button>
                )}
              </div>
              {giftingThis && (
                <div className="shop-gift-panel">
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted2)', marginBottom: 8 }}>
                    Gift {item.name} to:
                  </div>
                  {friendOptions.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="shop-gift-friend"
                      disabled={!!busyId}
                      onClick={() => giftCosmetic(f.id, item)}
                    >
                      {f.gamer_tag}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="action-btn ghost"
                    style={{ padding: '6px 10px', fontSize: 10, marginTop: 4, width: '100%' }}
                    onClick={() => setGiftTarget(null)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
