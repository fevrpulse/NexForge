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

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tourney } = await admin
    .from("tournaments")
    .select("id,host_id,status,prize_type,cash_amount,prize_funded,winner_id,payout_status,stripe_checkout_session_id,stripe_transfer_id")
    .eq("id", tournamentId)
    .maybeSingle();
  if (!tourney) return json({ error: "Tournament not found" }, 404);
  if (tourney.status !== "completed") return json({ error: "Tournament is not completed yet" }, 400);
  if (!tourney.prize_funded || !["cash", "both"].includes(String(tourney.prize_type))) {
    return json({ error: "No escrowed cash prize to pay" }, 400);
  }
  if (!tourney.winner_id) return json({ error: "Winner has not been recorded" }, 400);
  if (tourney.stripe_transfer_id || tourney.payout_status === "paid") {
    return json({ ok: true, alreadyPaid: true, transferId: tourney.stripe_transfer_id });
  }
  // Host or winner may trigger payout attempt
  if (user.id !== tourney.host_id && user.id !== tourney.winner_id) {
    return json({ error: "Only host or winner can request payout" }, 403);
  }

  const { data: winner } = await admin
    .from("payout_accounts")
    .select("user_id,stripe_connect_account_id,stripe_connect_onboarded")
    .eq("user_id", tourney.winner_id)
    .maybeSingle();
  if (!winner?.stripe_connect_account_id) {
    await admin.from("tournaments").update({
      payout_status: "awaiting_winner_onboarding",
    }).eq("id", tourney.id);
    return json({
      ok: false,
      needsOnboarding: true,
      error: "Winner must complete Stripe Connect onboarding to receive the prize",
    }, 409);
  }

  const amountCents = Math.round(Number(tourney.cash_amount || 0) * 100);
  if (amountCents < 100) return json({ error: "Invalid prize amount" }, 400);

  // Idempotent ledger row
  const { data: existing } = await admin
    .from("tournament_payouts")
    .select("id,stripe_transfer_id,status")
    .eq("tournament_id", tourney.id)
    .maybeSingle();
  if (existing?.stripe_transfer_id) {
    return json({ ok: true, alreadyPaid: true, transferId: existing.stripe_transfer_id });
  }

  if (!existing) {
    await admin.from("tournament_payouts").insert({
      tournament_id: tourney.id,
      winner_id: tourney.winner_id,
      amount_cents: amountCents,
      currency: "usd",
      stripe_checkout_session_id: tourney.stripe_checkout_session_id,
      status: "pending",
    });
  }

  const transferRes = await fetch("https://api.stripe.com/v1/transfers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `tourney-payout-${tourney.id}`,
    },
    body: new URLSearchParams({
      amount: String(amountCents),
      currency: "usd",
      destination: winner.stripe_connect_account_id,
      "metadata[tournament_id]": tourney.id,
      "metadata[winner_id]": tourney.winner_id,
    }),
  });
  const transfer = await transferRes.json();
  if (!transferRes.ok || !transfer?.id) {
    await admin.from("tournaments").update({
      payout_status: "failed",
    }).eq("id", tourney.id);
    await admin.from("tournament_payouts").update({
      status: "failed",
    }).eq("tournament_id", tourney.id);
    return json({
      error: transfer?.error?.message || "Stripe transfer failed. Ensure Connect transfers are enabled.",
    }, 502);
  }

  await admin.from("tournaments").update({
    payout_status: "paid",
    stripe_transfer_id: transfer.id,
  }).eq("id", tourney.id);
  await admin.from("tournament_payouts").update({
    status: "paid",
    stripe_transfer_id: transfer.id,
  }).eq("tournament_id", tourney.id);
  await admin.from("payout_accounts").upsert({
    user_id: winner.user_id,
    stripe_connect_account_id: winner.stripe_connect_account_id,
    stripe_connect_onboarded: true,
    updated_at: new Date().toISOString(),
  });

  return json({ ok: true, transferId: transfer.id, amountCents });
});
