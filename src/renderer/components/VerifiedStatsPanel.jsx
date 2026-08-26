import React, { useCallback, useEffect, useState } from 'react';
import { useNexForge } from '../context/NexForgeContext.jsx';
import { sb } from '../lib/supabase.js';

export const LINK_PROVIDERS = [
  {
    id: 'discord',
    label: 'Discord',
    color: '#5865F2',
    placeholder: 'username',
    hint: 'Connect so friends can see your Discord',
    oauthLabel: 'Connect Discord',
  },
  {
    id: 'steam',
    label: 'Steam',
    color: '#66c0f4',
    placeholder: '7656119… or vanity',
    hint: 'SteamID64 or profile vanity',
    oauthLabel: 'Connect Steam',
  },
  {
    id: 'riot',
    label: 'Riot',
    color: '#ff4554',
    placeholder: 'Name#TAG',
    hint: 'Valorant / LoL / TFT Riot ID',
    oauthLabel: 'Connect Riot',
  },
  {
    id: 'epic',
    label: 'Epic Games',
    color: '#2d6cff',
    placeholder: 'Epic display name',
    hint: 'Fortnite / Rocket League',
    oauthLabel: 'Connect Epic',
  },
  {
    id: 'tracker',
    label: 'Tracker',
    color: '#c9ff00',
    placeholder: 'tracker handle',
    hint: 'Cross-game tracker label',
    oauthLabel: null,
  },
];

const EMPTY_DRAFTS = Object.fromEntries(LINK_PROVIDERS.map((p) => [p.id, '']));

async function invokeLinkStart(body) {
  const { data, error } = await sb.functions.invoke('link-account-start', { body });
  let payload = data;
  if (error) {
    let detail = error.message || 'Could not start account linking';
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        const parsed = await ctx.json();
        if (parsed) payload = parsed;
        if (parsed?.error) detail = parsed.error;
      }
    } catch { /* ignore */ }
    if (!payload?.code) throw new Error(detail);
  }
  if (payload?.error && payload?.code !== 'oauth_not_configured') {
    const err = new Error(String(payload.error));
    err.code = payload.code;
    err.capabilities = payload.capabilities;
    throw err;
  }
  if (payload?.code === 'oauth_not_configured') {
    const err = new Error(String(payload.error || 'OAuth is not configured'));
    err.code = payload.code;
    err.capabilities = payload.capabilities;
    throw err;
  }
  if (payload?.error) throw new Error(String(payload.error));
  return payload;
}

