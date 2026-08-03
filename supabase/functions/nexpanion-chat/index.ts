import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const MAX_HISTORY = 16;
const MAX_MESSAGE_LEN = 2000;

const SYSTEM_PROMPT = `You are NexPanion, the in-app AI companion for NexForge — a competitive gaming desktop + mobile companion platform.

Personality:
- Friendly, sharp, and hype without being cringe
- Concise by default (2–6 short paragraphs or tight bullets unless the user asks for depth)
- Great at FPS, battle royale, MOBAs, fighting games, and ranked climb advice
- You can answer anything, but lean into gaming strategy, aim routines, tilt control, team comps, patch notes style tips, and NexForge features when relevant

NexForge context you may mention when asked:
- Friends DMs, parties, lobbies, clans, communities (Discord-style servers), matchmaking, tournaments, cosmetics shop, voice calls
- Companion phone web app for chat, party/lobby codes, and tournament check-in while desktop tracks games/overlays

Rules:
- Never invent private user data, match results, or API keys
- If unsure about a live patch number, say so and give evergreen advice
- No harmful or illegal instructions
- Stay in character as NexPanion`;

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

async function loadGroqKey(service: ReturnType<typeof createClient>) {
  const fromEnv = Deno.env.get("GROQ_API_KEY");
  if (fromEnv) return fromEnv;
  const { data, error } = await service.rpc("_internal_get_app_secret", {
    p_name: "groq_api_key",
  });
  if (error) throw error;
  return (typeof data === "string" && data) ? data : null;
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
    return json({ error: "NexPanion backend is misconfigured" }, 503);
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

  let groqKey: string | null = null;
  try {
    groqKey = await loadGroqKey(service);
  } catch (err) {
    console.error("Failed loading Groq key", err);
    return json({ error: "Could not load AI credentials" }, 503);
  }
  if (!groqKey) {
    return json({ error: "Groq is not configured" }, 503);
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: message },
  ];

  let groqRes: Response;
  try {
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
  } catch (err) {
    console.error("Groq fetch failed", err);
    return json({ error: "Could not reach Groq" }, 502);
  }

  const groqJson = await groqRes.json().catch(() => ({}));
  if (!groqRes.ok) {
    console.error("Groq error", groqRes.status, groqJson);
    const detail = typeof groqJson?.error?.message === "string"
      ? groqJson.error.message
      : "Groq request failed";
    return json({ error: detail }, 502);
  }

  const reply = groqJson?.choices?.[0]?.message?.content;
  if (!reply || typeof reply !== "string") {
    return json({ error: "Empty AI response" }, 502);
  }

  return json({
    reply: reply.trim(),
    model: GROQ_MODEL,
    assistant: "NexPanion",
  });
});
