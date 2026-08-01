import React, { useCallback, useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';

const PROVIDERS = [
  {
    id: 'riot',
    label: 'Riot',
    placeholder: 'Name#TAG',
    hint: 'Valorant / LoL Riot ID',
  },
  {
    id: 'steam',
    label: 'Steam',
    placeholder: '7656119… or vanity',
    hint: 'SteamID64 or profile vanity',
  },
  {
    id: 'tracker',
    label: 'Tracker',
    placeholder: 'tracker handle',
    hint: 'Cross-game tracker label',
  },
];

export default function VerifiedStatsPanel() {
  const { user, profile, refreshProfile, showToast, reportCloudError, guestMode } = useNexForge();
  const [links, setLinks] = useState([]);
  const [drafts, setDrafts] = useState({ riot: '', steam: '', tracker: '' });
  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user || guestMode) {
      setLinks([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await sb.rpc('get_my_stat_links');
      if (error) throw error;
      setLinks(Array.isArray(data?.links) ? data.links : []);
    } catch (err) {
      console.warn('get_my_stat_links failed', err);
    } finally {
      setLoading(false);
    }
  }, [user, guestMode]);

  useEffect(() => { load(); }, [load]);

  function linkFor(provider) {
    return links.find((l) => l.provider === provider) || null;
  }

  async function run(key, action, okMsg) {
    if (busy) return;
    setBusy(key);
    try {
      const data = await action();
      if (data?.links) setLinks(data.links);
      else await load();
      if (okMsg) showToast(okMsg, 'success');
    } catch (err) {
      showToast(err?.message || 'Verified stats action failed.', 'error');
      await reportCloudError(err);
    } finally {
      setBusy(null);
    }
  }

  async function linkAccount(provider) {
    const handle = (drafts[provider] || '').trim();
    if (!handle) {
      showToast('Enter a handle first.', 'error');
      return;
    }
    await run(`link-${provider}`, async () => {
      const { data, error } = await sb.rpc('link_stat_account', {
        p_provider: provider,
        p_handle: handle,
      });
      if (error) throw error;
      return data;
    }, 'Account linked — confirm ownership next');
  }

  async function confirm(provider) {
    await run(`confirm-${provider}`, async () => {
      const { data, error } = await sb.rpc('confirm_stat_link', { p_provider: provider });
      if (error) throw error;
      return data;
    }, 'Ownership confirmed');
  }

  async function sync(provider) {
    await run(`sync-${provider}`, async () => {
      const { data, error } = await sb.rpc('sync_stat_link', { p_provider: provider });
      if (error) throw error;
      return data;
    }, 'Stats synced from NexForge matches');
  }

  async function unlink(provider) {
    await run(`unlink-${provider}`, async () => {
      const { data, error } = await sb.rpc('unlink_stat_account', { p_provider: provider });
      if (error) throw error;
      return data;
    }, 'Account unlinked');
  }

  async function setStatusToCode(code) {
    if (!user || !code) return;
    setBusy('status');
    try {
      const { error } = await sb.from('profiles').update({ custom_status: code }).eq('id', user.id);
      if (error) throw error;
      await refreshProfile();
      showToast(`Status set to ${code}`, 'success');
    } catch (err) {
      showToast(err?.message || 'Could not set status.', 'error');
    } finally {
      setBusy(null);
    }
  }

  if (guestMode || !user) return null;

  return (
    <div className="card verified-panel">
      <div className="card-title">Verified Stats</div>
      <div className="verified-sub">
        Link Riot / Steam / Tracker handles, confirm ownership with a one-time status code, then sync W/L from your NexForge match history.
      </div>

      {loading && links.length === 0 ? (
        <div className="verified-empty">Loading links…</div>
      ) : (
        <div className="verified-list">
          {PROVIDERS.map((p) => {
            const link = linkFor(p.id);
            const snap = link?.snapshot || {};
            return (
              <div className="verified-row" key={p.id}>
                <div className="verified-row-head">
                  <div>
                    <div className="verified-provider">{p.label}</div>
                    <div className="verified-hint">{p.hint}</div>
                  </div>
                  {link?.status === 'verified' && (
                    <span className="badge badge-neon">VERIFIED</span>
                  )}
                  {link?.status === 'pending' && (
                    <span className="badge badge-muted">PENDING</span>
                  )}
                </div>

                {!link && (
                  <div className="verified-link-form">
                    <input
                      type="text"
                      maxLength={64}
                      placeholder={p.placeholder}
                      value={drafts[p.id]}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="action-btn primary"
                      style={{ padding: '8px 12px', fontSize: 12 }}
                      disabled={!!busy}
                      onClick={() => linkAccount(p.id)}
                    >
                      Link
                    </button>
                  </div>
                )}

                {link?.status === 'pending' && (
                  <div className="verified-pending">
                    <div className="verified-handle">{link.handle}</div>
                    <div className="verified-code-box">
                      Set your NexForge status to include <b>{link.verify_code}</b>, then confirm.
                    </div>
                    <div className="verified-actions">
                      <button
                        type="button"
                        className="action-btn ghost"
                        style={{ padding: '6px 10px', fontSize: 11 }}
                        disabled={!!busy}
                        onClick={() => setStatusToCode(link.verify_code)}
                      >
                        {busy === 'status' ? '…' : 'Set status to code'}
                      </button>
                      <button
                        type="button"
                        className="action-btn primary"
                        style={{ padding: '6px 10px', fontSize: 11 }}
                        disabled={!!busy}
                        onClick={() => confirm(p.id)}
                      >
                        Confirm ownership
                      </button>
                      <button
                        type="button"
                        className="action-btn ghost"
                        style={{ padding: '6px 10px', fontSize: 11 }}
                        disabled={!!busy}
                        onClick={() => unlink(p.id)}
                      >
                        Cancel
                      </button>
                    </div>
                    {profile?.custom_status && (
                      <div className="verified-hint" style={{ marginTop: 8 }}>
                        Current status: {profile.custom_status}
                      </div>
                    )}
                  </div>
                )}

                {link?.status === 'verified' && (
                  <div className="verified-done">
                    <div className="verified-handle">{link.handle}</div>
                    {snap.matches != null ? (
                      <div className="verified-snap">
                        {snap.wins ?? 0}W–{snap.losses ?? 0}L
                        {snap.win_rate != null ? ` · ${snap.win_rate}%` : ''}
                        {` · ${snap.matches} matches (90d)`}
                        {link.last_synced_at
                          ? ` · synced ${new Date(link.last_synced_at).toLocaleString()}`
                          : ''}
                      </div>
                    ) : (
                      <div className="verified-hint">Not synced yet — pull W/L from your NexForge history.</div>
                    )}
                    <div className="verified-actions">
                      <button
                        type="button"
                        className="action-btn primary"
                        style={{ padding: '6px 10px', fontSize: 11 }}
                        disabled={!!busy}
                        onClick={() => sync(p.id)}
                      >
                        Sync stats
                      </button>
                      <button
                        type="button"
                        className="action-btn ghost"
                        style={{ padding: '6px 10px', fontSize: 11 }}
                        disabled={!!busy}
                        onClick={() => unlink(p.id)}
                      >
                        Unlink
                      </button>
                    </div>
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
