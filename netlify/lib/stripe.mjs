// Minimal Stripe REST client (no SDK). Key comes from the Netlify
// environment variable STRIPE_SECRET_KEY only.

// Stripe expects nested form fields: line_items[0][price_data][currency]=usd
function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export function stripeMode() {
  const k = process.env.STRIPE_SECRET_KEY || "";
  return k.startsWith("sk_live_") ? "live" : k.startsWith("sk_test_") ? "test" : "missing";
}

export async function stripe(path, { method = "GET", body, query, idempotencyKey } = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const qs = query ? "?" + form(query).toString() : "";
  const res = await fetch(`https://api.stripe.com/v1${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body ? form(body).toString() : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const e = new Error(data?.error?.message || `Stripe error ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}
