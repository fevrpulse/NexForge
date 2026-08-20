import React, { useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';
import { maskAccount, formatPrizeLabel } from '../lib/format.js';

function BracketView({
  tournament,
  bracket,
  userId,
  isHost,
  busy,
  onReport,
}) {
  const matches = Array.isArray(bracket?.matches) ? bracket.matches : [];
  if (!matches.length) {
    return (
      <div className="bracket-empty">
        No bracket yet{isHost ? ' — generate after check-ins.' : '.'}
      </div>
    );
  }
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  return (
    <div className="bracket-board">
      {rounds.map((round) => (
        <div className="bracket-round" key={round}>
          <div className="bracket-round-label">Round {round}</div>
          {matches.filter((m) => m.round === round).map((m) => {
            const canReport = isHost
              && m.status === 'ready'
              && m.slot_a
              && m.slot_b
              && !m.winner_id;
            return (
              <div className={`bracket-match status-${m.status}`} key={`${m.round}-${m.match_index}`}>
                <button
                  type="button"
                  className={`bracket-slot ${m.winner_id === m.slot_a ? 'winner' : ''}`}
                  disabled={!canReport || busy || !m.slot_a}
                  onClick={() => onReport(m, m.slot_a)}
                >
                  {m.tag_a || (m.slot_a ? 'Player' : 'Bye')}
                  {m.slot_a === userId ? ' (you)' : ''}
                </button>
                <button
                  type="button"
                  className={`bracket-slot ${m.winner_id === m.slot_b ? 'winner' : ''}`}
                  disabled={!canReport || busy || !m.slot_b}
                  onClick={() => onReport(m, m.slot_b)}
                >
                  {m.tag_b || (m.slot_b ? 'Player' : 'Bye')}
                  {m.slot_b === userId ? ' (you)' : ''}
                </button>
                {m.status === 'done' && m.winner_tag && (
                  <div className="bracket-winner-label">→ {m.winner_tag}</div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {tournament.status === 'completed' && (
        <div className="bracket-complete">Tournament complete</div>
      )}
    </div>
  );
}

const FORMATS = ['1v1', '2v2', '5v5', 'Solo BR', 'Squad BR', 'Custom'];
const TOURNEY_COLUMNS = 'id,host_id,host_tag,name,game,format,max_slots,starts_at,expires_at,rules,prize_type,cash_amount,inapp_reward,status,registrations,created_at,bank_account_last4,prize_funded,payout_status,winner_id';

const MAX_TOURNEY_DAYS = 5;

function toLocalDateTimeValue(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function maxTournamentStartLocal() {
  return toLocalDateTimeValue(new Date(Date.now() + MAX_TOURNEY_DAYS * 24 * 60 * 60 * 1000));
}

function minTournamentStartLocal() {
  return toLocalDateTimeValue(new Date(Date.now() + 60 * 1000));
}

function abaRoutingValid(routing) {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = routing.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

function tournamentStatus(t) {
  if (t.status === 'completed') return 'completed';
  if (t.status === 'expired') return 'expired';
  if (t.status === 'pending_funds') {
    if (t.expires_at && new Date(t.expires_at).getTime() <= Date.now()) return 'expired';
    return 'pending_funds';
  }
  if (t.expires_at && new Date(t.expires_at).getTime() <= Date.now()) return 'expired';
  const start = t.starts_at ? new Date(t.starts_at) : null;
  if (start && start.getTime() < Date.now() - 6 * 60 * 60 * 1000) return 'completed';
  return 'open';
}

function needsCashPrize(t) {
  return t?.prize_type === 'cash' || t?.prize_type === 'both';
}

async function openExternalCheckout(url) {
  if (window.nexforge?.openExternalUrl) {
    await window.nexforge.openExternalUrl(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
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
  const [expandedId, setExpandedId] = useState(null);
  const [brackets, setBrackets] = useState({});
  const [checkedIn, setCheckedIn] = useState({});
  const [bracketBusy, setBracketBusy] = useState(false);

  async function loadTournaments() {
    try {
      await sb.rpc('expire_stale_tournaments').catch(() => {});
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
    const onFocus = () => loadTournaments();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
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
    if (!abaRoutingValid(routing)) return { error: 'Routing number must be a valid 9-digit ABA number.' };
    if (account.length < 4 || account.length > 17) return { error: 'Enter a valid bank account number.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid payout contact email.' };

    return {
      bank_holder: holder, bank_name: bank, bank_routing: routing, bank_account: account,
      bank_account_last4: account.slice(-4), bank_type: form.bankType, bank_country: country,
      payout_email: email, payout_phone: phone,
    };
  }

  async function fundTournamentPrize(tournamentId) {
    const { data, error } = await sb.functions.invoke('create-tournament-escrow', {
      body: { tournamentId },
    });
    let payload = data;
    if (error) {
      try {
        if (error.context && typeof error.context.json === 'function') {
          payload = await error.context.json();
        }
      } catch { /* keep */ }
      throw new Error(payload?.error || error.message || 'Could not start prize escrow checkout.');
    }
    if (!payload?.url) throw new Error(payload?.error || 'Escrow checkout did not return a URL');
    await openExternalCheckout(payload.url);
    return payload;
  }

  async function claimWinnerPayout(tournamentId) {
    const { data, error } = await sb.functions.invoke('payout-tournament-winner', {
      body: { tournamentId },
    });
    let payload = data;
    if (error) {
      try {
        if (error.context && typeof error.context.json === 'function') {
          payload = await error.context.json();
        }
      } catch { /* keep */ }
      if (payload?.needsOnboarding) return payload;
      throw new Error(payload?.error || error.message || 'Payout failed.');
    }
    return payload;
  }

  async function startConnectOnboarding() {
    const { data, error } = await sb.functions.invoke('create-connect-onboarding', { body: {} });
    let payload = data;
    if (error) {
      try {
        if (error.context && typeof error.context.json === 'function') {
          payload = await error.context.json();
        }
      } catch { /* keep */ }
      throw new Error(payload?.error || error.message || 'Could not start payout onboarding.');
    }
    if (!payload?.url) throw new Error(payload?.error || 'Onboarding did not return a URL');
    await openExternalCheckout(payload.url);
    return payload;
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
    const startMs = new Date(form.startsAt).getTime();
    if (Number.isNaN(startMs)) {
      setFormMsg({ type: 'error', text: 'Pick a valid start date and time.' }); return;
    }
    if (startMs < Date.now()) {
      setFormMsg({ type: 'error', text: 'Start time must be in the future.' }); return;
    }
    if (startMs > Date.now() + MAX_TOURNEY_DAYS * 24 * 60 * 60 * 1000) {
      setFormMsg({ type: 'error', text: `Start time must be within ${MAX_TOURNEY_DAYS} days.` }); return;
    }
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

    setPublishing(true);
    try {
      const { data, error } = await sb.rpc('create_tournament', {
        p_name: name,
        p_game: form.game,
        p_format: form.format,
        p_max_slots: slots,
        p_starts_at: new Date(form.startsAt).toISOString(),
        p_rules: rules || null,
        p_prize_type: form.prizeType,
        p_cash_amount: needsCash ? cashAmount : null,
        p_inapp_reward: needsInApp ? inappReward : null,
        p_bank_holder: bank?.bank_holder || null,
        p_bank_name: bank?.bank_name || null,
        p_bank_routing: bank?.bank_routing || null,
        p_bank_account: bank?.bank_account || null,
        p_bank_type: bank?.bank_type || null,
        p_bank_country: bank?.bank_country || null,
        p_payout_email: bank?.payout_email || null,
        p_payout_phone: bank?.payout_phone || null,
      });
      if (error || !data) {
        await reportCloudError(error || new Error('Tournament publish failed'));
        setFormMsg({ type: 'error', text: error?.message || 'Could not publish tournament.' });
        showToast(error?.message || 'Tournament publish failed', 'error');
        return;
      }

      const created = sanitizeTournament(typeof data === 'object' ? data : {});
      setTournaments((prev) => [created, ...prev.filter((x) => x.id !== created.id)]);
      setForm({ ...emptyForm, bankEmail: user.email || '' });
      setCreateOpen(false);

      if (data.needs_escrow || created.status === 'pending_funds') {
        setFormMsg(null);
        showToast('Tournament created — fund the prize in Stripe to open registration.', 'success');
        try {
          await fundTournamentPrize(created.id);
          showToast('Stripe escrow opened — return here after paying.', 'success');
        } catch (fundErr) {
          showToast(fundErr?.message || 'Tournament saved. Use Fund prize to open Stripe.', 'error');
        }
      } else {
        showToast('Tournament created', 'success');
      }
      loadTournaments();
    } catch (err) {
      await reportCloudError(err);
      setFormMsg({ type: 'error', text: err?.message || 'Could not publish tournament.' });
      showToast(err?.message || 'Tournament publish failed', 'error');
    } finally {
      setPublishing(false);
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

  async function loadBracket(tournamentId) {
    if (!tournamentId) return null;
    try {
      const { data, error } = await sb.rpc('get_tournament_bracket', { p_tournament_id: tournamentId });
      if (error) throw error;
      setBrackets((prev) => ({ ...prev, [tournamentId]: data || { matches: [], checkins: 0 } }));
      if (user) {
        const { data: mine } = await sb
          .from('tournament_checkins')
          .select('user_id')
          .eq('tournament_id', tournamentId)
          .eq('user_id', user.id)
          .maybeSingle();
        setCheckedIn((prev) => ({ ...prev, [tournamentId]: !!mine }));
      }
      return data;
    } catch (err) {
      console.warn('get_tournament_bracket failed', err);
      return null;
    }
  }

  async function toggleBracket(id) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    await loadBracket(id);
  }

  async function checkIn(id) {
    if (!user || guestMode || bracketBusy) return;
    setBracketBusy(true);
    try {
      const { error } = await sb.rpc('check_in_tournament', { p_tournament_id: id });
      if (error) throw error;
      setCheckedIn((prev) => ({ ...prev, [id]: true }));
      showToast('Checked in', 'success');
      await loadBracket(id);
    } catch (err) {
      showToast(err?.message || 'Check-in failed.', 'error');
      await reportCloudError(err);
    } finally {
      setBracketBusy(false);
    }
  }

  async function generateBracket(id) {
    if (bracketBusy) return;
    setBracketBusy(true);
    try {
      const { data, error } = await sb.rpc('host_generate_bracket', { p_tournament_id: id });
      if (error) throw error;
      setBrackets((prev) => ({ ...prev, [id]: data }));
      showToast('Bracket generated', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not generate bracket.', 'error');
      await reportCloudError(err);
    } finally {
      setBracketBusy(false);
    }
  }

  async function reportWinner(tournamentId, match, winnerId) {
    if (bracketBusy || !winnerId) return;
    setBracketBusy(true);
    try {
      const { data, error } = await sb.rpc('host_report_bracket_winner', {
        p_tournament_id: tournamentId,
        p_round: match.round,
        p_match_index: match.match_index,
        p_winner_id: winnerId,
      });
      if (error) throw error;
      setBrackets((prev) => ({ ...prev, [tournamentId]: data }));
      await loadTournaments();
      showToast('Match result recorded', 'success');

      // After refresh, attempt payout if this completed a funded cash tournament
      const refreshed = await sb.from('tournaments_public')
        .select(TOURNEY_COLUMNS)
        .eq('id', tournamentId)
        .maybeSingle();
      const t = refreshed?.data;
      if (
        t?.status === 'completed'
        && needsCashPrize(t)
        && t.prize_funded
        && t.payout_status
        && t.payout_status !== 'paid'
        && t.payout_status !== 'none'
      ) {
        try {
          const payout = await claimWinnerPayout(tournamentId);
          if (payout?.needsOnboarding) {
            showToast('Winner must complete payout onboarding to receive the prize.', 'error');
          } else if (payout?.ok || payout?.alreadyPaid) {
            showToast('Prize payout sent to the winner.', 'success');
            await loadTournaments();
          }
        } catch (payoutErr) {
          showToast(payoutErr?.message || 'Tournament complete — payout pending.', 'error');
        }
      }
    } catch (err) {
      showToast(err?.message || 'Could not report winner.', 'error');
      await reportCloudError(err);
    } finally {
      setBracketBusy(false);
    }
  }

  const filtered = tournaments.filter((t) => {
    const status = tournamentStatus(t);
    if (filter === 'open') return status === 'open' || status === 'pending_funds';
    if (filter === 'completed') return status === 'completed' || status === 'expired';
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
            <input
              type="datetime-local"
              value={form.startsAt}
              min={minTournamentStartLocal()}
              max={maxTournamentStartLocal()}
              onChange={(e) => updateField('startsAt', e.target.value)}
            />
            <div className="field-hint" style={{ marginTop: 6 }}>
              Must start within {MAX_TOURNEY_DAYS} days. Listing expires automatically after {MAX_TOURNEY_DAYS} days.
            </div>
          </div>

          <div className="field">
            <label>Rules / Details</label>
            <textarea placeholder="Bracket type, check-in window, map pool, eligibility rules..."
              value={form.rules} onChange={(e) => updateField('rules', e.target.value)} />
          </div>

          <div style={{ fontFamily: 'var(--font)', fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
            Prize type
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
                <div className="bank-title">Organizer bank info + Stripe escrow required</div>
                <div className="bank-note">
                  Cash tournaments require valid bank details and a Stripe card payment that escrows the prize.
                  Registration opens only after the prize is funded. The winner is paid via Stripe Connect when the bracket completes.
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
              {publishing ? 'Publishing...' : needsCash ? 'Create & Fund Prize' : 'Publish Tournament'}
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
          const expiresLabel = t.expires_at
            ? new Date(t.expires_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : null;
          const registered = isRegistered(t, user?.id);
          const isHost = !!(user && t.host_id === user.id);
          const expanded = expandedId === t.id;
          const bracket = brackets[t.id];
          const amCheckedIn = !!checkedIn[t.id];
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
                <span>Starts {startLabel}</span>
                {expiresLabel && <span>Expires {expiresLabel}</span>}
                <span>{filled}/{slots} slots</span>
                <span>
                  {status === 'pending_funds' ? 'Awaiting prize funding'
                    : status === 'open' ? 'Open'
                      : status === 'expired' ? 'Expired'
                        : 'Completed'}
                </span>
                {registered && <span className="badge badge-neon">REGISTERED</span>}
                {amCheckedIn && <span className="badge badge-muted">CHECKED IN</span>}
                {t.payout_status === 'paid' && <span className="badge badge-neon">PRIZE PAID</span>}
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
              {needsCashPrize(t) && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted2)', marginTop: 6 }}>
                  {t.prize_funded
                    ? `Prize escrowed · ${maskAccount(t.bank_account_last4)}`
                    : `Awaiting Stripe escrow · ${maskAccount(t.bank_account_last4)}`}
                  {t.payout_status && t.payout_status !== 'none' && t.payout_status !== 'awaiting_funds'
                    ? ` · payout ${t.payout_status.replace(/_/g, ' ')}`
                    : ''}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {isHost && status === 'pending_funds' && (
                  <button
                    className="action-btn primary"
                    style={{ padding: '8px 14px', fontSize: 12 }}
                    disabled={bracketBusy}
                    onClick={async () => {
                      setBracketBusy(true);
                      try {
                        await fundTournamentPrize(t.id);
                        showToast('Stripe escrow opened — return here after paying.', 'success');
                      } catch (err) {
                        showToast(err?.message || 'Could not open escrow checkout.', 'error');
                      } finally {
                        setBracketBusy(false);
                      }
                    }}
                  >
                    Fund prize
                  </button>
                )}
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
                {registered && !amCheckedIn && status === 'open' && (
                  <button
                    className="action-btn primary"
                    style={{ padding: '8px 14px', fontSize: 12 }}
                    disabled={bracketBusy}
                    onClick={() => checkIn(t.id)}
                  >
                    Check in
                  </button>
                )}
                {status === 'completed' && needsCashPrize(t) && t.prize_funded && t.payout_status !== 'paid'
                  && (isHost || t.winner_id === user?.id) && (
                  <button
                    className="action-btn primary"
                    style={{ padding: '8px 14px', fontSize: 12 }}
                    disabled={bracketBusy}
                    onClick={async () => {
                      setBracketBusy(true);
                      try {
                        const payout = await claimWinnerPayout(t.id);
                        if (payout?.needsOnboarding) {
                          if (t.winner_id === user?.id) {
                            await startConnectOnboarding();
                            showToast('Complete Stripe Connect, then claim payout again.', 'success');
                          } else {
                            showToast('Winner must complete payout onboarding first.', 'error');
                          }
                        } else if (payout?.ok || payout?.alreadyPaid) {
                          showToast('Prize payout complete.', 'success');
                          await loadTournaments();
                        }
                      } catch (err) {
                        showToast(err?.message || 'Payout failed.', 'error');
                      } finally {
                        setBracketBusy(false);
                      }
                    }}
                  >
                    {t.winner_id === user?.id && (t.payout_status === 'awaiting_winner_onboarding' || t.payout_status === 'pending')
                      ? 'Claim / set up payout'
                      : 'Pay winner'}
                  </button>
                )}
                <button
                  className="action-btn ghost"
                  style={{ padding: '8px 14px', fontSize: 12 }}
                  onClick={() => toggleBracket(t.id)}
                >
                  {expanded ? 'Hide bracket' : 'Bracket'}
                </button>
              </div>
              {expanded && (
                <div className="bracket-panel">
                  <div className="bracket-panel-head">
                    <span>
                      Check-ins · {bracket?.checkins ?? '—'}
                      {Array.isArray(bracket?.matches) && bracket.matches.length
                        ? ` · ${bracket.matches.length} matches`
                        : ''}
                    </span>
                    {isHost && !(bracket?.matches?.length) && (
                      <button
                        type="button"
                        className="action-btn primary"
                        style={{ padding: '6px 12px', fontSize: 11 }}
                        disabled={bracketBusy}
                        onClick={() => generateBracket(t.id)}
                      >
                        Generate bracket
                      </button>
                    )}
                  </div>
                  <BracketView
                    tournament={t}
                    bracket={bracket}
                    userId={user?.id}
                    isHost={isHost}
                    busy={bracketBusy}
                    onReport={(match, winnerId) => reportWinner(t.id, match, winnerId)}
                  />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
