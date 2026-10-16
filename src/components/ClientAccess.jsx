// Persone del cliente che possono entrare nella sua area riservata (lato agenzia).
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { portalPath } from "../router.jsx";

function inviteText(clientName, url, name) {
  return (
    `Ciao${name ? " " + name : ""},\n\n` +
    `ti abbiamo attivato l'area riservata di ${clientName}: qui trovi risultati dei social, contenuti in programma, report e la chat diretta con noi.\n\n` +
    `Apri questo link: ${url}\n\n` +
    `Inserisci questo stesso indirizzo email: ti arriverà un codice di accesso da digitare (nessuna password da ricordare).\n\n` +
    `A presto!`
  );
}

export default function ClientAccess({ client }) {
  const [members, setMembers] = useState(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [last, setLast] = useState(null); // ultimo invitato: mostra il messaggio da inviare
  const [copied, setCopied] = useState(false);
  const url = window.location.origin + portalPath(client.id);

  useEffect(() => {
    api
      .listMembers(client.id)
      .then(({ members }) => setMembers(members))
      .catch((e) => setError(e.message));
  }, [client.id]);

  async function invite(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { members } = await api.inviteMember(client.id, email, name);
      setMembers(members);
      setLast({ email: email.trim().toLowerCase(), name: name.trim() });
      setEmail("");
      setName("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(m) {
    if (!window.confirm(`Togliere l'accesso a ${m.email}? Non potrà più entrare nell'area di ${client.name}.`)) return;
    try {
      const { members } = await api.removeMember(client.id, m.id);
      setMembers(members);
    } catch (err) {
      setError(err.message);
    }
  }

  const text = last ? inviteText(client.name, url, last.name) : "";
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copia il messaggio:", text);
    }
  }

  return (
    <div className="client-access">
      <h3>Chi può entrare nell'area del cliente</h3>
      <p>
        Aggiungi l'email delle persone di {client.name}. Entreranno con il link fisso e un codice che ricevono via email:
        vedranno solo dashboard, contenuti, report e chat, mai anagrafica e note interne.
      </p>

      <form className="invite-form" onSubmit={invite}>
        <input type="email" required placeholder="email@cliente.it" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
        <input placeholder="Nome (facoltativo)" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Nome" />
        <button disabled={busy || !email.trim()}>{busy ? "Aggiungo…" : "+ Dai accesso"}</button>
      </form>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {last && (
        <div className="invite-message">
          <div className="invite-message-head">
            <b>Accesso attivato per {last.email}.</b> Mandagli questo messaggio:
          </div>
          <pre>{text}</pre>
          <div className="conn-actions">
            <button type="button" onClick={copy}>
              {copied ? "Copiato ✓" : "Copia messaggio"}
            </button>
            <a
              className="ghost-link"
              href={`mailto:${encodeURIComponent(last.email)}?subject=${encodeURIComponent("La tua area riservata " + client.name)}&body=${encodeURIComponent(text)}`}
            >
              Apri nell'email →
            </a>
          </div>
        </div>
      )}

      {!members ? (
        <p>Caricamento…</p>
      ) : members.length === 0 ? (
        <p className="demo-note">Nessuna persona ha ancora accesso all'area di questo cliente.</p>
      ) : (
        <div className="conn-list">
          {members.map((m) => (
            <div key={m.id} className="conn-row">
              <div>
                <b>{m.display_name || m.email}</b>
                <small>{m.display_name ? m.email : "Accesso all'area cliente"}</small>
              </div>
              <div className="conn-actions">
                <button type="button" className="ghost danger" onClick={() => remove(m)}>
                  Togli accesso
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
