// Etichetta visibile su tutto ciò che non proviene da dati reali.
export default function DemoBadge({ children = "Demo" }) {
  return <span className="demo-badge">{children}</span>;
}
