import { sb, SUPABASE_URL, SUPABASE_KEY } from './supabase.js';

/** True when a stored JWT/session is bad and breaks PostgREST calls. */
export function isAuthSessionError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  const code = String(err?.code || err?.status || '');
  return (
    code === 'PGRST301' ||
    code === 'PGRST303' ||
    code === '401' ||
    msg.includes('jwt') ||
    msg.includes('invalid claim') ||
    msg.includes('refresh_token') ||
    msg.includes('session from session') ||
    msg.includes('invalid token') ||
    msg.includes('not authorized') ||
    msg.includes('no suitable key') ||
    msg.includes('wrong key type')
  );
}

/** True when Supabase itself looks unreachable (not a permission/validation error). */
export function isCloudUnreachableError(err) {
  if (!err) return false;
  if (isAuthSessionError(err)) return false;
  const msg = String(err?.message || err || '').toLowerCase();
  const name = String(err?.name || '');
  // Media / WebRTC failures often surface as TypeError: Failed to fetch in Chromium —
  // those are not cloud outages.
  if (
    name === 'NotAllowedError'
    || name === 'NotFoundError'
    || name === 'NotReadableError'
    || name === 'OverconstrainedError'
    || name === 'AbortError'
    || msg.includes('permission denied')
    || msg.includes('getusermedia')
    || msg.includes('requested device not found')
    || msg.includes('could not start audio')
    || msg.includes('microphone')
  ) {
    return false;
  }
  const status = Number(err?.status || err?.statusCode || 0);
  if (status >= 500 && status <= 599) return true;
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('err_connection') ||
    msg.includes('err_name_not_resolved') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('cloudflare') && msg.includes('error')
  );
}

/** Wipe a corrupt local Supabase session so the anon key can talk to PostgREST again. */
export async function clearLocalAuthSession() {
  try {
    await sb.auth.signOut({ scope: 'local' });
  } catch {
    /* ignore */
  }
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('sb-') || k.includes('supabase.auth'))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/**
 * Ensure any persisted session is still valid with Auth.
 * Corrupt/expired tokens otherwise make every table query return 401 ("Local-only mode").
 */
export async function recoverAuthSession() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return { session: null, recovered: false };

    const { data: { user }, error } = await sb.auth.getUser();
    if (!error && user) return { session, recovered: false };

    await clearLocalAuthSession();
    return { session: null, recovered: true };
  } catch {
    await clearLocalAuthSession();
    return { session: null, recovered: true };
  }
}

/** Lightweight reachability check that recovers from bad JWTs once. */
export async function probeSupabaseCloud() {
  let { error } = await sb.from('profiles').select('id').limit(1);
  if (error && isAuthSessionError(error)) {
    await clearLocalAuthSession();
    ({ error } = await sb.from('profiles').select('id').limit(1));
    return { ok: !error, recoveredAuth: true, error: error || null };
  }
  if (!error) return { ok: true, recoveredAuth: false, error: null };

  // Fallback raw fetch — proves DNS/TLS even if the JS client is wedged.
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id&limit=1`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (res.ok) return { ok: true, recoveredAuth: false, error: null };
    return { ok: false, recoveredAuth: false, error: { message: `HTTP ${res.status}` } };
  } catch (err) {
    return { ok: false, recoveredAuth: false, error: err };
  }
}
