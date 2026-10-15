// Area riservata del cliente: è ciò che il cliente vede tramite il suo link fisso.
// Niente anagrafica né note interne: solo risultati, contenuti, report e chat.
// L'agenzia la apre in anteprima e può mostrare dati di ESEMPIO, sempre etichettati.
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { navigate, portalPath, clientPath } from "../router.jsx";
import Chat from "../components/Chat.jsx";
import DemoBadge from "../components/DemoBadge.jsx";
import { DEMO_POSTS } from "../data/demo.js";

const TABS = [
  { slug: "", label: "Panoramica" },
  { slug: "contenuti", label: "Contenuti" },
  { slug: "report", label: "Report" },
  { slug: "chat", label: "Chat" },
];

const PLATFORMS = [
  { key: "instagram", name: "Instagram", short: "IG", color: "var(--pink)" },
  { key: "facebook", name: "Facebook", short: "FB", color: "var(--blue)" },
  { key: "linkedin", name: "LinkedIn", short: "IN", color: "#7fb4ff" },
  { key: "tiktok", name: "TikTok", short: "TT", color: "var(--mint)" },
];

// Dati di ESEMPIO per l'anteprima: mai mostrati al cliente come reali.
const SAMPLE = {
  instagram: { followers: 4820, reach: 38400, interactions: 2950, rate: 4.1, delta: 6.2, trend: [42, 48, 45, 53, 58, 61, 70] },
  facebook: { followers: 2310, reach: 12800, interactions: 610, rate: 1.9, delta: -1.4, trend: [55, 52, 50, 49, 51, 47, 46] },
  linkedin: { followers: 880, reach: 6900, interactions: 410, rate: 3.6, delta: 9.8, trend: [20, 24, 26, 31, 30, 36, 41] },
  tiktok: { followers: 1540, reach: 52100, interactions: 4870, rate: 7.4, delta: 18.5, trend: [18, 25, 40, 33, 52, 66, 80] },
};

const fmt = (n) => n.toLocaleString("it-IT");

