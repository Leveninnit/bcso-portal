/**
 * Minimal signed-cookie session helper using HMAC-SHA256 via Web
 * Crypto, which is built into the Cloudflare Workers runtime — no extra
 * dependency needed. The cookie value is:
 *
 *   base64url(JSON payload) + "." + base64url(HMAC signature)
 *
 * so a session can be verified statelessly (no database lookup) using
 * only the SESSION_SECRET environment variable. Anyone without that
 * secret cannot forge a valid signature, so they cannot fake being
 * logged in or grant themselves extra subdivisions.
 */

function toBase64Url(bytes) {
  const str = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function getKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Signs a JSON-serializable payload into a cookie-safe string. */
export async function signSession(secret, payload) {
  const json = JSON.stringify(payload);
  const payloadB64 = toBase64Url(new TextEncoder().encode(json));
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64)
  );
  return `${payloadB64}.${toBase64Url(sig)}`;
}

/**
 * Verifies a cookie value and returns the decoded payload, or null if
 * the signature is invalid, the value is malformed, or the payload has
 * expired (payload.exp is a millisecond timestamp).
 */
export async function verifySession(secret, cookieValue) {
  if (!cookieValue || !cookieValue.includes(".")) return null;
  const [payloadB64, sigB64] = cookieValue.split(".");
  try {
    const key = await getKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(sigB64),
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return null;
    const json = new TextDecoder().decode(fromBase64Url(payloadB64));
    const payload = JSON.parse(json);
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Parses the request's Cookie header into a plain object. */
export function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const cookies = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}
