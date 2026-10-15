// Dopo il login Facebook: scelta della pagina (e del suo Instagram) che appartiene a questo cliente.
import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function PagePicker({ clientId, pendingId, onDone }) {
  const [pages, setPages] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    api
      .listPendingPages(clientId, pendingId)
      .then(({ pages }) => setPages(pages))
      .catch((e) => setError(e.message));
  }, [clientId, pendingId]);

  async function choose(pageId) {
    setBusy(pageId);
    setError("");
    try {
      const { accounts } = await api.selectPage(clientId, pendingId, pageId);
      onDone?.(accounts);
    } catch (e) {
      setError(e.message);
      setBusy("");
    }
  }

  return (
    <div className="page-picker">
      <h3>Quale pagina è di questo cliente?</h3>
      <p>Gestisci più pagine Facebook: scegli quella giusta. Verrà collegato anche l'Instagram associato.</p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!pages && !error && <p>Caricamento pagine…</p>}
      {pages && (
        <div className="conn-list">
          {pages.map((p) => (
            <div key={p.id} className="conn-row">
              <div>
                <b>{p.name}</b>
                <small>{p.instagram ? `Instagram collegato: ${p.instagram}` : "Nessun Instagram collegato a questa pagina"}</small>
              </div>
              <div className="conn-actions">
                <button type="button" disabled={!!busy} onClick={() => choose(p.id)}>
                  {busy === p.id ? "Collego…" : "Scegli"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
