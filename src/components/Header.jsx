import { navigate, clientPath } from "../router.jsx";

export default function Header({ section, title, clients, currentClientId }) {
  return (
    <header>
      <div>
        <label>WORKSPACE / {section.toUpperCase()}</label>
        <h1>{title}</h1>
      </div>
      <select
        aria-label="Apri la scheda di un cliente"
        value={currentClientId || ""}
        onChange={(e) => e.target.value && navigate(clientPath(e.target.value))}
      >
        <option value="">Vai a un cliente…</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </header>
  );
}
