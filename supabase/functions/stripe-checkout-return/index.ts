import "jsr:@supabase/functions-js/edge-runtime.d.ts";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
}

Deno.serve((req) => {
  const status = new URL(req.url).searchParams.get("status") === "success"
    ? "success"
    : "cancelled";
  const title = status === "success" ? "Payment complete" : "Checkout cancelled";
  const message = status === "success"
    ? "Your ring is being added to NexForge. Return to the app; it will refresh automatically."
    : "Nothing was charged. You can return to NexForge whenever you are ready.";

  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · NexForge</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;
    background:#090b0f;color:#f4f6f8;font:16px system-ui,sans-serif}.card{width:min(520px,calc(100% - 32px));
    padding:36px;border:1px solid #27303a;border-radius:18px;background:#11151b;text-align:center;
    box-shadow:0 24px 80px #0008}.mark{color:#c9ff00;font-weight:900;letter-spacing:.16em;
    font-size:13px}.icon{font-size:44px;margin:20px}h1{font-size:28px;margin:0 0 12px}
    p{color:#aab3be;line-height:1.6;margin:0}.success{color:#c9ff00}.cancelled{color:#aab3be}
  </style>
</head>
<body><main class="card"><div class="mark">NEXFORGE</div>
<div class="icon ${status}">${status === "success" ? "✓" : "×"}</div>
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
});
