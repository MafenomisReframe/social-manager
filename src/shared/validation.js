// Regole di validazione della scheda cliente.
// Usate sia dal frontend (errori immediati) sia dal Worker (controllo definitivo):
// il server non si fida mai dei dati ricevuti dal browser.

export const PROFILE_FIELDS = [
  { key: "sector", label: "Settore", group: "anagrafica", max: 120, placeholder: "Es. Ristorazione" },
  { key: "website", label: "Sito web", group: "anagrafica", max: 300, placeholder: "www.azienda.it" },
  { key: "email", label: "Email", group: "anagrafica", max: 254, type: "email", placeholder: "info@azienda.it" },
  { key: "phone", label: "Telefono", group: "anagrafica", max: 30, type: "tel", placeholder: "+39 030 ..." },
  { key: "instagram", label: "Instagram", group: "social", max: 300, placeholder: "@profilo o link" },
  { key: "facebook", label: "Facebook", group: "social", max: 300, placeholder: "Nome pagina o link" },
  { key: "linkedin", label: "LinkedIn", group: "social", max: 300, placeholder: "Link pagina aziendale" },
  { key: "tiktok", label: "TikTok", group: "social", max: 300, placeholder: "@profilo o link" },
  { key: "notes", label: "Note interne", group: "anagrafica", max: 2000, multiline: true, placeholder: "Visibili solo all'agenzia" },
];

export const PROFILE_KEYS = PROFILE_FIELDS.map((f) => f.key);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9 ().\/-]+$/;
const HANDLE_RE = /^@?[A-Za-z0-9._\-\/]{1,100}$/;

function checkUrl(value) {
  const withScheme = /^https?:\/\//i.test(value) ? value : "https://" + value;
  try {
    const u = new URL(withScheme);
    if (!["http:", "https:"].includes(u.protocol) || !u.hostname.includes(".")) return null;
    return withScheme;
  } catch {
    return null;
  }
}

// Restituisce { values, errors }. errors è vuoto se tutto è valido.
// Solo i campi presenti in input vengono controllati (aggiornamenti parziali).
export function validateProfile(input) {
  const values = {};
  const errors = {};

  if (input?.name !== undefined) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 2 || name.length > 120) errors.name = "Il nome deve avere tra 2 e 120 caratteri.";
    else values.name = name;
  }

  for (const field of PROFILE_FIELDS) {
    const raw = input?.[field.key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") {
      errors[field.key] = "Valore non valido.";
      continue;
    }
    const v = raw.trim();
    if (v.length > field.max) {
      errors[field.key] = `Massimo ${field.max} caratteri.`;
      continue;
    }
    if (v === "") {
      values[field.key] = "";
      continue;
    }
    switch (field.key) {
      case "website": {
        const url = checkUrl(v);
        if (!url) errors.website = "Indirizzo del sito non valido.";
        else values.website = url;
        break;
      }
      case "email":
        if (!EMAIL_RE.test(v)) errors.email = "Email non valida.";
        else values.email = v.toLowerCase();
        break;
      case "phone": {
        const digits = v.replace(/\D/g, "").length;
        if (!PHONE_RE.test(v) || digits < 6 || digits > 15) errors.phone = "Numero di telefono non valido.";
        else values.phone = v;
        break;
      }
      case "instagram":
      case "facebook":
      case "linkedin":
      case "tiktok":
        if (/^https?:\/\//i.test(v)) {
          const url = checkUrl(v);
          if (!url) errors[field.key] = "Link non valido.";
          else values[field.key] = url;
        } else if (!HANDLE_RE.test(v)) {
          errors[field.key] = "Inserisci un @profilo o un link completo.";
        } else values[field.key] = v;
        break;
      default:
        values[field.key] = v;
    }
  }
  return { values, errors };
}
