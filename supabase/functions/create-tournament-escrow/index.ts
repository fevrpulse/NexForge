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

  let tournamentId = "";
  try {
    const body = await req.json();
    tournamentId = String(body?.tournamentId || body?.tournament_id || "");
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  if (!tournamentId) return json({ error: "Missing tournament id" }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: tourney, error: tErr } = await admin
    .from("tournaments")
    .select("id,host_id,name,prize_type,cash_amount,prize_funded,status")
    .eq("id", tournamentId)
    .maybeSingle();
  if (tErr || !tourney) return json({ error: "Tournament not found" }, 404);
  if (tourney.host_id !== user.id) return json({ error: "Only the host can fund this prize" }, 403);
  if (!["cash", "both"].includes(String(tourney.prize_type))) {
    return json({ error: "This tournament has no cash prize to fund" }, 400);
  }
  if (tourney.prize_funded) return json({ error: "Prize already funded", funded: true }, 409);

  const dollars = Number(tourney.cash_amount) || 0;
  const amountCents = Math.round(dollars * 100);
  if (amountCents < 100) return json({ error: "Cash prize must be at least $1" }, 400);
  if (amountCents > 500000) return json({ error: "Cash prize exceeds platform limit" }, 400);

  const returnUrl = `${supabaseUrl}/functions/v1/stripe-checkout-return`;
  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${returnUrl}?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${returnUrl}?status=cancelled`,
    client_reference_id: user.id,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][price_data][product_data][name]": `NexForge prize escrow: ${tourney.name}`,
    "line_items[0][price_data][product_data][description]":
      "Escrowed cash prize held until the tournament winner is paid",
    "line_items[0][quantity]": "1",
    "metadata[kind]": "tournament_escrow",
    "metadata[user_id]": user.id,
    "metadata[tournament_id]": tourney.id,
    "payment_intent_data[metadata][kind]": "tournament_escrow",
    "payment_intent_data[metadata][tournament_id]": tourney.id,
    "payment_intent_data[metadata][user_id]": user.id,
  });
  if (user.email) params.set("customer_email", user.email);

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const session = await stripeResponse.json();
  if (!stripeResponse.ok || !session?.url) {
    return json({ error: session?.error?.message || "Could not start prize escrow checkout" }, 502);
  }

  await admin
    .from("tournaments")
    .update({ stripe_checkout_session_id: session.id })
    .eq("id", tourney.id);

  return json({ url: session.url, sessionId: session.id, tournamentId: tourney.id, amountCents });
});
