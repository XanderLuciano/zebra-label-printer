/**
 * Database layer — SQLite via better-sqlite3.
 *
 * Singleton pattern: call getDb() to access the database.
 * Schema migrations run automatically on first access.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;
const DB_PATH = process.env.ZEBRA_DB_PATH || path.join(process.cwd(), 'data', 'zebra-label-printer.db');

/** Get the database singleton, creating it if needed */
export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);

    // Performance settings
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    runMigrations(db);
  }
  return db;
}

/** Close the database connection (for graceful shutdown) */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ─── Migrations ──────────────────────────────────────────────────────────────

function runMigrations(database: Database.Database): void {
  // Migration tracking table
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    database
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((r: unknown) => (r as { name: string }).name),
  );

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.name)) {
      database.exec(migration.sql);
      database
        .prepare('INSERT INTO _migrations (name) VALUES (?)')
        .run(migration.name);
      console.log(`  📦 Migration: ${migration.name}`);
    }
  }
}

interface Migration {
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    name: '001_initial',
    sql: `
      -- Print jobs table
      CREATE TABLE IF NOT EXISTS print_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'printing', 'completed', 'failed', 'cancelled')),
        job_type TEXT NOT NULL
          CHECK (job_type IN ('text', 'barcode', 'qr', 'zpl', 'label')),
        request_data TEXT NOT NULL,       -- JSON: the original request body
        zpl_commands TEXT,                -- Generated ZPL (null until processed)
        printer_name TEXT,                -- Target printer
        cups_job_id TEXT,                 -- CUPS job ID after printing
        error_message TEXT,               -- Error details if failed
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT,
        priority INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_print_jobs_created ON print_jobs(created_at);

      -- Print job log (debug/audit trail)
      CREATE TABLE IF NOT EXISTS job_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES print_jobs(id) ON DELETE CASCADE,
        level TEXT NOT NULL DEFAULT 'info'
          CHECK (level IN ('debug', 'info', 'warn', 'error')),
        message TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id);

      -- Settings (key/value store)
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Printer status log (for connectivity tracking)
      CREATE TABLE IF NOT EXISTS printer_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        printer_name TEXT NOT NULL,
        event_type TEXT NOT NULL
          CHECK (event_type IN ('connected', 'disconnected', 'error', 'recovered')),
        message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];
