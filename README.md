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

## Ruoli e permessi

| Ruolo | Dove | Può fare |
|---|---|---|
| owner, agency_admin | tenant agenzia | vede e modifica tutti i clienti dell'agenzia, crea clienti |
| editor | tenant agenzia | vede e modifica i clienti dell'agenzia, non ne crea |
| client_viewer | tenant cliente | vede solo la propria azienda, sola lettura, senza note interne |

Ogni cliente appartiene a un'agenzia tramite `tenants.agency_id`; `tenants.kind` distingue `agency` e `client`. Un'agenzia non vede mai i clienti di un'altra (verificato dai test).

## Database

Contiene dati reali: **non azzerare il database**. Migrazioni in `migrations/`, registrate nella tabella `d1_migrations`:

- `0001_initial.sql` — schema iniziale (creato a mano dalla Console D1)
- `0002_agency_scoping.sql` — `kind`, `agency_id`, tabella `reports` (applicata il 15/10/2026)

Le nuove migrazioni vanno applicate PRIMA del deploy del codice che le usa, e devono essere additive.

## Test

```
bun test
```

## Sicurezza

D1 non isola i tenant da solo: ogni endpoint deve verificare utente, appartenenza e ruolo e filtrare per tenant. Non inserire token o credenziali nel repository.
