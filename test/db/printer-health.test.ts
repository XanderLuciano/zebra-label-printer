/**
 * Tests for the printer health monitor.
 *
 * Before this existed, nothing watched printer connectivity: the queue processor
 * only checks a printer when there is work for it, so an idle server never
 * noticed a cable being pulled, and `printer_events` was really a print-failure
 * log rather than a connectivity history.
 *
 * The behaviour that matters is that events mark *transitions* — one row when a
 * printer goes away and one when it comes back, not one per poll — and that a
 * healthy restart stays silent so the log doesn't fill with noise.
 *
 * Discovery is mocked so no CUPS or hardware is involved.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'

// Set test DB path BEFORE importing the database module
const TEST_DB = '/tmp/zebra-test-printer-health.db'
process.env.ZEBRA_DB_PATH = TEST_DB

import type { PrinterInfo } from '../../src/types'

/**
 * What the mocked discovery returns. Reassign to simulate hot-plug.
 *
 * `null` stands for CUPS not answering, which it signals with
 * `cupsAvailable: false` rather than an empty list — the two are different, and
 * conflating them made a `cupsd` restart look like every queue being deleted.
 */
let discovered: PrinterInfo[] | null = []

vi.mock('../../src/discovery', () => ({
  discoverPrintersDetailed: async () => (
    discovered === null
      ? { printers: [], cupsAvailable: false }
      : { printers: discovered, cupsAvailable: true }
  ),
  discoverPrinters: async () => discovered ?? []
}))

import { getDb, getSqlite, closeDb } from '../../src/db/database'
import { createPrinterProfile, deletePrinterProfile } from '../../src/db/printer-repo'
import { getPrinterEvents } from '../../src/db/settings-repo'
import { PrinterHealthMonitor } from '../../src/printer-health'

const GK_URI = 'usb://Zebra%20Technologies/ZTC%20GK420d?serial=38J154200130'

function info(overrides: Partial<PrinterInfo> = {}): PrinterInfo {
  return {
    name: 'ZTC-GK420d',
    uri: GK_URI,
    model: 'Zebra Technologies GK420d',
    status: 'idle',
    accepting: true,
    isZebra: true,
    presence: 'present',
    ...overrides
  }
}

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
  sqlite.exec('DELETE FROM printer_events')
  sqlite.exec('DELETE FROM settings')
}

/**
 * Event types for one printer, oldest first.
 *
 * Sorted by id rather than reversing the list: `created_at` only has one-second
 * resolution, so an unplug and the reconnect after it can share a timestamp.
 */
function events(printerName = 'ZTC-GK420d') {
  return getPrinterEvents(50)
    .filter(e => e.printer_name === printerName)
    .sort((a, b) => a.id - b.id)
    .map(e => e.event_type)
}

