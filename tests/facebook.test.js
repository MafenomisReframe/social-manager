// Accesso tramite Facebook con Graph API simulata: pagina + Instagram collegato, scelta pagina, isolamento.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTestDb } from "./d1-sqlite.js";
import { handleApi } from "../api/handler.js";
import { syncAll } from "../api/social.js";
import { decryptToken } from "../api/crypto.js";

const ORIGIN = "https://social-manager.test";
const SECRET = "chiave-di-prova-lunga-almeno-trentadue-caratteri!!";
const realFetch = globalThis.fetch;
let env;

const PAGES = [
  { id: "p1", name: "Area Emme", access_token: "PAGE-TOKEN-1", instagram_business_account: { id: "ig1", username: "areaemmecoworking" } },
  { id: "p2", name: "Altra Pagina", access_token: "PAGE-TOKEN-2" },
];

function mockGraph({ pages = PAGES } = {}) {
  globalThis.fetch = async (input) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    const ok = (b) => Response.json(b);
    const path = u.pathname.replace(/^\/v\d+\.\d+/, "");
    if (path === "/oauth/access_token") {
      if (u.searchParams.get("code") && u.searchParams.get("code") !== "CODICE") return Response.json({ error: { message: "bad code" } }, { status: 400 });
      if (u.searchParams.get("client_secret") !== "meta-secret") return Response.json({ error: { message: "bad secret" } }, { status: 400 });
      return ok({ access_token: u.searchParams.get("grant_type") ? "LONG-USER-TOKEN" : "SHORT-USER-TOKEN" });
    }
    if (path === "/me/accounts") return ok({ data: pages });
    const tok = u.searchParams.get("access_token");
    if (path === "/p1") return tok === "PAGE-TOKEN-1" ? ok({ name: "Area Emme", followers_count: 812 }) : Response.json({ error: { code: 190, message: "bad" } }, { status: 400 });
    if (path === "/p1/insights")
      return ok({
        data: [
          { name: "page_total_media_view_unique", values: [{ value: 3000 }, { value: 3400 }] },
          { name: "page_post_engagements", values: [{ value: 120 }] },
        ],
      });
    if (path === "/ig1") return ok({ username: "areaemmecoworking", followers_count: 1540, media_count: 210 });
    if (path === "/ig1/insights")
      return ok({ data: [{ name: "reach", total_value: { value: 9000 } }, { name: "total_interactions", total_value: { value: 640 } }, { name: "accounts_engaged", total_value: { value: 400 } }] });
    return new Response("not found", { status: 404 });
  };
}

