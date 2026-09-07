import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

function xmlTag(xml: string, tag: string) {
  const cdata = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i"));
  if (cdata) return cdata[1].trim();
  const plain = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return plain ? plain[1].trim() : "";
}

function steamProfileUrls(handle: string) {
  const trimmed = handle.trim();
  const idMatch = trimmed.match(/(\d{17})/);
  const vanityMatch = trimmed.match(/steamcommunity\.com\/(?:id|profiles)\/([^/?#]+)/i);
  const vanity = vanityMatch ? vanityMatch[1] : (!idMatch && /^[a-z0-9_-]{3,32}$/i.test(trimmed) ? trimmed : "");
  const urls: string[] = [];
  if (idMatch) urls.push(`https://steamcommunity.com/profiles/${idMatch[1]}/?xml=1`);
  if (vanity) urls.push(`https://steamcommunity.com/id/${encodeURIComponent(vanity)}/?xml=1`);
  return urls;
}

async function fetchSteamXml(handle: string) {
  const errors: string[] = [];
  for (const url of steamProfileUrls(handle)) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) NexForge/4.7",
          Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (!res.ok) {
        errors.push(`${url} → ${res.status}`);
        continue;
      }
      const xml = await res.text();
      if (/<privacyMessage>/i.test(xml) || /This user has not yet set up their profile/i.test(xml)) {
        throw new Error("That Steam profile is private or not set up. Make it public and try again.");
      }
      const steamId64 = xmlTag(xml, "steamID64");
      if (!/^\d{17}$/.test(steamId64)) {
        errors.push(`${url} had no SteamID64`);
        continue;
      }
      const privacy = xmlTag(xml, "privacyState").toLowerCase();
      if (privacy && privacy !== "public") {
        throw new Error("That Steam profile is not public. Set profile and About to public, then try again.");
      }
      return {
        steamId64,
        persona: xmlTag(xml, "steamID") || steamId64,
        summary: [
          xmlTag(xml, "summary"),
          xmlTag(xml, "headline"),
          xmlTag(xml, "realname"),
          xmlTag(xml, "customURL"),
        ].filter(Boolean).join(" "),
        avatar: xmlTag(xml, "avatarFull") || xmlTag(xml, "avatarMedium") || xmlTag(xml, "avatarIcon"),
        profileUrl: xmlTag(xml, "profileURL") || `https://steamcommunity.com/profiles/${steamId64}`,
      };
    } catch (err) {
      if (err instanceof Error && /private/i.test(err.message)) throw err;
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(errors[0] || "Could not load that Steam profile");
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

  let body: { provider?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const provider = String(body.provider || "").toLowerCase();
  if (provider !== "steam") {
    return json({
      error: provider === "discord" || provider === "riot" || provider === "epic"
        ? `Connect ${provider} to prove you own that account. A typed handle is not enough.`
        : "Only Steam profile codes can be verified this way. Use Connect for Discord, Riot, and Epic.",
    }, 400);
  }

  const { data: pendingRaw, error: pendingErr } = await userClient.rpc("get_pending_stat_link", {
    p_provider: "steam",
  });
  if (pendingErr) return json({ error: pendingErr.message || "Could not read pending link" }, 500);
  let pending: { found?: boolean; handle?: string; verify_code?: string } = {};
  try {
    pending = typeof pendingRaw === "string" ? JSON.parse(pendingRaw) : (pendingRaw || {});
  } catch {
    pending = {};
  }
  if (!pending?.found || !pending.verify_code) {
    return json({ error: "Start a Steam link first, then put the code in your public Steam About." }, 400);
  }

  let profile;
  try {
    profile = await fetchSteamXml(String(pending.handle));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Could not load Steam profile" }, 400);
  }

  const code = String(pending.verify_code).toUpperCase();
  const haystack = `${profile.summary} ${profile.persona}`.toUpperCase();
  if (!haystack.includes(code)) {
    return json({
      error: `Could not find ${pending.verify_code} on that Steam profile. Paste it into your public About, save, then verify again.`,
      code: "code_not_found",
    }, 400);
  }

  const { error: saveErr } = await admin.rpc("_internal_complete_oauth_link", {
    p_user_id: user.id,
    p_provider: "steam",
    p_external_id: profile.steamId64,
    p_handle: profile.persona || pending.handle,
    p_avatar_url: profile.avatar || "",
    p_link_method: "proof",
    p_meta: {
      verified_via: "steam_profile_bio",
      profileurl: profile.profileUrl,
      steamid64: profile.steamId64,
    },
  });
  if (saveErr) {
    return json({ error: saveErr.message || "Could not save Steam link" }, 500);
  }

  const { data: links } = await userClient.rpc("get_my_stat_links");
  return json({
    ok: true,
    provider: "steam",
    handle: profile.persona || pending.handle,
    links: links?.links || [],
  });
});
