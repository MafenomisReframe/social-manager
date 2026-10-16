import { PAGES, navigate } from "../router.jsx";

const ROLE_LABELS = { owner: "Proprietario", agency_admin: "Amministratore", editor: "Editor" };

export default function Sidebar({ current, session }) {
  const agency = session?.agencies?.[0];
  return (
    <aside>
      <h2>✦ Social Manager</h2>
      <p>{agency ? agency.name.toUpperCase() : "WORKSPACE"}</p>
      {session?.user && (
        <div className="who">
          <span>{session.user.display_name || session.user.email}</span>
          <small>{agency ? ROLE_LABELS[agency.role] || agency.role : "Area cliente"}</small>
        </div>
      )}
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
      <small>
        <a className="logout" href="/cdn-cgi/access/logout">
          Esci
        </a>
      </small>
    </aside>
  );
}
