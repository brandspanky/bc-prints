// Creates a Stripe Checkout page for the visitor's cart.
// Prices, sizes and shipping are set HERE on the server from the catalog,
// never taken from the browser, so nobody can change what they pay.
import { PRINTS, PRICES, MATERIALS, SIZE_LABELS } from "../lib/catalog.mjs";
import { shippingFor } from "../lib/shipping.mjs";
import { stripe } from "../lib/stripe.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  // Validate every line against the catalog.
  const raw = Array.isArray(body?.items) ? body.items.slice(0, 10) : [];
  const items = [];
  for (const l of raw) {
    const p = PRINTS[l?.id];
    const qty = Math.floor(Number(l?.qty));
    if (!p || !PRICES[l.material] || !p.sizes.includes(l.size) || !(qty >= 1 && qty <= 5))
      return json({ error: "Something in your cart is no longer available. Please remove it and try again." }, 400);
    items.push({ id: l.id, material: l.material, size: l.size, qty });
  }
  if (!items.length) return json({ error: "Your cart is empty." }, 400);

  const origin = new URL(req.url).origin;
  const ship = shippingFor(items);

  try {
    const session = await stripe("/checkout/sessions", {
      method: "POST",
      body: {
        mode: "payment",
        line_items: items.map((l) => ({
          quantity: l.qty,
          price_data: {
            currency: "usd",
            unit_amount: PRICES[l.material][l.size] * 100,
            tax_behavior: "exclusive",
            product_data: {
              name: `${PRINTS[l.id].title}`,
              description: `${MATERIALS[l.material]}, ${SIZE_LABELS[l.size]} in`,
              images: [`${origin}/img/sm/${l.id}.jpg`],
              tax_code: "txcd_99999999",
            },
          },
        })),
        shipping_address_collection: { allowed_countries: ["US"] },
        shipping_options: [{
          shipping_rate_data: {
            type: "fixed_amount",
            display_name: ship.label,
            fixed_amount: { amount: ship.cents, currency: "usd" },
            tax_behavior: "exclusive",
            delivery_estimate: {
              minimum: { unit: "business_day", value: 7 },
              maximum: { unit: "business_day", value: 14 },
            },
          },
        }],
        phone_number_collection: { enabled: true },
        automatic_tax: { enabled: process.env.STRIPE_TAX === "on" },
        // The order itself, read back by the approval page to send to WHCC.
        metadata: { items: items.map((l) => `${l.id}:${l.material}:${l.size}:${l.qty}`).join("|") },
        payment_intent_data: { description: "cotton.gallery print order" },
        success_url: `${origin}/#thanks`,
        cancel_url: `${origin}/#prints`,
      },
    });
    return json({ url: session.url });
  } catch (e) {
    console.log("Checkout error:", e.message);
    return json({ error: "Checkout is unavailable right now. Please try again shortly." }, 502);
  }
};

export const config = { path: "/api/checkout" };
