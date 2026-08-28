/**
 * Tests for routing a print to the right printer at the right size.
 *
 * Two things used to be wrong once more than one printer existed:
 *
 *   1. Label geometry came from one global setting, so a job for the 2×1" printer
 *      could be rendered at whatever size was configured last.
 *   2. The queue held a single printer connection and only ever looked at the head
 *      of the queue, so a job waiting on an offline printer blocked every job
 *      behind it — including ones whose printer was idle.
 *
 * These tests cover the resolution rules and the per-printer queue scan. They use
 * a fake printer source rather than CUPS, so no hardware is involved.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'

// Set test DB path BEFORE importing the database module
const TEST_DB = '/tmp/zebra-test-printer-routing.db'
process.env.ZEBRA_DB_PATH = TEST_DB

import { getDb, getSqlite, closeDb } from '../../src/db/database'
import {
  createPrinterProfile,
  jobLabelSizeFor,
  labelSizeFromDots
} from '../../src/db/printer-repo'
import { getJob, listJobs, updateJobStatus } from '../../src/db/print-job-repo'
import type { JobLabelSize } from '../../src/db/print-job-repo'
import { setLabelSize } from '../../src/db/settings-repo'
import { resolveJobLabelSize, isUnresolved, unresolvedMessage } from '../../src/printer-registry'
import type { ResolvedPrinter, UnresolvedReason } from '../../src/printer-registry'
import { PrintQueue } from '../../src/queue'
import type { QueuePrinterSource } from '../../src/queue'
import type { Printer } from '../../src/printer'
import type { PrinterProfile } from '../../src/types'

const SMALL = labelSizeFromDots(406, 203, 203, '2×1"')
const SHIPPING = labelSizeFromDots(812, 1218, 203, '4×6"')

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
  sqlite.exec('DELETE FROM settings')
  sqlite.exec('DELETE FROM printer_events')
}

/** A `Printer` stand-in that records what it was asked to print. */
function fakePrinter(name: string, options: { ready?: boolean; fails?: boolean } = {}) {
  const printed: string[] = []
  const printer = {
    name,
    isReady: vi.fn(async () => options.ready ?? true),
    print: vi.fn(async (zpl: string) => {
      printed.push(zpl)
      return options.fails
        ? { success: false, error: 'printer on fire' }
        : { success: true, jobId: `cups-${printed.length}` }
    })
  } as unknown as Printer
  return { printer, printed }
}

/**
 * A registry stand-in.
 *
 * Maps profile id → connection, resolving exactly the way PrinterRegistry does,
 * without needing CUPS.
 */
function fakeSource(entries: Array<{ profile: PrinterProfile; printer: Printer | null }>): QueuePrinterSource {
  const byId = new Map(entries.map(e => [e.profile.id, e]))
  const fallback = entries[0]

  const resolve = async (id?: string | null): Promise<ResolvedPrinter | { reason: UnresolvedReason }> => {
    if (typeof id === 'string' && id.startsWith('local_')) return { reason: 'browser-owned' }
    const entry = id ? byId.get(id) : fallback
    if (!entry) return { reason: id ? 'unknown-printer' : 'no-printers' }
    if (!entry.printer) return { reason: 'unavailable' }
    return { profile: entry.profile, printer: entry.printer }
  }

  return {
    resolve,
    resolveForJob: job => resolve(job.printer_id),
    labelSizeFor: (id?: string | null): JobLabelSize | null => {
      const entry = id ? byId.get(id) : fallback
      return entry ? jobLabelSizeFor(entry.profile) : null
    }
  }
}

