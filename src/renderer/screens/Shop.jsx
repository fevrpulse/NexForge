import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { mmrToSkillTag } from '../lib/ranks.js';
import PlayerAvatar from '../components/PlayerAvatar.jsx';

const SLOTS = [
  { id: 'frame', label: 'Frames' },
  { id: 'banner', label: 'Banners' },
  { id: 'nameplate', label: 'Nameplates' },
  { id: 'pass', label: 'Season Pass' },
];

export default function Shop() {
  const { user, profile, refreshProfile, showToast, reportCloudError, guestMode, refreshBattlePassXp } = useNexForge();
  const [catalog, setCatalog] = useState([]);
  const [owned, setOwned] = useState(new Set());
  const [slot, setSlot] = useState('frame');
  const [busyId, setBusyId] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [friendOptions, setFriendOptions] = useState([]);
  const [giftTarget, setGiftTarget] = useState(null);
  const [cashBusyId, setCashBusyId] = useState(null);
  const [pendingCash, setPendingCash] = useState(() => new Set());
  const [battlePass, setBattlePass] = useState(null);
  const [passBusy, setPassBusy] = useState(false);

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

  const loadBattlePass = useCallback(async () => {
    if (!user) return;
    try {
      const { data, error } = await sb.rpc('get_my_battle_pass');
      if (error) throw error;
      setBattlePass(data || null);
    } catch (err) {
      console.warn('get_my_battle_pass failed', err);
      setBattlePass(null);
    }
  }, [user]);

  useEffect(() => {
    if (slot === 'pass') loadBattlePass();
  }, [slot, loadBattlePass]);

  useEffect(() => {
    if (!user || pendingCash.size === 0) return undefined;
    let active = true;

    const checkPurchases = async () => {
      const pendingIds = [...pendingCash];
      const { data, error } = await sb
        .from('user_cosmetics')
        .select('cosmetic_id')
        .eq('user_id', user.id)
        .in('cosmetic_id', pendingIds);
      if (!active || error || !data?.length) return;

      const purchased = new Set(data.map((row) => row.cosmetic_id));
      setOwned((current) => new Set([...current, ...purchased]));
      setPendingCash((current) => {
        const next = new Set(current);
        purchased.forEach((id) => next.delete(id));
        return next;
      });
      purchased.forEach((id) => {
        const item = catalog.find((entry) => entry.id === id);
        showToast(`${item?.name || 'Ring'} unlocked — ready to equip`, 'success');
      });
      await refreshProfile();
    };

    checkPurchases();
    const timer = setInterval(checkPurchases, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [catalog, pendingCash, refreshProfile, showToast, user]);

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

  async function buyWithMoney(item) {
    if (!user || cashBusyId || isOwned(item)) return;
    setCashBusyId(item.id);
    try {
      const { data, error } = await sb.functions.invoke('create-ring-checkout', {
        body: { cosmeticId: item.id },
      });
      let payload = data;
      if (error) {
        let detail = error.message || 'Could not start secure checkout.';
        try {
          if (error.context && typeof error.context.json === 'function') {
            payload = await error.context.json();
          } else if (typeof data === 'object' && data?.error) {
            payload = data;
          }
        } catch { /* keep generic detail */ }
        throw new Error(payload?.error || detail);
      }
      if (!payload?.url) throw new Error(payload?.error || 'Checkout did not return a secure URL');

      if (window.nexforge?.openExternalUrl) {
        await window.nexforge.openExternalUrl(payload.url);
      } else {
        window.open(payload.url, '_blank', 'noopener,noreferrer');
      }
      setPendingCash((current) => new Set(current).add(item.id));
      showToast('Secure checkout opened in your browser. NexForge will unlock the item after payment.', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not start secure checkout.', 'error');
      await reportCloudError(err);
    } finally {
      setCashBusyId(null);
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

  async function claimPassTier(tier) {
    if (passBusy) return;
    setPassBusy(true);
    try {
      const { data, error } = await sb.rpc('claim_pass_tier', { p_tier: tier });
      if (error) throw error;
      setBattlePass(data || null);
      await refreshProfile();
      await refreshBattlePassXp?.();
      showToast(`Claimed pass tier ${tier}`, 'success');
    } catch (err) {
      showToast(err?.message || 'Could not claim tier.', 'error');
      await reportCloudError(err);
    } finally {
      setPassBusy(false);
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

      {slot === 'pass' ? (
        <div className="pass-panel">
          {!battlePass?.season ? (
            <div className="card">
              <div className="card-title">Season Pass</div>
              <div className="friends-empty">No active season pass yet. Ranked duels unlock XP when a season is live.</div>
            </div>
          ) : (
            <>
              <div className="card pass-hero">
                <div className="card-title" style={{ marginBottom: 6 }}>{battlePass.season.name} Pass</div>
                <div className="pass-xp-line">{battlePass.xp || 0} XP earned from ranked duels</div>
              </div>
              <div className="pass-tiers">
                {(battlePass.tiers || []).map((t) => (
                  <div key={t.tier} className={`pass-tier ${t.unlocked ? 'unlocked' : ''} ${t.claimed ? 'claimed' : ''}`}>
                    <div className="pass-tier-num">T{t.tier}</div>
                    <div className="pass-tier-body">
                      <div className="pass-tier-label">{t.reward_label || `${t.reward_coins} coins`}</div>
                      <div className="pass-tier-meta">{t.xp_required} XP · {t.reward_coins || 0} coins</div>
                    </div>
                    <button
                      type="button"
                      className={`action-btn ${t.claimed ? 'ghost' : 'primary'}`}
                      style={{ padding: '6px 12px', fontSize: 11 }}
                      disabled={passBusy || t.claimed || !t.unlocked}
                      onClick={() => claimPassTier(t.tier)}
                    >
                      {t.claimed ? 'Claimed' : t.unlocked ? 'Claim' : 'Locked'}
                    </button>
                  </div>
                ))}
              </div>
              {(battlePass.challenges || []).length > 0 && (
                <div className="card" style={{ marginTop: 14 }}>
                  <div className="card-title">Season challenges</div>
                  <div className="pass-challenges">
                    {battlePass.challenges.map((c) => (
                      <div key={c.id || c.key} className={`pass-challenge ${c.completed ? 'done' : ''}`}>
                        <div>
                          <div className="pass-challenge-title">{c.title}</div>
                          <div className="pass-challenge-meta">
                            {Math.min(c.progress || 0, c.target)}/{c.target} · +{c.xp_reward} XP
                          </div>
                        </div>
                        {c.completed && <span className="badge badge-neon">DONE</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
      <div className="shop-grid">
        {filtered.map((item) => {
          const ownedItem = isOwned(item);
          const lockedMmr = mmr < item.min_mmr;
          const canBuy = !lockedMmr && (item.price === 0 || coins >= item.price);
          const showGift = ownedItem || canBuy;
          const cashPrice = (item.real_money_cents || 0) / 100;
          const awaitingPayment = pendingCash.has(item.id);
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
                <span>{item.price > 0 ? `${item.price} coins` : (item.min_mmr > 0 ? 'MMR unlock' : 'Free')}</span>
                {cashPrice > 0 && <span className="cash-price">${cashPrice.toFixed(2)}</span>}
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
              {cashPrice > 0 && !ownedItem && (
                <button
                  type="button"
                  className="action-btn cash full"
                  disabled={!!cashBusyId || awaitingPayment}
                  onClick={() => buyWithMoney(item)}
                  title="Cash purchase bypasses the MMR and Forge Coin requirements"
                >
                  {cashBusyId === item.id
                    ? 'Opening secure checkout…'
                    : awaitingPayment
                      ? 'Waiting for payment…'
                      : `Skip requirements · $${cashPrice.toFixed(2)}`}
                </button>
              )}
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
      )}
    </div>
  );
}
