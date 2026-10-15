// API di Social Manager. Riceve l'email già verificata da Cloudflare Access (vedi worker.js),
// così la logica è testabile senza token reali.
import { validateProfile, PROFILE_KEYS } from "../src/shared/validation.js";
import { loadContext, managedAgencies, clientAccess, visibleClientsFilter, ROLES } from "./permissions.js";
import {
  PLATFORMS,
  canConnect,
  listSocial,
  startConnect,
  finishInstagramConnect,
  finishFacebookConnect,
  listPendingPages,
  selectPendingPage,
  disconnect,
  syncAccount,
} from "./social.js";

export const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

const TENANT_COLS = "id,name,slug,kind,agency_id,branding_json,created_at";
const CLIENT_BY_ID_SQL =
  "SELECT t.id,t.name,t.slug,t.kind,t.agency_id,t.branding_json,t.created_at,a.name AS agency_name " +
  "FROM tenants t LEFT JOIN tenants a ON a.id = t.agency_id WHERE t.id = ?";
const MAX_MESSAGE = 4000;

// Messaggi della chat del cliente; "from" dice se l'autore è dell'agenzia o del cliente.
async function listMessages(db, client, userId, after) {
  const rows = (
    await db
      .prepare(
        "SELECT tm.rowid AS seq, tm.id, tm.body, tm.created_at, tm.author_id, u.display_name, u.email, " +
          "EXISTS(SELECT 1 FROM memberships m WHERE m.user_id = tm.author_id AND m.tenant_id = ? AND m.role <> 'client_viewer') AS from_agency " +
          "FROM ticket_messages tm JOIN tickets t ON t.id = tm.ticket_id JOIN users u ON u.id = tm.author_id " +
          "WHERE tm.tenant_id = ? AND t.tenant_id = ? AND t.kind = 'chat' AND tm.rowid > ? " +
          "ORDER BY tm.rowid LIMIT 500"
      )
      .bind(client.agency_id || "", client.id, client.id, after)
      .all()
  ).results;
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    body: r.body,
    created_at: r.created_at,
    author: r.display_name || r.email.split("@")[0],
    from: r.from_agency ? "agency" : "client",
    mine: r.author_id === userId,
  }));
}

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
    agency_name: row.agency_name || "",
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

  const resolveAccess = async (tenantId) =>
    clientAccess(ctx, await db.prepare(CLIENT_BY_ID_SQL).bind(tenantId).first());

  // Ritorno dal login di Instagram (navigazione del browser, non fetch).
  if ((url.pathname === "/api/oauth/instagram/callback" || url.pathname === "/api/oauth/facebook/callback") && method === "GET") {
    const finish = url.pathname.includes("/facebook/") ? finishFacebookConnect : finishInstagramConnect;
    const { redirect } = await finish(db, env, url, user, resolveAccess);
    return new Response(null, { status: 302, headers: { Location: redirect, "Cache-Control": "no-store" } });
  }

  // Scelta della pagina Facebook dopo il login (quando l'utente ne gestisce più di una).
  const pendingMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/social\/pending\/([0-9a-f-]{36})$/);
  if (pendingMatch && method === "GET") {
    const id = decodeURIComponent(pendingMatch[1]);
    const access = await resolveAccess(id);
    if (!access || !canConnect(access)) return json({ error: "not_found" }, 404);
    const pages = await listPendingPages(db, env, user, id, pendingMatch[2]);
    return pages ? json({ pages }) : json({ error: "selection_expired" }, 410);
  }

  const socialMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/social(?:\/([a-z]+)(?:\/(connect|sync|select))?)?$/);
  if (socialMatch) {
    let id;
    try {
      id = decodeURIComponent(socialMatch[1]);
    } catch {
      return json({ error: "not_found" }, 404);
    }
    const [, , platform, action] = socialMatch;
    const access = await resolveAccess(id);
    if (!access) return json({ error: "not_found" }, 404);

    if (!platform && method === "GET") return json({ accounts: await listSocial(db, env, id, access) });
    if (!platform || !PLATFORMS.includes(platform)) return json({ error: "not_found" }, 404);
    if (!canConnect(access)) return json({ error: "forbidden" }, 403);

    if (action === "connect" && method === "POST") {
      const r = await startConnect(db, env, url, user, id, platform);
      return r.error ? json({ error: r.error }, r.status) : json({ url: r.url });
    }
    if (action === "select" && method === "POST" && platform === "facebook") {
      const { body, error } = await readJson(request);
      if (error) return error;
      const ok = await selectPendingPage(db, env, user, id, String(body?.pending || ""), String(body?.page_id || ""));
      if (!ok) return json({ error: "selection_expired" }, 410);
      return json({ accounts: await listSocial(db, env, id, access) });
    }
    if (action === "sync" && method === "POST") {
      const account = await db.prepare("SELECT * FROM social_accounts WHERE tenant_id = ? AND platform = ?").bind(id, platform).first();
      if (!account || account.connection_status !== "connected") return json({ error: "not_connected" }, 400);
      if (account.last_sync_at && Date.now() - Date.parse(account.last_sync_at) < 5 * 60000)
        return json({ accounts: await listSocial(db, env, id, access), throttled: true });
      await syncAccount(db, env, account);
      return json({ accounts: await listSocial(db, env, id, access) });
    }
    if (!action && method === "DELETE") {
      await disconnect(db, user, id, platform);
      return json({ accounts: await listSocial(db, env, id, access) });
    }
    return json({ error: "not_found" }, 404);
  }

  const chatMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/messages$/);
  if (chatMatch) {
    let id;
    try {
      id = decodeURIComponent(chatMatch[1]);
    } catch {
      return json({ error: "not_found" }, 404);
    }
    const client = await db.prepare(CLIENT_BY_ID_SQL).bind(id).first();
    const access = clientAccess(ctx, client);
    if (!access) return json({ error: "not_found" }, 404);

    if (method === "GET") {
      const after = Math.max(0, parseInt(url.searchParams.get("after") || "0", 10) || 0);
      return json({ messages: await listMessages(db, client, user.id, after) });
    }

    if (method === "POST") {
      // Anche il cliente in sola lettura può scrivere in chat.
      const { body, error } = await readJson(request);
      if (error) return error;
      const text = typeof body?.body === "string" ? body.body.trim() : "";
      if (!text || text.length > MAX_MESSAGE) return json({ error: "invalid_message" }, 400);

      let ticket = await db.prepare("SELECT id FROM tickets WHERE tenant_id = ? AND kind = 'chat'").bind(id).first();
      const statements = [];
      if (!ticket) {
        ticket = { id: crypto.randomUUID() };
        statements.push(
          db
            .prepare("INSERT INTO tickets(id,tenant_id,subject,status,created_by,kind) VALUES(?,?,'Chat','open',?,'chat')")
            .bind(ticket.id, id, user.id)
        );
      }
      const messageId = crypto.randomUUID();
      const now = new Date().toISOString().replace("T", " ").replace("Z", "");
      statements.push(
        db
          .prepare("INSERT INTO ticket_messages(id,tenant_id,ticket_id,author_id,body,created_at) VALUES(?,?,?,?,?,?)")
          .bind(messageId, id, ticket.id, user.id, text, now)
      );
      await db.batch(statements);
      // seq = posizione progressiva del messaggio: il browser chiede solo quelli successivi.
      const saved = await db.prepare("SELECT rowid AS seq FROM ticket_messages WHERE id = ?").bind(messageId).first();
      return json(
        {
          message: {
            id: messageId,
            seq: saved.seq,
            body: text,
            created_at: now,
            author: user.display_name || user.email.split("@")[0],
            from: access.role === "client_viewer" ? "client" : "agency",
            mine: true,
          },
        },
        201
      );
    }
    return json({ error: "not_found" }, 404);
  }

  const match = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (match) {
    let id;
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      return json({ error: "not_found" }, 404);
    }
    const row = await db.prepare(CLIENT_BY_ID_SQL).bind(id).first();
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