describe('resolving which label size to render for', () => {
  beforeEach(() => {
    resetDb()
  })

  afterEach(() => {
    try {
      closeDb()
    } catch { /* empty */ }
    cleanDb()
  })

  it("uses the named printer's own configuration", () => {
    const small = createPrinterProfile({ name: 'Small', cupsName: 'small', labelSize: SMALL })
    createPrinterProfile({ name: 'Big', cupsName: 'big', labelSize: SHIPPING })

    expect(resolveJobLabelSize(null, { printerId: small.id }))
      .toEqual({ widthDots: 406, heightDots: 203, dpi: 203 })
  })

  it('is unaffected by another printer being reconfigured', () => {
    const small = createPrinterProfile({ name: 'Small', cupsName: 'small', labelSize: SMALL })
    const big = createPrinterProfile({ name: 'Big', cupsName: 'big', labelSize: SHIPPING })

    // The old global-setting behaviour would have changed both.
    const before = resolveJobLabelSize(null, { printerId: small.id })
    setLabelSize({ widthInches: 4, heightInches: 6, widthDots: 812, heightDots: 1218, name: '4×6"' })
    const after = resolveJobLabelSize(null, { printerId: small.id })

    expect(after).toEqual(before)
    expect(resolveJobLabelSize(null, { printerId: big.id }).widthDots).toBe(812)
  })

  it('prefers an explicit geometry over the saved configuration', () => {
    const printer = createPrinterProfile({ name: 'Small', cupsName: 'small', labelSize: SMALL })

    expect(resolveJobLabelSize(null, {
      printerId: printer.id,
      labelSize: { widthDots: 609, heightDots: 406 }
    })).toEqual({ widthDots: 609, heightDots: 406, dpi: 203 })
  })

  it('takes the DPI from the named printer when the geometry omits it', () => {
    const printer = createPrinterProfile({
      name: 'HiRes',
      cupsName: 'hires',
      labelSize: labelSizeFromDots(1218, 1827, 300),
      dpi: 300
    })

    expect(resolveJobLabelSize(null, {
      printerId: printer.id,
      labelSize: { widthDots: 900, heightDots: 1200 }
    }).dpi).toBe(300)
  })

  it('trusts the geometry a browser sends for its own USB printer', () => {
    // A browser-owned printer's configuration lives in that browser, so this is
    // the only way the server learns its size.
    createPrinterProfile({ name: 'Server', cupsName: 'server', labelSize: SHIPPING })

    expect(resolveJobLabelSize(null, {
      printerId: 'local_usb-0a5f-0080-123',
      labelSize: { widthDots: 406, heightDots: 203 }
    })).toEqual({ widthDots: 406, heightDots: 203, dpi: 203 })
  })

  it('falls back to the default printer when none is named', () => {
    const dflt = createPrinterProfile({ name: 'Default', cupsName: 'dflt', labelSize: SMALL })
    const source = fakeSource([{ profile: dflt, printer: fakePrinter('dflt').printer }])

    expect(resolveJobLabelSize(source, {})).toEqual({ widthDots: 406, heightDots: 203, dpi: 203 })
  })

  it('falls back to the legacy global size when nothing is configured', () => {
    setLabelSize({ widthInches: 3, heightInches: 2, widthDots: 609, heightDots: 406, name: '3×2"' })
    expect(resolveJobLabelSize(null, {})).toEqual({ widthDots: 609, heightDots: 406, dpi: 203 })
  })
})

describe('unresolved printers', () => {
  it('explains every reason a printer could not be resolved', () => {
    const reasons: UnresolvedReason[] = [
      'no-printers', 'unknown-printer', 'browser-owned', 'unsupported', 'unavailable'
    ]
    for (const reason of reasons) {
      expect(unresolvedMessage(reason)).toMatch(/\w/)
    }
  })

  it('distinguishes a resolution from a failure', () => {
    expect(isUnresolved({ reason: 'no-printers' })).toBe(true)
    expect(isUnresolved({ profile: {} as PrinterProfile, printer: {} as Printer })).toBe(false)
  })
})

