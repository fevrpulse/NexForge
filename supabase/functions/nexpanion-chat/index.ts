import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b";
const MAX_HISTORY = 16;
const MAX_MESSAGE_LEN = 2000;

const SYSTEM_PROMPT = `You are NexAI, the in-app AI companion for NexForge — a competitive gaming desktop + mobile companion platform.

Personality:
- Friendly, sharp, and hype without being cringe
- Concise by default (2–6 short paragraphs or tight bullets unless the user asks for depth)
- Great at FPS, battle royale, MOBAs, fighting games, and practical in-game advice
- You can answer anything, but lean into gaming strategy, warmup routines, tilt control, team comps, patch-notes-style tips, and NexForge features when relevant

NexForge context you may mention when asked:
- Friends DMs, parties, lobbies, clans, communities (Discord-style servers), matchmaking, tournaments, cosmetics shop, voice calls
- Companion phone web app for chat, party/lobby codes, and tournament check-in while desktop tracks games/overlays

Rules:
- Never invent private user data, match results, or API keys
- If unsure about a live patch number, say so and give evergreen advice
- No harmful or illegal instructions
- Stay in character as NexAI`;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function resolvePublishableKey() {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (!raw) return null;
  try {
    const keys = JSON.parse(raw);
    return keys.default || keys.anon || Object.values(keys)[0] || null;
  } catch {
    return null;
  }
}

function normalizeSecret(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let s = value.trim();
  if (!s) return null;
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(s)) s = s.replace(/^bearer\s+/i, "").trim();
  return s || null;
}

async function loadGroqKeys(service: ReturnType<typeof createClient>): Promise<string[]> {
  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    const next = normalizeSecret(value);
    if (next && !seen.has(next)) {
      seen.add(next);
      keys.push(next);
    }
  };

  const { data, error } = await service.rpc("_internal_get_app_secret", {
    p_name: "groq_api_key",
  });
  if (error) throw error;
  add(data);
  add(Deno.env.get("GROQ_API_KEY"));
  return keys;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) {
    return json({ error: "Not authenticated" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = resolvePublishableKey();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !serviceKey) {
    return json({ error: "NexAI backend is misconfigured" }, 503);
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jwt = authorization.replace(/^Bearer\s+/i, "");
  const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
  const user = authData.user;
  if (authError || !user) {
    return json({ error: "Invalid session" }, 401);
  }

  let message = "";
  let history: Array<{ role: string; content: string }> = [];
  try {
    const body = await req.json();
    message = String(body?.message || "").trim();
    if (Array.isArray(body?.history)) {
      history = body.history
        .filter((m: { role?: string; content?: string }) =>
          (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string"
        )
        .slice(-MAX_HISTORY)
        .map((m: { role: string; content: string }) => ({
          role: m.role,
          content: String(m.content).slice(0, MAX_MESSAGE_LEN),
        }));
    }
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  if (!message) {
    return json({ error: "Message required" }, 400);
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return json({ error: `Keep messages under ${MAX_MESSAGE_LEN} characters` }, 400);
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let groqKeys: string[] = [];
  try {
    groqKeys = await loadGroqKeys(service);
  } catch (err) {
    console.error("Failed loading Groq key", err);
    return json({ error: "NexAI is temporarily unavailable. Try again in a bit." }, 503);
  }
  if (!groqKeys.length) {
    return json({ error: "NexAI is temporarily unavailable. Try again in a bit." }, 503);
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: message },
  ];

  let groqRes: Response | null = null;
  let groqJson: { error?: { message?: string }; choices?: Array<{ message?: { content?: string } }> } = {};
  try {
    for (const groqKey of groqKeys) {
      groqRes = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages,
          temperature: 0.7,
          max_tokens: 1024,
        }),
      });
      groqJson = await groqRes.json().catch(() => ({}));
      if (groqRes.ok) break;
      const authFail = groqRes.status === 401 || groqRes.status === 403;
      console.error("Groq error", groqRes.status, groqJson);
      if (authFail && groqKey !== groqKeys[groqKeys.length - 1]) continue;
      break;
    }
  } catch (err) {
    console.error("Groq fetch failed", err);
    return json({ error: "Could not reach NexAI" }, 502);
  }

  if (!groqRes || !groqRes.ok) {
    const status = groqRes?.status || 502;
    if (status === 401 || status === 403) {
      return json({ error: "NexAI is temporarily unavailable. Try again in a bit." }, 502);
    }
    return json({ error: "NexAI request failed" }, 502);
  }

  const reply = groqJson?.choices?.[0]?.message?.content;
  if (!reply || typeof reply !== "string") {
    return json({ error: "Empty AI response" }, 502);
  }

  return json({
    reply: reply.trim(),
    model: GROQ_MODEL,
    assistant: "NexAI",
  });
});
