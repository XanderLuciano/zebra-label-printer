/**
 * Database layer — Drizzle ORM with SQLite via better-sqlite3.
 *
 * Singleton pattern: call getDb() to access the Drizzle instance.
 * Migrations run automatically on first access via drizzle-kit's migrate().
 */

import Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import * as schema from './schema'

export type DB = BetterSQLite3Database<typeof schema>

let db: DB | null = null
let sqlite: Database.Database | null = null

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'zebra-label-printer.db')
const MIGRATIONS_DIR = path.join(__dirname, '../../drizzle')

/** Resolve the DB path at call time so env vars set after module load are respected */
function getDbPath(): string {
  return process.env.ZEBRA_DB_PATH || DEFAULT_DB_PATH
}

/** Get the Drizzle database singleton, creating it if needed */
export function getDb(): DB {
  if (!db) {
    const dbPath = getDbPath()
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    sqlite = new Database(dbPath)

    // Performance settings
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')

    db = drizzle(sqlite, { schema })

    // Run pending migrations
    if (fs.existsSync(MIGRATIONS_DIR)) {
      // For existing databases created before Drizzle: drop the old migration
      // tracker so Drizzle can take over cleanly. The schema is identical.
      const hasOldMigrations = sqlite.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='_migrations'"
      ).get()
      const hasDrizzleMigrations = sqlite.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'"
      ).get()

      if (hasOldMigrations && !hasDrizzleMigrations) {
        // Existing DB from pre-Drizzle era: tables already exist.
        // Create the Drizzle journal table and mark the initial migration as applied
        // so Drizzle doesn't try to CREATE TABLE again.
        sqlite.exec(`
          CREATE TABLE IF NOT EXISTS __drizzle_migrations (
            id integer PRIMARY KEY AUTOINCREMENT,
            hash text NOT NULL,
            created_at numeric
          );
        `)
        // Read the journal to get the hash for migration 0000
        const journalPath = path.join(MIGRATIONS_DIR, 'meta', '_journal.json')
        if (fs.existsSync(journalPath)) {
          const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'))
          const firstEntry = journal.entries?.[0]
          if (firstEntry) {
            const migrationFile = path.join(MIGRATIONS_DIR, `${firstEntry.tag}.sql`)
            if (fs.existsSync(migrationFile)) {
              const content = fs.readFileSync(migrationFile, 'utf-8')
              // Drizzle uses the SQL content as the hash
              const hash = crypto.createHash('sha256').update(content).digest('hex')
              sqlite.prepare(
                'INSERT OR IGNORE INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)'
              ).run(hash, Date.now())
            }
          }
        }
        sqlite.exec('DROP TABLE IF EXISTS _migrations')
        console.log('  📦 Migrated from legacy migration system to Drizzle')
      }

      migrate(db, { migrationsFolder: MIGRATIONS_DIR })
    }
  }
  return db
}

/** Get the underlying better-sqlite3 instance (for raw queries if needed) */
export function getSqlite(): Database.Database {
  if (!sqlite) {
    getDb() // Initialize if not already done
  }
  if (!sqlite) {
    throw new Error('Database failed to initialize')
  }
  return sqlite
}

/** Close the database connection (for graceful shutdown) */
export function closeDb(): void {
  if (sqlite) {
    sqlite.close()
    sqlite = null
    db = null
  }
}
