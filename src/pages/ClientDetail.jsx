import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { navigate, clientPath, portalPath, setNavigationGuard } from "../router.jsx";
import Chat from "../components/Chat.jsx";
import { ClientDashboard } from "./Portal.jsx";
import { PROFILE_FIELDS, validateProfile } from "../shared/validation.js";

const TABS = [
  { slug: "", label: "Dashboard" },
  { slug: "anagrafica", label: "Anagrafica" },
  { slug: "social", label: "Profili social" },
  { slug: "chat", label: "Chat" },
  { slug: "brand", label: "Brand" },
  { slug: "calendario", label: "Calendario" },
];

const EMPTY = Object.fromEntries([["name", ""], ...PROFILE_FIELDS.map((f) => [f.key, ""])]);

function pickForm(client) {
  const form = { ...EMPTY, name: client.name || "" };
  for (const f of PROFILE_FIELDS) form[f.key] = client.branding?.[f.key] || "";
  return form;
}

export default function ClientDetail({ id, tab, onSaved }) {
  const activeTab = TABS.some((t) => t.slug === tab) ? tab : "";
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [status, setStatus] = useState({ type: "idle", text: "" });
  const [canEdit, setCanEdit] = useState(false);
  const [client, setClient] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .getClient(id)
      .then(({ client }) => {
        if (!alive) return;
        const f = pickForm(client);
        setClient(client);
        setCanEdit(client.permissions?.edit === true);
        setSaved(f);
        setForm(f);
      })
      .catch((err) => alive && setLoadError(err.message));
    return () => {
      alive = false;
    };
  }, [id]);

  const dirty = useMemo(() => form && saved && JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

  // Avvisa prima di uscire con modifiche non salvate (menu interno e chiusura pagina).
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    setNavigationGuard(() => window.confirm("Ci sono modifiche non salvate. Vuoi uscire comunque?"));
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      setNavigationGuard(null);
    };
  }, [dirty]);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setFieldErrors((e) => ({ ...e, [key]: undefined }));
    if (status.type !== "saving") setStatus({ type: "idle", text: "" });
  }

  async function save(e) {
    e.preventDefault();
    const { errors } = validateProfile(form);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setStatus({ type: "error", text: "Controlla i campi evidenziati." });
      return;
    }
    setStatus({ type: "saving", text: "Salvataggio..." });
    try {
      const { client } = await api.updateClient(id, form);
      const f = pickForm(client);
      setClient(client);
      setSaved(f);
      setForm(f);
      setFieldErrors({});
      const time = new Date().toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
      setStatus({ type: "saved", text: `Salvato alle ${time} ✓` });
      onSaved?.();
    } catch (err) {
      setFieldErrors(err.fields || {});
      setStatus({ type: "error", text: err.message });
    }
  }

  function renderField(field) {
    const err = fieldErrors[field.key];
    const props = {
      id: "f-" + field.key,
      value: form[field.key],
      onChange: (e) => update(field.key, e.target.value),
      placeholder: field.placeholder,
      maxLength: field.max,
      "aria-invalid": err ? "true" : undefined,
      readOnly: !canEdit,
    };
    return (
      <label key={field.key} className={field.multiline ? "wide" : undefined} htmlFor={props.id}>
        {field.label}
        {field.multiline ? <textarea rows={4} {...props} /> : <input type={field.type || "text"} {...props} />}
        {err && <span className="field-error">{err}</span>}
      </label>
    );
  }

  const header = (
    <div className="profile-heading">
      <h2>{saved?.name || "Scheda cliente"}</h2>
      <button type="button" className="ghost" onClick={() => navigate("/clienti")}>
        ← Torna ai clienti
      </button>
    </div>
  );

  if (loadError)
    return (
      <section className="panel">
        {header}
        <p role="alert" className="form-error">
          {loadError}
        </p>
      </section>
    );
  if (!form)
    return (
      <section className="panel">
        {header}
        <p>Caricamento scheda...</p>
      </section>
    );

  const isFormTab = activeTab === "anagrafica" || activeTab === "social";

  return (
    <section className="panel client-detail-page">
      {header}
      <PortalLink id={id} />

      <nav className="tabs" aria-label="Sezioni della scheda cliente">
        {TABS.map((t) => (
          <button
            key={t.slug}
            type="button"
            className={t.slug === activeTab ? "active" : ""}
            aria-current={t.slug === activeTab ? "page" : undefined}
            onClick={() => navigate(clientPath(id, t.slug))}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {isFormTab && (
        <form className="profile-form" onSubmit={save} noValidate>
          {activeTab === "anagrafica" && (
            <>
              <label htmlFor="f-name">
                Nome azienda
                <input
                  id="f-name"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  maxLength={120}
                  required
                  readOnly={!canEdit}
                  aria-invalid={fieldErrors.name ? "true" : undefined}
                />
                {fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
              </label>
              {PROFILE_FIELDS.filter((f) => f.group === "anagrafica" && (canEdit || f.key !== "notes")).map(renderField)}
            </>
          )}

          {activeTab === "social" && (
            <>
              <p className="wide demo-note">
                Qui salvi i riferimenti dei profili. Il collegamento vero (OAuth) per pubblicare e leggere le
                statistiche arriverà nella fase 6: per ora nessun account è collegato.
              </p>
              {PROFILE_FIELDS.filter((f) => f.group === "social").map(renderField)}
            </>
          )}

          {!canEdit && (
            <p className="wide demo-note">Sola lettura: per modifiche apri una Segnalazione al team.</p>
          )}
          {canEdit && <div className="profile-actions">
            <button disabled={!dirty || status.type === "saving"}>
              {status.type === "saving" ? "Salvataggio..." : "Salva modifiche"}
            </button>
            <span role="status" className={"save-status " + (dirty && status.type === "idle" ? "dirty" : status.type)}>
              {dirty && status.type === "idle" ? "Modifiche non salvate" : status.text}
            </span>
          </div>}
        </form>
      )}

      {activeTab === "brand" && (
        <ComingSoon
          title="Brand e AI Brand Interview"
          phase="fase 5"
          text="Profilo strategico del cliente: obiettivi, cliente ideale, tono di voce, servizi prioritari, logo e palette."
        />
      )}
      {activeTab === "calendario" && (
        <ComingSoon
          title="Calendario del cliente"
          phase="fase 3"
          text="Contenuti programmati, stati di lavorazione e responsabili, solo per questo cliente."
        />
      )}
      {activeTab === "" && client && <ClientDashboard client={client} />}

      {activeTab === "chat" && (
        <div className="coming-soon">
          <p>Conversazione con il cliente: lui la vede, identica, nella sua area riservata.</p>
          <Chat clientId={id} viewer="agency" />
        </div>
      )}
    </section>
  );
}

function ComingSoon({ title, phase, text }) {
  return (
    <div className="coming-soon">
      <h3>{title}</h3>
      <p>{text}</p>
      <p className="demo-note">Sezione in arrivo con la {phase} della roadmap. Nessun dato dimostrativo mostrato qui.</p>
    </div>
  );
}

// Link fisso dell'area riservata: si copia e si manda al cliente.
function PortalLink({ id }) {
  const [copied, setCopied] = useState(false);
  const url = window.location.origin + portalPath(id);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copia il link:", url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="portal-link">
      <div>
        <small>LINK AREA CLIENTE</small>
        <code>{url}</code>
      </div>
      <div className="portal-link-actions">
        <button type="button" onClick={copy}>{copied ? "Copiato ✓" : "Copia link"}</button>
        <button type="button" className="ghost" onClick={() => navigate(portalPath(id))}>
          Anteprima →
        </button>
      </div>
      <p>Il cliente potrà aprirlo dopo essere stato invitato con la sua email (prossimo passo: inviti).</p>
    </div>
  );
}
