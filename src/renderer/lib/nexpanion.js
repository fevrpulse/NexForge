/**
 * NexAI — Groq-powered AI companion (via Supabase edge function).
 */
import { sb } from './supabase.js';

export const NEXPANION_ID = '__nexpanion__';

export const NEXPANION_PROFILE = {
  id: NEXPANION_ID,
  gamer_tag: 'NexAI',
  display_name: 'NexAI',
  main_game: 'All games',
  platform: 'AI',
  custom_status: 'Ask me anything — especially gaming',
  last_seen_at: new Date().toISOString(),
  avatar_preset: 'circuit',
};

/**
 * @param {string} message
 * @param {Array<{role: string, content: string}>} [history]
 */
export async function askNexPanion(message, history = []) {
  const { data, error } = await sb.functions.invoke('nexpanion-chat', {
    body: { message, history },
  });
  if (error) {
    let detail = error.message || 'NexAI is unavailable';
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.error) detail = body.error;
      }
    } catch { /* ignore */ }
    throw new Error(friendlyNexAiError(detail));
  }
  if (data?.error) throw new Error(friendlyNexAiError(data.error));
  const reply = String(data?.reply || '').trim();
  if (!reply) throw new Error('Empty reply from NexAI');
  return reply;
}

export function friendlyNexAiError(detail) {
  const raw = String(detail || '');
  if (/not authenticated|invalid session/i.test(raw)) {
    return 'Sign in again to use NexAI.';
  }
  if (/empty reply|empty ai response|^empty$/i.test(raw)) {
    return 'NexAI sent a blank reply. Try asking again.';
  }
  if (/could not reach|failed to fetch|network|load failed/i.test(raw)) {
    return 'Could not reach NexAI. Check your connection and try again.';
  }
  if (
    /invalid api key|invalid_api_key|authenticate with groq|app_secrets|groq is not configured|could not load ai credentials|gsk_|bearer|openai\//i.test(raw)
    || /groq/i.test(raw)
  ) {
    return 'NexAI is temporarily unavailable. Try again in a bit.';
  }
  return raw || 'NexAI is unavailable';
}
