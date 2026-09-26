import React, { useCallback, useEffect, useRef, useState } from 'react';
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
    if (!l?.provider || !['discord', 'steam', 'riot', 'epic', 'tracker'].includes(l.provider)) return false;
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
  const { user, showToast, reportCloudError, guestMode } = useNexForge();
  const [links, setLinks] = useState([]);
  const [drafts, setDrafts] = useState(EMPTY_DRAFTS);
  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [capabilities, setCapabilities] = useState({
    discord: false,
    steam: false,
    riot: false,
    epic: false,
  });
  const [pollingUntil, setPollingUntil] = useState(0);
  const [pollBaseline, setPollBaseline] = useState(null);
  const pollVerifiedRef = useRef(new Set());

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
      if (!opts.silent) {
        pollVerifiedRef.current = new Set(
          (Array.isArray(data?.links) ? data.links : [])
            .filter((l) => l.status === 'verified')
            .map((l) => l.provider),
        );
      }
    } catch (err) {
      console.warn('get_my_stat_links failed', err);
      if (!opts.silent) {
        showToast(err?.message || 'Could not load linked accounts.', 'error');
      }
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, [user, guestMode, showToast]);

  const loadCapabilities = useCallback(async () => {
    if (!user || guestMode) return;
    try {
      const data = await invokeLinkStart({ action: 'capabilities' });
      if (data?.capabilities) setCapabilities((c) => ({ ...c, ...data.capabilities }));
    } catch {
      setCapabilities({ discord: false, steam: false, riot: false, epic: false });
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
    const verified = links.filter((l) => l.status === 'verified');
    if (verified.length > pollBaseline) {
      setPollingUntil(0);
      setPollBaseline(null);
      const prev = pollVerifiedRef.current;
      const added = verified.find((l) => !prev.has(l.provider));
      pollVerifiedRef.current = new Set(verified.map((l) => l.provider));
      showToast(
        added?.handle ? `${added.provider} linked as ${added.handle}` : 'Account linked',
        'success',
      );
    }
  }, [links, pollBaseline, pollingUntil, showToast]);

  function linkFor(provider) {
    return links.find((l) => l.provider === provider) || null;
  }

  async function run(key, action, okMsg) {
    if (busy) return;
    setBusy(key);
    try {
      const data = await action();
      if (data?.links) {
        setLinks(data.links);
        pollVerifiedRef.current = new Set(
          data.links.filter((l) => l.status === 'verified').map((l) => l.provider),
        );
      } else {
        await load();
      }
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
        showToast(err.message || 'This provider is not set up for sign-in yet. Type the handle and press Link.', 'error');
      } else {
        const msg = String(err?.message || '');
        showToast(
          /not found|404|Failed to send/i.test(msg)
            ? 'Sign-in linking is not live. Type the handle and press Link.'
            : (err?.message || 'Could not start linking.'),
          'error',
        );
        await reportCloudError(err);
      }
    } finally {
      setBusy(null);
    }
  }

  async function linkAccount(provider, handleOverride) {
    const handle = String(handleOverride || drafts[provider] || '').trim();
    if (!handle) {
      showToast('Enter a handle first.', 'error');
      return;
    }
    const label = LINK_PROVIDERS.find((p) => p.id === provider)?.label || 'Account';
    await run(`link-${provider}`, async () => {
      const { data, error } = await sb.rpc('link_stat_account', {
        p_provider: provider,
        p_handle: handle,
      });
      if (error) {
        const msg = String(error.message || '');
        if (/provider must be|stat_links_provider_check|violates check constraint/i.test(msg)) {
          throw new Error('Run v163-link-accounts-save.sql in Supabase, then link the account again.');
        }
        throw error;
      }
      const row = (data?.links || []).find((l) => l.provider === provider);
      if (row && row.status !== 'verified') {
        throw new Error('Run v163-link-accounts-save.sql in Supabase so this account stays on your profile.');
      }
      setDrafts((d) => ({ ...d, [provider]: '' }));
      return data;
    }, `${label} linked`);
  }

  function methodLabel(link) {
    if (link?.link_method === 'proof') return 'Verified via public Steam About';
    if (link?.link_method === 'openid') return 'Verified via Steam login';
    if (link?.link_method === 'oauth') return 'Verified via sign-in';
    if (link?.provider === 'tracker' || link?.link_method === 'handle') return 'Saved on your profile';
    return 'Verified on your NexForge profile';
  }

  async function unlink(provider) {
    await run(`unlink-${provider}`, async () => {
      const { data, error } = await sb.rpc('unlink_stat_account', { p_provider: provider });
      if (error) throw error;
      return data;
    }, 'Account unlinked');
  }

  if (guestMode || !user) return null;

  const oauthWaiting = pollingUntil > Date.now();

  return (
    <div className="card verified-panel">
      <div className="card-title">Linked accounts</div>
      <div className="verified-sub">
        Linked accounts stay on your profile and show up for friends.
        Type the name you use on that service and press Link.
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
                    <span className="badge badge-neon">VERIFIED</span>
                  )}
                  {link?.status === 'pending' && (
                    <span className="badge badge-muted">PENDING</span>
                  )}
                </div>

                {!link && (
                  <div className="verified-link-form" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    {p.oauthLabel && capabilities[p.id] && (
                      <button
                        type="button"
                        className="action-btn ghost"
                        style={{ padding: '8px 12px', fontSize: 12, alignSelf: 'flex-start' }}
                        disabled={!!busy}
                        onClick={() => connectOAuth(p.id)}
                      >
                        {busy === `oauth-${p.id}` ? 'Opening…' : p.oauthLabel}
                      </button>
                    )}
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
                        {busy === `link-${p.id}` ? 'Linking…' : 'Link'}
                      </button>
                    </div>
                  </div>
                )}

                {link?.status === 'pending' && (
                  <div className="verified-pending">
                    <div className="verified-handle">{link.handle}</div>
                    <div className="verified-hint">This name is not on your profile yet.</div>
                    <div className="verified-actions">
                      <button
                        type="button"
                        className="action-btn primary"
                        style={{ padding: '6px 10px', fontSize: 11 }}
                        disabled={!!busy}
                        onClick={() => linkAccount(p.id, link.handle)}
                      >
                        {busy === `link-${p.id}` ? 'Linking…' : 'Link'}
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
                  </div>
                )}

                {link?.status === 'verified' && (
                  <div className="verified-done">
                    <div className="verified-handle">{link.handle}</div>
                    <div className="verified-hint">{methodLabel(link)}</div>
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
