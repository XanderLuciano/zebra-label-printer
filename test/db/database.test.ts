/**
 * Tests for database layer — SQLite persistence.
 * Uses an in-memory database for fast, isolated tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'

// Set test DB path BEFORE importing database module
const TEST_DB = '/tmp/zebra-test.db'
process.env.ZEBRA_DB_PATH = TEST_DB

import { getDb, getSqlite, closeDb } from '../../src/db/database'
import {
  createJob,
  getJob,
  updateJobStatus,
  listJobs,
  getJobStats,
  getJobLogs,
  addJobLog,
  getNextPendingJob,
  countPendingJobs,
  cleanupOldJobs
} from '../../src/db/print-job-repo'
import {
  getSetting,
  setSetting,
  getAllSettings,
  getBoolSetting,
  getNumberSetting,
  getJsonSetting,
  recordPrinterEvent,
  getPrinterEvents,
  getLabelSize,
  setLabelSize,
  getRecentSizes,
  STANDARD_SIZES
} from '../../src/db/settings-repo'

function cleanDb() {
  try {
    fs.unlinkSync(TEST_DB)
  } catch { /* empty */ }
  try {
    fs.unlinkSync(TEST_DB + '-wal')
  } catch { /* empty */ }
  try {
    fs.unlinkSync(TEST_DB + '-shm')
  } catch { /* empty */ }
}

// Reset all tables between tests
function resetDb() {
  // Ensure the DB is initialized (runs migrations on first call)
  getDb()
  const sqlite = getSqlite()
  // Delete all data but keep schema
  sqlite.exec('DELETE FROM job_logs')
  sqlite.exec('DELETE FROM print_jobs')
  sqlite.exec('DELETE FROM settings')
  sqlite.exec('DELETE FROM printer_events')
}

