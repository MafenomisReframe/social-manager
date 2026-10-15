-- Chat continua tra agenzia e cliente: un ticket di tipo 'chat' per ogni cliente.
-- Le future Segnalazioni restano ticket di tipo 'ticket'. Modifica solo ADDITIVA.
ALTER TABLE tickets ADD COLUMN kind TEXT NOT NULL DEFAULT 'ticket';
CREATE INDEX IF NOT EXISTS tickets_tenant_kind_idx ON tickets(tenant_id, kind);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket_created_idx ON ticket_messages(ticket_id, created_at);
