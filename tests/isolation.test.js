// Test di isolamento multi-tenant: nessun utente deve vedere o modificare dati di altri.
// Avvio: bun test
import { beforeEach, describe, expect, test } from "bun:test";
import { createTestDb } from "./d1-sqlite.js";
import { handleApi } from "../api/handler.js";

const ORIGIN = "https://social-manager.test";
let env;

// Due agenzie (Re-Frame e un'altra), tre clienti, cinque utenti con ruoli diversi.
function seed(db) {
  db.raw.exec(`
    INSERT INTO tenants(id,name,slug,kind) VALUES
      ('tenant-reframe-001','Re-Frame','reframe','agency'),
      ('agency-b','Agenzia B','agency-b','agency');
    INSERT INTO tenants(id,name,slug,kind,agency_id) VALUES
      ('client-a1','Effebiemme','client-a1','client','tenant-reframe-001'),
      ('client-a2','Seconda A','client-a2','client','tenant-reframe-001'),
      ('client-b1','Cliente di B','client-b1','client','agency-b');
    INSERT INTO users(id,email) VALUES
      ('u-owner-a','owner@a.it'),('u-editor-a','editor@a.it'),('u-viewer-a1','viewer@a1.it'),
      ('u-owner-b','owner@b.it'),('u-nobody','nobody@x.it'),('u-legacy','legacy@x.it');
    INSERT INTO memberships(tenant_id,user_id,role) VALUES
      ('tenant-reframe-001','u-owner-a','owner'),
      ('tenant-reframe-001','u-editor-a','editor'),
      ('client-a1','u-viewer-a1','client_viewer'),
      ('agency-b','u-owner-b','owner'),
      ('client-a2','u-legacy','owner');
  `);
}

beforeEach(() => {
  const db = createTestDb();
  seed(db);
  env = { DB: db };
});