async function openExternal(url) {
  if (window.nexforge?.openExternalUrl) {
    await window.nexforge.openExternalUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function LinkedAccountChips({ links, className = '' }) {
  const shown = (links || []).filter((l) => {
    if (!l?.provider || !['discord', 'steam', 'riot', 'epic'].includes(l.provider)) return false;
    return !l.status || l.status === 'verified';
  });
  if (!shown.length) return null;
  return (
    <div className={`linked-chip-row ${className}`}>
      {shown.map((l) => {
        const meta = LINK_PROVIDERS.find((p) => p.id === l.provider);
        return (
          <span
            key={l.provider}
            className="linked-chip"
            style={{ borderColor: `${meta?.color || '#c9ff00'}55` }}
            title={`${meta?.label || l.provider}: ${l.handle}`}
          >
            <span className="linked-chip-dot" style={{ background: meta?.color || '#c9ff00' }} />
            <span className="linked-chip-provider">{meta?.label || l.provider}</span>
            <span className="linked-chip-handle">{l.handle}</span>
          </span>
        );
      })}
    </div>
  );
}

export default function VerifiedStatsPanel() {
  const { user, profile, refreshProfile, showToast, reportCloudError, guestMode } = useNexForge();
  const [links, setLinks] = useState([]);
  const [drafts, setDrafts] = useState(EMPTY_DRAFTS);
  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [capabilities, setCapabilities] = useState({
    discord: false,
    steam: true,
    riot: false,
    epic: false,
  });
  const [pollingUntil, setPollingUntil] = useState(0);
  const [pollBaseline, setPollBaseline] = useState(null);
  const [showHandle, setShowHandle] = useState({});

  const load = useCallback(async (opts = {}) => {
    if (!user || guestMode) {
      setLinks([]);
      return;
    }
    if (!opts.silent) setLoading(true);
    try {
      const { data, error } = await sb.rpc('get_my_stat_links');
      if (error) throw error;
      setLinks(Array.isArray(data?.links) ? data.links : []);
    } catch (err) {
      console.warn('get_my_stat_links failed', err);
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, [user, guestMode]);

  const loadCapabilities = useCallback(async () => {
    if (!user || guestMode) return;
    try {
      const data = await invokeLinkStart({ action: 'capabilities' });
      if (data?.capabilities) setCapabilities((c) => ({ ...c, ...data.capabilities }));
    } catch {
      /* functions not deployed yet — handle linking still works */
    }
  }, [user, guestMode]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCapabilities(); }, [loadCapabilities]);

  useEffect(() => {
    if (!pollingUntil || Date.now() > pollingUntil) return undefined;
    const tick = () => {
      if (Date.now() > pollingUntil) {
        setPollingUntil(0);
        return;
      }
      load({ silent: true });
    };
    const id = setInterval(tick, 2000);
    const onFocus = () => load({ silent: true });
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [pollingUntil, load]);

  useEffect(() => {
    if (pollBaseline == null || !pollingUntil) return;
    const verifiedCount = links.filter((l) => l.status === 'verified').length;
    if (verifiedCount > pollBaseline) {
      setPollingUntil(0);
      setPollBaseline(null);
    }
  }, [links, pollBaseline, pollingUntil]);

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
      showToast(err?.message || 'Account linking failed.', 'error');
      await reportCloudError(err);
    } finally {
      setBusy(null);
    }
  }

  async function connectOAuth(provider) {
    if (busy) return;
    setBusy(`oauth-${provider}`);
    try {
      const data = await invokeLinkStart({ provider });
      if (data?.capabilities) setCapabilities((c) => ({ ...c, ...data.capabilities }));
      if (!data?.url) throw new Error('No linking URL returned');
      await openExternal(data.url);
      setPollBaseline(links.filter((l) => l.status === 'verified').length);
      setPollingUntil(Date.now() + 2 * 60 * 1000);
      showToast('Finish linking in your browser, then come back here.', 'success');
    } catch (err) {
      if (err?.code === 'oauth_not_configured') {
        if (err.capabilities) setCapabilities((c) => ({ ...c, ...err.capabilities }));
        setShowHandle((s) => ({ ...s, [provider]: true }));
        showToast(err.message || 'OAuth is not set up — enter a handle instead.', 'error');
      } else {
        showToast(err?.message || 'Could not start linking.', 'error');
        await reportCloudError(err);
      }
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

  const oauthWaiting = pollingUntil > Date.now();

  return (
    <div className="card verified-panel">
      <div className="card-title">Linked accounts</div>
      <div className="verified-sub">
        Connect Discord, Steam, Riot, and Epic so friends can see the real accounts behind your tag.
        Steam signs in with OpenID. Discord / Riot / Epic use OAuth when those apps are configured;
        otherwise you can still attach a handle and confirm it.
      </div>

      <LinkedAccountChips links={links} />

      {oauthWaiting && (
        <div className="verified-code-box" style={{ marginTop: 10 }}>
          Waiting for the browser to finish linking… this updates automatically when you come back.
        </div>
      )}

      {loading && links.length === 0 ? (
        <div className="verified-empty">Loading links…</div>
      ) : (
        <div className="verified-list">
          {LINK_PROVIDERS.map((p) => {
            const link = linkFor(p.id);
            const oauthReady = p.oauthLabel && capabilities[p.id];
            const handleOpen = showHandle[p.id] || !oauthReady;
            return (
              <div className="verified-row" key={p.id}>
                <div className="verified-row-head">
                  <div>
                    <div className="verified-provider">
                      <span className="linked-chip-dot" style={{ background: p.color, marginRight: 8 }} />
                      {p.label}
                    </div>
                    <div className="verified-hint">{p.hint}</div>
                  </div>
                  {link?.status === 'verified' && (
                    <span className="badge badge-neon">
                      {link.link_method === 'handle' ? 'LINKED' : 'VERIFIED'}
                    </span>
                  )}
                  {link?.status === 'pending' && (
                    <span className="badge badge-muted">PENDING</span>
                  )}
                </div>

                {!link && (
                  <div className="verified-link-form" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    {p.oauthLabel && (
                      <button
                        type="button"
                        className="action-btn primary"
                        style={{ padding: '8px 12px', fontSize: 12, alignSelf: 'flex-start' }}
                        disabled={!!busy}
                        onClick={() => connectOAuth(p.id)}
                      >
                        {busy === `oauth-${p.id}` ? 'Opening…' : p.oauthLabel}
                      </button>
                    )}
                    {p.oauthLabel && oauthReady && !handleOpen && (
                      <button
                        type="button"
                        className="verified-handle-toggle"
                        onClick={() => setShowHandle((s) => ({ ...s, [p.id]: true }))}
                      >
                        Or enter a handle
                      </button>
                    )}
                    {handleOpen && (
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
                          className="action-btn ghost"
                          style={{ padding: '8px 12px', fontSize: 12 }}
                          disabled={!!busy}
                          onClick={() => linkAccount(p.id)}
                        >
                          Link handle
                        </button>
                      </div>
                    )}
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
                    <div className="verified-actions">
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
