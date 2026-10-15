# Social Manager

Applicazione multi-tenant di Re-Frame Communication per gestire i social dei clienti. È autonoma rispetto al gestionale Re-Frame.

- **Online:** https://social-manager.simone-87d.workers.dev (protetta da Cloudflare Access)
- **Stack:** React 18 + Vite (frontend), Cloudflare Worker in JavaScript (API), Cloudflare D1 (`social-manager-db`, binding `DB`)
- **Deploy:** automatico da GitHub (`main`) tramite Cloudflare

## Struttura

```
index.html            pagina che carica src/main.jsx
vite.config.js        build del frontend (output in dist/)
worker.js             verifica JWT di Cloudflare Access, poi passa a api/handler.js
api/handler.js        endpoint /api/* (sessione, clienti)
api/permissions.js    UNICO punto che decide chi vede/modifica cosa
tests/                test di isolamento multi-tenant e validazione (bun test)
wrangler.jsonc        Worker, assets, D1 e POLICY_AUD (non rimuovere nei deploy)
migrations/           schema SQL di riferimento
src/
  main.jsx, App.jsx   avvio e composizione delle pagine
  router.jsx          indirizzi delle pagine (/clienti/<id>/social, ...)
  api.js              chiamate al backend e messaggi d'errore
  shared/validation.js  regole sui campi cliente, usate da frontend E Worker
  components/         menu, intestazione, etichetta "Demo"
  pages/              Dashboard, Clienti, Scheda cliente, pagine dimostrative
  data/demo.js        unici dati finti dell'app (marcati "Demo" in interfaccia)
```

## Cosa è reale e cosa è demo

Reali: login, elenco clienti, creazione cliente, scheda cliente con anagrafica e riferimenti social (validati e salvati in D1, con registro in `audit_events`).

Demo (etichetta "Demo" visibile): pubblicazioni, calendario, contenuti, chat Segnalazioni, Brand Interview, Creative Lab. Nessun account social è collegato via OAuth.

## Sviluppo locale

```
npm install
npm run dev        # solo frontend
npm run build      # genera dist/ usata dal Worker
```

## Due lati della stessa app

- **Agenzia** (`/clienti/<id>`): anagrafica, note interne, profili social, chat, lavorazione. In testa alla scheda c'è il link fisso dell'area cliente, da copiare e mandare.
- **Area cliente** (`/portale/<id>`): dashboard per piattaforma, contenuti, report e chat. Niente anagrafica né note interne. Un utente cliente viene sempre portato qui. L'agenzia la apre in anteprima e può attivare "dati di esempio", sempre etichettati.

## Ruoli e permessi

| Ruolo | Dove | Può fare |
|---|---|---|
| owner, agency_admin | tenant agenzia | vede e modifica tutti i clienti dell'agenzia, crea clienti |
| editor | tenant agenzia | vede e modifica i clienti dell'agenzia, non ne crea |
| client_viewer | tenant cliente | vede solo la propria area, sola lettura, senza note interne; può scrivere in chat |

Ogni cliente appartiene a un'agenzia tramite `tenants.agency_id`; `tenants.kind` distingue `agency` e `client`. Un'agenzia non vede mai i clienti di un'altra (verificato dai test).

## Database

Contiene dati reali: **non azzerare il database**. Migrazioni in `migrations/`, registrate nella tabella `d1_migrations`:

- `0001_initial.sql` — schema iniziale (creato a mano dalla Console D1)
- `0002_agency_scoping.sql` — `kind`, `agency_id`, tabella `reports` (applicata il 15/10/2026)
- `0003_client_chat.sql` — `tickets.kind` per la chat continua cliente-agenzia (applicata il 15/10/2026)
- `0004_social_connections.sql` — token social cifrati, stati OAuth, metriche giornaliere (applicata il 15/10/2026)
- `0005_facebook_login.sql` — `social_accounts.api` e scelta pagina dopo il login Facebook (applicata il 15/10/2026)

Le nuove migrazioni vanno applicate PRIMA del deploy del codice che le usa, e devono essere additive.

## Collegamento social

Instagram (API con Instagram Login, account professionali): il pulsante **Collega** apre il login di Instagram, il ritorno
arriva su `/api/oauth/instagram/callback`, il token di 60 giorni viene salvato **cifrato** e rinnovato in automatico.
Ogni giorno alle 05:15 UTC il cron del Worker legge follower e totali a 30 giorni (copertura, interazioni, account coinvolti)
e salva una riga in `social_metrics_daily`.

Configurazione in Cloudflare (Worker `social-manager` → Impostazioni → Variabili e segreti):

| Nome | Tipo | Valore |
|---|---|---|
| `IG_APP_ID` | variabile (in `wrangler.jsonc`) | ID app Instagram dalla dashboard Meta |
| `IG_APP_SECRET` | **Secret** | Chiave segreta app Instagram |
| `TOKEN_ENC_KEY` | **Secret** | Stringa casuale di almeno 32 caratteri, da non cambiare più |

Nella dashboard Meta, l'URI di reindirizzamento OAuth è
`https://social-manager.simone-87d.workers.dev/api/oauth/instagram/callback`.

**Accesso tramite Facebook (metodo principale per l'agenzia).** Con `META_APP_SECRET` configurato, sia "Collega Facebook"
sia "Collega Instagram" usano il login Facebook: si sceglie la pagina del cliente e si collegano insieme la pagina e
l'Instagram professionale associato. I token delle pagine non scadono. Pagina Facebook: follower, `page_total_media_view_unique`
e `page_post_engagements` (28 giorni). Instagram: stesse metriche del login Instagram, lette da graph.facebook.com.

| Nome | Tipo | Valore |
|---|---|---|
| `META_APP_ID` | variabile | ID app Meta |
| `META_APP_SECRET` | **Secret** | Chiave segreta app (Impostazioni app → Di base) |
| `META_LOGIN_CONFIG_ID` | variabile, facoltativa | ID configurazione di Facebook Login for Business |

URI di reindirizzamento da registrare in Facebook Login: `https://social-manager.simone-87d.workers.dev/api/oauth/facebook/callback`.

## Test

```
bun test
```

## Sicurezza

D1 non isola i tenant da solo: ogni endpoint deve verificare utente, appartenenza e ruolo e filtrare per tenant. Non inserire token o credenziali nel repository.