export default function Portal({ id, tab, agencyView }) {
  const activeTab = TABS.some((t) => t.slug === tab) ? tab : "";
  const [client, setClient] = useState(null);
  const [error, setError] = useState("");
  const [sample, setSample] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getClient(id)
      .then(({ client }) => alive && setClient(client))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (client) document.title = `${client.name} · Area riservata`;
  }, [client]);

  if (error)
    return (
      <div className="portal">
        <section className="panel">
          <h2>Area non disponibile</h2>
          <p role="alert" className="form-error">
            {error}
          </p>
        </section>
      </div>
    );
  if (!client)
    return (
      <div className="portal">
        <p className="portal-loading">Caricamento della tua area…</p>
      </div>
    );

  const agencyName = client.agency_name || "il team";
  const demo = agencyView && sample;

  return (
    <div className="portal">
      {agencyView && (
        <div className="preview-bar">
          <span>
            <b>Anteprima</b> · stai vedendo l'area come la vede il cliente
          </span>
          <label className="switch">
            <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} />
            Mostra dati di esempio
          </label>
          <button type="button" className="ghost" onClick={() => navigate(clientPath(id))}>
            ← Torna alla scheda
          </button>
        </div>
      )}

      <header className="portal-head">
        <div className="portal-id">
          <div className="portal-logo">{client.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <h1>{client.name}</h1>
            <p>Area riservata · a cura di {agencyName}</p>
          </div>
        </div>
        <nav className="portal-tabs" aria-label="Sezioni dell'area cliente">
          {TABS.map((t) => (
            <button
              key={t.slug}
              type="button"
              className={t.slug === activeTab ? "active" : ""}
              aria-current={t.slug === activeTab ? "page" : undefined}
              onClick={() => navigate(portalPath(id, t.slug))}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {activeTab === "" && <Overview client={client} demo={demo} />}
      {activeTab === "contenuti" && <Contents demo={demo} />}
      {activeTab === "report" && <Reports demo={demo} agencyName={agencyName} />}
      {activeTab === "chat" && (
        <section className="panel">
          <h3>Conversazione con {agencyName}</h3>
          <Chat clientId={id} viewer={agencyView ? "agency" : "client"} agencyName={agencyName} />
        </section>
      )}

      <footer className="portal-foot">
        I dati provengono direttamente dalle piattaforme collegate. {demo && "Anteprima con dati di esempio."}
      </footer>
    </div>
  );
}

// Converte lo storico giornaliero salvato nel database nei numeri della scheda.
function realData(account) {
  if (!account || account.status !== "connected" || !account.latest) return null;
  const h = account.history.filter((d) => d.followers != null);
  const latest = account.latest;
  const monthAgo = h.find((d) => Date.parse(d.day) >= Date.parse(latest.day) - 30 * 86400000) || h[0];
  const delta =
    monthAgo && monthAgo !== latest && monthAgo.followers
      ? ((latest.followers - monthAgo.followers) / monthAgo.followers) * 100
      : null;
  const rate =
    latest.reach_30d && latest.interactions_30d != null ? (latest.interactions_30d / latest.reach_30d) * 100 : null;
  return {
    followers: latest.followers,
    delta: delta == null ? null : Math.round(delta * 10) / 10,
    trend: h.slice(-14).map((d) => d.followers),
    reach: latest.reach_30d,
    interactions: latest.interactions_30d,
    rate: rate == null ? null : Math.round(rate * 10) / 10,
    lastSync: account.last_sync_at,
  };
}

function useSocial(clientId) {
  const [accounts, setAccounts] = useState(null);
  useEffect(() => {
    let alive = true;
    api
      .listSocial(clientId)
      .then(({ accounts }) => alive && setAccounts(accounts))
      .catch(() => alive && setAccounts([]));
    return () => {
      alive = false;
    };
  }, [clientId]);
  return accounts;
}

function Overview({ client, demo }) {
  const accounts = useSocial(client.id);
  const byPlatform = Object.fromEntries((accounts || []).map((a) => [a.platform, a]));
  const connected = demo ? 4 : (accounts || []).filter((a) => a.status === "connected").length;
  return (
    <>
      <div className="portal-kpis">
        <article>
          <span>Account collegati</span>
          <strong>
            {accounts || demo ? connected : "…"}
            <small>/4</small>
          </strong>
        </article>
        <article>
          <span>Contenuti pubblicati · 30 giorni</span>
          <strong>{demo ? "18" : "—"}</strong>
        </article>
        <article>
          <span>Prossimo contenuto</span>
          <strong className="kpi-text">{demo ? "16 ottobre · Instagram" : "—"}</strong>
        </article>
        <article>
          <span>Ultimo report</span>
          <strong className="kpi-text">{demo ? "Settembre 2026" : "—"}</strong>
        </article>
      </div>

      <div className="period">
        <h3>
          Risultati per piattaforma {demo && <DemoBadge>Esempio</DemoBadge>}
        </h3>
        <span className="chip">Ultimi 30 giorni</span>
      </div>

      <div className="platform-grid">
        {PLATFORMS.map((p) => {
          const account = byPlatform[p.key];
          return (
            <PlatformCard
              key={p.key}
              platform={p}
              clientId={client.id}
              account={demo ? null : account}
              handle={(demo ? null : account?.handle) || client.branding?.[p.key]}
              data={demo ? SAMPLE[p.key] : realData(account)}
              demo={demo}
            />
          );
        })}
      </div>
      <p className="demo-note">
        Ogni piattaforma è analizzata separatamente: follower e copertura di social diversi non vengono sommati, perché le
        stesse persone possono seguirti su più canali. I dati si aggiornano automaticamente ogni giorno.
      </p>
    </>
  );
}

const num = (v) => (v == null ? "—" : fmt(v));

function PlatformCard({ platform, clientId, account, handle, data, demo }) {
  const [busy, setBusy] = useState(false);
  const trend = data?.trend || [];
  const max = Math.max(1, ...trend);
  const connected = demo || account?.status === "connected";
  const expired = account?.status === "expired";

  async function connect() {
    setBusy(true);
    try {
      const { url } = await api.connectSocial(clientId, platform.key);
      window.location.href = url;
    } catch (err) {
      alert(err.message);
      setBusy(false);
    }
  }

  return (
    <article className="platform" style={{ "--accent": platform.color }}>
      <div className="platform-head">
        <span className="platform-badge">{platform.short}</span>
        <div>
          <h4>{platform.name}</h4>
          <small>{handle || "Profilo non indicato"}</small>
        </div>
        <span className={"status " + (connected ? "on" : "off")}>
          {connected ? "Collegato" : expired ? "Da ricollegare" : "Non collegato"}
        </span>
      </div>

      {data ? (
        <>
          <div className="platform-main">
            <div>
              <span>Follower</span>
              <strong>{num(data.followers)}</strong>
            </div>
            {data.delta != null && (
              <em className={data.delta >= 0 ? "up" : "down"} title="Variazione rispetto a circa 30 giorni fa">
                {data.delta >= 0 ? "▲" : "▼"} {Math.abs(data.delta).toLocaleString("it-IT")}%
              </em>
            )}
          </div>
          {trend.length >= 2 ? (
            <div className="trend" aria-label="Andamento dei follower">
              {trend.map((v, i) => (
                <i key={i} style={{ height: `${Math.max(6, Math.round((v / max) * 100))}%` }} />
              ))}
            </div>
          ) : (
            <p className="platform-empty small">Il grafico si costruisce giorno dopo giorno dalla data di collegamento.</p>
          )}
          <dl className="platform-stats">
            <div>
              <dt>Copertura</dt>
              <dd>{num(data.reach)}</dd>
            </div>
            <div>
              <dt>Interazioni</dt>
              <dd>{num(data.interactions)}</dd>
            </div>
            <div>
              <dt>Engagement</dt>
              <dd>{data.rate == null ? "—" : data.rate.toLocaleString("it-IT") + "%"}</dd>
            </div>
          </dl>
          {data.lastSync && (
            <small className="sync-info">
              Aggiornato il{" "}
              {new Date(data.lastSync).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </small>
          )}
        </>
      ) : connected ? (
        <p className="platform-empty">Collegato: i primi dati arriveranno con il prossimo aggiornamento.</p>
      ) : (
        <>
          <p className="platform-empty">I dati compariranno qui automaticamente quando l'account sarà collegato.</p>
          {account?.available && (
            <button type="button" className="connect-btn" disabled={busy} onClick={connect}>
              {busy ? "Apertura…" : expired ? `Ricollega ${platform.name}` : `Collega ${platform.name}`}
            </button>
          )}
        </>
      )}
    </article>
  );
}

function Contents({ demo }) {
  if (!demo)
    return (
      <section className="panel empty-state">
        <h3>Contenuti</h3>
        <p>Qui vedrai il calendario dei post in programma e quelli già pubblicati, con anteprima e piattaforma.</p>
      </section>
    );
  return (
    <section className="panel">
      <h3>
        Prossimi contenuti <DemoBadge>Esempio</DemoBadge>
      </h3>
      {DEMO_POSTS.map((p) => (
        <div className="row" key={p.id}>
          <b>{p.title}</b>
          <span>{p.platform}</span>
          <em>{p.date}</em>
        </div>
      ))}
    </section>
  );
}

function Reports({ demo, agencyName }) {
  if (!demo)
    return (
      <section className="panel empty-state">
        <h3>Report</h3>
        <p>Ogni mese troverai qui il report con risultati, confronto con il periodo precedente e le azioni consigliate da {agencyName}.</p>
      </section>
    );
  return (
    <section className="panel">
      <h3>
        Report mensili <DemoBadge>Esempio</DemoBadge>
      </h3>
      <div className="report-card">
        <div>
          <small>SETTEMBRE 2026</small>
          <h4>Crescita trainata da TikTok e Instagram</h4>
          <p>
            Copertura in aumento rispetto ad agosto, con i video brevi come formato migliore. Per ottobre si consiglia di
            aumentare i Reel e testare un post LinkedIn a settimana.
          </p>
        </div>
        <button type="button" disabled>
          Scarica PDF
        </button>
      </div>
    </section>
  );
}

// Stessa dashboard dell'area cliente, mostrata dentro la scheda cliente dell'agenzia.
const INNER_TABS = [
  { key: "overview", label: "Panoramica" },
  { key: "contents", label: "Contenuti" },
  { key: "reports", label: "Report" },
];

export function ClientDashboard({ client }) {
  const [inner, setInner] = useState("overview");
  const [sample, setSample] = useState(false);
  const agencyName = client.agency_name || "il team";
  return (
    <div className="client-dashboard">
      <div className="dash-toolbar">
        <div className="dash-tabs">
          {INNER_TABS.map((t) => (
            <button key={t.key} type="button" className={t.key === inner ? "active" : ""} onClick={() => setInner(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="switch">
          <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} />
          Dati di esempio
        </label>
        <button type="button" className="ghost" onClick={() => navigate(portalPath(client.id))}>
          Vedi come il cliente →
        </button>
      </div>
      {inner === "overview" && <Overview client={client} demo={sample} />}
      {inner === "contents" && <Contents demo={sample} />}
      {inner === "reports" && <Reports demo={sample} agencyName={agencyName} />}
    </div>
  );
}
