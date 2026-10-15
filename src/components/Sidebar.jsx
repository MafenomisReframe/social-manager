import { PAGES, navigate } from "../router.jsx";

export default function Sidebar({ current }) {
  return (
    <aside>
      <h2>✦ Social Manager</h2>
      <p>WORKSPACE AGENZIA</p>
      <nav className="side-nav" aria-label="Menu principale">
        {PAGES.map((p) => (
          <button
            key={p.slug}
            className={p.slug === current ? "active" : ""}
            aria-current={p.slug === current ? "page" : undefined}
            onClick={() => navigate("/" + p.slug)}
          >
            {p.label}
          </button>
        ))}
      </nav>
      <small>Clienti salvati in D1 · Contenuti demo</small>
    </aside>
  );
}
