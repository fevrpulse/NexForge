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
  const url = new URL(req.url);
  const status = url.searchParams.get("status") === "success" ? "success" : "cancelled";
  const sessionId = String(url.searchParams.get("session_id") || "");
  const title = status === "success" ? "Payment complete" : "Checkout cancelled";
  const message = status === "success"
    ? "Return to NexForge — your item unlocks automatically within a few seconds."
    : "Nothing was charged. You can return to NexForge whenever you are ready.";

  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · NexForge</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;
    background:#070807;color:#F2F5EC;font:16px "Segoe UI",system-ui,sans-serif}
    .card{width:min(480px,calc(100% - 32px));padding:32px 28px;border:1px solid #262b24;
    border-radius:14px;background:#101210;text-align:center}
    .mark{color:#c9ff00;font-weight:800;letter-spacing:.12em;font-size:12px;text-transform:uppercase}
    h1{font-size:24px;margin:18px 0 10px;font-weight:700;letter-spacing:-.02em}
    p{color:#A7AE9C;line-height:1.55;margin:0}
    .hint{margin-top:18px;font-size:13px;color:#6F7568}
  </style>
</head>
<body>
<main class="card">
  <div class="mark">NexForge</div>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  ${sessionId ? `<p class="hint">Session ready for the app to confirm.</p>` : ""}
</main>
</body>
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
