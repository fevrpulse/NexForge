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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Not authenticated" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = resolvePublishableKey();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");

  if (!stripeSecret || !supabaseUrl || !serviceRoleKey || !publishableKey) {
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

  let sessionId = "";
  try {
    const body = await req.json();
    sessionId = String(body?.sessionId || body?.session_id || "");
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (!sessionId.startsWith("cs_")) {
    return json({ error: "Missing checkout session id" }, 400);
  }

  const stripeResponse = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${stripeSecret}` } },
  );
  const session = await stripeResponse.json();
  if (!stripeResponse.ok) {
    return json({ error: session?.error?.message || "Could not load checkout session" }, 502);
  }

  const metaUser = String(session?.metadata?.user_id || "");
  const cosmeticId = String(session?.metadata?.cosmetic_id || "");
  if (metaUser !== user.id) {
    return json({ error: "Checkout session does not belong to this account" }, 403);
  }
  if (session?.mode !== "payment" || session?.payment_status !== "paid") {
    return json({ ok: false, paid: false, status: session?.payment_status || "unpaid" });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: cosmetic } = await admin
    .from("cosmetics")
    .select("id,real_money_cents")
    .eq("id", cosmeticId)
    .maybeSingle();
  const expectedAmount = Number(cosmetic?.real_money_cents) || 0;
  const amount = Number(session?.amount_total);
  const currency = String(session?.currency || "").toLowerCase();
  if (!expectedAmount || amount !== expectedAmount || currency !== "usd" || expectedAmount > 699) {
    return json({ error: "Checkout data did not match the catalog" }, 400);
  }

  const { data: recorded } = await admin
    .from("cosmetic_payments")
    .select("stripe_checkout_session_id")
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();

  if (!recorded) {
    const { error: entitlementError } = await admin
      .from("user_cosmetics")
      .upsert(
        { user_id: user.id, cosmetic_id: cosmeticId },
        { onConflict: "user_id,cosmetic_id", ignoreDuplicates: true },
      );
    if (entitlementError) {
      return json({ error: "Could not grant purchase" }, 500);
    }

    const { error: auditError } = await admin.from("cosmetic_payments").insert({
      stripe_checkout_session_id: session.id,
      stripe_event_id: `confirm:${session.id}`,
      user_id: user.id,
      cosmetic_id: cosmeticId,
      amount_total: amount,
      currency,
    });
    if (auditError && auditError.code !== "23505") {
      return json({ error: "Could not record purchase" }, 500);
    }
  }

  return json({ ok: true, paid: true, cosmeticId });
});
