import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { useRoute } from "./router.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Header from "./components/Header.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Clients from "./pages/Clients.jsx";
import ClientDetail from "./pages/ClientDetail.jsx";
import { ContentDemo, BrandInterviewDemo, CreativeLabDemo, TicketsDemo, Placeholder, NotFound } from "./pages/DemoPages.jsx";

export default function App() {
  const route = useRoute();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);

  useEffect(() => {
    api.session().then(setSession).catch(() => setSession(null));
  }, []);
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

  const section = route.page?.label || "Pagina non trovata";
  let title = section;
  let content;

  if (route.slug === "clienti" && route.clientId) {
    title = clients.find((c) => c.id === route.clientId)?.name || "Scheda cliente";
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

  useEffect(() => {
    document.title = title === "Dashboard" ? "Social Manager" : `${title} · Social Manager`;
  }, [title]);

  return (
    <div className="layout">
      <Sidebar current={route.slug} session={session} />
      <main>
        <Header section={section} title={title} clients={clients} currentClientId={route.clientId} />
        {content}
        <footer>Social Manager v0.2 · Nessun account social collegato · I contenuti marcati “Demo” non sono reali</footer>
      </main>
    </div>
  );
}