beforeEach(() => {
  const db = createTestDb();
  db.raw.exec(`
    INSERT INTO tenants(id,name,slug,kind) VALUES ('ag-a','Re-Frame','ag-a','agency'),('ag-b','Agenzia B','ag-b','agency');
    INSERT INTO tenants(id,name,slug,kind,agency_id) VALUES ('c-a1','Area Emme','c-a1','client','ag-a');
    INSERT INTO users(id,email) VALUES ('u-a','owner@a.it'),('u-b','owner@b.it');
    INSERT INTO memberships(tenant_id,user_id,role) VALUES ('ag-a','u-a','owner'),('ag-b','u-b','owner');
  `);
  env = { DB: db, META_APP_ID: "meta-app", META_APP_SECRET: "meta-secret", TOKEN_ENC_KEY: SECRET, APP_ORIGIN: ORIGIN };
  mockGraph();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function call(email, method, path, body) {
  const headers = { Origin: ORIGIN };
  if (body) headers["Content-Type"] = "application/json";
  const res = await handleApi(new Request(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, email);
  const text = await res.text();
  return { status: res.status, location: res.headers.get("Location"), text, data: text ? JSON.parse(text) : null };
}

async function login(platform = "instagram", email = "owner@a.it") {
  const start = await call(email, "POST", `/api/clients/c-a1/social/${platform}/connect`);
  const u = new URL(start.data.url);
  return { start: u, cb: await call(email, "GET", `/api/oauth/facebook/callback?code=CODICE&state=${u.searchParams.get("state")}`) };
}

describe("accesso tramite Facebook", () => {
  test("con Facebook configurato, anche 'Collega Instagram' usa il login Facebook", async () => {
    const r = await call("owner@a.it", "POST", "/api/clients/c-a1/social/instagram/connect");
    const u = new URL(r.data.url);
    expect(u.host).toBe("www.facebook.com");
    expect(u.searchParams.get("redirect_uri")).toBe(ORIGIN + "/api/oauth/facebook/callback");
    expect(u.searchParams.get("scope")).toContain("instagram_manage_insights");
  });

  test("con una configurazione Meta usa config_id al posto di scope", async () => {
    env.META_LOGIN_CONFIG_ID = "cfg-123";
    const u = new URL((await call("owner@a.it", "POST", "/api/clients/c-a1/social/facebook/connect")).data.url);
    expect(u.searchParams.get("config_id")).toBe("cfg-123");
    expect(u.searchParams.get("scope")).toBeNull();
  });

  test("più pagine: chiede quale scegliere, senza mai mostrare i token", async () => {
    const { cb } = await login();
    expect(cb.location).toMatch(/^\/clienti\/c-a1\/social\?social=scegli&scelta=[0-9a-f-]{36}$/);
    const pending = new URL(ORIGIN + cb.location).searchParams.get("scelta");
    const list = await call("owner@a.it", "GET", `/api/clients/c-a1/social/pending/${pending}`);
    expect(list.data.pages).toEqual([
      { id: "p1", name: "Area Emme", instagram: "@areaemmecoworking" },
      { id: "p2", name: "Altra Pagina", instagram: null },
    ]);
    expect(list.text).not.toContain("PAGE-TOKEN");
    const stored = env.DB.raw.query("SELECT payload_enc FROM oauth_pending").get().payload_enc;
    expect(stored).not.toContain("PAGE-TOKEN");
  });

  test("scelta la pagina, collega Facebook e Instagram e legge i dati", async () => {
    const { cb } = await login();
    const pending = new URL(ORIGIN + cb.location).searchParams.get("scelta");
    const sel = await call("owner@a.it", "POST", "/api/clients/c-a1/social/facebook/select", { pending, page_id: "p1" });
    expect(sel.status).toBe(200);
    expect(sel.text).not.toContain("PAGE-TOKEN");
    const by = Object.fromEntries(sel.data.accounts.map((a) => [a.platform, a]));
    expect(by.facebook).toMatchObject({ status: "connected", handle: "Area Emme" });
    expect(by.facebook.latest).toMatchObject({ followers: 812, reach_30d: 3400, interactions_30d: 120 });
    expect(by.instagram).toMatchObject({ status: "connected", handle: "@areaemmecoworking" });
    expect(by.instagram.latest).toMatchObject({ followers: 1540, media_count: 210, reach_30d: 9000, interactions_30d: 640, engaged_30d: 400 });
    const row = env.DB.raw.query("SELECT access_token_enc, api FROM social_accounts WHERE platform='instagram'").get();
    expect(row.api).toBe("facebook_login");
    expect(await decryptToken(SECRET, row.access_token_enc)).toBe("PAGE-TOKEN-1");
    // La scelta si usa una volta sola.
    expect((await call("owner@a.it", "POST", "/api/clients/c-a1/social/facebook/select", { pending, page_id: "p1" })).status).toBe(410);
  });

  test("una sola pagina: collegata subito", async () => {
    mockGraph({ pages: [PAGES[0]] });
    const { cb } = await login("facebook");
    expect(cb.location).toBe("/clienti/c-a1/social?social=collegato");
    expect(env.DB.raw.query("SELECT COUNT(*) AS n FROM social_accounts WHERE connection_status='connected'").get().n).toBe(2);
  });

  test("nessuna pagina gestita: lo dice chiaramente", async () => {
    mockGraph({ pages: [] });
    expect((await login()).cb.location).toBe("/clienti/c-a1/social?social=nessuna-pagina");
  });

  test("un'altra agenzia non può leggere né usare la scelta in sospeso", async () => {
    const { cb } = await login();
    const pending = new URL(ORIGIN + cb.location).searchParams.get("scelta");
    expect((await call("owner@b.it", "GET", `/api/clients/c-a1/social/pending/${pending}`)).status).toBe(404);
    expect((await call("owner@b.it", "POST", "/api/clients/c-a1/social/facebook/select", { pending, page_id: "p1" })).status).toBe(404);
  });

  test("il cron giornaliero aggiorna pagina e Instagram", async () => {
    mockGraph({ pages: [PAGES[0]] });
    await login("facebook");
    expect(await syncAll(env.DB, env)).toEqual({ total: 2, ok: 2 });
  });

  test("token della pagina revocato: l'account risulta da ricollegare", async () => {
    mockGraph({ pages: [{ ...PAGES[0], access_token: "PAGE-TOKEN-REVOCATO", instagram_business_account: undefined }] });
    await login("facebook");
    expect(env.DB.raw.query("SELECT connection_status FROM social_accounts WHERE platform='facebook'").get().connection_status).toBe("expired");
  });
});
