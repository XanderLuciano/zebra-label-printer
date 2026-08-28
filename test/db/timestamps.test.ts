/**
 * Tests that timestamp columns actually store timestamps.
 *
 * Every `created_at`/`updated_at` column was originally declared as
 *   DEFAULT '(datetime(''now''))'
 * — a quoted string *literal*, not an expression — because that is what
 * drizzle-kit emits for `.default("(datetime('now'))")`. Rows inserted without an
 * explicit value stored the text "(datetime('now'))" instead of a date, which
 * silently broke print-history dates, history ordering, and the template list's
 * "most recently edited first" sort.
 *
 * The schema now uses sql`(datetime('now'))`. Both kinds of assertion below are
 * needed, because the defect had two independent halves:
 *
 *   • The **DDL** assertions guard the migration files, which are what actually
 *     runs against a real database.
 *   • The **behavioural** assertions guard `schema.ts`, because Drizzle inlines a
 *     plain-string `.default()` into the INSERT it generates rather than omitting
 *     the column and letting SQLite apply its own default. A correct DDL is
 *     therefore not enough on its own — verified by reverting one column and
 *     watching only the behavioural test fail.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'

// Set test DB path BEFORE importing the database module
const TEST_DB = '/tmp/zebra-test-timestamps.db'
process.env.ZEBRA_DB_PATH = TEST_DB

import { getDb, getSqlite, closeDb } from '../../src/db/database'
import { createJob, getJob, addJobLog, getJobLogs, listJobs } from '../../src/db/print-job-repo'
import { recordPrinterEvent, getPrinterEvents, setSetting } from '../../src/db/settings-repo'
import { createPrinterProfile } from '../../src/db/printer-repo'
import { createTemplate } from '../../src/db/template-repo'

/** The value the broken default used to store. */
const BROKEN = "(datetime('now'))"

/** SQLite's `datetime()` output format, e.g. `2026-08-28 20:04:10`. */
const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

/** Every column that defaults to the current time. */
const TIMESTAMP_COLUMNS: Array<[table: string, column: string]> = [
  ['print_jobs', 'created_at'],
  ['job_logs', 'created_at'],
  ['printer_events', 'created_at'],
  ['label_templates', 'created_at'],
  ['label_templates', 'updated_at'],
  ['settings', 'updated_at'],
  ['printers', 'created_at'],
  ['printers', 'updated_at']
]

function cleanDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(TEST_DB + suffix)
    } catch { /* empty */ }
  }
}

function resetDb() {
  getDb()
  const sqlite = getSqlite()
  sqlite.exec('DELETE FROM job_logs')
  sqlite.exec('DELETE FROM print_jobs')
  sqlite.exec('DELETE FROM printers')
  sqlite.exec('DELETE FROM label_templates')
  sqlite.exec('DELETE FROM settings')
  sqlite.exec('DELETE FROM printer_events')
}

function ddlFor(table: string): string {
  const row = getSqlite()
    .prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
    .get('table', table) as { sql: string } | undefined
  return row?.sql ?? ''
}

describe('timestamp defaults', () => {
  beforeEach(() => {
    resetDb()
  })

  afterEach(() => {
    try {
      closeDb()
    } catch { /* empty */ }
    cleanDb()
  })

  it.each(TIMESTAMP_COLUMNS)(
    '%s.%s defaults to an expression, not a quoted string',
    (table, column) => {
      const ddl = ddlFor(table)
      expect(ddl, `${table} should exist`).not.toBe('')

      // The defect: a quoted literal. `DEFAULT '(datetime(''now''))'`
      expect(ddl, `${table}.${column} still has the string-literal default`)
        .not.toContain("DEFAULT '(datetime(''now''))'")

      // The fix: an unquoted expression.
      expect(ddl).toContain(`\`${column}\` text DEFAULT (datetime('now'))`)
    }
  )

  it('gives a print job a real creation timestamp', () => {
    const job = createJob('text', { lines: ['x'] })
    expect(job.created_at).not.toBe(BROKEN)
    expect(job.created_at).toMatch(SQLITE_DATETIME)
  })

  it('gives a job log a real creation timestamp', () => {
    const job = createJob('text', { lines: ['x'] })
    addJobLog(job.id, 'info', 'hello')

    const logs = getJobLogs(job.id)
    expect(logs.length).toBeGreaterThan(0)
    for (const log of logs) {
      expect(log.created_at).toMatch(SQLITE_DATETIME)
    }
  })

  it('gives a printer event a real creation timestamp', () => {
    recordPrinterEvent('ZTC-GK420d', 'disconnected', 'unplugged')
    const [event] = getPrinterEvents(1)
    expect(event!.created_at).toMatch(SQLITE_DATETIME)
  })

  it('gives a template real creation and update timestamps', () => {
    const template = createTemplate({
      name: 'Timestamped',
      baseWidthDots: 406,
      baseHeightDots: 203,
      variables: [],
      elements: [],
      overrides: {}
    })
    expect(template.createdAt).toMatch(SQLITE_DATETIME)
    expect(template.updatedAt).toMatch(SQLITE_DATETIME)
  })

  it('gives a printer profile real timestamps', () => {
    const printer = createPrinterProfile({ name: 'Bench', cupsName: 'bench' })
    expect(printer.createdAt).toMatch(SQLITE_DATETIME)
    expect(printer.updatedAt).toMatch(SQLITE_DATETIME)
  })

  it('gives a setting a real update timestamp', () => {
    setSetting('auto_update_check', 'true')
    const row = getSqlite()
      .prepare('SELECT updated_at FROM settings WHERE key = ?')
      .get('auto_update_check') as { updated_at: string }
    expect(row.updated_at).toMatch(SQLITE_DATETIME)
  })

  it('stores timestamps SQLite can compare, which is what history sorting needs', () => {
    // The broken value made datetime() return null, so ordering by created_at was
    // ordering by a constant string.
    createJob('text', { lines: ['a'] })
    createJob('text', { lines: ['b'] })

    const rows = getSqlite().prepare(
      'SELECT count(*) AS total, count(datetime(created_at)) AS parseable FROM print_jobs'
    ).get() as { total: number; parseable: number }

    expect(rows.total).toBe(2)
    expect(rows.parseable).toBe(rows.total)
  })

  it('orders job listings by a real date', () => {
    const first = createJob('text', { lines: ['first'] })
    getSqlite()
      .prepare("UPDATE print_jobs SET created_at = datetime('now', '-1 day') WHERE id = ?")
      .run(first.id)
    const second = createJob('text', { lines: ['second'] })

    // Newest first. With the broken default both dates were the same string and
    // this ordering was arbitrary.
    expect(listJobs({ limit: 10 }).map(j => j.id)).toEqual([second.id, first.id])
  })

  it('records a job creation time consistent with the id it generated', () => {
    // print_jobs.id embeds Date.now(), which is what let migration 0004 recover
    // the corrupted dates. Keep the two in step.
    const job = createJob('text', { lines: ['x'] })
    const msFromId = Number(job.id.slice(4, 17))
    expect(Number.isFinite(msFromId)).toBe(true)

    const recorded = getJob(job.id)!.created_at
    const fromId = new Date(msFromId).toISOString().replace('T', ' ').slice(0, 19)

    // Same second, or one either side if the insert straddled a tick.
    const deltaSeconds = Math.abs(
      (new Date(`${recorded}Z`).getTime() - new Date(`${fromId}Z`).getTime()) / 1000
    )
    expect(deltaSeconds).toBeLessThanOrEqual(2)
  })
})
