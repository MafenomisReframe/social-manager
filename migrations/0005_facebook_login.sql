-- Accesso tramite Facebook: una pagina Facebook e il suo Instagram collegato con un solo login.
-- Solo modifiche ADDITIVE.

-- Con quale API è stato collegato l'account: 'instagram_login' (graph.instagram.com)
-- oppure 'facebook_login' (graph.facebook.com, token della pagina).
ALTER TABLE social_accounts ADD COLUMN api TEXT NOT NULL DEFAULT 'instagram_login';

-- Elenco temporaneo (cifrato) delle pagine trovate dopo il login, in attesa che l'utente scelga quella del cliente.
CREATE TABLE IF NOT EXISTS oauth_pending (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 payload_enc TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