describe('Database layer', () => {
  beforeEach(() => {
    resetDb()
  })

  afterEach(() => {
    try {
      closeDb()
    } catch { /* empty */ }
    cleanDb()
  })

  it('creates database with migrations', () => {
    getDb()
    const sqlite = getSqlite()
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>
    const names = tables.map(t => t.name)
    expect(names).toContain('print_jobs')
    expect(names).toContain('job_logs')
    expect(names).toContain('settings')
    expect(names).toContain('printer_events')
  })

  it('migrations are idempotent', () => {
    closeDb()
    // Second call should not fail (migrations already applied)
    getDb()
    const sqlite = getSqlite()
    // Drizzle tracks migrations in __drizzle_migrations
    const migrations = sqlite.prepare('SELECT COUNT(*) as cnt FROM __drizzle_migrations').get() as { cnt: number }
    expect(migrations.cnt).toBeGreaterThanOrEqual(1)
  })

  it('creates print jobs', () => {
    const job = createJob('text', { lines: ['Test'] }, undefined, 'TestPrinter')
    expect(job.status).toBe('pending')
    expect(job.job_type).toBe('text')
    expect(job.printer_name).toBe('TestPrinter')
    expect(job.id).toBeTruthy()

    const fetched = getJob(job.id)
    expect(fetched).toBeTruthy()
    expect(fetched!.status).toBe('pending')
  })

  it('updates job status through lifecycle', () => {
    const job = createJob('text', { lines: ['Test'] })
    updateJobStatus(job.id, 'printing')
    let fetched = getJob(job.id)
    expect(fetched!.status).toBe('printing')
    expect(fetched!.started_at).toBeTruthy()

    updateJobStatus(job.id, 'completed', { cupsJobId: 'CUPS-42' })
    fetched = getJob(job.id)
    expect(fetched!.status).toBe('completed')
    expect(fetched!.cups_job_id).toBe('CUPS-42')
    expect(fetched!.completed_at).toBeTruthy()
  })

  it('adds and retrieves job logs', () => {
    const job = createJob('text', { lines: ['Test'] })
    addJobLog(job.id, 'info', 'Test message')
    addJobLog(job.id, 'warn', 'Warning message')

    const logs = getJobLogs(job.id)
    expect(logs.length).toBe(3) // 2 manual + 1 auto from createJob
    const messages = logs.map(l => l.message)
    expect(messages).toContain('Warning message')
    expect(messages).toContain('Test message')
    expect(messages).toContain('Job created (text)')
  })

  it('lists jobs with filters', () => {
    const j1 = createJob('text', { lines: ['A'] })
    const j2 = createJob('barcode', { data: '123' })
    updateJobStatus(j2.id, 'completed')

    const all = listJobs()
    expect(all.length).toBe(2)

    const pending = listJobs({ status: 'pending' })
    expect(pending.length).toBe(1)
    expect(pending[0].id).toBe(j1.id)

    const completed = listJobs({ status: 'completed' })
    expect(completed.length).toBe(1)
    expect(completed[0].id).toBe(j2.id)
  })

  it('gets job statistics', () => {
    createJob('text', { lines: ['A'] })
    createJob('text', { lines: ['B'] })
    const j3 = createJob('text', { lines: ['C'] })
    updateJobStatus(j3.id, 'completed')

    const stats = getJobStats()
    expect(stats.total).toBe(3)
    expect(stats.pending).toBe(2)
    expect(stats.completed).toBe(1)
    expect(stats.failed).toBe(0)
    expect(stats.cancelled).toBe(0)
  })

  it('gets next pending job', () => {
    createJob('text', { lines: ['A'] })
    const next = getNextPendingJob()
    expect(next).toBeTruthy()
    expect(next!.status).toBe('pending')
  })

  it('cancels pending jobs', () => {
    const job = createJob('text', { lines: ['Test'] })
    expect(countPendingJobs()).toBe(1)

    updateJobStatus(job.id, 'cancelled')
    expect(getJob(job.id)!.status).toBe('cancelled')
    expect(countPendingJobs()).toBe(0)
  })

  it('cleans up old jobs', () => {
    const j1 = createJob('text', { lines: ['Old'] })
    const j2 = createJob('text', { lines: ['New'] })
    updateJobStatus(j1.id, 'completed')
    updateJobStatus(j2.id, 'completed')

    // Manually age j1
    getSqlite().prepare("UPDATE print_jobs SET completed_at = datetime('now', '-31 days') WHERE id = ?").run(j1.id)

    const count = cleanupOldJobs(30)
    expect(count).toBe(1)
    expect(listJobs().length).toBe(1)
    expect(listJobs()[0].id).toBe(j2.id)
  })

  it('settings CRUD', () => {
    setSetting('test_key', 'test_value')
    expect(getSetting('test_key')).toBe('test_value')
    expect(getSetting('nonexistent', 'default')).toBe('default')

    setSetting('num_key', '42')
    expect(getNumberSetting('num_key', 0)).toBe(42)

    setSetting('bool_key', 'true')
    expect(getBoolSetting('bool_key', false)).toBe(true)

    setSetting('json_key', { arr: [1, 2] })
    expect(getJsonSetting<any>('json_key', null).arr).toEqual([1, 2])

    expect(getAllSettings()['test_key']).toBe('test_value')
  })

  it('settings overwrite on conflict', () => {
    setSetting('key', 'first')
    setSetting('key', 'second')
    expect(getSetting('key')).toBe('second')
  })

  it('printer events', () => {
    recordPrinterEvent('ZTC-GK420d', 'connected')
    recordPrinterEvent('ZTC-GK420d', 'disconnected', 'USB unplugged')

    const events = getPrinterEvents(10)
    expect(events.length).toBe(2)
    const types = events.map(e => e.event_type)
    expect(types).toContain('connected')
    expect(types).toContain('disconnected')
  })

  it('label size management', () => {
    const current = getLabelSize()
    expect(current.widthDots).toBe(609)
    expect(current.heightDots).toBe(1015)

    const custom = { widthInches: 2, heightInches: 2, widthDots: 406, heightDots: 406, name: '2×2"' }
    setLabelSize(custom)
    expect(getLabelSize().widthDots).toBe(406)

    const recents = getRecentSizes()
    expect(recents.some(s => s.widthDots === 406 && s.heightDots === 406)).toBe(true)
    expect(recents.length).toBeGreaterThanOrEqual(STANDARD_SIZES.length)
  })
})
