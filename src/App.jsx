import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { useRoute, navigate, portalPath } from "./router.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Header from "./components/Header.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Clients from "./pages/Clients.jsx";
import ClientDetail from "./pages/ClientDetail.jsx";
import Portal from "./pages/Portal.jsx";
import { ContentDemo, BrandInterviewDemo, CreativeLabDemo, TicketsDemo, Placeholder, NotFound } from "./pages/DemoPages.jsx";

export default function App() {
  const route = useRoute();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);
  const [sessionError, setSessionError] = useState("");

  useEffect(() => {
    api
      .session()
      .then(setSession)
      .catch((err) => setSessionError(err.message));
  }, []);
  const isAgency = Boolean(session?.agencies?.length);
  const canManage = Boolean(session?.can?.manageClients);

  const reloadClients = useCallback(async () => {
    try {
      const { clients } = await api.listClients();
      setClients(clients || []);
      setError("");
    } catch (err) {
      setError("Impossibile caricare i clienti: " + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reloadClients();
  }, [reloadClients]);

  // Un utente cliente vede solo la propria area: lo portiamo lì da qualsiasi indirizzo.
  const clientHome = !isAgency && session && clients[0] ? portalPath(clients[0].id) : null;
  useEffect(() => {
    if (clientHome && !(route.portal && route.clientId)) navigate(clientHome);
  }, [clientHome, route.portal, route.clientId]);

  const section = route.page?.label || "Pagina non trovata";
  let title = section;
  if (route.slug === "clienti" && route.clientId)
    title = clients.find((c) => c.id === route.clientId)?.name || "Scheda cliente";

  useEffect(() => {
    if (route.portal) return; // il titolo lo imposta l'area cliente
    document.title = title === "Dashboard" ? "Social Manager" : `${title} · Social Manager`;
  }, [title, route.portal]);

  if (sessionError)
    return (
      <div className="portal">
        <section className="panel">
          <h2>Accesso non disponibile</h2>
          <p role="alert" className="form-error">
            {sessionError}
          </p>
          <p>
            <a className="logout" href="/cdn-cgi/access/logout">
              Esci e accedi con un'altra email
            </a>
          </p>
        </section>
      </div>
    );
  if (!session) return <div className="portal"><p className="portal-loading">Caricamento…</p></div>;

  if (route.portal && route.clientId)
    return <Portal key={route.clientId} id={route.clientId} tab={route.tab} agencyView={isAgency} />;

  if (!isAgency)
    return (
      <div className="portal">
        <p className="portal-loading">
          {loading ? "Caricamento della tua area…" : "Nessuna area cliente associata al tuo account. Contatta l'agenzia."}
        </p>
      </div>
    );

  let content;
  if (route.slug === "clienti" && route.clientId) {
    content = <ClientDetail key={route.clientId} id={route.clientId} tab={route.tab} onSaved={reloadClients} />;
  } else {
    switch (route.slug) {
      case "":
        content = <Dashboard clients={clients} loading={loading} />;
        break;
      case "clienti":
        content = <Clients clients={clients} loading={loading} error={error} onChanged={reloadClients} canManage={canManage} />;
        break;
      case "calendario":
        content = <ContentDemo title="Piano editoriale" />;
        break;
      case "contenuti":
        content = <ContentDemo title="Contenuti del cliente" />;
        break;
      case "brand-interview":
        content = <BrandInterviewDemo />;
        break;
      case "creative-lab":
        content = <CreativeLabDemo />;
        break;
      case "segnalazioni":
        content = <TicketsDemo />;
        break;
      default:
        content = route.page ? <Placeholder title={route.page.label} /> : <NotFound />;
    }
  }

  return (
    <div className="layout">
      <Sidebar current={route.slug} session={session} />
      <main>
        <Header section={section} title={title} clients={clients} currentClientId={route.clientId} />
        {content}
        <footer>Social Manager v0.6 · I contenuti marcati “Demo” non sono reali</footer>
      </main>
    </div>
  );
}
