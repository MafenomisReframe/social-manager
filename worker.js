import { jwtVerify, createRemoteJWKSet } from "jose";
import { handleApi, json } from "./api/handler.js";
import { syncAll } from "./api/social.js";

// Gli endpoint dati falliscono "chiusi" finché la verifica del JWT di Access non è configurata.
// Mai fidarsi di email, tenant ID o header non firmati inviati dal browser.
const TEAM_DOMAIN = "https://nameless-cherry-6ec3.cloudflareaccess.com";
const jwks = createRemoteJWKSet(new URL(TEAM_DOMAIN + "/cdn-cgi/access/certs"));

async function identity(request, env) {
  if (!env.POLICY_AUD) return { error: "auth_not_configured", status: 503 };
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { error: "unauthorized", status: 401 };
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: TEAM_DOMAIN,
      audience: env.POLICY_AUD,
      algorithms: ["RS256"],
    });
    if (typeof payload.email !== "string" || !payload.email) return { error: "identity_missing", status: 403 };
    return { email: payload.email.toLowerCase() };
  } catch {
    return { error: "invalid_access_token", status: 401 };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      try {
        if (!env.DB) return json({ status: "unavailable", database: "binding_missing" }, 503);
        await env.DB.prepare("SELECT 1 AS ok").first();
        return json({ status: "ok", database: "connected" });
      } catch {
        return json({ status: "unavailable", database: "error" }, 503);
      }
    }

    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      const auth = await identity(request, env);
      if (auth.error) return json({ error: auth.error }, auth.status);
      return await handleApi(request, env, auth.email);
    } catch (e) {
      console.error("API error", e);
      return json({ error: "save_failed" }, 500);
    }
  },

  // Ogni giorno (vedi "triggers" in wrangler.jsonc): legge le statistiche di tutti gli account collegati
  // e rinnova i token in scadenza.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      syncAll(env.DB, env)
        .then((r) => console.log("Social sync", r))
        .catch((e) => console.error("Social sync failed", e))
    );
  },
};
