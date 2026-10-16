// Tutte le chiamate al backend passano da qui, con messaggi d'errore in italiano.

const MESSAGES = {
  unauthorized: "Sessione scaduta: ricarica la pagina per accedere di nuovo.",
  invalid_access_token: "Sessione scaduta: ricarica la pagina per accedere di nuovo.",
  account_not_provisioned: "Questo indirizzo email non è abilitato. Chiedi all'agenzia di invitarti, oppure esci e accedi con l'email a cui è arrivato l'invito.",
  auth_not_configured: "Autenticazione non configurata sul server.",
  forbidden: "Non hai i permessi per questa operazione.",
  not_found: "Elemento non trovato.",
  invalid_origin: "Richiesta non valida, ricarica la pagina.",
  invalid_json: "Dati non validi.",
  invalid_name: "Il nome deve avere tra 2 e 120 caratteri.",
  validation: "Alcuni campi non sono validi: controlla i campi evidenziati.",
  save_failed: "Salvataggio non riuscito, riprova tra poco.",
  platform_not_configured: "Il collegamento con questa piattaforma non è ancora stato configurato.",
  platform_not_supported: "Collegamento non ancora disponibile per questa piattaforma.",
  not_connected: "Account non collegato.",
  selection_expired: "La scelta è scaduta: premi di nuovo Collega.",
  confirm_name_mismatch: "Il nome scritto non corrisponde: cliente NON eliminato.",
  invalid_email: "Indirizzo email non valido.",
  already_agency: "Questa email appartiene al team dell'agenzia: vede già tutti i clienti.",
  invalid_message: "Il messaggio è vuoto o troppo lungo (massimo 4000 caratteri).",
};

export class ApiError extends Error {
  constructor(code, status, fields = {}) {
    super(MESSAGES[code] || `Errore imprevisto (${status || "rete"}).`);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

async function request(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Con Cloudflare Access una sessione scaduta provoca un redirect bloccato dal browser.
    throw new ApiError("network", 0, {});
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    /* risposta senza JSON */
  }
  if (!response.ok) throw new ApiError(data.error, response.status, data.fields);
  return data;
}

MESSAGES.network = "Connessione non riuscita o sessione scaduta: ricarica la pagina.";

export const api = {
  session: () => request("/api/session"),
  listClients: () => request("/api/clients"),
  createClient: (name) => request("/api/clients", { method: "POST", body: { name } }),
  getClient: (id) => request("/api/clients/" + encodeURIComponent(id)),
  updateClient: (id, data) => request("/api/clients/" + encodeURIComponent(id), { method: "PATCH", body: data }),
  deleteClient: (id, confirmName) =>
    request("/api/clients/" + encodeURIComponent(id), { method: "DELETE", body: { confirm_name: confirmName } }),
  listMembers: (id) => request("/api/clients/" + encodeURIComponent(id) + "/members"),
  inviteMember: (id, email, name) =>
    request("/api/clients/" + encodeURIComponent(id) + "/members", { method: "POST", body: { email, name } }),
  removeMember: (id, userId) =>
    request("/api/clients/" + encodeURIComponent(id) + "/members/" + encodeURIComponent(userId), { method: "DELETE" }),
  listSocial: (id) => request("/api/clients/" + encodeURIComponent(id) + "/social"),
  connectSocial: (id, platform) =>
    request("/api/clients/" + encodeURIComponent(id) + "/social/" + platform + "/connect", { method: "POST", body: {} }),
  syncSocial: (id, platform) =>
    request("/api/clients/" + encodeURIComponent(id) + "/social/" + platform + "/sync", { method: "POST", body: {} }),
  listPendingPages: (id, pending) => request("/api/clients/" + encodeURIComponent(id) + "/social/pending/" + pending),
  selectPage: (id, pending, pageId) =>
    request("/api/clients/" + encodeURIComponent(id) + "/social/facebook/select", { method: "POST", body: { pending, page_id: pageId } }),
  disconnectSocial: (id, platform) =>
    request("/api/clients/" + encodeURIComponent(id) + "/social/" + platform, { method: "DELETE" }),
  listMessages: (id, after) =>
    request("/api/clients/" + encodeURIComponent(id) + "/messages" + (after ? "?after=" + encodeURIComponent(after) : "")),
  sendMessage: (id, body) =>
    request("/api/clients/" + encodeURIComponent(id) + "/messages", { method: "POST", body: { body } }),
};
