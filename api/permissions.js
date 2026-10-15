// Punto UNICO in cui si decide chi può vedere o modificare cosa.
// D1 non isola i dati da solo: ogni endpoint deve passare da qui.
//
// Modello:
// - Un tenant "agency" è il workspace di un'agenzia (Re-Frame, future agenzie white-label).
// - Un tenant "client" è un'azienda cliente, collegata alla sua agenzia tramite agency_id.
// - Chi ha un ruolo d'agenzia (owner, agency_admin, editor) sul tenant agenzia
//   accede a TUTTI i clienti di quell'agenzia, e solo a quelli.
// - Un client_viewer ha una membership diretta sul tenant cliente e lo vede in sola lettura.

export const ROLES = {
  owner: { manageClients: true, editClient: true, label: "Proprietario" },
  agency_admin: { manageClients: true, editClient: true, label: "Amministratore" },
  editor: { manageClients: false, editClient: true, label: "Editor" },
  client_viewer: { manageClients: false, editClient: false, label: "Cliente" },
};
const AGENCY_ROLES = ["owner", "agency_admin", "editor"];

export async function loadContext(db, email) {
  const user = await db.prepare("SELECT id,email,display_name FROM users WHERE email = ?").bind(email).first();
  if (!user) return null;
  const rows = (
    await db
      .prepare(
        "SELECT m.tenant_id, m.role, t.kind, t.name FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = ?"
      )
      .bind(user.id)
      .all()
  ).results;

  const agencies = new Map(); // agency tenant_id -> { role, name }
  const viewerOf = new Set(); // client tenant_id visibili in sola lettura
  for (const r of rows) {
    if (r.kind === "agency" && AGENCY_ROLES.includes(r.role)) agencies.set(r.tenant_id, { role: r.role, name: r.name });
    else if (r.kind === "client" && r.role === "client_viewer") viewerOf.add(r.tenant_id);
    // Altre combinazioni (es. owner diretto su un cliente) non danno accesso: conta solo l'agenzia.
  }
  return { user, agencies, viewerOf };
}

// Agenzie in cui l'utente può creare clienti.
export function managedAgencies(ctx) {
  return [...ctx.agencies].filter(([, a]) => ROLES[a.role].manageClients).map(([id]) => id);
}

// Accesso a un tenant cliente già letto dal database. null = nessun accesso.
export function clientAccess(ctx, tenant) {
  if (!tenant || tenant.kind !== "client") return null;
  const agency = tenant.agency_id ? ctx.agencies.get(tenant.agency_id) : null;
  if (agency) return { role: agency.role, edit: ROLES[agency.role].editClient };
  if (ctx.viewerOf.has(tenant.id)) return { role: "client_viewer", edit: false };
  return null;
}

// Condizione SQL per elencare solo i clienti visibili all'utente.
export function visibleClientsFilter(ctx) {
  const agencyIds = [...ctx.agencies.keys()];
  const viewerIds = [...ctx.viewerOf];
  const parts = [];
  const params = [];
  if (agencyIds.length) {
    parts.push(`agency_id IN (${agencyIds.map(() => "?").join(",")})`);
    params.push(...agencyIds);
  }
  if (viewerIds.length) {
    parts.push(`id IN (${viewerIds.map(() => "?").join(",")})`);
    params.push(...viewerIds);
  }
  if (!parts.length) return null;
  return { sql: `kind = 'client' AND (${parts.join(" OR ")})`, params };
}