async function call(email, method, path, body) {
  const headers = { Origin: ORIGIN };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const req = new Request(ORIGIN + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handleApi(req, env, email);
  return { status: res.status, data: await res.json() };
}
const ids = (r) => r.data.clients.map((c) => c.id).sort();

describe("elenco clienti", () => {
  test("owner A vede solo i clienti di A, non l'agenzia stessa", async () => {
    expect(ids(await call("owner@a.it", "GET", "/api/clients"))).toEqual(["client-a1", "client-a2"]);
  });
  test("owner B vede solo i clienti di B", async () => {
    expect(ids(await call("owner@b.it", "GET", "/api/clients"))).toEqual(["client-b1"]);
  });
  test("il cliente vede solo la propria azienda", async () => {
    expect(ids(await call("viewer@a1.it", "GET", "/api/clients"))).toEqual(["client-a1"]);
  });
  test("utente senza ruoli non vede nulla", async () => {
    expect(ids(await call("nobody@x.it", "GET", "/api/clients"))).toEqual([]);
  });
  test("una membership 'owner' diretta su un cliente non dà accesso", async () => {
    expect(ids(await call("legacy@x.it", "GET", "/api/clients"))).toEqual([]);
  });
  test("utente non registrato è respinto", async () => {
    expect((await call("sconosciuto@x.it", "GET", "/api/clients")).status).toBe(403);
  });
});

describe("lettura e modifica della scheda", () => {
  test("agenzia B non può leggere un cliente di A (404, nessuna informazione)", async () => {
    const r = await call("owner@b.it", "GET", "/api/clients/client-a1");
    expect(r.status).toBe(404);
  });
  test("agenzia B non può modificare un cliente di A", async () => {
    const r = await call("owner@b.it", "PATCH", "/api/clients/client-a1", { name: "Hack" });
    expect(r.status).toBe(404);
    const row = env.DB.raw.query("SELECT name FROM tenants WHERE id='client-a1'").get();
    expect(row.name).toBe("Effebiemme");
  });
  test("il tenant agenzia non è leggibile come cliente", async () => {
    expect((await call("owner@a.it", "GET", "/api/clients/tenant-reframe-001")).status).toBe(404);
  });
  test("il cliente legge la propria scheda in sola lettura", async () => {
    const r = await call("viewer@a1.it", "GET", "/api/clients/client-a1");
    expect(r.status).toBe(200);
    expect(r.data.client.permissions).toEqual({ role: "client_viewer", edit: false });
  });
  test("le note interne non arrivano mai al cliente", async () => {
    await call("owner@a.it", "PATCH", "/api/clients/client-a1", { name: "Effebiemme", notes: "Pagamenti lenti", sector: "Moda" });
    const asViewer = await call("viewer@a1.it", "GET", "/api/clients/client-a1");
    expect(asViewer.data.client.branding.notes).toBeUndefined();
    expect(asViewer.data.client.branding.sector).toBe("Moda");
    const asOwner = await call("owner@a.it", "GET", "/api/clients/client-a1");
    expect(asOwner.data.client.branding.notes).toBe("Pagamenti lenti");
  });
  test("il cliente non può modificare la propria scheda", async () => {
    expect((await call("viewer@a1.it", "PATCH", "/api/clients/client-a1", { name: "Nuovo" })).status).toBe(403);
  });
  test("il cliente non vede un altro cliente della stessa agenzia", async () => {
    expect((await call("viewer@a1.it", "GET", "/api/clients/client-a2")).status).toBe(404);
  });
  test("l'editor modifica e la modifica è registrata nell'audit", async () => {
    const r = await call("editor@a.it", "PATCH", "/api/clients/client-a1", { name: "Effebiemme Srl", website: "effebiemme.it" });
    expect(r.status).toBe(200);
    expect(r.data.client.branding.website).toBe("https://effebiemme.it");
    const audit = env.DB.raw.query("SELECT actor_id, action FROM audit_events WHERE tenant_id='client-a1'").all();
    expect(audit).toEqual([{ actor_id: "u-editor-a", action: "update" }]);
  });
  test("campi non validi restituiscono l'errore per campo", async () => {
    const r = await call("owner@a.it", "PATCH", "/api/clients/client-a1", { name: "Ok", email: "pippo" });
    expect(r.status).toBe(400);
    expect(r.data.fields.email).toBeDefined();
  });
  test("campi sconosciuti vengono ignorati", async () => {
    await call("owner@a.it", "PATCH", "/api/clients/client-a1", { name: "Ok", agency_id: "agency-b", kind: "agency" });
    const row = env.DB.raw.query("SELECT kind, agency_id, branding_json FROM tenants WHERE id='client-a1'").get();
    expect(row).toEqual({ kind: "client", agency_id: "tenant-reframe-001", branding_json: "{}" });
  });
});

describe("creazione clienti", () => {
  test("owner A crea un cliente che finisce nella propria agenzia", async () => {
    const r = await call("owner@a.it", "POST", "/api/clients", { name: "Nuova Srl" });
    expect(r.status).toBe(201);
    const row = env.DB.raw.query("SELECT kind, agency_id FROM tenants WHERE id=?").get(r.data.client.id);
    expect(row).toEqual({ kind: "client", agency_id: "tenant-reframe-001" });
    expect(ids(await call("owner@b.it", "GET", "/api/clients"))).toEqual(["client-b1"]);
  });
  test("owner A non può creare clienti dentro l'agenzia B", async () => {
    expect((await call("owner@a.it", "POST", "/api/clients", { name: "X Srl", agency_id: "agency-b" })).status).toBe(403);
  });
  test("editor e cliente non possono creare clienti", async () => {
    expect((await call("editor@a.it", "POST", "/api/clients", { name: "X Srl" })).status).toBe(403);
    expect((await call("viewer@a1.it", "POST", "/api/clients", { name: "X Srl" })).status).toBe(403);
  });
});

describe("sicurezza richieste", () => {
  test("scritture da un'altra origine sono respinte", async () => {
    const req = new Request(ORIGIN + "/api/clients/client-a1", {
      method: "PATCH",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hack" }),
    });
    expect((await handleApi(req, env, "owner@a.it")).status).toBe(403);
  });
  test("la sessione indica cosa può fare l'utente", async () => {
    expect((await call("owner@a.it", "GET", "/api/session")).data.can.manageClients).toBe(true);
    expect((await call("viewer@a1.it", "GET", "/api/session")).data.can.manageClients).toBe(false);
  });
});

describe("chat cliente-agenzia", () => {
  test("agenzia e cliente si scrivono nella stessa conversazione", async () => {
    const a = await call("owner@a.it", "POST", "/api/clients/client-a1/messages", { body: "Ciao, ecco il piano" });
    expect(a.status).toBe(201);
    const c = await call("viewer@a1.it", "POST", "/api/clients/client-a1/messages", { body: "Perfetto, grazie!" });
    expect(c.status).toBe(201);
    const list = (await call("viewer@a1.it", "GET", "/api/clients/client-a1/messages")).data.messages;
    expect(list.map((m) => [m.body, m.from, m.mine])).toEqual([
      ["Ciao, ecco il piano", "agency", false],
      ["Perfetto, grazie!", "client", true],
    ]);
    // Una sola conversazione per cliente.
    expect(env.DB.raw.query("SELECT COUNT(*) AS n FROM tickets WHERE tenant_id='client-a1' AND kind='chat'").get().n).toBe(1);
  });
  test("si possono chiedere solo i messaggi nuovi", async () => {
    const first = await call("owner@a.it", "POST", "/api/clients/client-a1/messages", { body: "Uno" });
    await call("owner@a.it", "POST", "/api/clients/client-a1/messages", { body: "Due" });
    const after = first.data.message.seq;
    const list = (await call("owner@a.it", "GET", "/api/clients/client-a1/messages?after=" + after)).data.messages;
    expect(list.map((m) => m.body)).toEqual(["Due"]);
  });
  test("altre agenzie e altri clienti non leggono né scrivono la chat", async () => {
    await call("owner@a.it", "POST", "/api/clients/client-a1/messages", { body: "Riservato" });
    expect((await call("owner@b.it", "GET", "/api/clients/client-a1/messages")).status).toBe(404);
    expect((await call("owner@b.it", "POST", "/api/clients/client-a1/messages", { body: "x" })).status).toBe(404);
    expect((await call("viewer@a1.it", "GET", "/api/clients/client-a2/messages")).status).toBe(404);
  });
  test("messaggi vuoti o troppo lunghi sono rifiutati", async () => {
    expect((await call("owner@a.it", "POST", "/api/clients/client-a1/messages", { body: "   " })).status).toBe(400);
    expect((await call("owner@a.it", "POST", "/api/clients/client-a1/messages", { body: "a".repeat(4001) })).status).toBe(400);
  });
  test("la scheda indica l'agenzia che segue il cliente", async () => {
    expect((await call("viewer@a1.it", "GET", "/api/clients/client-a1")).data.client.agency_name).toBe("Re-Frame");
  });
});

describe("eliminazione cliente", () => {
  test("il proprietario elimina il cliente e tutti i suoi dati", async () => {
    await call("owner@a.it", "POST", "/api/clients/client-a1/messages", { body: "ciao" });
    const r = await call("owner@a.it", "DELETE", "/api/clients/client-a1", { confirm_name: "effebiemme" });
    expect(r.status).toBe(200);
    expect(env.DB.raw.query("SELECT COUNT(*) AS n FROM tenants WHERE id='client-a1'").get().n).toBe(0);
    expect(env.DB.raw.query("SELECT COUNT(*) AS n FROM ticket_messages").get().n).toBe(0);
    expect(env.DB.raw.query("SELECT COUNT(*) AS n FROM memberships WHERE tenant_id='client-a1'").get().n).toBe(0);
    expect(env.DB.raw.query("SELECT action FROM audit_events WHERE tenant_id='tenant-reframe-001'").get().action).toBe("delete");
    expect(ids(await call("owner@a.it", "GET", "/api/clients"))).toEqual(["client-a2"]);
  });
  test("senza il nome corretto non elimina nulla", async () => {
    expect((await call("owner@a.it", "DELETE", "/api/clients/client-a1", { confirm_name: "altro" })).status).toBe(400);
    expect(env.DB.raw.query("SELECT COUNT(*) AS n FROM tenants WHERE id='client-a1'").get().n).toBe(1);
  });
  test("editor, cliente e altre agenzie non possono eliminare", async () => {
    expect((await call("editor@a.it", "DELETE", "/api/clients/client-a1", { confirm_name: "Effebiemme" })).status).toBe(403);
    expect((await call("viewer@a1.it", "DELETE", "/api/clients/client-a1", { confirm_name: "Effebiemme" })).status).toBe(403);
    expect((await call("owner@b.it", "DELETE", "/api/clients/client-a1", { confirm_name: "Effebiemme" })).status).toBe(404);
    expect((await call("owner@a.it", "DELETE", "/api/clients/tenant-reframe-001", { confirm_name: "Re-Frame" })).status).toBe(404);
    expect(env.DB.raw.query("SELECT COUNT(*) AS n FROM tenants").get().n).toBe(5);
  });
});

describe("accessi del cliente (inviti)", () => {
  test("l'agenzia invita un'email: la persona entra e vede solo quel cliente", async () => {
    const r = await call("owner@a.it", "POST", "/api/clients/client-a1/members", { email: " Mario@Cliente.IT ", name: "Mario" });
    expect(r.status).toBe(201);
    expect(r.data.members.map((m) => [m.email, m.display_name])).toEqual([
      ["mario@cliente.it", "Mario"],
      ["viewer@a1.it", null],
    ]);
    expect(ids(await call("mario@cliente.it", "GET", "/api/clients"))).toEqual(["client-a1"]);
    const c = await call("mario@cliente.it", "GET", "/api/clients/client-a1");
    expect(c.data.client.permissions).toEqual({ role: "client_viewer", edit: false });
  });
  test("invitare due volte la stessa email non crea doppioni", async () => {
    await call("owner@a.it", "POST", "/api/clients/client-a1/members", { email: "mario@cliente.it" });
    await call("owner@a.it", "POST", "/api/clients/client-a1/members", { email: "MARIO@cliente.it" });
    expect(env.DB.raw.query("SELECT COUNT(*) AS n FROM users WHERE email='mario@cliente.it'").get().n).toBe(1);
    expect(env.DB.raw.query("SELECT COUNT(*) AS n FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.email='mario@cliente.it'").get().n).toBe(1);
  });
  test("la stessa persona può essere invitata su due clienti", async () => {
    await call("owner@a.it", "POST", "/api/clients/client-a1/members", { email: "mario@cliente.it" });
    await call("owner@a.it", "POST", "/api/clients/client-a2/members", { email: "mario@cliente.it" });
    expect(ids(await call("mario@cliente.it", "GET", "/api/clients"))).toEqual(["client-a1", "client-a2"]);
  });
  test("togliere l'accesso blocca subito la persona", async () => {
    const r = await call("owner@a.it", "POST", "/api/clients/client-a1/members", { email: "mario@cliente.it" });
    const mario = r.data.members.find((m) => m.email === "mario@cliente.it");
    await call("owner@a.it", "DELETE", `/api/clients/client-a1/members/${mario.id}`);
    expect((await call("mario@cliente.it", "GET", "/api/clients/client-a1")).status).toBe(404);
    expect(ids(await call("mario@cliente.it", "GET", "/api/clients"))).toEqual([]);
  });
  test("email non valida o del team agenzia rifiutate", async () => {
    expect((await call("owner@a.it", "POST", "/api/clients/client-a1/members", { email: "pippo" })).status).toBe(400);
    expect((await call("owner@a.it", "POST", "/api/clients/client-a1/members", { email: "editor@a.it" })).status).toBe(409);
  });
  test("il cliente e le altre agenzie non vedono né modificano gli accessi", async () => {
    expect((await call("viewer@a1.it", "GET", "/api/clients/client-a1/members")).status).toBe(403);
    expect((await call("viewer@a1.it", "POST", "/api/clients/client-a1/members", { email: "x@y.it" })).status).toBe(403);
    expect((await call("owner@b.it", "GET", "/api/clients/client-a1/members")).status).toBe(404);
    expect((await call("owner@b.it", "POST", "/api/clients/client-a1/members", { email: "x@y.it" })).status).toBe(404);
  });
  test("una persona non invitata viene respinta", async () => {
    expect((await call("estraneo@x.it", "GET", "/api/clients")).data.error).toBe("account_not_provisioned");
  });
});
