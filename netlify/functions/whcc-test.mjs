// WHCC test-host tool for setting up the print shop.
// Only ever calls WHCC's TEST host. Going live is a separate, deliberate step.
//
// Requires two Netlify environment variables, set by the site owner in the
// Netlify dashboard (never in code):
//   WHCC_SANDBOX_API_KEY  - WHCC test API key
//   ADMIN_TOKEN           - any long random string; must be passed as ?token=
//
// Usage (GET):
//   /api/whcc-test?token=...&action=catalog[&q=canvas][&category=wall-art][&cursor=...]
//   /api/whcc-test?token=...&action=product&ref=<product ref>
//   /api/whcc-test?token=...&action=build&ref=<ref>&selections=<json>&image=<https url>
//   /api/whcc-test?token=...&action=poll&ids=<configuredProductId,...>
//   /api/whcc-test?token=...&action=quote&id=<configuredProductId>
//   /api/whcc-test?token=...&action=submit&id=<configuredProductId>&key=<unique idempotency key>
//   /api/whcc-test?token=...&action=submission&id=<submissionId>

const TEST_HOST = "https://apis-stage.whcc.com/api";
const VERSION = "2026-10";

// A fixed test recipient (WHCC's own example address) so no real person is involved.
const TEST_ADDRESS = {
  name: "Test Recipient",
  addr1: "3005 Eagandale Place",
  city: "Eagan",
  state: "MN",
  zip: "55121",
  country: "US",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function whcc(path, { method = "GET", body, headers = {} } = {}) {
  const key = process.env.WHCC_SANDBOX_API_KEY;
  // Only allow paths on the test host. Absolute "actions" links must also be on it.
  const url = path.startsWith("https://") ? path : TEST_HOST + path;
  if (!url.startsWith(TEST_HOST + "/")) throw new Error("Refusing to call a non-test host");
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "WHCC-API-Version": VERSION,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 2000) }; }
  // One-line call note for the function log (no secrets).
  console.log(`WHCC ${method} ${url.replace(TEST_HOST, "")} -> ${res.status}`);
  return { status: res.status, data };
}

export default async (req) => {
  const u = new URL(req.url);
  const p = u.searchParams;

  if (!process.env.ADMIN_TOKEN || !safeEqual(p.get("token") || "", process.env.ADMIN_TOKEN)) {
    return json({ error: "Not authorized" }, 401);
  }
  if (!process.env.WHCC_SANDBOX_API_KEY) {
    return json({ error: "WHCC_SANDBOX_API_KEY is not set in Netlify environment variables" }, 500);
  }

  try {
    switch (p.get("action")) {
      case "catalog": {
        const qs = new URLSearchParams({ limit: "200" });
        for (const k of ["q", "category", "cursor"]) if (p.get(k)) qs.set(k, p.get(k));
        const r = await whcc(`/v1/catalog/products?${qs}`);
        if (r.status !== 200) return json(r, r.status);
        return json({
          status: r.status,
          totalCount: r.data.totalCount,
          nextCursor: r.data.nextCursor,
          products: (r.data.products || []).map((x) => ({
            ref: x.ref, name: x.name, completion: x.completion,
            category: x.category?.ref, kind: x.kind, resolution: x.resolution,
          })),
        });
      }
      case "product": {
        const r = await whcc(`/v1/catalog/products/${encodeURIComponent(p.get("ref") || "")}`);
        if (r.status !== 200) return json(r, r.status);
        const d = r.data;
        return json({
          ref: d.ref, name: d.name, completion: d.completion, resolution: d.resolution,
          fields: (d.configuration?.fields || []).map((f) => ({
            field: f.field, name: f.name, required: f.required, kind: f.kind, default: f.default,
            unit: f.unit, constraints: f.constraints,
            values: (f.values || []).filter((v) => typeof v === "object")
              .map((v) => ({ id: v.id, name: v.name, enabled: v.enabled, width: v.width, height: v.height })),
          })),
        });
      }
      case "build": {
        const selections = JSON.parse(p.get("selections") || "{}");
        const image = p.get("image") || "";
        if (!image.startsWith("https://")) return json({ error: "image must be an https URL" }, 400);
        const r = await whcc("/v1/commerce/configured-products", {
          method: "POST",
          body: { configuredProducts: [{ productId: p.get("ref"), selections, images: [{ url: image }] }] },
        });
        return json(r, r.status);
      }
      case "poll": {
        const r = await whcc(`/v1/commerce/configured-products?ids=${encodeURIComponent(p.get("ids") || "")}`);
        return json(r, r.status);
      }
      case "quote": {
        const r = await whcc("/v1/commerce/submissions/calculate", {
          method: "POST",
          body: { items: [{ configuredProductId: p.get("id"), quantity: 1 }], shipping: { address: TEST_ADDRESS } },
        });
        return json(r, r.status);
      }
      case "submit": {
        const key = p.get("key");
        if (!key) return json({ error: "key (idempotency key) is required" }, 400);
        const r = await whcc("/v1/commerce/submissions", {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: {
            items: [{ configuredProductId: p.get("id"), quantity: 1 }],
            shipping: { type: "dropship", priority: "dropship_lowest_cost", address: TEST_ADDRESS },
            reference: "BC-TEST",
          },
        });
        return json(r, r.status);
      }
      case "submission": {
        const r = await whcc(`/v1/commerce/submissions/${encodeURIComponent(p.get("id") || "")}`);
        return json(r, r.status);
      }
      default:
        return json({ error: "Unknown action", actions: ["catalog", "product", "build", "poll", "quote", "submit", "submission"] }, 400);
    }
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
};

export const config = { path: "/api/whcc-test" };
