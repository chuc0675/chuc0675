'use strict';
/**
 * SQLite (node:sqlite, Node 22.5+). Migratsiyalar `migrations/NNN_*.sql`
 * tartibida bir marta qo'llanadi; qo'llanganlar `schema_migrations` da.
 */
const fs = require('node:fs');
const path = require('node:path');

// node:sqlite eksperimental ogohlantirishini yashiramiz (faqat shu modul uchun)
const origEmit = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : origEmit.call(process, w, ...a));
const { DatabaseSync } = require('node:sqlite');
process.emitWarning = origEmit;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db, dir = path.join(__dirname, 'migrations')) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    tx(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, Date.now());
    });
  }
}

/** Tranzaksiya: xatolikda to'liq bekor qilinadi. Ichma-ich chaqiruvlar SAVEPOINT bilan. */
function tx(db, fn) {
  db._txDepth = db._txDepth || 0;
  const sp = `sp${db._txDepth}`;
  if (db._txDepth === 0) db.exec('BEGIN IMMEDIATE');
  else db.exec(`SAVEPOINT ${sp}`);
  db._txDepth++;
  try {
    const r = fn();
    db._txDepth--;
    if (db._txDepth === 0) db.exec('COMMIT');
    else db.exec(`RELEASE ${sp}`);
    return r;
  } catch (e) {
    db._txDepth--;
    if (db._txDepth === 0) db.exec('ROLLBACK');
    else db.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

module.exports = { openDb, migrate, tx };
