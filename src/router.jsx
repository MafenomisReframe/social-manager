// Router minimo basato sull'indirizzo del browser.
// Ogni pagina ha un URL proprio, quindi il refresh e i link diretti funzionano
// (il Worker restituisce index.html per ogni percorso che non è /api/*).
import { useEffect, useState } from "react";

export const PAGES = [
  { slug: "", label: "Dashboard" },
  { slug: "clienti", label: "Clienti" },
  { slug: "calendario", label: "Calendario" },
  { slug: "contenuti", label: "Contenuti" },
  { slug: "lavori", label: "Lavori" },
  { slug: "statistiche", label: "Statistiche" },
  { slug: "budget-ai", label: "Budget AI" },
  { slug: "brand-interview", label: "AI Brand Interview" },
  { slug: "creative-lab", label: "Creative Lab" },
  { slug: "segnalazioni", label: "Segnalazioni" },
  { slug: "impostazioni", label: "Impostazioni" },
];

export function parsePath(pathname) {
  const parts = pathname.split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const slug = parts[0] || "";
  const page = PAGES.find((p) => p.slug === slug) || null;
  return {
    slug,
    page,
    clientId: slug === "clienti" ? parts[1] || null : null,
    tab: slug === "clienti" ? parts[2] || null : null,
  };
}

// Una pagina con modifiche non salvate può bloccare la navigazione interna.
let guard = null;
export function setNavigationGuard(fn) {
  guard = fn;
}

export function navigate(path) {
  if (path === window.location.pathname) return;
  if (guard && !guard()) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function clientPath(id, tab) {
  return "/clienti/" + encodeURIComponent(id) + (tab ? "/" + tab : "");
}

export function useRoute() {
  const [route, setRoute] = useState(() => parsePath(window.location.pathname));
  useEffect(() => {
    const onChange = () => setRoute(parsePath(window.location.pathname));
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return route;
}
