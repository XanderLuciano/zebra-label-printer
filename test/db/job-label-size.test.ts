/**
 * Tests for the per-job label size snapshot.
 *
 * Print history is a record of what physically came out of the printer. Reading
 * the current `label_size` setting at display time gets this wrong the moment
 * someone swaps label stock, so each job carries its own frozen copy. These
 * tests cover that the snapshot is written, read back, and — critically —
 * unaffected by later changes to the global setting.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'

// Set test DB path BEFORE importing the database module
const TEST_DB = '/tmp/zebra-test-label-size.db'
process.env.ZEBRA_DB_PATH = TEST_DB

import { getDb, getSqlite, closeDb } from '../../src/db/database'
import {
  createJob,
  getJob,
  listJobs,
  getJobLabelSize,
  claimJob,
  failStalePrintingJobs
} from '../../src/db/print-job-repo'
import { setLabelSize, getLabelSize } from '../../src/db/settings-repo'
import { DEFAULT_DPI, LOCAL_PRINTER_NAME } from '../../src/constants'

const SMALL = { widthDots: 406, heightDots: 203, dpi: 203 }
const LARGE = { widthDots: 812, heightDots: 1218, dpi: 203 }

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
  sqlite.exec('DELETE FROM settings')
  sqlite.exec('DELETE FROM printer_events')
}

describe('Print job label size snapshot', () => {
  beforeEach(() => {
    resetDb()
  })

  afterEach(() => {
    try {
      closeDb()
    } catch { /* empty */ }
    cleanDb()
  })

  it('adds the snapshot columns via migration', () => {
    const cols = getSqlite().prepare('PRAGMA table_info(print_jobs)').all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    expect(names).toContain('label_width_dots')
    expect(names).toContain('label_height_dots')
    expect(names).toContain('label_dpi')
  })

  it('stores the label size given at creation', () => {
    const job = createJob('label', { elements: [] }, undefined, 'P1', SMALL)
    expect(job.label_width_dots).toBe(406)
    expect(job.label_height_dots).toBe(203)
    expect(job.label_dpi).toBe(203)
  })

  it('reads the snapshot back from the database', () => {
    const created = createJob('label', { elements: [] }, undefined, 'P1', LARGE)
    const fetched = getJob(created.id)!
    expect(fetched.label_width_dots).toBe(812)
    expect(fetched.label_height_dots).toBe(1218)
  })

  it('includes the snapshot in job listings, which is what history renders from', () => {
    createJob('label', { elements: [] }, undefined, 'P1', SMALL)
    const [job] = listJobs({ limit: 10 })
    expect(job!.label_width_dots).toBe(406)
    expect(job!.label_height_dots).toBe(203)
  })

  it('leaves the snapshot null when no size is supplied', () => {
    // Mirrors rows created before the columns existed.
    const job = createJob('zpl', { zpl: '^XA^XZ' })
    expect(job.label_width_dots).toBeNull()
    expect(job.label_height_dots).toBeNull()
    expect(job.label_dpi).toBeNull()
  })

  it('does not follow later changes to the global label size', () => {
    // The whole point: print a small label, switch stock, print a large label.
    // The first job must still report the size it was printed on.
    setLabelSize({ widthInches: 2, heightInches: 1, widthDots: 406, heightDots: 203, name: '2×1"' })
    const smallJob = createJob('label', { elements: [] }, undefined, 'P1', SMALL)

    setLabelSize({ widthInches: 4, heightInches: 6, widthDots: 812, heightDots: 1218, name: '4×6"' })
    const largeJob = createJob('label', { elements: [] }, undefined, 'P1', LARGE)

    // And switch back again, the way someone would after a one-off big label.
    setLabelSize({ widthInches: 2, heightInches: 1, widthDots: 406, heightDots: 203, name: '2×1"' })

    expect(getLabelSize().widthDots).toBe(406)

    expect(getJob(smallJob.id)!.label_width_dots).toBe(406)
    expect(getJob(smallJob.id)!.label_height_dots).toBe(203)
    expect(getJob(largeJob.id)!.label_width_dots).toBe(812)
    expect(getJob(largeJob.id)!.label_height_dots).toBe(1218)
  })

  it('getJobLabelSize returns the recorded geometry', () => {
    const job = createJob('label', { elements: [] }, undefined, 'P1', LARGE)
    expect(getJobLabelSize(getJob(job.id)!)).toEqual(LARGE)
  })

  it('getJobLabelSize returns null for jobs without a snapshot', () => {
    const job = createJob('zpl', { zpl: '^XA^XZ' })
    expect(getJobLabelSize(getJob(job.id)!)).toBeNull()
  })

  it('getJobLabelSize falls back to the default DPI when only dimensions were recorded', () => {
    const job = createJob('label', { elements: [] }, undefined, 'P1', SMALL)
    getSqlite().prepare('UPDATE print_jobs SET label_dpi = NULL WHERE id = ?').run(job.id)
    expect(getJobLabelSize(getJob(job.id)!)?.dpi).toBe(DEFAULT_DPI)
  })
})

describe('failStalePrintingJobs', () => {
  beforeEach(() => {
    resetDb()
  })

  afterEach(() => {
    try {
      closeDb()
    } catch { /* empty */ }
    cleanDb()
  })

  /** Claim a job and backdate started_at to simulate an abandoned transfer. */
  function abandonedJob(printerName: string, ageSeconds: number) {
    const job = createJob('label', { elements: [] }, '^XA^XZ', printerName, SMALL)
    claimJob(job.id)
    getSqlite()
      .prepare(`UPDATE print_jobs SET started_at = datetime('now', '-${ageSeconds} seconds') WHERE id = ?`)
      .run(job.id)
    return job
  }

  it('fails local jobs whose client never reported a result', () => {
    const job = abandonedJob(LOCAL_PRINTER_NAME, 120)
    expect(failStalePrintingJobs(LOCAL_PRINTER_NAME, 60)).toBe(1)

    const fetched = getJob(job.id)!
    expect(fetched.status).toBe('failed')
    expect(fetched.error_message).toContain('No result reported')
  })

  it('leaves local jobs alone inside the grace period', () => {
    const job = abandonedJob(LOCAL_PRINTER_NAME, 5)
    expect(failStalePrintingJobs(LOCAL_PRINTER_NAME, 60)).toBe(0)
    expect(getJob(job.id)!.status).toBe('printing')
  })

  it('only touches the named printer, never server jobs', () => {
    // Server-side prints complete in-process, so they must not be reaped.
    const serverJob = abandonedJob('ZTC-GK420d', 600)
    expect(failStalePrintingJobs(LOCAL_PRINTER_NAME, 60)).toBe(0)
    expect(getJob(serverJob.id)!.status).toBe('printing')
  })

  it('ignores jobs that are not in the printing state', () => {
    createJob('label', { elements: [] }, undefined, LOCAL_PRINTER_NAME, SMALL) // stays pending
    expect(failStalePrintingJobs(LOCAL_PRINTER_NAME, 0)).toBe(0)
  })
})
