// Collegamento Instagram con API simulata: flusso OAuth, cifratura, isolamento, nessun token esposto.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTestDb } from "./d1-sqlite.js";
import { handleApi } from "../api/handler.js";
import { syncAll } from "../api/social.js";
import { encryptToken, decryptToken } from "../api/crypto.js";

const ORIGIN = "https://social-manager.test";
const SECRET = "chiave-di-prova-lunga-almeno-trentadue-caratteri!!";
let env;
let calls;
const realFetch = globalThis.fetch;

function seed(db) {
  db.raw.exec(`
    INSERT INTO tenants(id,name,slug,kind) VALUES ('ag-a','Re-Frame','ag-a','agency'),('ag-b','Agenzia B','ag-b','agency');
    INSERT INTO tenants(id,name,slug,kind,agency_id) VALUES ('c-a1','Effebiemme','c-a1','client','ag-a'),('c-b1','Cliente B','c-b1','client','ag-b');
    INSERT INTO users(id,email) VALUES ('u-a','owner@a.it'),('u-v','viewer@a1.it'),('u-b','owner@b.it');
    INSERT INTO memberships(tenant_id,user_id,role) VALUES ('ag-a','u-a','owner'),('c-a1','u-v','client_viewer'),('ag-b','u-b','owner');
  `);
}

function mockInstagram({ followers = 1234, insightsFail = false } = {}) {
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    calls.push(u.host + u.pathname);
    const ok = (body) => Response.json(body);
    if (u.host === "api.instagram.com" && u.pathname === "/oauth/access_token") {
      const form = new URLSearchParams(await new Response(init.body).text());
      if (form.get("code") !== "CODICE" || form.get("client_secret") !== "ig-secret") return Response.json({ error_type: "OAuthException", error_message: "bad code" }, { status: 400 });
      return ok({ data: [{ access_token: "SHORT", user_id: "178", permissions: "instagram_business_basic,instagram_business_manage_insights" }] });
    }
    if (u.pathname === "/access_token") return ok({ access_token: "LONG-TOKEN-SEGRETO", token_type: "bearer", expires_in: 5184000 });
    if (u.pathname.endsWith("/me")) return ok({ user_id: "178", username: "effebiemme", account_type: "BUSINESS", followers_count: followers, media_count: 42 });
    if (u.pathname.endsWith("/insights")) {
      if (insightsFail) return Response.json({ error: { message: "Not enough followers", code: 100 } }, { status: 400 });
      return ok({ data: [{ name: "reach", total_value: { value: 5000 } }, { name: "total_interactions", total_value: { value: 300 } }, { name: "accounts_engaged", total_value: { value: 210 } }] });
    }
    return new Response("not found", { status: 404 });
  };
}

