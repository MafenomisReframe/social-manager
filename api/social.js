// Collegamento degli account social dei clienti e lettura delle statistiche.
// I token sono salvati cifrati e non vengono MAI restituiti al browser.
import { encryptToken, decryptToken, randomState } from "./crypto.js";
import {
  PlatformError,
  instagramAuthorizeUrl,
  exchangeInstagramCode,
  refreshInstagramToken,
  fetchInstagramProfile,
  fetchInstagramInsights,
} from "./instagram.js";
import { facebookAuthorizeUrl, exchangeFacebookCode, listFacebookPages, fetchPageMetrics, fetchInstagramViaPage } from "./facebook.js";

export const PLATFORMS = ["instagram", "facebook", "linkedin", "tiktok"];
const READY = {
  instagram: (env) => Boolean(env.IG_APP_ID && env.IG_APP_SECRET && env.TOKEN_ENC_KEY),
  facebook: (env) => Boolean(env.META_APP_ID && env.META_APP_SECRET && env.TOKEN_ENC_KEY),
};
// Instagram si può collegare sia con il login di Instagram sia tramite la pagina Facebook.
const available = (platform, env) =>
  platform === "instagram" ? READY.instagram(env) || READY.facebook(env) : platform === "facebook" ? READY.facebook(env) : false;
const PENDING_MINUTES = 20;
const STATE_MINUTES = 15;
const REFRESH_WITHIN_DAYS = 15;

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const appOrigin = (env, url) => env.APP_ORIGIN || url.origin;

// Chi può collegare/scollegare: chi modifica il cliente e il cliente stesso (è il proprietario dell'account).
export const canConnect = (access) => access.edit || access.role === "client_viewer";

export async function listSocial(db, env, tenantId, access) {
  const accounts = (
    await db
      .prepare(
        "SELECT id, platform, handle, external_account_id, connection_status, connected_at, last_sync_at, last_error, token_expires_at, api " +
          "FROM social_accounts WHERE tenant_id = ?"
      )
      .bind(tenantId)
      .all()
  ).results;
  const since = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const metrics = (
    await db
      .prepare(
        "SELECT account_id, day, followers, media_count, reach_30d, interactions_30d, engaged_30d " +
          "FROM social_metrics_daily WHERE tenant_id = ? AND day >= ? ORDER BY day"
      )
      .bind(tenantId, since)
      .all()
  ).results;

  return PLATFORMS.map((platform) => {
    const a = accounts.find((x) => x.platform === platform);
    const history = a
      ? metrics
          .filter((m) => m.account_id === a.id)
          .map(({ day, followers, media_count, reach_30d, interactions_30d, engaged_30d }) => ({
            day,
            followers,
            media_count,
            reach_30d,
            interactions_30d,
            engaged_30d,
          }))
      : [];
    return {
      platform,
      available: available(platform, env),
      status: a?.connection_status || "disconnected",
      via: a?.api || null,
      handle: a?.handle || "",
      connected_at: a?.connected_at || null,
      last_sync_at: a?.last_sync_at || null,
      token_expires_at: access.role === "client_viewer" ? undefined : a?.token_expires_at || null,
      last_error: access.role === "client_viewer" ? undefined : a?.last_error || null,
      latest: history[history.length - 1] || null,
      history,
    };
  });
}

export async function startConnect(db, env, url, user, tenantId, platform) {
  let flow;
  if ((platform === "facebook" || platform === "instagram") && READY.facebook(env)) flow = "facebook";
  else if (platform === "instagram" && READY.instagram(env)) flow = "instagram";
  else if (platform === "facebook" || platform === "instagram") return { error: "platform_not_configured", status: 503 };
  else return { error: "platform_not_supported", status: 400 };

  const state = randomState();
  const expires = new Date(Date.now() + STATE_MINUTES * 60000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(nowIso()),
    db.prepare("DELETE FROM oauth_pending WHERE expires_at < ?").bind(nowIso()),
    db
      .prepare("INSERT INTO oauth_states(state, tenant_id, user_id, platform, expires_at) VALUES(?,?,?,?,?)")
      .bind(state, tenantId, user.id, flow, expires),
  ]);
  const origin = appOrigin(env, url);
  return { url: flow === "facebook" ? facebookAuthorizeUrl(env, origin, state) : instagramAuthorizeUrl(env, origin, state) };
}

