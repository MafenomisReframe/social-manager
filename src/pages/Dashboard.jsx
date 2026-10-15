import { navigate } from "../router.jsx";
import { DEMO_POSTS } from "../data/demo.js";
import DemoBadge from "../components/DemoBadge.jsx";

export default function Dashboard({ clients, loading }) {
  const metrics = [
    ["Clienti", loading ? "…" : String(clients.length), false],
    ["Account collegati", "0", false],
    ["Contenuti", String(DEMO_POSTS.length), true],
    ["Segnalazioni", "1", true],
  ];
  const shortcuts = [
    ["✦ Gestisci clienti", "/clienti"],
    ["◈ Brand Interview", "/brand-interview"],
    ["✧ Stimolami!", "/creative-lab"],
    ["◉ Segnalazioni", "/segnalazioni"],
  ];
  return (
    <>
      <section className="hero">
        <h2>La tua comunicazione, sotto controllo.</h2>
        <p>Gestisci clienti, calendario, lavori e risultati da un unico spazio.</p>
        <button onClick={() => navigate("/calendario")}>Apri calendario →</button>
      </section>

      <div className="metrics">
        {metrics.map(([label, value, demo]) => (
          <article key={label}>
            <span>
              {label} {demo && <DemoBadge />}
            </span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <div className="quick-grid">
        {shortcuts.map(([label, to]) => (
          <button key={to} onClick={() => navigate(to)}>
            {label} <span>→</span>
          </button>
        ))}
      </div>

      <section className="panel">
        <h3>
          Prossime pubblicazioni <DemoBadge />
        </h3>
        {DEMO_POSTS.map((p) => (
          <div className="row" key={p.id}>
            <b>{p.title}</b>
            <span>
              {p.company} · {p.platform}
            </span>
            <em>{p.date}</em>
          </div>
        ))}
      </section>
    </>
  );
}
