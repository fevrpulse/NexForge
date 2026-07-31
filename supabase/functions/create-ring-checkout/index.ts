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
  if (!authorization) {
    return json({ error: "Not authenticated" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = resolvePublishableKey();
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");

  if (!stripeSecret) {
    console.error("Missing STRIPE_SECRET_KEY secret");
    return json({
      error: "Stripe is not configured. Set STRIPE_SECRET_KEY in Supabase Edge Function secrets.",
    }, 503);
  }
  if (!supabaseUrl || !publishableKey) {
    console.error("Missing SUPABASE_URL or publishable/anon key");
    return json({ error: "Payments backend is missing Supabase configuration" }, 503);
  }

  const supabase = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const jwt = authorization.replace(/^Bearer\s+/i, "");
  const { data: authData, error: authError } = await supabase.auth.getUser(jwt);
  const user = authData.user;
  if (authError || !user) {
    return json({ error: "Invalid session" }, 401);
  }

  let cosmeticId = "";
  try {
    const body = await req.json();
    cosmeticId = String(body?.cosmeticId || "");
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const { data: cosmetic, error: cosmeticError } = await supabase
    .from("cosmetics")
    .select("id,name,real_money_cents,rarity")
    .eq("id", cosmeticId)
    .maybeSingle();
  if (cosmeticError || !cosmetic) {
    return json({ error: "Unknown cosmetic" }, 404);
  }

  const amount = Number(cosmetic.real_money_cents) || 0;
  if (amount <= 0) {
    return json({ error: "This item is not available for cash purchase" }, 400);
  }
  if (amount > 699) {
    return json({ error: "Invalid catalog price" }, 500);
  }

  const { data: owned } = await supabase
    .from("user_cosmetics")
    .select("cosmetic_id")
    .eq("user_id", user.id)
    .eq("cosmetic_id", cosmeticId)
    .maybeSingle();
  if (owned) {
    return json({ error: "You already own this item" }, 409);
  }

  const returnUrl = `${supabaseUrl}/functions/v1/stripe-checkout-return`;
  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${returnUrl}?status=success`,
    cancel_url: `${returnUrl}?status=cancelled`,
    client_reference_id: user.id,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(amount),
    "line_items[0][price_data][product_data][name]": `NexForge ${cosmetic.name}`,
    "line_items[0][price_data][product_data][description]":
      "Permanent NexForge cosmetic entitlement",
    "line_items[0][quantity]": "1",
    "metadata[user_id]": user.id,
    "metadata[cosmetic_id]": cosmeticId,
    "payment_intent_data[metadata][user_id]": user.id,
    "payment_intent_data[metadata][cosmetic_id]": cosmeticId,
  });
  if (user.email) {
    params.set("customer_email", user.email);
  }

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
    console.error(
      "Stripe session creation failed",
      session?.error?.type,
      session?.error?.code,
      session?.error?.message,
    );
    return json({
      error: session?.error?.message || "Could not start secure checkout",
    }, 502);
  }

  return json({ url: session.url, cosmeticId, amount });
});
