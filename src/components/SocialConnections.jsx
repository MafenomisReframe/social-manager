// Gestione dei collegamenti social di un cliente (lato agenzia).
import { useEffect, useState } from "react";
import { api } from "../api.js";

const NAMES = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok" };
const RESULT = {
  collegato: ["ok", "Account collegato: i primi dati sono già stati letti."],
  annullato: ["warn", "Collegamento annullato su Instagram."],
  "account-personale": ["warn", "L'account è personale: va trasformato in account professionale (business o creator) dall'app Instagram."],
  errore: ["error", "Il collegamento non è riuscito. Riprova; se si ripete, controlla che l'account sia tra i tester dell'app Meta."],
};

const when = (iso) =>
  iso ? new Date(iso).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "mai";

export default function SocialConnections({ clientId }) {
  const [accounts, setAccounts] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result] = useState(() => new URLSearchParams(window.location.search).get("social"));

  useEffect(() => {
    api
      .listSocial(clientId)
      .then(({ accounts }) => setAccounts(accounts))
      .catch((e) => setError(e.message));
    if (result) window.history.replaceState(null, "", window.location.pathname);
  }, [clientId, result]);

  async function act(platform, kind) {
    setBusy(platform + kind);
    setError("");
    try {
      if (kind === "connect") {
        const { url } = await api.connectSocial(clientId, platform);
        window.location.href = url;
        return;
      }
      if (kind === "disconnect" && !window.confirm(`Scollegare ${NAMES[platform]}? Lo storico dei dati resta salvato.`)) return;
      const r = kind === "sync" ? await api.syncSocial(clientId, platform) : await api.disconnectSocial(clientId, platform);
      setAccounts(r.accounts);
      if (r.throttled) setError("Dati già aggiornati da pochi minuti.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }

  const banner = RESULT[result];
  return (
    <div className="wide social-connections">
      <h3>Collegamenti</h3>
      {banner && <p className={"notice " + banner[0]}>{banner[1]}</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!accounts ? (
        <p>Caricamento…</p>
      ) : (
        <div className="conn-list">
          {accounts.map((a) => {
            const connected = a.status === "connected";
            return (
              <div key={a.platform} className="conn-row">
                <div>
                  <b>{NAMES[a.platform]}</b>
                  <small>
                    {connected
                      ? `${a.handle || "Collegato"} · ultimo aggiornamento ${when(a.last_sync_at)}`
                      : a.status === "expired"
                        ? "Accesso scaduto: va ricollegato"
                        : a.available
                          ? "Non collegato"
                          : "Disponibile prossimamente"}
                  </small>
                  {a.last_error && <small className="conn-error">Nota: {a.last_error}</small>}
                </div>
                <div className="conn-actions">
                  {connected ? (
                    <>
                      <button type="button" className="ghost" disabled={!!busy} onClick={() => act(a.platform, "sync")}>
                        {busy === a.platform + "sync" ? "Aggiorno…" : "Aggiorna ora"}
                      </button>
                      <button type="button" className="ghost danger" disabled={!!busy} onClick={() => act(a.platform, "disconnect")}>
                        Scollega
                      </button>
                    </>
                  ) : (
                    <button type="button" disabled={!a.available || !!busy} onClick={() => act(a.platform, "connect")}>
                      {busy === a.platform + "connect" ? "Apertura…" : a.status === "expired" ? "Ricollega" : "Collega"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
