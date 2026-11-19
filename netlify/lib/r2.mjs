// Private print files in Cloudflare R2.
// Makes short-lived signed download links (AWS Signature V4) so WHCC can fetch
// one file for one order. Keys come from Netlify environment variables only:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
import { createHash, createHmac } from "node:crypto";

const enc = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const hmac = (k, s) => createHmac("sha256", k).update(s).digest();

export function r2Configured() {
  const e = process.env;
  return !!(e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY && e.R2_BUCKET);
}

// Signed GET URL. objectKey = file name in the bucket, or null for the bucket itself.
export function r2SignedUrl(objectKey, { expires = 3600, query = {} } = {}) {
  const { R2_ACCOUNT_ID: acct, R2_ACCESS_KEY_ID: ak, R2_SECRET_ACCESS_KEY: sk, R2_BUCKET: bucket } = process.env;
  const host = `${acct.trim()}.r2.cloudflarestorage.com`;
  const path = "/" + enc(bucket.trim()) + (objectKey ? "/" + objectKey.split("/").map(enc).join("/") : "");
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/auto/s3/aws4_request`;
  const params = {
    ...query,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${ak.trim()}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.min(expires, 604800)),
    "X-Amz-SignedHeaders": "host",
  };
  const qs = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join("&");
  const canonical = ["GET", path, qs, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  let key = hmac("AWS4" + sk.trim(), day);
  for (const part of ["auto", "s3", "aws4_request"]) key = hmac(key, part);
  const sig = createHmac("sha256", key).update(toSign).digest("hex");
  return `https://${host}${path}?${qs}&X-Amz-Signature=${sig}`;
}

// List every file in the bucket: [{ key, size }]
export async function r2List() {
  const out = [];
  let token;
  do {
    const q = { "list-type": "2", ...(token ? { "continuation-token": token } : {}) };
    const res = await fetch(r2SignedUrl(null, { expires: 300, query: q }));
    const xml = await res.text();
    if (!res.ok) throw new Error(`R2 list failed (${res.status}): ${(xml.match(/<Code>(.*?)<\/Code>/) || [])[1] || "unknown"}`);
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = (m[1].match(/<Key>([\s\S]*?)<\/Key>/) || [])[1];
      const size = Number((m[1].match(/<Size>(\d+)<\/Size>/) || [])[1]);
      out.push({ key: key.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"), size });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/) || [])[1] : null;
  } while (token);
  return out;
}

// Print file name for a catalog master: same name, .jpg
export const printFileFor = (master) => master.replace(/\.[^.]+$/, ".jpg");
