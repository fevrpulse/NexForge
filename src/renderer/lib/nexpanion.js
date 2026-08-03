/**
 * NexPanion — Groq-powered AI companion (via Supabase edge function).
 */
import { sb } from './supabase.js';

export const NEXPANION_ID = '__nexpanion__';

export const NEXPANION_PROFILE = {
  id: NEXPANION_ID,
  gamer_tag: 'NexPanion',
  display_name: 'NexPanion',
  main_game: 'All games',
  platform: 'AI',
  mmr: 9999,
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
    let detail = error.message || 'NexPanion is unavailable';
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json();
        if (body?.error) detail = body.error;
      }
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(String(data.error));
  const reply = String(data?.reply || '').trim();
  if (!reply) throw new Error('Empty reply from NexPanion');
  return reply;
}
