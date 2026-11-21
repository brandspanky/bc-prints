// Admin check: is every print file in the private R2 bucket, and can it be fetched?
// Never returns keys. Usage: /api/r2-test?token=<ADMIN_TOKEN>[&action=list|check|link&id=p17]
import { r2Configured, r2List, r2SignedUrl, printFileFor } from "../lib/r2.mjs";

// Catalog id -> master file name (kept in sync with public/index.html)
export const MASTERS = {
  "p17": "L1012601-Edit.tif",
  "p41": "2013_COT5990-rev1111FB.jpg",
  "p52": "_COT5959-3-Edit.jpg",
  "p53": "_COT6005-4-Edit.jpg",
  "p54": "_COT6017-2-Edit.jpg",
  "p42": "2014_BSC0884-rev11381410261-3FB.jpg",
  "p43": "2015_BSC4708-rev1546FB-3.jpg",
  "p18": "L1010723-Edit.jpg",
  "p44": "L1010598-Edit-Edit-2-Edit-2.jpg",
  "p45": "SIV01466.tif",
  "p19": "_BSC4254-Edit-Edit copy 2.jpg",
  "p12": "_SIV2400-Edit.jpg",
  "p15": "_COT2817-Edit-Edit-2.jpg",
  "p16": "_SIV7914-Edit-Edit-Edit.jpg",
  "p46": "2017_BSC6093-rev1636.jpg",
  "p47": "_BSC7246-Edit-2.jpg",
  "p40": "_SIV4552-Edit2.jpg",
  "p22": "SIV01693-Edit.jpg",
  "p48": "L1000134-Edit-Edit.jpg",
  "p23": "_SIV4835-2-Edit.jpg",
  "p49": "L1010948-Edit-Edit.jpg",
  "p39": "BSC03372-Enhanced-NR-Edit.jpg",
  "p21": "_BSC9976-Edit-Edit-Edit.jpg",
  "p24": "_BSC6931-Edit-Edit-Edit.tif",
  "p50": "SIV00325-2-Edit_copy.tif",
  "p26": "Q1010527-Edit-Edit-2.jpg",
  "p28": "L1000021-Edit-Edit.jpg",
  "p29": "L1010533.jpg",
  "p30": "_BSC4958-Edit-2.tif",
  "p31": "_BSC7943 copy-Edit-Edit.jpg",
  "p32": "_BSC4180-Edit-Edit-2.tif",
  "p37": "BSC01160-Edit-Edit-2.jpg",
  "p34": "_BSC9896-Edit-Edit-Edit.jpg",
  "p51": "bnweye.jpg",
  "p35": "_BSC3693-Edit-2 copy.jpg",
  "p01": "_SIV7877-Edit-Edit.jpg",
  "p09": "L1060307-Enhanced-NR-Edit-Edit-Edit.jpg",
  "p03": "BSC05391-Enhanced-NR-Edit-2.tif",
  "p02": "DJI_0078-Enhanced-NR-Edit-3.tif",
  "p07": "DJI_0297.jpg",
  "p04": "L1020183-Edit-Edit-Edit.jpg",
  "p05": "L1020663-2.jpg",
  "p55": "L1000825-Edit.jpg",
  "p56": "DSC_0745-Edit-Edit.jpg",
  "p57": "Silk_Loom_Abstract_30x45_200ppi.jpg"
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

export default async (req) => {
  const url = new URL(req.url);
  if (!process.env.ADMIN_TOKEN || !safeEqual(url.searchParams.get("token") || "", process.env.ADMIN_TOKEN))
    return json({ error: "Not authorized" }, 401);
  if (!r2Configured()) {
    const e = process.env;
    return json({ error: "R2 variables missing", present: {
      R2_ACCOUNT_ID: !!e.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID: !!e.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: !!e.R2_SECRET_ACCESS_KEY, R2_BUCKET: !!e.R2_BUCKET } }, 500);
  }
  const action = url.searchParams.get("action") || "check";
  try {
    if (action === "list") return json({ files: await r2List() });
    if (action === "link") {
      const m = MASTERS[url.searchParams.get("id")];
      if (!m) return json({ error: "Unknown print id" }, 400);
      return json({ file: printFileFor(m), url: r2SignedUrl(printFileFor(m), { expires: 600 }) });
    }
    // check: compare bucket to catalog, and test one real download
    const files = await r2List();
    const have = new Map(files.map((f) => [f.key, f.size]));
    const missing = [], found = [];
    for (const [id, m] of Object.entries(MASTERS)) {
      const f = printFileFor(m);
      (have.has(f) ? found : missing).push({ id, file: f });
    }
    const expected = new Set(Object.values(MASTERS).map(printFileFor));
    const extra = files.filter((f) => !expected.has(f.key)).map((f) => f.key);
    let download = null;
    if (found.length) {
      const res = await fetch(r2SignedUrl(found[0].file, { expires: 120 }), { headers: { Range: "bytes=0-3" } });
      const b = new Uint8Array(await res.arrayBuffer());
      download = { file: found[0].file, status: res.status, isJpeg: b[0] === 0xff && b[1] === 0xd8 };
    }
    return json({ inBucket: files.length, catalog: Object.keys(MASTERS).length, matched: found.length, missing, extra, download });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
};

export const config = { path: "/api/r2-test" };
