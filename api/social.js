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

export const PLATFORMS = ["instagram", "facebook", "linkedin", "tiktok"];
const READY = { instagram: (env) => Boolean(env.IG_APP_ID && env.IG_APP_SECRET && env.TOKEN_ENC_KEY) };
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
        "SELECT id, platform, handle, external_account_id, connection_status, connected_at, last_sync_at, last_error, token_expires_at " +
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
      available: Boolean(READY[platform]?.(env)),
      status: a?.connection_status || "disconnected",
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
  if (platform !== "instagram") return { error: "platform_not_supported", status: 400 };
  if (!READY.instagram(env)) return { error: "platform_not_configured", status: 503 };
  const state = randomState();
  const expires = new Date(Date.now() + STATE_MINUTES * 60000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(nowIso()),
    db
      .prepare("INSERT INTO oauth_states(state, tenant_id, user_id, platform, expires_at) VALUES(?,?,?,?,?)")
      .bind(state, tenantId, user.id, platform, expires),
  ]);
  return { url: instagramAuthorizeUrl(env, appOrigin(env, url), state) };
}

// Ritorno da Instagram dopo il login. Restituisce l'indirizzo a cui riportare l'utente.
export async function finishInstagramConnect(db, env, url, user, resolveAccess) {
  const stateParam = url.searchParams.get("state") || "";
  const row = await db
    .prepare("SELECT tenant_id, platform, expires_at FROM oauth_states WHERE state = ? AND user_id = ?")
    .bind(stateParam, user.id)
    .first();
  if (row) await db.prepare("DELETE FROM oauth_states WHERE state = ?").bind(stateParam).run();
  if (!row || row.platform !== "instagram" || row.expires_at < nowIso()) return { redirect: "/?social=scaduto" };

  const access = await resolveAccess(row.tenant_id);
  if (!access || !canConnect(access)) return { redirect: "/?social=negato" };
  const back = (result) =>
    (access.role === "client_viewer" ? `/portale/${encodeURIComponent(row.tenant_id)}` : `/clienti/${encodeURIComponent(row.tenant_id)}/social`) +
    "?social=" +
    result;

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
    await db
      .prepare(
        "INSERT INTO social_accounts(id, tenant_id, platform, handle, external_account_id, connection_status, access_token_enc, token_expires_at, scopes, connected_by, connected_at, last_error) " +
          "VALUES(?,?,?,?,?,'connected',?,?,?,?,?,NULL) " +
          "ON CONFLICT(tenant_id, platform) DO UPDATE SET handle=excluded.handle, external_account_id=excluded.external_account_id, " +
          "connection_status='connected', access_token_enc=excluded.access_token_enc, token_expires_at=excluded.token_expires_at, " +
          "scopes=excluded.scopes, connected_by=excluded.connected_by, connected_at=excluded.connected_at, last_error=NULL"
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
  if (account.platform !== "instagram" || account.connection_status !== "connected") return { skipped: true };
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

// Eseguita ogni giorno dal cron del Worker.
export async function syncAll(db, env) {
  const accounts = (await db.prepare("SELECT * FROM social_accounts WHERE connection_status = 'connected'").all()).results;
  let ok = 0;
  for (const a of accounts) if ((await syncAccount(db, env, a)).ok) ok++;
  return { total: accounts.length, ok };
}
