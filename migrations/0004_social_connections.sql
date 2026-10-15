-- Collegamento reale degli account social (OAuth) e storico giornaliero delle metriche.
-- Solo modifiche ADDITIVE.

-- Token di accesso CIFRATO (AES-GCM, chiave nel secret TOKEN_ENC_KEY): mai in chiaro nel database.
ALTER TABLE social_accounts ADD COLUMN access_token_enc TEXT;
ALTER TABLE social_accounts ADD COLUMN token_expires_at TEXT;
ALTER TABLE social_accounts ADD COLUMN scopes TEXT;
ALTER TABLE social_accounts ADD COLUMN connected_by TEXT REFERENCES users(id);
ALTER TABLE social_accounts ADD COLUMN connected_at TEXT;
ALTER TABLE social_accounts ADD COLUMN last_sync_at TEXT;
ALTER TABLE social_accounts ADD COLUMN last_error TEXT;
-- Un solo account per piattaforma per cliente.
CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_tenant_platform_uq ON social_accounts(tenant_id, platform);

-- Stato temporaneo del login OAuth (protezione CSRF), valido 15 minuti.
CREATE TABLE IF NOT EXISTS oauth_states (
 state TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 platform TEXT NOT NULL,
 expires_at TEXT NOT NULL
);

-- Una riga al giorno per account: base per grafici, confronti e report.
-- reach/interactions/engaged sono totali degli ultimi 30 giorni al momento della lettura.
CREATE TABLE IF NOT EXISTS social_metrics_daily (
 account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 followers INTEGER,
 media_count INTEGER,
 reach_30d INTEGER,
 interactions_30d INTEGER,
 engaged_30d INTEGER,
 raw_json TEXT NOT NULL DEFAULT '{}',
 PRIMARY KEY (account_id, day)
);
CREATE INDEX IF NOT EXISTS social_metrics_tenant_day_idx ON social_metrics_daily(tenant_id, day);
