import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const premiumRings = {
  frame_pulse: { name: "NexForge Pulse Ring", amount: 499 },
  frame_spin: { name: "NexForge Orbit Ring", amount: 699 },
} as const;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!supabaseUrl || !anonKey || !stripeSecret) {
    console.error("Stripe checkout is missing server configuration");
    return json({ error: "Payments are not configured yet" }, 503);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
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

  const ring = premiumRings[cosmeticId as keyof typeof premiumRings];
  if (!ring) {
    return json({ error: "This item is not available for cash purchase" }, 400);
  }

  const { data: owned } = await supabase
    .from("user_cosmetics")
    .select("cosmetic_id")
    .eq("user_id", user.id)
    .eq("cosmetic_id", cosmeticId)
    .maybeSingle();
  if (owned) {
    return json({ error: "You already own this ring" }, 409);
  }

  const returnUrl = `${supabaseUrl}/functions/v1/stripe-checkout-return`;
  const params = new URLSearchParams({
    mode: "payment",
    success_url: `${returnUrl}?status=success`,
    cancel_url: `${returnUrl}?status=cancelled`,
    client_reference_id: user.id,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(ring.amount),
    "line_items[0][price_data][product_data][name]": ring.name,
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
    console.error("Stripe session creation failed", session?.error?.type);
    return json({ error: "Could not start secure checkout" }, 502);
  }

  return json({ url: session.url, cosmeticId });
});