beforeEach(() => {
  const db = createTestDb();
  seed(db);
  env = { DB: db, IG_APP_ID: "ig-app", IG_APP_SECRET: "ig-secret", TOKEN_ENC_KEY: SECRET, APP_ORIGIN: ORIGIN };
  calls = [];
  mockInstagram();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function call(email, method, path) {
  const res = await handleApi(new Request(ORIGIN + path, { method, headers: { Origin: ORIGIN } }), env, email);
  const text = await res.text();
  return { status: res.status, location: res.headers.get("Location"), text, data: text ? JSON.parse(text) : null };
}

async function connect(email = "owner@a.it", client = "c-a1") {
  const start = await call(email, "POST", `/api/clients/${client}/social/instagram/connect`);
  const auth = new URL(start.data.url);
  return call(email, "GET", `/api/oauth/instagram/callback?code=CODICE%23_&state=${auth.searchParams.get("state")}`);
}

test("cifratura dei token: andata e ritorno, e testo cifrato diverso dal token", async () => {
  const c = await encryptToken(SECRET, "abc");
  expect(c).not.toContain("abc");
  expect(await decryptToken(SECRET, c)).toBe("abc");
  await expect(decryptToken(SECRET + "x", c)).rejects.toThrow();
});

describe("collegamento Instagram", () => {
  test("l'URL di accesso punta a Instagram con i permessi giusti", async () => {
    const r = await call("owner@a.it", "POST", "/api/clients/c-a1/social/instagram/connect");
    const u = new URL(r.data.url);
    expect(u.host).toBe("www.instagram.com");
    expect(u.searchParams.get("client_id")).toBe("ig-app");
    expect(u.searchParams.get("redirect_uri")).toBe(ORIGIN + "/api/oauth/instagram/callback");
    expect(u.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_manage_insights");
  });

  test("flusso completo: collega, salva token cifrato, legge i primi dati", async () => {
    const r = await connect();
    expect(r.status).toBe(302);
    expect(r.location).toBe("/clienti/c-a1/social?social=collegato");
    const row = env.DB.raw.query("SELECT * FROM social_accounts WHERE tenant_id='c-a1'").get();
    expect(row.connection_status).toBe("connected");
    expect(row.handle).toBe("@effebiemme");
    expect(row.access_token_enc).not.toContain("LONG-TOKEN");
    expect(await decryptToken(SECRET, row.access_token_enc)).toBe("LONG-TOKEN-SEGRETO");
    const m = env.DB.raw.query("SELECT followers, reach_30d, interactions_30d, engaged_30d FROM social_metrics_daily").get();
    expect(m).toEqual({ followers: 1234, reach_30d: 5000, interactions_30d: 300, engaged_30d: 210 });
  });

  test("l'elenco account non contiene mai il token", async () => {
    await connect();
    const r = await call("owner@a.it", "GET", "/api/clients/c-a1/social");
    expect(r.text).not.toContain("LONG-TOKEN");
    expect(r.text).not.toContain("access_token");
    const ig = r.data.accounts.find((a) => a.platform === "instagram");
    expect(ig).toMatchObject({ status: "connected", handle: "@effebiemme", available: true });
    expect(ig.latest.followers).toBe(1234);
  });

  test("il cliente vede i propri dati, senza dettagli tecnici", async () => {
    await connect();
    const r = await call("viewer@a1.it", "GET", "/api/clients/c-a1/social");
    const ig = r.data.accounts.find((a) => a.platform === "instagram");
    expect(ig.latest.followers).toBe(1234);
    expect(ig.last_error).toBeUndefined();
    expect(ig.token_expires_at).toBeUndefined();
  });

  test("il cliente può collegare il proprio account e torna nella sua area", async () => {
    const r = await connect("viewer@a1.it");
    expect(r.location).toBe("/portale/c-a1?social=collegato");
  });

  test("un'altra agenzia non vede, non collega e non scollega", async () => {
    await connect();
    expect((await call("owner@b.it", "GET", "/api/clients/c-a1/social")).status).toBe(404);
    expect((await call("owner@b.it", "POST", "/api/clients/c-a1/social/instagram/connect")).status).toBe(404);
    expect((await call("owner@b.it", "DELETE", "/api/clients/c-a1/social/instagram")).status).toBe(404);
  });

  test("uno state di un altro utente o inventato non collega nulla", async () => {
    const start = await call("owner@a.it", "POST", "/api/clients/c-a1/social/instagram/connect");
    const state = new URL(start.data.url).searchParams.get("state");
    const stolen = await call("owner@b.it", "GET", `/api/oauth/instagram/callback?code=CODICE&state=${state}`);
    expect(stolen.location).toBe("/?social=scaduto");
    const fake = await call("owner@a.it", "GET", "/api/oauth/instagram/callback?code=CODICE&state=inventato");
    expect(fake.location).toBe("/?social=scaduto");
    expect(env.DB.raw.query("SELECT COUNT(*) AS n FROM social_accounts").get().n).toBe(0);
  });

  test("lo state si usa una volta sola", async () => {
    const start = await call("owner@a.it", "POST", "/api/clients/c-a1/social/instagram/connect");
    const state = new URL(start.data.url).searchParams.get("state");
    await call("owner@a.it", "GET", `/api/oauth/instagram/callback?code=CODICE&state=${state}`);
    const again = await call("owner@a.it", "GET", `/api/oauth/instagram/callback?code=CODICE&state=${state}`);
    expect(again.location).toBe("/?social=scaduto");
  });

  test("se l'utente annulla su Instagram torna indietro senza collegare", async () => {
    const start = await call("owner@a.it", "POST", "/api/clients/c-a1/social/instagram/connect");
    const state = new URL(start.data.url).searchParams.get("state");
    const r = await call("owner@a.it", "GET", `/api/oauth/instagram/callback?error=access_denied&state=${state}`);
    expect(r.location).toBe("/clienti/c-a1/social?social=annullato");
  });

  test("scollegare cancella il token ma conserva lo storico", async () => {
    await connect();
    await call("owner@a.it", "DELETE", "/api/clients/c-a1/social/instagram");
    const row = env.DB.raw.query("SELECT connection_status, access_token_enc FROM social_accounts").get();
    expect(row).toEqual({ connection_status: "disconnected", access_token_enc: null });
    expect(env.DB.raw.query("SELECT COUNT(*) AS n FROM social_metrics_daily").get().n).toBe(1);
  });

  test("senza configurazione il collegamento risponde 'non configurato'", async () => {
    env.IG_APP_SECRET = "";
    expect((await call("owner@a.it", "POST", "/api/clients/c-a1/social/instagram/connect")).data.error).toBe("platform_not_configured");
  });
});

describe("lettura giornaliera", () => {
  test("il cron aggiorna i follower del giorno", async () => {
    await connect();
    mockInstagram({ followers: 1300 });
    expect(await syncAll(env.DB, env)).toEqual({ total: 1, ok: 1 });
    expect(env.DB.raw.query("SELECT followers FROM social_metrics_daily").get().followers).toBe(1300);
  });
  test("se mancano gli insights (pochi follower) salva comunque i follower", async () => {
    mockInstagram({ insightsFail: true });
    await connect();
    const m = env.DB.raw.query("SELECT followers, reach_30d FROM social_metrics_daily").get();
    expect(m).toEqual({ followers: 1234, reach_30d: null });
  });
});
