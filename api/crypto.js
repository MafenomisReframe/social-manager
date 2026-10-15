// Cifratura dei token social con AES-GCM (Web Crypto, disponibile nei Worker).
// La chiave deriva dal secret TOKEN_ENC_KEY configurato in Cloudflare: non è mai nel codice.

const enc = new TextEncoder();
const dec = new TextDecoder();
const keyCache = new Map();

async function getKey(secret) {
  if (!secret || secret.length < 32) throw new Error("token_key_missing");
  if (keyCache.has(secret)) return keyCache.get(secret);
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("social-manager/tokens/v1"), info: enc.encode("aes-gcm") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  keyCache.set(secret, key);
  return key;
}

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptToken(secret, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getKey(secret), enc.encode(plain));
  return "v1." + toB64(iv) + "." + toB64(data);
}

export async function decryptToken(secret, stored) {
  const [version, iv, data] = String(stored || "").split(".");
  if (version !== "v1" || !iv || !data) throw new Error("token_invalid");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await getKey(secret), fromB64(data));
  return dec.decode(plain);
}

export function randomState() {
  return toB64(crypto.getRandomValues(new Uint8Array(24))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);
}
