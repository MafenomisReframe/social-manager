// Instagram API con Instagram Login (account professionali business/creator).
// Documentazione: developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login

const GRAPH = "https://graph.instagram.com";
const VERSION = "v25.0";
export const IG_SCOPES = ["instagram_business_basic", "instagram_business_manage_insights"];

export class PlatformError extends Error {
  constructor(message, { auth = false } = {}) {
    super(message);
    this.auth = auth; // true = token non più valido: serve ricollegare
  }
}

export const instagramRedirectUri = (origin) => origin + "/api/oauth/instagram/callback";

export function instagramAuthorizeUrl(env, origin, state) {
  const p = new URLSearchParams({
    client_id: env.IG_APP_ID,
    redirect_uri: instagramRedirectUri(origin),
    response_type: "code",
    scope: IG_SCOPES.join(","),
    state,
    force_reauth: "true",
  });
  return "https://www.instagram.com/oauth/authorize?" + p.toString();
}

async function call(url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw new PlatformError("Instagram non raggiungibile");
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* risposta non JSON */
  }
  if (!res.ok || data.error || data.error_type) {
    const e = data.error || {};
    const message = e.message || data.error_message || `Errore Instagram (HTTP ${res.status})`;
    const auth = e.code === 190 || e.type === "OAuthException" || res.status === 401;
    throw new PlatformError(message, { auth });
  }
  return data;
}

// Codice di autorizzazione -> token di lunga durata (60 giorni).
export async function exchangeInstagramCode(env, origin, code) {
  const form = new URLSearchParams({
    client_id: env.IG_APP_ID,
    client_secret: env.IG_APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: instagramRedirectUri(origin),
    code,
  });
  const short = await call("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
  const first = Array.isArray(short.data) ? short.data[0] : short;
  if (!first?.access_token) throw new PlatformError("Risposta di Instagram senza token");

  const q = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: env.IG_APP_SECRET,
    access_token: first.access_token,
  });
  const long = await call(`${GRAPH}/access_token?${q}`);
  const permissions = Array.isArray(first.permissions) ? first.permissions.join(",") : first.permissions || "";
  return { token: long.access_token, expiresIn: Number(long.expires_in) || 5184000, permissions };
}

export async function refreshInstagramToken(token) {
  const q = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token });
  const r = await call(`${GRAPH}/refresh_access_token?${q}`);
  return { token: r.access_token, expiresIn: Number(r.expires_in) || 5184000 };
}

export async function fetchInstagramProfile(token) {
  const q = new URLSearchParams({
    fields: "user_id,username,account_type,followers_count,media_count",
    access_token: token,
  });
  return call(`${GRAPH}/${VERSION}/me?${q}`);
}

// Totali degli ultimi 30 giorni. Alcune metriche non sono disponibili sotto i 100 follower.
export async function fetchInstagramInsights(token, igUserId, now = Date.now()) {
  const until = Math.floor(now / 1000);
  const since = until - 30 * 86400 + 60;
  const q = new URLSearchParams({
    metric: "reach,total_interactions,accounts_engaged",
    period: "day",
    metric_type: "total_value",
    since: String(since),
    until: String(until),
    access_token: token,
  });
  const r = await call(`${GRAPH}/${VERSION}/${encodeURIComponent(igUserId)}/insights?${q}`);
  const out = {};
  for (const m of r.data || []) out[m.name] = m.total_value?.value ?? null;
  return out;
}
