import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OAUTH_PROVIDERS = ["discord", "steam", "riot", "epic"] as const;
type Provider = typeof OAUTH_PROVIDERS[number];

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

function envName(secretName: string) {
  return secretName.toUpperCase();
}

async function readSecret(
  admin: ReturnType<typeof createClient>,
  name: string,
): Promise<string> {
  const { data } = await admin.rpc("_internal_get_app_secret", { p_name: name });
  if (typeof data === "string" && data.trim()) return data.trim();
  const fromEnv = Deno.env.get(envName(name));
  return fromEnv?.trim() || "";
}

function callbackUrl(supabaseUrl: string, provider: Provider) {
  return `${supabaseUrl}/functions/v1/link-account-callback?provider=${provider}`;
}

function randomNonce() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Not authenticated" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = resolvePublishableKey();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !serviceKey) {
    return json({ error: "Linking backend is misconfigured" }, 503);
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jwt = authorization.replace(/^Bearer\s+/i, "");
  const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
  const user = authData.user;
  if (authError || !user) return json({ error: "Invalid session" }, 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: { action?: string; provider?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const [
    discordId,
    discordSecret,
    riotId,
    riotSecret,
    epicId,
    epicSecret,
  ] = await Promise.all([
    readSecret(admin, "discord_client_id"),
    readSecret(admin, "discord_client_secret"),
    readSecret(admin, "riot_client_id"),
    readSecret(admin, "riot_client_secret"),
    readSecret(admin, "epic_client_id"),
    readSecret(admin, "epic_client_secret"),
  ]);

  const capabilities = {
    discord: !!(discordId && discordSecret),
    steam: true,
    riot: !!(riotId && riotSecret),
    epic: !!(epicId && epicSecret),
  };

  if (body.action === "capabilities" || !body.provider) {
    return json({ capabilities });
  }

  const provider = String(body.provider || "").toLowerCase() as Provider;
  if (!OAUTH_PROVIDERS.includes(provider)) {
    return json({ error: "Unsupported provider" }, 400);
  }
  if (!capabilities[provider]) {
    return json({
      error: `${provider} OAuth is not configured yet. You can still enter a handle.`,
      code: "oauth_not_configured",
      capabilities,
    });
  }

  const nonce = randomNonce();
  const { error: stateErr } = await admin.rpc("_internal_create_link_state", {
    p_user_id: user.id,
    p_provider: provider,
    p_nonce: nonce,
    p_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (stateErr) {
    return json({ error: stateErr.message || "Could not start linking" }, 500);
  }

  const redirect = callbackUrl(supabaseUrl, provider);
  let url = "";

  if (provider === "discord") {
    const params = new URLSearchParams({
      client_id: discordId,
      redirect_uri: redirect,
      response_type: "code",
      scope: "identify",
      state: nonce,
      prompt: "consent",
    });
    url = `https://discord.com/oauth2/authorize?${params}`;
  } else if (provider === "steam") {
    const params = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": `${redirect}&state=${nonce}`,
      "openid.realm": `${supabaseUrl}/functions/v1/link-account-callback`,
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    });
    url = `https://steamcommunity.com/openid/login?${params}`;
  } else if (provider === "riot") {
    const params = new URLSearchParams({
      client_id: riotId,
      redirect_uri: redirect,
      response_type: "code",
      scope: "openid",
      state: nonce,
    });
    url = `https://auth.riotgames.com/authorize?${params}`;
  } else if (provider === "epic") {
    const params = new URLSearchParams({
      client_id: epicId,
      redirect_uri: redirect,
      response_type: "code",
      scope: "basic_profile",
      state: nonce,
    });
    url = `https://www.epicgames.com/id/authorize?${params}`;
  }

  return json({ url, provider, capabilities });
});
