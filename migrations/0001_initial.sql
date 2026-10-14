-- Social Manager: initial multi-tenant schema (not applied to D1 yet)
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tenants (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
 branding_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS memberships (
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','agency_admin','editor','client_viewer')),
 PRIMARY KEY(tenant_id,user_id)
);
CREATE TABLE IF NOT EXISTS social_accounts (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 platform TEXT NOT NULL CHECK(platform IN ('instagram','facebook','linkedin','tiktok')),
 handle TEXT, external_account_id TEXT, connection_status TEXT NOT NULL DEFAULT 'disconnected',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS social_accounts_tenant_idx ON social_accounts(tenant_id);
CREATE TABLE IF NOT EXISTS content_items (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 title TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_progress','scheduled','published','failed')),
 scheduled_at TEXT, created_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS content_tenant_schedule_idx ON content_items(tenant_id,scheduled_at);
CREATE TABLE IF NOT EXISTS content_targets (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
 social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'draft', published_at TEXT
);
CREATE TABLE IF NOT EXISTS reports (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 title TEXT NOT NULL, period_start TEXT, period_end TEXT, payload_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tickets (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')),
 content_id TEXT REFERENCES content_items(id), created_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ticket_messages (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ticket_messages_tenant_ticket_idx ON ticket_messages(tenant_id,ticket_id);
CREATE TABLE IF NOT EXISTS brand_profiles (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 answers_json TEXT NOT NULL DEFAULT '{}', strategy_json TEXT NOT NULL DEFAULT '{}',
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_events (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, entity_type TEXT NOT NULL,
 entity_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Security: D1 has no built-in row-level security.
-- Every backend route must authenticate the user, validate membership and role,
-- and filter ALL queries by authorized tenant_id; never trust tenant_id from client.
-- client_viewer may only read tenant resources and create/read own ticket messages
-- or update brand interview fields specifically authorized by the application.
