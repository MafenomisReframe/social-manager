import { useState } from "react";
import { api } from "../api.js";
import { navigate, clientPath } from "../router.jsx";

export default function Clients({ clients, loading, error, onChanged, canManage }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function addClient(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2 || saving) return;
    setSaving(true);
    setFormError("");
    try {
      const { client } = await api.createClient(trimmed);
      setName("");
      await onChanged();
      navigate(clientPath(client.id));
    } catch (err) {
      setFormError("Impossibile salvare: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <h2>Clienti</h2>
      <p>Le aziende create qui vengono salvate nel database di Social Manager, con accesso riservato all'agenzia.</p>

      {canManage && <form onSubmit={addClient} className="client-form">
        <input
          aria-label="Nome azienda"
          placeholder="Nome nuova azienda"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          minLength={2}
          required
        />
        <button disabled={saving}>{saving ? "Salvataggio..." : "+ Nuovo cliente"}</button>
      </form>}

      {(formError || error) && (
        <p role="alert" className="form-error">
          {formError || error}
        </p>
      )}

      {loading ? (
        <p>Caricamento clienti...</p>
      ) : clients.length === 0 && !error ? (
        <p>Nessun cliente registrato.</p>
      ) : (
        <div className="grid">
          {clients.map((c) => (
            <article className="tile" key={c.id}>
              <div className="icon">{c.name.slice(0, 2).toUpperCase()}</div>
              <h3>{c.name}</h3>
              <small>{c.sector || "Settore non indicato"}</small>
              <div className="profile-action">
                <button onClick={() => navigate(clientPath(c.id))}>Apri scheda →</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
