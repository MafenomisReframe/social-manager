// Pagine ancora dimostrative: nessun dato reale, nessun salvataggio.
import { useState } from "react";
import { DEMO_POSTS, DEMO_CHAT } from "../data/demo.js";
import DemoBadge from "../components/DemoBadge.jsx";

export function ContentDemo({ title }) {
  return (
    <section className="panel">
      <h3>
        {title} <DemoBadge />
      </h3>
      <div className="grid">
        {DEMO_POSTS.map((p) => (
          <article className="tile" key={p.id}>
            <small>{p.date}</small>
            <h3>{p.title}</h3>
            <p>{p.company}</p>
            <b>{p.platform}</b>
          </article>
        ))}
      </div>
      <p>Contenuti dimostrativi, non pubblicati.</p>
    </section>
  );
}

export function BrandInterviewDemo() {
  const answers = [
    ["01 · OBIETTIVO", "Rafforzare il brand"],
    ["02 · CLIENTE IDEALE", "Da definire con l’AI"],
    ["03 · PERCEZIONE", "Professionale e autorevole"],
    ["04 · SERVIZIO PRIORITARIO", "Il servizio più richiesto"],
  ];
  return (
    <section className="panel">
      <h2>
        Conosciamo il brand <DemoBadge />
      </h2>
      <p>Le risposte guideranno calendario editoriale, contenuti, Social Intelligence e Budget AI.</p>
      <div className="interview">
        {answers.map(([q, a]) => (
          <div key={q}>
            <small>{q}</small>
            <strong>{a}</strong>
          </div>
        ))}
      </div>
      <p className="demo-note">Profilo dimostrativo: le risposte reali saranno salvate per ogni cliente nella fase 5.</p>
    </section>
  );
}

export function CreativeLabDemo() {
  const items = [
    ["✦", "Minimal Impact", "Tipografia e contrasto"],
    ["◈", "Cinematic Mood", "Atmosfera e storytelling"],
    ["✧", "Bold Graphics", "Colore e composizione"],
  ];
  return (
    <section className="panel">
      <h2>
        Creative Lab ✦ <DemoBadge />
      </h2>
      <p>
        La bacheca delle ispirazioni del team. Caricheremo immagini, video e link e indicheremo cosa ci piace: stile,
        colore, tipografia, ritmo o composizione.
      </p>
      <div className="inspo-grid">
        {items.map(([icon, name, desc]) => (
          <article key={name}>
            {icon}
            <strong>{name}</strong>
            <small>{desc}</small>
          </article>
        ))}
      </div>
      <p className="demo-note">La libreria e il pulsante “Stimolami!” saranno attivati con l’archivio media.</p>
    </section>
  );
}

export function TicketsDemo() {
  const [chat, setChat] = useState(DEMO_CHAT);
  const [message, setMessage] = useState("");
  return (
    <section className="panel">
      <h3>
        Chat Segnalazioni <DemoBadge />
      </h3>
      {chat.map((c, i) => (
        <p className="bubble" key={i}>
          {c}
        </p>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (message.trim()) {
            setChat([...chat, "Team: " + message.trim()]);
            setMessage("");
          }
        }}
      >
        <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Scrivi un messaggio di prova" />
        <button>Invia</button>
      </form>
      <small>I messaggi non vengono salvati né inviati.</small>
    </section>
  );
}

export function Placeholder({ title }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <p>
        Modulo previsto nella roadmap. Le funzioni reali saranno attivate dopo permessi, database e autorizzazioni
        delle piattaforme.
      </p>
    </section>
  );
}

export function NotFound() {
  return (
    <section className="panel">
      <h2>Pagina non trovata</h2>
      <p>L'indirizzo non corrisponde a nessuna sezione. Usa il menu a sinistra.</p>
    </section>
  );
}