// Verifica e consuma lo state del login. Restituisce { row, access, back } oppure { redirect }.
async function consumeState(db, url, user, flow, resolveAccess) {
  const stateParam = url.searchParams.get("state") || "";
  const row = await db
    .prepare("SELECT tenant_id, platform, expires_at FROM oauth_states WHERE state = ? AND user_id = ?")
    .bind(stateParam, user.id)
    .first();
  if (row) await db.prepare("DELETE FROM oauth_states WHERE state = ?").bind(stateParam).run();
  if (!row || row.platform !== flow || row.expires_at < nowIso()) return { redirect: "/?social=scaduto" };
  const access = await resolveAccess(row.tenant_id);
  if (!access || !canConnect(access)) return { redirect: "/?social=negato" };
  const base =
    access.role === "client_viewer"
      ? `/portale/${encodeURIComponent(row.tenant_id)}`
      : `/clienti/${encodeURIComponent(row.tenant_id)}/social`;
  const back = (result, extra = "") => base + "?social=" + result + extra;
  return { row, access, back };
}

const UPSERT_ACCOUNT =
  "INSERT INTO social_accounts(id, tenant_id, platform, handle, external_account_id, connection_status, access_token_enc, token_expires_at, scopes, connected_by, connected_at, last_error, api) " +
  "VALUES(?,?,?,?,?,'connected',?,?,?,?,?,NULL,?) " +
  "ON CONFLICT(tenant_id, platform) DO UPDATE SET handle=excluded.handle, external_account_id=excluded.external_account_id, " +
  "connection_status='connected', access_token_enc=excluded.access_token_enc, token_expires_at=excluded.token_expires_at, " +
  "scopes=excluded.scopes, connected_by=excluded.connected_by, connected_at=excluded.connected_at, last_error=NULL, api=excluded.api";

// Se il cliente viene ricollegato a un account DIVERSO, lo storico del precedente va cancellato:
// altrimenti grafici e confronti mescolerebbero i dati di due aziende.
const dropForeignHistory = (db, tenantId, platform, externalId) =>
  db
    .prepare(
      "DELETE FROM social_metrics_daily WHERE account_id IN (SELECT id FROM social_accounts WHERE tenant_id = ? AND platform = ? AND COALESCE(external_account_id,'') <> ?)"
    )
    .bind(tenantId, platform, String(externalId));

