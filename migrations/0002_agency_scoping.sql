-- Social Manager: collegamento clienti -> agenzia (base del multi-tenant e del white-label).
-- Solo modifiche ADDITIVE: nessuna riga cancellata, il codice precedente continua a funzionare.

-- kind: 'agency' per i workspace delle agenzie, 'client' per le aziende clienti.
ALTER TABLE tenants ADD COLUMN kind TEXT NOT NULL DEFAULT 'client';
-- agency_id: l'agenzia che gestisce il cliente (NULL per le agenzie).
ALTER TABLE tenants ADD COLUMN agency_id TEXT REFERENCES tenants(id);
CREATE INDEX IF NOT EXISTS tenants_agency_idx ON tenants(agency_id, kind);

UPDATE tenants SET kind = 'agency', agency_id = NULL WHERE id = 'tenant-reframe-001';
UPDATE tenants SET agency_id = 'tenant-reframe-001' WHERE kind = 'client' AND agency_id IS NULL;

-- Tabella prevista dallo schema iniziale ma mai creata in produzione.
CREATE TABLE IF NOT EXISTS reports (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 title TEXT NOT NULL, period_start TEXT, period_end TEXT, payload_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS reports_tenant_idx ON reports(tenant_id, period_start);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);
