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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Not authenticated" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = resolvePublishableKey();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey || !stripeSecret) {
    return json({ error: "Payments backend is not configured" }, 503);
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const jwt = authorization.replace(/^Bearer\s+/i, "");
  const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
  const user = authData.user;
  if (authError || !user) return json({ error: "Invalid session" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: stored } = await admin
    .from("payout_accounts")
    .select("stripe_connect_account_id,stripe_connect_onboarded")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: profile } = await admin
    .from("profiles")
    .select("id,gamer_tag")
    .eq("id", user.id)
    .maybeSingle();

  let accountId = stored?.stripe_connect_account_id || "";
  if (!accountId) {
    const createRes = await fetch("https://api.stripe.com/v1/accounts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        type: "express",
        "capabilities[transfers][requested]": "true",
        "metadata[nexforge_user_id]": user.id,
        ...(user.email ? { email: user.email } : {}),
      }),
    });
    const account = await createRes.json();
    if (!createRes.ok || !account?.id) {
      return json({
        error: account?.error?.message || "Could not create Stripe Connect account",
      }, 502);
    }
    accountId = account.id;
    await admin.from("payout_accounts").upsert({
      user_id: user.id,
      stripe_connect_account_id: accountId,
      stripe_connect_onboarded: false,
      updated_at: new Date().toISOString(),
    });
  }

  const refreshUrl = `${supabaseUrl}/functions/v1/stripe-checkout-return?status=success`;
  const returnUrl = `${supabaseUrl}/functions/v1/stripe-checkout-return?status=success`;
  const linkRes = await fetch("https://api.stripe.com/v1/account_links", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    }),
  });
  const link = await linkRes.json();
  if (!linkRes.ok || !link?.url) {
    return json({ error: link?.error?.message || "Could not start Connect onboarding" }, 502);
  }

  return json({ url: link.url, accountId });
});