describe('printer health monitor', () => {
  beforeEach(() => {
    resetDb()
    discovered = [info()]
    createPrinterProfile({ name: 'Bench', cupsName: 'ZTC-GK420d' })
  })

  afterEach(() => {
    try {
      closeDb()
    } catch { /* empty */ }
    cleanDb()
  })

  it('reports a healthy printer as ready', async () => {
    const monitor = new PrinterHealthMonitor()
    const [state] = await monitor.check()

    expect(state!.health).toBe('ready')
    expect(state!.presence).toBe('present')
  })

  it('stays silent when a healthy printer is seen for the first time', async () => {
    // Otherwise every server restart would write an event per printer.
    await new PrinterHealthMonitor().check()
    expect(events()).toEqual([])
  })

  it('logs a disconnect when the device goes away', async () => {
    const monitor = new PrinterHealthMonitor()
    await monitor.check()

    discovered = [info({ presence: 'absent' })]
    const [state] = await monitor.check()

    expect(state!.health).toBe('unplugged')
    expect(events()).toEqual(['disconnected'])
  })

  it('notices the unplug even though CUPS still calls the queue idle', async () => {
    const monitor = new PrinterHealthMonitor()
    await monitor.check()

    // The exact failure mode: CUPS has not tried to print, so its queue state is
    // still 'idle' and accepting. Only device presence reveals the truth.
    discovered = [info({ status: 'idle', accepting: true, presence: 'absent' })]
    const [state] = await monitor.check()

    expect(state!.status).toBe('idle')
    expect(state!.accepting).toBe(true)
    expect(state!.health).toBe('unplugged')
    expect(events()).toEqual(['disconnected'])
  })

  it('does not repeat the event while the printer stays unplugged', async () => {
    const monitor = new PrinterHealthMonitor()
    await monitor.check()

    discovered = [info({ presence: 'absent' })]
    await monitor.check()
    await monitor.check()
    await monitor.check()

    expect(events()).toEqual(['disconnected'])
  })

  it('logs a reconnect when the device comes back', async () => {
    const monitor = new PrinterHealthMonitor()
    await monitor.check()

    discovered = [info({ presence: 'absent' })]
    await monitor.check()

    discovered = [info()]
    const [state] = await monitor.check()

    expect(state!.health).toBe('ready')
    expect(events()).toEqual(['disconnected', 'connected'])
  })

  it('records a full unplug/replug cycle as two events', async () => {
    const monitor = new PrinterHealthMonitor()
    await monitor.check()

    for (let i = 0; i < 2; i++) {
      discovered = [info({ presence: 'absent' })]
      await monitor.check()
      discovered = [info()]
      await monitor.check()
    }

    expect(events()).toEqual(['disconnected', 'connected', 'disconnected', 'connected'])
  })

  it('separates a stopped queue from an unplugged cable', async () => {
    const monitor = new PrinterHealthMonitor()
    await monitor.check()

    // Device still attached, but CUPS stopped the queue: an error, not a disconnect.
    discovered = [info({ status: 'unavailable', presence: 'present' })]
    const [stopped] = await monitor.check()
    expect(stopped!.health).toBe('offline')
    expect(events()).toEqual(['error'])

    discovered = [info()]
    const [recovered] = await monitor.check()
    expect(recovered!.health).toBe('ready')
    expect(events()).toEqual(['error', 'recovered'])
  })

  it('logs a disconnect when the CUPS queue itself disappears', async () => {
    const monitor = new PrinterHealthMonitor()
    await monitor.check()

    discovered = []
    const [state] = await monitor.check()

    expect(state!.health).toBe('missing')
    expect(events()).toEqual(['disconnected'])
  })

  it('reports an already-broken printer at startup, and says so', async () => {
    // A healthy first sighting is silent, but a broken one is worth recording.
    discovered = [info({ presence: 'absent' })]
    const monitor = new PrinterHealthMonitor()
    await monitor.check()

    const [event] = getPrinterEvents(5)
    expect(event!.event_type).toBe('disconnected')
    expect(event!.message).toMatch(/startup/i)
  })

  it('logs nothing when CUPS cannot be reached', async () => {
    const monitor = new PrinterHealthMonitor()
    await monitor.check()

    discovered = null
    const [state] = await monitor.check()

    // A CUPS outage is not a printer disconnect, and would otherwise log an event
    // for every printer every time it flapped.
    expect(state!.health).toBe('unknown')
    expect(events()).toEqual([])
  })

  it('does not mistake a CUPS outage for every queue being deleted', async () => {
    // Regression: discoverPrinters() returns [] both when CUPS reports no
    // printers and when it fails to answer. Reading the empty list as truth made
    // every configured printer look 'missing', logging a disconnect for each one
    // on every hiccup — and a matching reconnect afterwards.
    createPrinterProfile({ name: 'Shipping', cupsName: 'ZTC-ZD410' })
    discovered = [info(), info({ name: 'ZTC-ZD410' })]

    const monitor = new PrinterHealthMonitor()
    await monitor.check()

    discovered = null
    const states = await monitor.check()
    expect(states.every(s => s.health === 'unknown')).toBe(true)

    discovered = [info(), info({ name: 'ZTC-ZD410' })]
    await monitor.check()

    expect(getPrinterEvents(50)).toHaveLength(0)
  })

  it('still detects a real disconnect that happened during a CUPS outage', async () => {
    // The flip side: carrying the last known state forward must not swallow a
    // change that turns out to be real once CUPS answers again.
    const monitor = new PrinterHealthMonitor()
    await monitor.check()

    discovered = null
    await monitor.check()

    discovered = [info({ presence: 'absent' })]
    await monitor.check()

    expect(events()).toEqual(['disconnected'])
  })

  it('does not treat a CUPS outage as a reconnect afterwards', async () => {
    const monitor = new PrinterHealthMonitor()
    await monitor.check()

    discovered = null
    await monitor.check()
    discovered = [info()]
    await monitor.check()

    expect(events()).toEqual([])
  })

  it('exposes the latest observation without polling again', async () => {
    const monitor = new PrinterHealthMonitor()
    const [state] = await monitor.check()

    expect(monitor.snapshot()).toHaveLength(1)
    expect(monitor.get(state!.printerId)?.health).toBe('ready')
    expect(monitor.get('prn_nonexistent')).toBeNull()
  })

  it('timestamps a health change', async () => {
    const monitor = new PrinterHealthMonitor()
    const [before] = await monitor.check()
    expect(before!.changedAt).toBeUndefined()

    discovered = [info({ presence: 'absent' })]
    const [after] = await monitor.check()
    expect(after!.changedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('forgets printers that are no longer configured', async () => {
    const monitor = new PrinterHealthMonitor()
    const [state] = await monitor.check()

    deletePrinterProfile(state!.printerId)
    await monitor.check()

    expect(monitor.snapshot()).toHaveLength(0)
    expect(monitor.get(state!.printerId)).toBeNull()
  })

  it('tracks several printers independently', async () => {
    createPrinterProfile({ name: 'Shipping', cupsName: 'ZTC-ZD410' })
    const zd = info({ name: 'ZTC-ZD410', uri: 'usb://Zebra/ZD410?serial=D8N2' })
    discovered = [info(), zd]

    const monitor = new PrinterHealthMonitor()
    await monitor.check()

    // Unplug only the second one.
    discovered = [info(), { ...zd, presence: 'absent' }]
    const states = await monitor.check()

    const byName = Object.fromEntries(states.map(s => [s.cupsName, s.health]))
    expect(byName['ZTC-GK420d']).toBe('ready')
    expect(byName['ZTC-ZD410']).toBe('unplugged')

    expect(events('ZTC-GK420d')).toEqual([])
    expect(events('ZTC-ZD410')).toEqual(['disconnected'])
  })

  it('start() polls immediately and stop() halts it', async () => {
    const monitor = new PrinterHealthMonitor(50)
    monitor.start()

    // The immediate check is fire-and-forget; give it a tick to land.
    await new Promise(r => setTimeout(r, 20))
    expect(monitor.snapshot()).toHaveLength(1)

    monitor.stop()
    const countAfterStop = getPrinterEvents(50).length
    discovered = [info({ presence: 'absent' })]
    await new Promise(r => setTimeout(r, 120))

    // No further polling, so the unplug goes unrecorded.
    expect(getPrinterEvents(50).length).toBe(countAfterStop)
  })
})
