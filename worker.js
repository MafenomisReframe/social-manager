import { jwtVerify, createRemoteJWKSet } from "jose";
import { validateProfile, PROFILE_KEYS } from "./src/shared/validation.js";

// Tutti gli endpoint dati falliscono "chiusi" finché la verifica del JWT di Access non è configurata.
// Mai fidarsi di email, tenant ID o header non firmati inviati dal browser.
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

const TEAM_DOMAIN = "https://nameless-cherry-6ec3.cloudflareaccess.com";
// Workspace dell'agenzia: non è un cliente e non compare nell'elenco clienti.
// (Nella fase 2 diventerà un campo agency_id sui tenant, per supportare più agenzie.)
const AGENCY_TENANT_ID = "tenant-reframe-001";
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
    return { email: payload.email.toLowerCase(), sub: String(payload.sub || "") };
  } catch {
    return { error: "invalid_access_token", status: 401 };
  }
}

function sameOrigin(request, url) {
  return request.headers.get("Origin") === url.origin;
}

async function readJson(request) {
  try {
    return { body: await request.json() };
  } catch {
    return { error: json({ error: "invalid_json" }, 400) };
  }
}

function parseBranding(raw) {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function clientView(row) {
  const branding = parseBranding(row.branding_json);
  return { id: row.id, name: row.name, slug: row.slug, created_at: row.created_at, branding };
}

// Cliente visibile solo se l'utente ne è membro; il tenant dell'agenzia è escluso.
const CLIENT_SQL =
  "SELECT id,name,slug,branding_json,created_at FROM tenants WHERE id=? AND id<>? " +
  "AND EXISTS(SELECT 1 FROM memberships WHERE tenant_id=tenants.id AND user_id=?)";

function audit(env, tenantId, actorId, action, entityType, entityId) {
  return env.DB.prepare(
    "INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id) VALUES(?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), tenantId, actorId, action, entityType, entityId);
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

      const user = await env.DB.prepare("SELECT id,email,display_name FROM users WHERE email = ?").bind(auth.email).first();
      if (!user) return json({ error: "account_not_provisioned" }, 403);
      const memberships = (
        await env.DB.prepare("SELECT tenant_id,role FROM memberships WHERE user_id = ?").bind(user.id).all()
      ).results;

      if (url.pathname === "/api/session" && request.method === "GET") return json({ user, memberships });

      // Solo l'owner del workspace agenzia gestisce i clienti.
      const agencyOwner = memberships.some((m) => m.tenant_id === AGENCY_TENANT_ID && m.role === "owner");

      if (url.pathname === "/api/clients" && request.method === "GET") {
        if (!agencyOwner) return json({ error: "forbidden" }, 403);
        const rows = await env.DB.prepare(
          "SELECT t.id,t.name,t.slug,t.branding_json,t.created_at FROM tenants t " +
            "JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=? AND t.id<>? ORDER BY t.created_at DESC,t.name"
        )
          .bind(user.id, AGENCY_TENANT_ID)
          .all();
        const clients = rows.results.map((r) => {
          const c = clientView(r);
          return { id: c.id, name: c.name, slug: c.slug, created_at: c.created_at, sector: c.branding.sector || "" };
        });
        return json({ clients });
      }

      if (url.pathname === "/api/clients" && request.method === "POST") {
        if (!agencyOwner) return json({ error: "forbidden" }, 403);
        if (!sameOrigin(request, url)) return json({ error: "invalid_origin" }, 403);
        const { body, error } = await readJson(request);
        if (error) return error;
        const { values, errors } = validateProfile({ name: body?.name ?? "" });
        if (errors.name) return json({ error: "invalid_name" }, 400);
        const id = crypto.randomUUID();
        const slug = "client-" + id.slice(0, 8);
        await env.DB.batch([
          env.DB.prepare("INSERT INTO tenants(id,name,slug) VALUES(?,?,?)").bind(id, values.name, slug),
          env.DB.prepare("INSERT INTO memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(id, user.id),
          audit(env, id, user.id, "create", "tenant", id),
        ]);
        return json({ client: { id, name: values.name, slug } }, 201);
      }

      const match = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
      if (match) {
        if (!agencyOwner) return json({ error: "forbidden" }, 403);
        let id;
        try {
          id = decodeURIComponent(match[1]);
        } catch {
          return json({ error: "not_found" }, 404);
        }

        if (request.method === "GET") {
          const row = await env.DB.prepare(CLIENT_SQL).bind(id, AGENCY_TENANT_ID, user.id).first();
          if (!row) return json({ error: "not_found" }, 404);
          return json({ client: clientView(row) });
        }

        if (request.method === "PATCH") {
          if (!sameOrigin(request, url)) return json({ error: "invalid_origin" }, 403);
          const row = await env.DB.prepare(CLIENT_SQL).bind(id, AGENCY_TENANT_ID, user.id).first();
          if (!row) return json({ error: "not_found" }, 404);
          const { body, error } = await readJson(request);
          if (error) return error;

          const input = { name: body?.name ?? "" };
          for (const key of PROFILE_KEYS) if (body?.[key] !== undefined) input[key] = body[key];
          const { values, errors } = validateProfile(input);
          if (Object.keys(errors).length) return json({ error: "validation", fields: errors }, 400);

          const { name, ...details } = values;
          const branding = { ...parseBranding(row.branding_json), ...details };
          await env.DB.batch([
            env.DB.prepare("UPDATE tenants SET name=?,branding_json=? WHERE id=?").bind(name, JSON.stringify(branding), id),
            audit(env, id, user.id, "update", "tenant", id),
          ]);
          return json({ client: { ...clientView(row), name, branding } });
        }
      }

      return json({ error: "not_found" }, 404);
    } catch (e) {
      console.error("API error", e);
      return json({ error: "save_failed" }, 500);
    }
  },
};
