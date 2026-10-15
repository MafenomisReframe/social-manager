// Chat tra agenzia e cliente. È la stessa conversazione vista da entrambi i lati.
// Si aggiorna da sola ogni 8 secondi mentre la pagina è aperta.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const POLL_MS = 8000;

function formatTime(ts) {
  const d = new Date(ts.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function Chat({ clientId, viewer = "agency", agencyName = "il team" }) {
  const [messages, setMessages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const lastRef = useRef(0);
  const listRef = useRef(null);

  const merge = useCallback((incoming) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const next = [...prev, ...incoming.filter((m) => !seen.has(m.id))].sort((a, b) => a.seq - b.seq);
      lastRef.current = Math.max(...next.map((m) => m.seq || 0));
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    lastRef.current = 0;
    setMessages([]);
    setLoaded(false);
    async function poll() {
      try {
        const { messages } = await api.listMessages(clientId, lastRef.current);
        if (!alive) return;
        merge(messages);
        setError("");
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoaded(true);
      }
    }
    poll();
    const timer = setInterval(() => document.visibilityState === "visible" && poll(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [clientId, merge]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { message } = await api.sendMessage(clientId, body);
      merge([message]);
      setText("");
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const emptyText =
    viewer === "client"
      ? `Scrivi qui per qualsiasi richiesta: ${agencyName} ti risponderà in questa conversazione.`
      : "Nessun messaggio. Scrivi al cliente: vedrà la conversazione nella sua area riservata.";

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef} aria-live="polite">
        {!loaded && <p className="chat-empty">Caricamento conversazione...</p>}
        {loaded && messages.length === 0 && <p className="chat-empty">{emptyText}</p>}
        {messages.map((m) => (
          <div key={m.id} className={"msg " + (m.mine ? "mine" : "theirs") + " from-" + m.from}>
            <div className="msg-meta">
              <b>{m.mine ? "Tu" : m.author}</b>
              {!m.mine && <span className="msg-tag">{m.from === "agency" ? "Team" : "Cliente"}</span>}
              <time>{formatTime(m.created_at)}</time>
            </div>
            <p>{m.body}</p>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <form className="chat-form" onSubmit={send}>
        <textarea
          rows={2}
          value={text}
          maxLength={4000}
          placeholder="Scrivi un messaggio…"
          aria-label="Messaggio"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) send(e);
          }}
        />
        <button disabled={sending || !text.trim()}>{sending ? "Invio…" : "Invia"}</button>
      </form>
      <small className="chat-hint">Invio per mandare · Maiusc+Invio per andare a capo</small>
    </div>
  );
}
