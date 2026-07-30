import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const expectedPurchases: Record<string, number> = {
  frame_pulse: 499,
  frame_spin: 699,
};

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function verifyStripeSignature(body: string, header: string, secret: string) {
  const parts = header.split(",");
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3).toLowerCase());
  if (!timestamp || signatures.length === 0) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const expected = hex(digest);
  return signatures.some((signature) => constantTimeEqual(signature, expected));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error("Stripe webhook is missing server configuration");
    return new Response("Server configuration error", { status: 503 });
  }

  const signature = req.headers.get("Stripe-Signature");
  const rawBody = await req.text();
  if (!signature || !(await verifyStripeSignature(rawBody, signature, webhookSecret))) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = event.data?.object;
  const userId = String(session?.metadata?.user_id || "");
  const cosmeticId = String(session?.metadata?.cosmetic_id || "");
  const amount = Number(session?.amount_total);
  const currency = String(session?.currency || "").toLowerCase();
  const expectedAmount = expectedPurchases[cosmeticId];
  const validUserId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(userId);

  if (
    session?.mode !== "payment" ||
    session?.payment_status !== "paid" ||
    !validUserId ||
    !expectedAmount ||
    amount !== expectedAmount ||
    currency !== "usd"
  ) {
    console.error("Rejected inconsistent Stripe checkout session", session?.id);
    return new Response("Checkout data did not match the catalog", { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: recorded } = await admin
    .from("cosmetic_payments")
    .select("stripe_checkout_session_id")
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();
  if (recorded) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error: entitlementError } = await admin
    .from("user_cosmetics")
    .upsert(
      { user_id: userId, cosmetic_id: cosmeticId },
      { onConflict: "user_id,cosmetic_id", ignoreDuplicates: true },
    );
  if (entitlementError) {
    console.error("Could not grant cosmetic", entitlementError.code);
    return new Response("Could not grant purchase", { status: 500 });
  }

  const { error: auditError } = await admin.from("cosmetic_payments").insert({
    stripe_checkout_session_id: session.id,
    stripe_event_id: event.id,
    user_id: userId,
    cosmetic_id: cosmeticId,
    amount_total: amount,
    currency,
  });
  if (auditError && auditError.code !== "23505") {
    console.error("Could not record payment", auditError.code);
    return new Response("Could not record purchase", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