describe('the print queue with several printers', () => {
  beforeEach(() => {
    resetDb()
  })

  afterEach(() => {
    try {
      closeDb()
    } catch { /* empty */ }
    cleanDb()
  })

  it('records which printer a job is bound for', async () => {
    const profile = createPrinterProfile({ name: 'Small', cupsName: 'small', labelSize: SMALL })
    const { printer } = fakePrinter('small')
    const queue = new PrintQueue(fakeSource([{ profile, printer }]))

    const result = await queue.submit('zpl', { zpl: '^XA^XZ' }, () => '^XA^XZ', { printerId: profile.id })

    const job = getJob(result.jobId)!
    expect(job.printer_id).toBe(profile.id)
    expect(job.printer_name).toBe('Small')
  })

  it("freezes the printer's geometry onto the job", async () => {
    const profile = createPrinterProfile({ name: 'Small', cupsName: 'small', labelSize: SMALL })
    const { printer } = fakePrinter('small')
    const queue = new PrintQueue(fakeSource([{ profile, printer }]))

    const result = await queue.submit('label', { elements: [] }, () => '^XA^XZ', { printerId: profile.id })

    expect(result.labelSize).toEqual({ widthDots: 406, heightDots: 203, dpi: 203 })
    expect(getJob(result.jobId)!.label_width_dots).toBe(406)
  })

  it('renders each job for its own printer, not a shared setting', async () => {
    const small = createPrinterProfile({ name: 'Small', cupsName: 'small', labelSize: SMALL })
    const big = createPrinterProfile({ name: 'Big', cupsName: 'big', labelSize: SHIPPING })
    const source = fakeSource([
      { profile: small, printer: fakePrinter('small').printer },
      { profile: big, printer: fakePrinter('big').printer }
    ])
    const queue = new PrintQueue(source)

    const widths: number[] = []
    const record = (size: JobLabelSize) => {
      widths.push(size.widthDots)
      return '^XA^XZ'
    }

    await queue.submit('label', { elements: [] }, record, { printerId: small.id })
    await queue.submit('label', { elements: [] }, record, { printerId: big.id })

    expect(widths).toEqual([406, 812])
  })

  it('queues a job whose printer cannot be reached', async () => {
    const profile = createPrinterProfile({ name: 'Offline', cupsName: 'offline', labelSize: SMALL })
    const queue = new PrintQueue(fakeSource([{ profile, printer: null }]))

    const result = await queue.submit('zpl', { zpl: '^XA^XZ' }, () => '^XA^XZ', { printerId: profile.id })

    expect(result.queued).toBe(true)
    expect(getJob(result.jobId)!.status).toBe('pending')
  })

  it('does not let a job for an offline printer block the others', async () => {
    const offline = createPrinterProfile({ name: 'Offline', cupsName: 'offline', labelSize: SMALL })
    const online = createPrinterProfile({ name: 'Online', cupsName: 'online', labelSize: SHIPPING })
    const onlinePrinter = fakePrinter('online')

    const queue = new PrintQueue(fakeSource([
      { profile: offline, printer: null },
      { profile: online, printer: onlinePrinter.printer }
    ]))

    // Oldest job first, bound for the printer that is switched off.
    const stuck = await queue.submit('zpl', { zpl: '^XA STUCK ^XZ' }, () => '^XA STUCK ^XZ', { printerId: offline.id })
    const ready = await queue.submit('zpl', { zpl: '^XA READY ^XZ' }, () => '^XA READY ^XZ', { printerId: online.id })

    // The second job printed immediately on submit; drain anything left.
    expect(getJob(ready.jobId)!.status).toBe('completed')
    expect(getJob(stuck.jobId)!.status).toBe('pending')

    // A queued job for the working printer must still go out with the stuck one
    // ahead of it in the queue.
    updateJobStatus(ready.jobId, 'pending')
    expect(await queue.processNext()).toBe(true)

    expect(getJob(ready.jobId)!.status).toBe('completed')
    expect(getJob(stuck.jobId)!.status).toBe('pending')
  })

  it('never prints a job on a printer it was not rendered for', async () => {
    const missing = createPrinterProfile({ name: 'Gone', cupsName: 'gone', labelSize: SMALL })
    const other = createPrinterProfile({ name: 'Other', cupsName: 'other', labelSize: SHIPPING })
    const otherPrinter = fakePrinter('other')

    // 'Gone' resolves to nothing, as if its printer had been deleted.
    const queue = new PrintQueue(fakeSource([
      { profile: other, printer: otherPrinter.printer },
      { profile: missing, printer: null }
    ]))

    const orphan = await queue.submit('zpl', { zpl: '^XA ORPHAN ^XZ' }, () => '^XA ORPHAN ^XZ', { printerId: missing.id })
    expect(getJob(orphan.jobId)!.status).toBe('pending')

    // Reassigning it to the working printer would put a 2×1" label on 4×6" stock.
    expect(await queue.processNext()).toBe(false)
    expect(otherPrinter.printed).toHaveLength(0)
    expect(getJob(orphan.jobId)!.status).toBe('pending')
  })

  it('rebuilds a queued job at the size it was rendered for', async () => {
    const profile = createPrinterProfile({ name: 'Small', cupsName: 'small', labelSize: SMALL })
    const offlineSource = fakeSource([{ profile, printer: null }])
    const queued = await new PrintQueue(offlineSource)
      .submit('text', { lines: ['hello'] }, () => '^XA^XZ', { printerId: profile.id })

    // The printer comes back, but on different stock than the job was made for.
    const { printer, printed } = fakePrinter('small')
    createPrinterProfile({ name: 'Ignored', cupsName: 'ignored', labelSize: SHIPPING })
    const queue = new PrintQueue(fakeSource([{ profile, printer }]))

    expect(await queue.processNext()).toBe(true)
    expect(getJob(queued.jobId)!.status).toBe('completed')
    // Rebuilt from the frozen 406-dot snapshot, not the 812-dot printer.
    expect(printed[0]).toContain('^PW406')
  })

  it('hands a browser-owned job back as ZPL instead of printing it', () => {
    const profile = createPrinterProfile({ name: 'Server', cupsName: 'server', labelSize: SHIPPING })
    const { printer, printed } = fakePrinter('server')
    const queue = new PrintQueue(fakeSource([{ profile, printer }]))

    const prepared = queue.prepareExternal('text', { lines: ['x'] }, size => `^XA${size.widthDots}^XZ`, {
      printerId: 'local_usb-0a5f-0080-123',
      printerName: 'Desk GK420d',
      labelSize: { widthDots: 406, heightDots: 203 }
    })

    expect(printed).toHaveLength(0)
    expect(prepared.zpl).toBe('^XA406^XZ')
    expect(prepared.labelSize).toEqual({ widthDots: 406, heightDots: 203, dpi: 203 })

    const job = getJob(prepared.jobId)!
    expect(job.printer_id).toBe('local_usb-0a5f-0080-123')
    expect(job.printer_name).toBe('Desk GK420d')
    // Claimed straight away so the server's processor can't also print it.
    expect(job.status).toBe('printing')
  })

  it('reaps abandoned browser prints across every local printer', () => {
    const profile = createPrinterProfile({ name: 'Server', cupsName: 'server', labelSize: SMALL })
    const queue = new PrintQueue(fakeSource([{ profile, printer: fakePrinter('server').printer }]))

    const first = queue.prepareExternal('text', { lines: ['a'] }, () => '^XA^XZ', {
      printerId: 'local_usb-0a5f-0080-aaa',
      printerName: 'Desk A'
    })
    const second = queue.prepareExternal('text', { lines: ['b'] }, () => '^XA^XZ', {
      printerId: 'local_usb-0a5f-0080-bbb',
      printerName: 'Desk B'
    })

    // Both clients went away mid-transfer.
    getSqlite().exec("UPDATE print_jobs SET started_at = datetime('now', '-600 seconds')")

    expect(queue.reapStaleLocalJobs()).toBe(2)
    expect(getJob(first.jobId)!.status).toBe('failed')
    expect(getJob(second.jobId)!.status).toBe('failed')
  })

  it('leaves server-side jobs out of the local reaper', async () => {
    const profile = createPrinterProfile({ name: 'Server', cupsName: 'server', labelSize: SMALL })
    const queue = new PrintQueue(fakeSource([{ profile, printer: fakePrinter('server').printer }]))

    const result = await queue.submit('zpl', { zpl: '^XA^XZ' }, () => '^XA^XZ', { printerId: profile.id })
    getSqlite().prepare("UPDATE print_jobs SET status = 'printing', started_at = datetime('now', '-600 seconds') WHERE id = ?")
      .run(result.jobId)

    expect(queue.reapStaleLocalJobs()).toBe(0)
    expect(getJob(result.jobId)!.status).toBe('printing')
  })

  it('filters print history by printer', async () => {
    const small = createPrinterProfile({ name: 'Small', cupsName: 'small', labelSize: SMALL })
    const big = createPrinterProfile({ name: 'Big', cupsName: 'big', labelSize: SHIPPING })
    const queue = new PrintQueue(fakeSource([
      { profile: small, printer: fakePrinter('small').printer },
      { profile: big, printer: fakePrinter('big').printer }
    ]))

    await queue.submit('zpl', { zpl: '^XA^XZ' }, () => '^XA^XZ', { printerId: small.id })
    await queue.submit('zpl', { zpl: '^XA^XZ' }, () => '^XA^XZ', { printerId: big.id })
    await queue.submit('zpl', { zpl: '^XA^XZ' }, () => '^XA^XZ', { printerId: big.id })

    expect(listJobs({ printerId: small.id })).toHaveLength(1)
    expect(listJobs({ printerId: big.id })).toHaveLength(2)
  })
})
