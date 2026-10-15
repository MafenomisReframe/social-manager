// Imitazione minima dell'API di Cloudflare D1 sopra SQLite (bun:sqlite), solo per i test.
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async first() {
    return this.db.query(this.sql).get(...this.args) ?? null;
  }
  async all() {
    return { results: this.db.query(this.sql).all(...this.args) };
  }
  async run() {
    this.db.query(this.sql).run(...this.args);
    return { success: true };
  }
  runSync() {
    this.db.query(this.sql).run(...this.args);
  }
}

export function createTestDb() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of ["0001_initial.sql", "0002_agency_scoping.sql"]) {
    db.exec(readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"));
  }
  return {
    raw: db,
    prepare: (sql) => new Statement(db, sql),
    batch: async (statements) => {
      db.transaction(() => statements.forEach((s) => s.runSync()))();
      return statements.map(() => ({ success: true }));
    },
  };
}
