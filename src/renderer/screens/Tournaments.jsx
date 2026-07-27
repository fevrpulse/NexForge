import React, { useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { maskAccount, formatPrizeLabel } from '../lib/format.js';

const FORMATS = ['1v1', '2v2', '5v5', 'Solo BR', 'Squad BR', 'Custom'];
const TOURNEY_COLUMNS = 'id,host_id,host_tag,name,game,format,max_slots,starts_at,rules,prize_type,cash_amount,inapp_reward,status,registrations,created_at,bank_account_last4';

function tournamentStatus(t) {
  if (t.status === 'completed') return 'completed';
  const start = t.starts_at ? new Date(t.starts_at) : null;
  if (start && start.getTime() < Date.now() - 6 * 60 * 60 * 1000) return 'completed';
  return 'open';
}

function isRegistered(t, userId) {
  const regs = t.registrations || [];
  return !!userId && regs.includes(userId);
}

/** Bank/PII fields are never kept in renderer state past submission — only last4. */
function sanitizeTournament(t) {
  const copy = { ...t };
  delete copy.bank_routing;
  delete copy.bank_account;
  delete copy.payout_email;
  delete copy.payout_phone;
  delete copy.bank_holder;
  delete copy.bank_name;
  delete copy.bank_type;
  delete copy.bank_country;
  if (t.bank_account) copy.bank_account_last4 = String(t.bank_account).slice(-4);
  return copy;
}

const emptyForm = {
  name: '', game: 'Valorant', format: '5v5', slots: 16, startsAt: '', rules: '',
  prizeType: 'cash', cashAmount: '', inappReward: '',
  bankHolder: '', bankName: '', bankRouting: '', bankAccount: '', bankType: 'checking',
  bankCountry: 'United States', bankEmail: '', bankPhone: '',
};

export default function Tournaments() {
  const { user, profile, guestMode, showToast, setCloudOffline, reportCloudError, setLockMessage, knownGames } = useNexForge();
  const [tournaments, setTournaments] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('open');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formMsg, setFormMsg] = useState(null);
  const [publishing, setPublishing] = useState(false);

  async function loadTournaments() {
    try {
      let { data, error } = await sb.from('tournaments_public').select(TOURNEY_COLUMNS).order('starts_at', { ascending: true });
      if (error) {
        ({ data, error } = await sb.from('tournaments').select(TOURNEY_COLUMNS).order('starts_at', { ascending: true }));
      }
      if (error) throw error;
      setCloudOffline(false);
      setTournaments(data || []);
    } catch (err) {
      await reportCloudError(err);
      setTournaments([]);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    loadTournaments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openCreate() {
    if (!user || guestMode) {
      setLockMessage('Create a free NexForge account to host tournaments and offer prizes');
      return;
    }
    if (!form.bankEmail && user?.email) updateField('bankEmail', user.email);
    setCreateOpen(true);
  }

  function validateBankInfo() {
    const holder = form.bankHolder.trim();
    const bank = form.bankName.trim();
    const routing = form.bankRouting.trim().replace(/\D/g, '');
    const account = form.bankAccount.trim().replace(/\D/g, '');
    const country = form.bankCountry.trim();
    const email = form.bankEmail.trim();
    const phone = form.bankPhone.trim();

    if (!holder || !bank || !routing || !account || !country || !email || !phone) {
      return { error: 'Cash prizes require complete organizer bank and contact information.' };
    }
    if (routing.length !== 9) return { error: 'Routing number must be 9 digits.' };
    if (account.length < 4 || account.length > 17) return { error: 'Enter a valid bank account number.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid payout contact email.' };

    return {
      bank_holder: holder, bank_name: bank, bank_routing: routing, bank_account: account,
      bank_account_last4: account.slice(-4), bank_type: form.bankType, bank_country: country,
      payout_email: email, payout_phone: phone,
    };
  }

  async function createTournament() {
    if (!user || guestMode) { openCreate(); return; }
    setFormMsg(null);

    const name = form.name.trim();
    const slots = Number(form.slots || 0);
    const rules = form.rules.trim();
    const cashAmount = Number(form.cashAmount || 0);
    const inappReward = form.inappReward.trim();
    const needsCash = form.prizeType === 'cash' || form.prizeType === 'both';
    const needsInApp = form.prizeType === 'inapp' || form.prizeType === 'both';

    if (!name) { setFormMsg({ type: 'error', text: 'Enter a tournament title.' }); return; }
    if (!form.startsAt) { setFormMsg({ type: 'error', text: 'Pick a start date and time.' }); return; }
    if (slots < 2) { setFormMsg({ type: 'error', text: 'Max players/teams must be at least 2.' }); return; }
    if (needsCash && (!cashAmount || cashAmount < 1)) {
      setFormMsg({ type: 'error', text: 'Enter a cash prize amount of at least $1.' }); return;
    }
    if (needsInApp && !inappReward) {
      setFormMsg({ type: 'error', text: 'Describe the in-app reward.' }); return;
    }

    let bank = null;
    if (needsCash) {
      const bankResult = validateBankInfo();
      if (bankResult.error) { setFormMsg({ type: 'error', text: bankResult.error }); return; }
      bank = bankResult;
    }

    const tournament = {
      id: crypto.randomUUID(),
      host_id: user.id,
      host_tag: profile?.gamer_tag || user.email?.split('@')[0] || 'Host',
      name,
      game: form.game,
      format: form.format,
      max_slots: slots,
      starts_at: new Date(form.startsAt).toISOString(),
      rules,
      prize_type: form.prizeType,
      cash_amount: needsCash ? cashAmount : null,
      inapp_reward: needsInApp ? inappReward : null,
      status: 'open',
      registrations: [],
      created_at: new Date().toISOString(),
      ...(bank || {}),
    };

    setPublishing(true);
    try {
      const { data, error } = await sb.from('tournaments').insert(tournament).select(TOURNEY_COLUMNS).single();
      setPublishing(false);
      if (error || !data) {
        await reportCloudError(error || new Error('Tournament publish failed'));
        setFormMsg({ type: 'error', text: error?.message || 'Could not publish tournament. Fix cloud sync and try again.' });
        showToast(error?.message || 'Tournament publish failed', 'error');
        return;
      }
      setTournaments((prev) => [sanitizeTournament(data), ...prev]);
      setFormMsg({ type: 'success', text: 'Tournament published.' });
      setForm({ ...emptyForm, bankEmail: user.email || '' });
      setCreateOpen(false);
      showToast('Tournament created', 'success');
      loadTournaments();
    } catch (err) {
      setPublishing(false);
      await reportCloudError(err);
      setFormMsg({ type: 'error', text: err?.message || 'Could not publish tournament.' });
      showToast(err?.message || 'Tournament publish failed', 'error');
    }
  }

  async function registerForTournament(id) {
    if (!user || guestMode) {
      setLockMessage('Create a free NexForge account to register for tournaments');
      return;
    }
    const t = tournaments.find((x) => x.id === id);
    if (!t) return;
    const regs = Array.isArray(t.registrations) ? t.registrations : [];
    if (regs.includes(user.id)) return;
    if (regs.length >= (t.max_slots || 16)) {
      showToast('This tournament is full.', 'error');
      return;
    }

    const { data, error } = await sb.rpc('register_for_tournament', { tournament_id: id });
    if (!error && data) {
      setCloudOffline(false);
      setTournaments((prev) => prev.map((x) => (x.id === id ? { ...x, ...sanitizeTournament(data) } : x)));
      showToast(`Registered for ${t.name}`, 'success');
    } else {
      await reportCloudError(error);
      showToast(error?.message || 'Could not register — cloud required.', 'error');
    }
  }

  async function unregisterFromTournament(id) {
    if (!user) return;
    const t = tournaments.find((x) => x.id === id);
    if (!t) return;

    const { data, error } = await sb.rpc('unregister_from_tournament', { tournament_id: id });
    if (!error && data) {
      setCloudOffline(false);
      setTournaments((prev) => prev.map((x) => (x.id === id ? { ...x, ...sanitizeTournament(data) } : x)));
      showToast('Left tournament', 'success');
    } else {
      await reportCloudError(error);
      showToast(error?.message || 'Could not leave — cloud required.', 'error');
    }
  }

  const filtered = tournaments.filter((t) => {
    const status = tournamentStatus(t);
    if (filter === 'open') return status === 'open';
    if (filter === 'completed') return status === 'completed';
    if (filter === 'registered') return isRegistered(t, user?.id);
    return true;
  });

  const needsCash = form.prizeType === 'cash' || form.prizeType === 'both';
  const needsInApp = form.prizeType === 'inapp' || form.prizeType === 'both';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['open', 'registered', 'completed'].map((f) => (
            <span
              key={f}
              className={`badge tourney-filter ${filter === f ? 'active badge-neon' : 'badge-muted'}`}
              onClick={() => setFilter(f)}
            >
              {f[0].toUpperCase() + f.slice(1)}
            </span>
          ))}
        </div>
        <button className="action-btn primary" onClick={openCreate}>+ Create Tournament</button>
      </div>

      {createOpen && (
        <div className="card mm-form" style={{ marginBottom: 18 }}>
          <div className="card-title">Create a Tournament</div>

          <div className="field">
            <label>Tournament Title</label>
            <input type="text" maxLength={80} placeholder="e.g. Friday Night Valorant Cup"
              value={form.name} onChange={(e) => updateField('name', e.target.value)} />
          </div>

          <div className="filter-row" style={{ marginBottom: 14 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Game</label>
              <select value={form.game} onChange={(e) => updateField('game', e.target.value)}>
                {knownGames.map((g) => <option key={g}>{g}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Format</label>
              <select value={form.format} onChange={(e) => updateField('format', e.target.value)}>
                {FORMATS.map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Max Players / Teams</label>
              <input type="number" min={2} max={256} value={form.slots} onChange={(e) => updateField('slots', e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label>Start Date &amp; Time</label>
            <input type="datetime-local" value={form.startsAt} onChange={(e) => updateField('startsAt', e.target.value)} />
          </div>

          <div className="field">
            <label>Rules / Details</label>
            <textarea placeholder="Bracket type, check-in window, map pool, eligibility rules..."
              value={form.rules} onChange={(e) => updateField('rules', e.target.value)} />
          </div>

          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted2)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            Prize Type
          </div>
          <div className="prize-type-row">
            <button type="button" className={`prize-type-btn ${form.prizeType === 'cash' ? 'active' : ''}`} onClick={() => updateField('prizeType', 'cash')}>Cash</button>
            <button type="button" className={`prize-type-btn ${form.prizeType === 'inapp' ? 'active' : ''}`} onClick={() => updateField('prizeType', 'inapp')}>In-App Reward</button>
            <button type="button" className={`prize-type-btn ${form.prizeType === 'both' ? 'active' : ''}`} onClick={() => updateField('prizeType', 'both')}>Cash + In-App</button>
          </div>

          {needsCash && (
            <div>
              <div className="field">
                <label>Cash Prize Amount (USD)</label>
                <input type="number" min={1} step={1} placeholder="e.g. 100" value={form.cashAmount} onChange={(e) => updateField('cashAmount', e.target.value)} />
              </div>
              <div className="bank-box">
                <div className="bank-title">Organizer bank info required for cash prizes</div>
                <div className="bank-note">
                  To offer a cash prize, you must provide bank details used to fund the payout so the winner can be paid.
                  This information is only used for prize fulfillment and is never shown on the public tournament card.
                </div>
                <div className="field">
                  <label>Account Holder Full Legal Name</label>
                  <input type="text" placeholder="Name on the bank account" value={form.bankHolder} onChange={(e) => updateField('bankHolder', e.target.value)} />
                </div>
                <div className="field">
                  <label>Bank Name</label>
                  <input type="text" placeholder="e.g. Chase, Bank of America" value={form.bankName} onChange={(e) => updateField('bankName', e.target.value)} />
                </div>
                <div className="filter-row" style={{ marginBottom: 14 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Routing Number</label>
                    <input type="text" inputMode="numeric" maxLength={9} placeholder="9 digits" value={form.bankRouting} onChange={(e) => updateField('bankRouting', e.target.value)} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Account Number</label>
                    <input type="text" inputMode="numeric" maxLength={17} placeholder="Account number" value={form.bankAccount} onChange={(e) => updateField('bankAccount', e.target.value)} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Account Type</label>
                    <select value={form.bankType} onChange={(e) => updateField('bankType', e.target.value)}>
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                    </select>
                  </div>
                </div>
                <div className="filter-row" style={{ marginBottom: 0 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Country</label>
                    <input type="text" value={form.bankCountry} onChange={(e) => updateField('bankCountry', e.target.value)} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Payout Contact Email</label>
                    <input type="email" placeholder="you@email.com" value={form.bankEmail} onChange={(e) => updateField('bankEmail', e.target.value)} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Payout Contact Phone</label>
                    <input type="tel" placeholder="+1 555 000 0000" value={form.bankPhone} onChange={(e) => updateField('bankPhone', e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {needsInApp && (
            <div className="field">
              <label>In-App Reward Details</label>
              <textarea placeholder="e.g. 5,000 NexForge XP, exclusive badge, profile flair, or seasonal reward pack"
                value={form.inappReward} onChange={(e) => updateField('inappReward', e.target.value)} />
            </div>
          )}

          {formMsg && (
            <div className={`auth-msg ${formMsg.type}`} style={{ textAlign: 'left', marginTop: 0, marginBottom: 8 }}>
              {formMsg.text}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="action-btn primary" onClick={createTournament} disabled={publishing}>
              {publishing ? 'Publishing...' : 'Publish Tournament'}
            </button>
            <button className="action-btn ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {!loaded ? (
        <div className="tourney-empty">Loading tournaments...</div>
      ) : filtered.length === 0 ? (
        <div className="tourney-empty">
          No {filter} tournaments yet.<br /><br />
          Create one with a cash prize, in-app reward, or both.
        </div>
      ) : (
        filtered.map((t) => {
          const status = tournamentStatus(t);
          const filled = (t.registrations || []).length;
          const slots = t.max_slots || 16;
          const startLabel = t.starts_at
            ? new Date(t.starts_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : 'TBD';
          const registered = isRegistered(t, user?.id);
          return (
            <div className="tourney-card" key={t.id}>
              <div className="tourney-top">
                <div>
                  <div className="tourney-name">{t.name}</div>
                  <div className="tourney-game">{t.game || '—'} · {t.format || 'Custom'} · Hosted by {t.host_tag || 'Player'}</div>
                </div>
                <div className="prize">{formatPrizeLabel(t)}</div>
              </div>
              <div className="tourney-meta">
                <span>📅 {startLabel}</span>
                <span>👥 {filled}/{slots}</span>
                <span>{status === 'open' ? '🟢 Open' : '⬛ Completed'}</span>
                {registered && <span className="badge badge-neon">REGISTERED</span>}
              </div>
              {t.rules && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted2)', marginTop: 10, lineHeight: 1.5 }}>
                  {t.rules}
                </div>
              )}
              {(t.prize_type === 'inapp' || t.prize_type === 'both') && t.inapp_reward && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted2)', marginTop: 8 }}>
                  Reward · {t.inapp_reward}
                </div>
              )}
              {(t.prize_type === 'cash' || t.prize_type === 'both') && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted2)', marginTop: 6 }}>
                  Cash payout funded by organizer · {maskAccount(t.bank_account_last4)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {status === 'open' && !registered && (
                  <button className="action-btn primary" style={{ padding: '8px 14px', fontSize: 12 }} onClick={() => registerForTournament(t.id)}>
                    Register
                  </button>
                )}
                {status === 'open' && registered && (
                  <button className="action-btn ghost" style={{ padding: '8px 14px', fontSize: 12 }} onClick={() => unregisterFromTournament(t.id)}>
                    Leave
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
