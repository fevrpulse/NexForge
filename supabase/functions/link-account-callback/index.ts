import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const OAUTH_PROVIDERS = ["discord", "steam", "riot", "epic"] as const;
type Provider = typeof OAUTH_PROVIDERS[number];

function html(title: string, message: string, ok: boolean) {
  const accent = ok ? "#c9ff00" : "#ff3d1f";
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — NexForge</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#080808; color:#efefef; font-family:'Nunito',sans-serif; }
    .box { text-align:center; max-width:440px; padding:40px; border:1px solid #242424; border-radius:16px; background:#101010; }
    h1 { font-size:24px; margin:0 0 8px; }
    h1 span { color:${accent}; }
    p { font-family:'JetBrains Mono',monospace; font-size:12px; color:#888; line-height:1.7; margin:0; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Nex<span>Forge</span></h1>
    <p>${message}</p>
  </div>
</body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
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

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => (
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] || ch
  ));
}

async function consumeState(
  admin: ReturnType<typeof createClient>,
  nonce: string,
  provider: Provider,
) {
  const { data, error } = await admin.rpc("_internal_take_link_state", { p_nonce: nonce });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.user_id) return null;
  if (String(row.provider) !== provider) return null;
  return row as { user_id: string; provider: string };
}

async function finishLink(
  admin: ReturnType<typeof createClient>,
  userId: string,
  provider: Provider,
  externalId: string,
  handle: string,
  avatarUrl: string,
  method: "oauth" | "openid",
  meta: Record<string, unknown>,
) {
  const { data, error } = await admin.rpc("_internal_complete_oauth_link", {
    p_user_id: userId,
    p_provider: provider,
    p_external_id: externalId,
    p_handle: handle,
    p_avatar_url: avatarUrl,
    p_link_method: method,
    p_meta: meta,
  });
  if (error) throw new Error(error.message || "Could not save linked account");
  return data;
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return html("Link failed", "Linking backend is misconfigured.", false);
  }

  const url = new URL(req.url);
  const provider = String(url.searchParams.get("provider") || "").toLowerCase() as Provider;
  if (!OAUTH_PROVIDERS.includes(provider)) {
    return html("Link failed", "Unknown account provider.", false);
  }

  if (url.searchParams.get("error")) {
    const desc = url.searchParams.get("error_description") || url.searchParams.get("error") || "cancelled";
    return html("Link cancelled", escapeHtml(desc), false);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    let nonce = url.searchParams.get("state") || "";
    let externalId = "";
    let handle = "";
    let avatarUrl = "";
    let method: "oauth" | "openid" = "oauth";
    const meta: Record<string, unknown> = {};

    if (provider === "steam") {
      method = "openid";
      const claimed = url.searchParams.get("openid.claimed_id") || "";
      const steamMatch = claimed.match(/\/openid\/id\/(\d{17})$/);
      if (!steamMatch) throw new Error("Steam did not return a SteamID");

      const verify = new URLSearchParams();
      for (const [key, value] of url.searchParams.entries()) {
        if (key.startsWith("openid.")) verify.set(key, value);
      }
      verify.set("openid.mode", "check_authentication");
      const verifyRes = await fetch("https://steamcommunity.com/openid/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: verify.toString(),
      });
      const verifyText = await verifyRes.text();
      if (!/is_valid\s*:\s*true/i.test(verifyText)) {
        throw new Error("Steam could not verify this login");
      }

      nonce = url.searchParams.get("state") || "";
      externalId = steamMatch[1];
      handle = externalId;

      const steamKey = await readSecret(admin, "steam_api_key");
      if (steamKey) {
        const sumUrl = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
        sumUrl.searchParams.set("key", steamKey);
        sumUrl.searchParams.set("steamids", externalId);
        const sumRes = await fetch(sumUrl);
        if (sumRes.ok) {
          const sumJson = await sumRes.json();
          const player = sumJson?.response?.players?.[0];
          if (player?.personaname) handle = String(player.personaname);
          if (player?.avatarfull) avatarUrl = String(player.avatarfull);
          if (player?.profileurl) meta.profileurl = player.profileurl;
        }
      }
    } else {
      const code = url.searchParams.get("code") || "";
      if (!code) throw new Error("Missing OAuth code");
      if (!nonce) throw new Error("Missing OAuth state");
      const redirect = callbackUrl(supabaseUrl, provider);

      if (provider === "discord") {
        const clientId = await readSecret(admin, "discord_client_id");
        const clientSecret = await readSecret(admin, "discord_client_secret");
        if (!clientId || !clientSecret) throw new Error("Discord linking is not configured");
        const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "authorization_code",
            code,
            redirect_uri: redirect,
          }),
        });
        const tokenJson = await tokenRes.json();
        if (!tokenRes.ok || !tokenJson?.access_token) {
          throw new Error(tokenJson?.error_description || "Discord token exchange failed");
        }
        const meRes = await fetch("https://discord.com/api/users/@me", {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        });
        const me = await meRes.json();
        if (!meRes.ok || !me?.id) throw new Error("Could not read Discord profile");
        externalId = String(me.id);
        handle = me.discriminator && me.discriminator !== "0"
          ? `${me.username}#${me.discriminator}`
          : String(me.global_name || me.username || me.id);
        if (me.avatar) {
          avatarUrl = `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png`;
        }
        meta.username = me.username;
      } else if (provider === "riot") {
        const clientId = await readSecret(admin, "riot_client_id");
        const clientSecret = await readSecret(admin, "riot_client_secret");
        if (!clientId || !clientSecret) throw new Error("Riot linking is not configured");
        const basic = btoa(`${clientId}:${clientSecret}`);
        const tokenRes = await fetch("https://auth.riotgames.com/token", {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirect,
          }),
        });
        const tokenJson = await tokenRes.json();
        if (!tokenRes.ok || !tokenJson?.access_token) {
          throw new Error(tokenJson?.error_description || tokenJson?.error || "Riot token exchange failed");
        }
        const meRes = await fetch("https://auth.riotgames.com/userinfo", {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        });
        const me = await meRes.json();
        if (!meRes.ok || !me?.sub) throw new Error("Could not read Riot profile");
        externalId = String(me.sub);
        const gameName = me.acct?.game_name || me.gameName || me.preferred_username;
        const tagLine = me.acct?.tag_line || me.tagLine;
        handle = gameName && tagLine ? `${gameName}#${tagLine}` : String(gameName || me.sub);
        meta.iss = me.iss;
      } else if (provider === "epic") {
        const clientId = await readSecret(admin, "epic_client_id");
        const clientSecret = await readSecret(admin, "epic_client_secret");
        if (!clientId || !clientSecret) throw new Error("Epic linking is not configured");
        const basic = btoa(`${clientId}:${clientSecret}`);
        const tokenRes = await fetch("https://api.epicgames.dev/epic/oauth/v1/token", {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirect,
          }),
        });
        const tokenJson = await tokenRes.json();
        if (!tokenRes.ok || !tokenJson?.access_token) {
          throw new Error(tokenJson?.error_description || tokenJson?.error || "Epic token exchange failed");
        }
        const meRes = await fetch("https://api.epicgames.dev/epic/oauth/v1/userInfo", {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        });
        const me = await meRes.json();
        if (!meRes.ok || !(me?.sub || me?.id)) throw new Error("Could not read Epic profile");
        externalId = String(me.sub || me.id);
        handle = String(me.preferred_username || me.displayName || me.nickName || externalId);
        meta.iss = me.iss;
      }
    }

    if (!nonce) throw new Error("Missing link state — start again from NexForge");
    const state = await consumeState(admin, nonce, provider);
    if (!state) throw new Error("This link expired or was already used. Start again from NexForge.");

    await finishLink(admin, state.user_id, provider, externalId, handle, avatarUrl, method, meta);
    const label = provider === "epic" ? "Epic Games" : provider[0].toUpperCase() + provider.slice(1);
    return html(
      "Account linked",
      `${escapeHtml(label)} is linked as ${escapeHtml(handle)}. You can close this tab and return to NexForge.`,
      true,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not link account";
    return html("Link failed", escapeHtml(message), false);
  }
});