const auditStmt = (db, tenantId, userId, action, what) =>
  db
    .prepare("INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id) VALUES(?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), tenantId, userId, action, "social_account", what);

// Ritorno da Facebook dopo il login: trova le pagine; se è una sola la collega, altrimenti chiede quale.
export async function finishFacebookConnect(db, env, url, user, resolveAccess) {
  const st = await consumeState(db, url, user, "facebook", resolveAccess);
  if (st.redirect) return st;
  const { row, back } = st;
  if (url.searchParams.get("error")) return { redirect: back("annullato") };
  const code = (url.searchParams.get("code") || "").replace(/#_$/, "");
  if (!code) return { redirect: back("errore") };
  try {
    const userToken = await exchangeFacebookCode(env, appOrigin(env, url), code);
    const pages = await listFacebookPages(userToken);
    if (!pages.length) return { redirect: back("nessuna-pagina") };
    if (pages.length === 1) {
      await savePage(db, env, user, row.tenant_id, pages[0]);
      return { redirect: back("collegato") };
    }
    const id = crypto.randomUUID();
    await db
      .prepare("INSERT INTO oauth_pending(id, tenant_id, user_id, payload_enc, expires_at) VALUES(?,?,?,?,?)")
      .bind(
        id,
        row.tenant_id,
        user.id,
        await encryptToken(env.TOKEN_ENC_KEY, JSON.stringify(pages)),
        new Date(Date.now() + PENDING_MINUTES * 60000).toISOString()
      )
      .run();
    return { redirect: back("scegli", "&scelta=" + id) };
  } catch (e) {
    console.error("Facebook connect failed", e?.message);
    return { redirect: back("errore") };
  }
}

async function loadPending(db, env, user, tenantId, pendingId) {
  const p = await db
    .prepare("SELECT payload_enc, expires_at FROM oauth_pending WHERE id = ? AND user_id = ? AND tenant_id = ?")
    .bind(pendingId, user.id, tenantId)
    .first();
  if (!p || p.expires_at < nowIso()) return null;
  return JSON.parse(await decryptToken(env.TOKEN_ENC_KEY, p.payload_enc));
}

// Elenco delle pagine trovate, SENZA token.
export async function listPendingPages(db, env, user, tenantId, pendingId) {
  const pages = await loadPending(db, env, user, tenantId, pendingId);
  return pages && pages.map((p) => ({ id: p.id, name: p.name, instagram: p.ig ? "@" + p.ig.username : null }));
}

export async function selectPendingPage(db, env, user, tenantId, pendingId, pageId) {
  const pages = await loadPending(db, env, user, tenantId, pendingId);
  const page = pages?.find((p) => p.id === pageId);
  if (!page) return false;
  await db.prepare("DELETE FROM oauth_pending WHERE id = ?").bind(pendingId).run();
  await savePage(db, env, user, tenantId, page);
  return true;
}

// Salva la pagina Facebook e, se presente, l'Instagram collegato; poi legge subito i dati.
async function savePage(db, env, user, tenantId, page) {
  const tokenEnc = await encryptToken(env.TOKEN_ENC_KEY, page.token);
  const now = nowIso();
  const stmts = [
    dropForeignHistory(db, tenantId, "facebook", page.id),
    db
      .prepare(UPSERT_ACCOUNT)
      .bind(crypto.randomUUID(), tenantId, "facebook", page.name, page.id, tokenEnc, null, "", user.id, now, "facebook_login"),
    auditStmt(db, tenantId, user.id, "connect", "facebook"),
  ];
  if (page.ig) {
    stmts.push(
      dropForeignHistory(db, tenantId, "instagram", page.ig.id),
      db
        .prepare(UPSERT_ACCOUNT)
        .bind(crypto.randomUUID(), tenantId, "instagram", page.ig.username ? "@" + page.ig.username : "", page.ig.id, tokenEnc, null, "", user.id, now, "facebook_login"),
      auditStmt(db, tenantId, user.id, "connect", "instagram")
    );
  }
  await db.batch(stmts);
  const rows = (
    await db.prepare("SELECT * FROM social_accounts WHERE tenant_id = ? AND api = 'facebook_login' AND connection_status = 'connected'").bind(tenantId).all()
  ).results;
  for (const r of rows) await syncAccount(db, env, r);
}

// Ritorno da Instagram dopo il login. Restituisce l'indirizzo a cui riportare l'utente.
export async function finishInstagramConnect(db, env, url, user, resolveAccess) {
  const st = await consumeState(db, url, user, "instagram", resolveAccess);
  if (st.redirect) return st;
  const { row, back } = st;

  if (url.searchParams.get("error")) return { redirect: back("annullato") };
  const code = (url.searchParams.get("code") || "").replace(/#_$/, "");
  if (!code) return { redirect: back("errore") };

  try {
    const { token, expiresIn, permissions } = await exchangeInstagramCode(env, appOrigin(env, url), code);
    const profile = await fetchInstagramProfile(token);
    if (profile.account_type && !["BUSINESS", "MEDIA_CREATOR", "CREATOR"].includes(profile.account_type))
      return { redirect: back("account-personale") };
    const tokenEnc = await encryptToken(env.TOKEN_ENC_KEY, token);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const extId = String(profile.user_id || profile.id || "");
    const handle = profile.username ? "@" + profile.username : "";
    await dropForeignHistory(db, row.tenant_id, "instagram", extId).run();
    await db
      .prepare(
        "INSERT INTO social_accounts(id, tenant_id, platform, handle, external_account_id, connection_status, access_token_enc, token_expires_at, scopes, connected_by, connected_at, last_error) " +
          "VALUES(?,?,?,?,?,'connected',?,?,?,?,?,NULL) " +
          "ON CONFLICT(tenant_id, platform) DO UPDATE SET handle=excluded.handle, external_account_id=excluded.external_account_id, " +
          "connection_status='connected', access_token_enc=excluded.access_token_enc, token_expires_at=excluded.token_expires_at, " +
          "scopes=excluded.scopes, connected_by=excluded.connected_by, connected_at=excluded.connected_at, last_error=NULL, api='instagram_login'"
      )
      .bind(crypto.randomUUID(), row.tenant_id, "instagram", handle, extId, tokenEnc, expiresAt, permissions, user.id, nowIso())
      .run();
    await db
      .prepare("INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id) VALUES(?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), row.tenant_id, user.id, "connect", "social_account", "instagram")
      .run();
    const account = await db.prepare("SELECT * FROM social_accounts WHERE tenant_id = ? AND platform = 'instagram'").bind(row.tenant_id).first();
    await syncAccount(db, env, account, { profile, token });
    return { redirect: back("collegato") };
  } catch (e) {
    console.error("Instagram connect failed", e?.message);
    return { redirect: back("errore") };
  }
}

export async function disconnect(db, user, tenantId, platform) {
  await db.batch([
    db
      .prepare(
        "UPDATE social_accounts SET connection_status='disconnected', access_token_enc=NULL, token_expires_at=NULL WHERE tenant_id = ? AND platform = ?"
      )
      .bind(tenantId, platform),
    db
      .prepare("INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id) VALUES(?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), tenantId, user.id, "disconnect", "social_account", platform),
  ]);
}

// Legge profilo e statistiche e salva la riga del giorno. Rinnova il token se sta per scadere.
export async function syncAccount(db, env, account, prefetched = {}) {
  if (account.connection_status !== "connected") return { skipped: true };
  if (account.api === "facebook_login") return syncViaFacebook(db, env, account);
  if (account.platform !== "instagram") return { skipped: true };
  try {
    let token = prefetched.token || (await decryptToken(env.TOKEN_ENC_KEY, account.access_token_enc));
    const expiresAt = account.token_expires_at ? Date.parse(account.token_expires_at) : 0;
    const connectedAt = account.connected_at ? Date.parse(account.connected_at) : Date.now();
    if (
      !prefetched.token &&
      expiresAt &&
      expiresAt - Date.now() < REFRESH_WITHIN_DAYS * 86400000 &&
      Date.now() - connectedAt > 86400000
    ) {
      const r = await refreshInstagramToken(token);
      token = r.token;
      await db
        .prepare("UPDATE social_accounts SET access_token_enc = ?, token_expires_at = ? WHERE id = ?")
        .bind(await encryptToken(env.TOKEN_ENC_KEY, token), new Date(Date.now() + r.expiresIn * 1000).toISOString(), account.id)
        .run();
    }

    const profile = prefetched.profile || (await fetchInstagramProfile(token));
    let insights = {};
    let insightsError = null;
    try {
      insights = await fetchInstagramInsights(token, profile.user_id || profile.id || account.external_account_id);
    } catch (e) {
      if (e.auth) throw e;
      insightsError = e.message; // es. account sotto i 100 follower: salviamo comunque i follower
    }

    await db.batch([
      db
        .prepare(
          "INSERT INTO social_metrics_daily(account_id, tenant_id, day, followers, media_count, reach_30d, interactions_30d, engaged_30d, raw_json) " +
            "VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id, day) DO UPDATE SET followers=excluded.followers, media_count=excluded.media_count, " +
            "reach_30d=excluded.reach_30d, interactions_30d=excluded.interactions_30d, engaged_30d=excluded.engaged_30d, raw_json=excluded.raw_json"
        )
        .bind(
          account.id,
          account.tenant_id,
          today(),
          profile.followers_count ?? null,
          profile.media_count ?? null,
          insights.reach ?? null,
          insights.total_interactions ?? null,
          insights.accounts_engaged ?? null,
          JSON.stringify({ insights, insightsError })
        ),
      db
        .prepare("UPDATE social_accounts SET last_sync_at = ?, last_error = ?, handle = COALESCE(?, handle) WHERE id = ?")
        .bind(nowIso(), insightsError, profile.username ? "@" + profile.username : null, account.id),
    ]);
    return { ok: true };
  } catch (e) {
    const status = e instanceof PlatformError && e.auth ? "expired" : "connected";
    await db
      .prepare("UPDATE social_accounts SET last_error = ?, connection_status = ? WHERE id = ?")
      .bind(String(e.message || e).slice(0, 300), status, account.id)
      .run();
    return { error: e.message };
  }
}

function metricsStmt(db, account, m) {
  return db
    .prepare(
      "INSERT INTO social_metrics_daily(account_id, tenant_id, day, followers, media_count, reach_30d, interactions_30d, engaged_30d, raw_json) " +
        "VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id, day) DO UPDATE SET followers=excluded.followers, media_count=excluded.media_count, " +
        "reach_30d=excluded.reach_30d, interactions_30d=excluded.interactions_30d, engaged_30d=excluded.engaged_30d, raw_json=excluded.raw_json"
    )
    .bind(account.id, account.tenant_id, today(), m.followers, m.media, m.reach, m.interactions, m.engaged, JSON.stringify(m.raw || {}));
}

// Account collegati tramite la pagina Facebook (token della pagina, non scade).
async function syncViaFacebook(db, env, account) {
  try {
    const token = await decryptToken(env.TOKEN_ENC_KEY, account.access_token_enc);
    let m;
    let handle = null;
    let note = null;
    if (account.platform === "facebook") {
      const r = await fetchPageMetrics(token, account.external_account_id);
      m = { followers: r.followers, media: null, reach: r.reach, interactions: r.engagements, engaged: null, raw: r };
      handle = r.name || null;
      note = r.insightsError;
    } else {
      const r = await fetchInstagramViaPage(token, account.external_account_id);
      m = {
        followers: r.profile.followers_count ?? null,
        media: r.profile.media_count ?? null,
        reach: r.insights.reach ?? null,
        interactions: r.insights.total_interactions ?? null,
        engaged: r.insights.accounts_engaged ?? null,
        raw: { insights: r.insights, insightsError: r.insightsError },
      };
      handle = r.profile.username ? "@" + r.profile.username : null;
      note = r.insightsError;
    }
    await db.batch([
      metricsStmt(db, account, m),
      db
        .prepare("UPDATE social_accounts SET last_sync_at = ?, last_error = ?, handle = COALESCE(?, handle) WHERE id = ?")
        .bind(nowIso(), note, handle, account.id),
    ]);
    return { ok: true };
  } catch (e) {
    const status = e instanceof PlatformError && e.auth ? "expired" : "connected";
    await db
      .prepare("UPDATE social_accounts SET last_error = ?, connection_status = ? WHERE id = ?")
      .bind(String(e.message || e).slice(0, 300), status, account.id)
      .run();
    return { error: e.message };
  }
}

// Eseguita ogni giorno dal cron del Worker.
export async function syncAll(db, env) {
  const accounts = (await db.prepare("SELECT * FROM social_accounts WHERE connection_status = 'connected'").all()).results;
  let ok = 0;
  for (const a of accounts) if ((await syncAccount(db, env, a)).ok) ok++;
  return { total: accounts.length, ok };
}
