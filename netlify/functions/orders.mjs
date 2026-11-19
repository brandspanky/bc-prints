// Admin API behind the order approval page (/admin.html).
// Paid orders live in Stripe; this reads them and, when bc clicks Approve,
// sends the order to WHCC. Progress is recorded on the Stripe payment
// (metadata), so no separate database is needed.
//
// Auth: header "Authorization: Bearer <ADMIN_TOKEN>"
// GET  /api/orders                         -> recent paid orders
// POST /api/orders {action:"build",  id}   -> create WHCC items (print file links)
// POST /api/orders {action:"status", id}   -> are WHCC items ready?
// POST /api/orders {action:"submit", id}   -> place the order with WHCC
import { PRINTS, MATERIALS, SIZE_LABELS } from "../lib/catalog.mjs";
import { stripe, stripeMode } from "../lib/stripe.mjs";
import { whcc, whccProduct } from "../lib/whcc.mjs";
import { r2SignedUrl, printFileFor } from "../lib/r2.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

const parseItems = (s = "") =>
  s.split("|").filter(Boolean).map((x) => {
    const [id, material, size, qty] = x.split(":");
    return { id, material, size, qty: Number(qty) || 1 };
  });

function shippingOf(s) {
  const sd = s.collected_information?.shipping_details || s.shipping_details || null;
  if (!sd?.address) return null;
  const a = sd.address;
  return { name: sd.name, addr1: a.line1, addr2: a.line2 || undefined, city: a.city, state: a.state, zip: a.postal_code, country: a.country };
}

function summarize(s) {
  const pi = s.payment_intent && typeof s.payment_intent === "object" ? s.payment_intent : null;
  const m = pi?.metadata || {};
  return {
    id: s.id,
    created: s.created,
    livemode: s.livemode,
    paid: s.payment_status === "paid",
    email: s.customer_details?.email,
    phone: s.customer_details?.phone,
    total: s.amount_total / 100,
    shipping: shippingOf(s),
    items: parseItems(s.metadata?.items).map((l) => ({
      ...l,
      title: PRINTS[l.id]?.title || l.id,
      label: `${MATERIALS[l.material] || l.material}, ${SIZE_LABELS[l.size] || l.size} in`,
    })),
    whcc: { state: m.whcc_state || "new", items: m.whcc_items || "", submission: m.whcc_submission || "" },
  };
}

async function getOrder(id) {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id || "")) throw Object.assign(new Error("Bad order id"), { status: 400 });
  const s = await stripe(`/checkout/sessions/${id}`, { query: { "expand[]": "payment_intent" } });
  return { s, o: summarize(s), piId: s.payment_intent?.id };
}

const setMeta = (piId, metadata) => stripe(`/payment_intents/${piId}`, { method: "POST", body: { metadata } });

export default async (req) => {
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!process.env.ADMIN_TOKEN || !safeEqual(auth, process.env.ADMIN_TOKEN)) return json({ error: "Not authorized" }, 401);

  try {
    if (req.method === "GET") {
      const list = await stripe("/checkout/sessions", {
        query: { limit: 30, status: "complete", "expand[]": "data.payment_intent" },
      });
      return json({ mode: stripeMode(), orders: list.data.filter((s) => s.metadata?.items).map(summarize) });
    }

    const { action, id } = await req.json();
    const { o, piId } = await getOrder(id);
    if (!o.paid) return json({ error: "This order is not paid." }, 409);
    if (o.whcc.state === "submitted") return json({ error: "Already sent to WHCC.", order: o }, 409);

    if (action === "build") {
      if (!o.shipping) return json({ error: "No shipping address on this order." }, 409);
      const configuredProducts = o.items.map((l) => {
        const p = PRINTS[l.id];
        if (!p) throw new Error(`Unknown print ${l.id}`);
        const { productId, selections } = whccProduct(l.material, l.size);
        // Signed link to the private print file, valid 7 days for WHCC to fetch.
        const url = r2SignedUrl(printFileFor(p.master), { expires: 604800 });
        return { productId, selections, images: [{ url }] };
      });
      const r = await whcc("/v1/commerce/configured-products", { method: "POST", body: { configuredProducts } });
      const ids = (r.data?.items || []).map((x) => x.configuredProductId);
      if (r.status >= 300 || ids.length !== o.items.length)
        return json({ error: "WHCC could not set up the items.", detail: r.data }, 502);
      await setMeta(piId, { whcc_state: "building", whcc_items: ids.join(",") });
      return json({ ok: true, ids });
    }

    const ids = (o.whcc.items || "").split(",").filter(Boolean);
    if (!ids.length) return json({ error: "Approve the order first." }, 409);

    if (action === "status") {
      const r = await whcc(`/v1/commerce/configured-products?ids=${encodeURIComponent(ids.join(","))}`);
      const items = (r.data?.items || []).map((x) => ({ id: x.configuredProductId, status: x.status, errors: x.errors }));
      return json({ ready: items.length === ids.length && items.every((x) => x.status === "ready"), items });
    }

    if (action === "submit") {
      const r = await whcc("/v1/commerce/submissions", {
        method: "POST",
        headers: { "Idempotency-Key": o.id },
        body: {
          items: ids.map((cid, i) => ({ configuredProductId: cid, quantity: o.items[i].qty })),
          shipping: { type: "dropship", priority: "dropship_lowest_cost", address: o.shipping },
          reference: "CG-" + o.id.slice(-10),
        },
      });
      const sub = r.data?.id || r.data?.submissionId || r.data?.submission?.id;
      if (r.status >= 300 || !sub) return json({ error: "WHCC did not accept the order.", detail: r.data }, 502);
      await setMeta(piId, { whcc_state: "submitted", whcc_submission: String(sub) });
      return json({ ok: true, submission: sub, status: r.data?.status });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.log("Orders error:", e.message);
    return json({ error: e.message }, e.status || 500);
  }
};

export const config = { path: "/api/orders" };
