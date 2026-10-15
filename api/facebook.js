// Accesso tramite Facebook (Facebook Login for Business) e Graph API.
// Con un solo login si ottengono le pagine gestite e gli Instagram professionali collegati.
import { PlatformError } from "./instagram.js";

const GRAPH = "https://graph.facebook.com/v25.0";
// Usati solo se in Meta non è stata creata una "configurazione" (META_LOGIN_CONFIG_ID).
export const FB_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "read_insights",
  "instagram_basic",
  "instagram_manage_insights",
  "business_management",
];

export const facebookRedirectUri = (origin) => origin + "/api/oauth/facebook/callback";

export function facebookAuthorizeUrl(env, origin, state) {
  const p = new URLSearchParams({
    client_id: env.META_APP_ID,
    redirect_uri: facebookRedirectUri(origin),
    state,
    response_type: "code",
  });
  if (env.META_LOGIN_CONFIG_ID) p.set("config_id", env.META_LOGIN_CONFIG_ID);
  else p.set("scope", FB_SCOPES.join(","));
  return "https://www.facebook.com/v25.0/dialog/oauth?" + p.toString();
}

async function call(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new PlatformError("Facebook non raggiungibile");
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* risposta non JSON */
  }
  if (!res.ok || data.error) {
    const e = data.error || {};
    throw new PlatformError(e.message || `Errore Facebook (HTTP ${res.status})`, {
      auth: e.code === 190 || res.status === 401,
    });
  }
  return data;
}

// Codice -> token utente di lunga durata. I token delle pagine ottenuti da questo non scadono.
export async function exchangeFacebookCode(env, origin, code) {
  const q1 = new URLSearchParams({
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    redirect_uri: facebookRedirectUri(origin),
    code,
  });
  const short = await call(`${GRAPH}/oauth/access_token?${q1}`);
  const q2 = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    fb_exchange_token: short.access_token,
  });
  const long = await call(`${GRAPH}/oauth/access_token?${q2}`);
  return long.access_token;
}

export async function listFacebookPages(userToken) {
  const q = new URLSearchParams({
    fields: "id,name,access_token,instagram_business_account{id,username}",
    limit: "100",
    access_token: userToken,
  });
  const r = await call(`${GRAPH}/me/accounts?${q}`);
  return (r.data || []).map((p) => ({
    id: p.id,
    name: p.name,
    token: p.access_token,
    ig: p.instagram_business_account ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username || "" } : null,
  }));
}

function lastValue(insights, name) {
  const m = (insights.data || []).find((x) => x.name === name);
  const values = m?.values || [];
  return values.length ? values[values.length - 1].value ?? null : null;
}

// Pagina Facebook: follower + copertura e interazioni sugli ultimi 28 giorni (metriche aggiornate 2025).
export async function fetchPageMetrics(pageToken, pageId) {
  const info = await call(`${GRAPH}/${encodeURIComponent(pageId)}?${new URLSearchParams({ fields: "name,followers_count,fan_count", access_token: pageToken })}`);
  let reach = null;
  let engagements = null;
  let insightsError = null;
  try {
    const ins = await call(
      `${GRAPH}/${encodeURIComponent(pageId)}/insights?${new URLSearchParams({
        metric: "page_total_media_view_unique,page_post_engagements",
        period: "days_28",
        access_token: pageToken,
      })}`
    );
    reach = lastValue(ins, "page_total_media_view_unique");
    engagements = lastValue(ins, "page_post_engagements");
  } catch (e) {
    if (e.auth) throw e;
    insightsError = e.message;
  }
  return { name: info.name, followers: info.followers_count ?? info.fan_count ?? null, reach, engagements, insightsError };
}

// Instagram collegato a una pagina, letto tramite graph.facebook.com con il token della pagina.
export async function fetchInstagramViaPage(pageToken, igId, now = Date.now()) {
  const profile = await call(
    `${GRAPH}/${encodeURIComponent(igId)}?${new URLSearchParams({ fields: "username,followers_count,media_count", access_token: pageToken })}`
  );
  const until = Math.floor(now / 1000);
  const since = until - 30 * 86400 + 60;
  let insights = {};
  let insightsError = null;
  try {
    const r = await call(
      `${GRAPH}/${encodeURIComponent(igId)}/insights?${new URLSearchParams({
        metric: "reach,total_interactions,accounts_engaged",
        period: "day",
        metric_type: "total_value",
        since: String(since),
        until: String(until),
        access_token: pageToken,
      })}`
    );
    for (const m of r.data || []) insights[m.name] = m.total_value?.value ?? null;
  } catch (e) {
    if (e.auth) throw e;
    insightsError = e.message;
  }
  return { profile, insights, insightsError };
}
