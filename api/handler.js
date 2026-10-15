// API di Social Manager. Riceve l'email già verificata da Cloudflare Access (vedi worker.js),
// così la logica è testabile senza token reali.
import { validateProfile, PROFILE_KEYS } from "../src/shared/validation.js";
import { loadContext, managedAgencies, clientAccess, visibleClientsFilter, ROLES } from "./permissions.js";

export const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

const TENANT_COLS = "id,name,slug,kind,agency_id,branding_json,created_at";

function parseBranding(raw) {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

// Campi riservati all'agenzia: non vengono mai inviati al cliente.
const AGENCY_ONLY_FIELDS = ["notes"];

function clientView(row, access, fullBranding = parseBranding(row.branding_json)) {
  const branding = { ...fullBranding };
  if (access.role === "client_viewer") for (const k of AGENCY_ONLY_FIELDS) delete branding[k];
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    created_at: row.created_at,
    branding,
    permissions: { role: access.role, edit: access.edit },
  };
}

function audit(db, tenantId, actorId, action, entityType, entityId) {
  return db
    .prepare("INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id) VALUES(?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), tenantId, actorId, action, entityType, entityId);
}

async function readJson(request) {
  try {
    return { body: await request.json() };
  } catch {
    return { error: json({ error: "invalid_json" }, 400) };
  }
}

// Le scritture accettano solo richieste dalla stessa origine (protezione CSRF).
const sameOrigin = (request, url) => request.headers.get("Origin") === url.origin;

export async function handleApi(request, env, email) {
  const url = new URL(request.url);
  const db = env.DB;
  const ctx = await loadContext(db, email);
  if (!ctx) return json({ error: "account_not_provisioned" }, 403);
  const { user } = ctx;
  const method = request.method;
  if (method !== "GET" && !sameOrigin(request, url)) return json({ error: "invalid_origin" }, 403);

  if (url.pathname === "/api/session" && method === "GET") {
    return json({
      user,
      agencies: [...ctx.agencies].map(([id, a]) => ({ id, name: a.name, role: a.role })),
      can: { manageClients: managedAgencies(ctx).length > 0 },
    });
  }

  if (url.pathname === "/api/clients" && method === "GET") {
    const filter = visibleClientsFilter(ctx);
    if (!filter) return json({ clients: [] });
    const rows = (
      await db
        .prepare(`SELECT ${TENANT_COLS} FROM tenants WHERE ${filter.sql} ORDER BY created_at DESC, name`)
        .bind(...filter.params)
        .all()
    ).results;
    const clients = rows.map((r) => {
      const access = clientAccess(ctx, r);
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        created_at: r.created_at,
        sector: parseBranding(r.branding_json).sector || "",
        permissions: { role: access.role, edit: access.edit },
      };
    });
    return json({ clients });
  }

  if (url.pathname === "/api/clients" && method === "POST") {
    const managed = managedAgencies(ctx);
    if (!managed.length) return json({ error: "forbidden" }, 403);
    const { body, error } = await readJson(request);
    if (error) return error;

    let agencyId = body?.agency_id;
    if (agencyId === undefined) {
      if (managed.length !== 1) return json({ error: "agency_required" }, 400);
      agencyId = managed[0];
    } else if (!managed.includes(agencyId)) {
      return json({ error: "forbidden" }, 403);
    }

    const { values, errors } = validateProfile({ name: body?.name ?? "" });
    if (errors.name) return json({ error: "invalid_name" }, 400);
    const id = crypto.randomUUID();
    const slug = "client-" + id.slice(0, 8);
    await db.batch([
      db.prepare("INSERT INTO tenants(id,name,slug,kind,agency_id) VALUES(?,?,?,'client',?)").bind(id, values.name, slug, agencyId),
      audit(db, id, user.id, "create", "tenant", id),
    ]);
    return json({ client: { id, name: values.name, slug } }, 201);
  }

  const match = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (match) {
    let id;
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      return json({ error: "not_found" }, 404);
    }
    const row = await db.prepare(`SELECT ${TENANT_COLS} FROM tenants WHERE id = ?`).bind(id).first();
    const access = clientAccess(ctx, row);
    // Stessa risposta se il cliente non esiste o appartiene ad altri: non si rivela nulla.
    if (!access) return json({ error: "not_found" }, 404);

    if (method === "GET") return json({ client: clientView(row, access) });

    if (method === "PATCH") {
      if (!access.edit) return json({ error: "forbidden" }, 403);
      const { body, error } = await readJson(request);
      if (error) return error;
      const input = { name: body?.name ?? "" };
      for (const key of PROFILE_KEYS) if (body?.[key] !== undefined) input[key] = body[key];
      const { values, errors } = validateProfile(input);
      if (Object.keys(errors).length) return json({ error: "validation", fields: errors }, 400);

      const { name, ...details } = values;
      const branding = { ...parseBranding(row.branding_json), ...details };
      await db.batch([
        db.prepare("UPDATE tenants SET name = ?, branding_json = ? WHERE id = ?").bind(name, JSON.stringify(branding), id),
        audit(db, id, user.id, "update", "tenant", id),
      ]);
      return json({ client: clientView({ ...row, name }, access, branding) });
    }
  }

  return json({ error: "not_found" }, 404);
}

export { ROLES };
