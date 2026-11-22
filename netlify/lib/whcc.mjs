// WHCC order API.
// Test orders (Stripe test-mode payments) always go to WHCC's test system.
// Live orders (real Stripe payments) go to WHCC's live system, which prints,
// ships and bills. The caller decides by passing { live: session.livemode }.
const TEST_HOST = "https://apis-stage.whcc.com/api";
const LIVE_HOST = "https://apis.whcc.com/api";
const VERSION = "2026-10";

export async function whcc(path, { method = "GET", body, headers = {}, live = false } = {}) {
  const key = live ? process.env.WHCC_LIVE_API_KEY : process.env.WHCC_SANDBOX_API_KEY;
  if (!key) throw new Error(live ? "WHCC_LIVE_API_KEY is not set" : "WHCC_SANDBOX_API_KEY is not set");
  const url = (live ? LIVE_HOST : TEST_HOST) + path;
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
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 1000) }; }
  console.log(`WHCC ${live ? "LIVE" : "test"} ${method} ${path.split("?")[0]} -> ${res.status}`);
  return { status: res.status, data };
}

// The finishes bc chose: rag paper, black-edge premium canvas with matte coating,
// semi-gloss float-mount metal.
export function whccProduct(material, size) {
  if (material === "paper") return { productId: "fine-art-print", selections: { size, paper: "photo_rag_matte" } };
  if (material === "metal") return { productId: "metal-print", selections: { size, surface: "white_semi_gloss", display_options: "3_4in_float_mount" } };
  if (material === "canvas") {
    const base = {
      canvas_type: "premium_fine_art", depth: "1_1_2in", protection: "matte",
      gallery_wrap_edge: "black_edge", all_hanging_hardware: "sawtooth_hangers_bumpers_paper_backing",
    };
    // WHCC has no stock canvas at these sizes, so they are ordered as custom sizes.
    if (size === "30x45" || size === "18x24") {
      const [width, height] = size.split("x").map(Number);
      return { productId: "gallery-wrap", selections: { ...base, size: "custom", custom_canvas_type: "premium_fine_art", dimensions: { width, height } } };
    }
    return { productId: "gallery-wrap", selections: { ...base, size } };
  }
  throw new Error("Unknown material " + material);
}
