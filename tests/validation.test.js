import { expect, test } from "bun:test";
import { validateProfile } from "../src/shared/validation.js";

test("valori validi vengono normalizzati", () => {
  const { values, errors } = validateProfile({
    name: " Effebiemme ",
    website: "effebiemme.it",
    email: "Info@Effe.IT",
    phone: "+39 030 123456",
    instagram: "@effebiemme",
    linkedin: "https://linkedin.com/company/x",
  });
  expect(errors).toEqual({});
  expect(values).toMatchObject({ name: "Effebiemme", website: "https://effebiemme.it", email: "info@effe.it" });
});

test("valori non validi sono segnalati campo per campo", () => {
  const { errors } = validateProfile({
    name: "x",
    website: "non un sito",
    email: "pippo",
    phone: "abc",
    tiktok: "ciao mondo!",
    instagram: "javascript:alert(1)",
  });
  expect(Object.keys(errors).sort()).toEqual(["email", "instagram", "name", "phone", "tiktok", "website"]);
});

test("campi vuoti consentiti, tipi errati e testi troppo lunghi rifiutati", () => {
  expect(validateProfile({ name: "Ok", website: "", email: "  " }).errors).toEqual({});
  expect(validateProfile({ name: "Ok", notes: 5 }).errors.notes).toBeDefined();
  expect(validateProfile({ name: "Ok", notes: "a".repeat(2001) }).errors.notes).toBeDefined();
});
