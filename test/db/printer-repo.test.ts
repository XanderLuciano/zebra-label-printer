/**
 * Tests for per-printer configuration.
 *
 * Label size, DPI, and media tracking used to be one global setting, which meant
 * a 2×1" printer and a 4×6" printer could not be configured at the same time:
 * whichever was touched last silently redefined the geometry for both. These tests
 * pin down that each printer keeps its own configuration, that adopting discovered
 * printers is idempotent, and that exactly one printer is ever the default.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'

// Set test DB path BEFORE importing the database module
const TEST_DB = '/tmp/zebra-test-printer-repo.db'
process.env.ZEBRA_DB_PATH = TEST_DB

import { getDb, getSqlite, closeDb } from '../../src/db/database'
import {
  adoptDiscoveredPrinters,
  countPrinterProfiles,
  createPrinterProfile,
  deletePrinterProfile,
  getDefaultPrinterProfile,
  getPrinterProfile,
  getPrinterProfileByCupsName,
  isLocalPrinterId,
  jobLabelSizeFor,
  labelSizeFromDots,
  listPrinterProfiles,
  setDefaultPrinterProfile,
  updatePrinterProfile
} from '../../src/db/printer-repo'
import { setLabelSize } from '../../src/db/settings-repo'
import type { PrinterInfo } from '../../src/types'

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

/** A printer as discovery would report it. */
function discovered(name: string, overrides: Partial<PrinterInfo> = {}): PrinterInfo {
  return {
    name,
    uri: `usb://Zebra/${name}`,
    model: `Zebra ${name}`,
    status: 'idle',
    accepting: true,
    isZebra: true,
    ...overrides
  }
}

describe('printer profiles', () => {
  beforeEach(() => {
    resetDb()
  })

  afterEach(() => {
    try {
      closeDb()
    } catch { /* empty */ }
    cleanDb()
  })

  it('creates the printers table via migration', () => {
    const cols = getSqlite().prepare('PRAGMA table_info(printers)').all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining([
      'id', 'name', 'transport', 'cups_name', 'device_uri', 'usb_device_id',
      'label_width_dots', 'label_height_dots', 'label_name', 'dpi', 'tracking',
      'mark_offset', 'is_default'
    ]))
  })

  it('adds printer_id to print_jobs via migration', () => {
    const cols = getSqlite().prepare('PRAGMA table_info(print_jobs)').all() as Array<{ name: string }>
    expect(cols.map(c => c.name)).toContain('printer_id')
  })

  it('stores a full media configuration per printer', () => {
    const printer = createPrinterProfile({
      name: 'Bench',
      cupsName: 'bench',
      labelSize: SMALL,
      dpi: 203,
      tracking: 'mark',
      markOffset: 40
    })

    expect(printer.name).toBe('Bench')
    expect(printer.connection).toBe('server')
    expect(printer.transport).toBe('cups')
    expect(printer.labelSize.widthDots).toBe(406)
    expect(printer.tracking).toBe('mark')
    expect(printer.markOffset).toBe(40)
  })

  it('keeps each printer on its own label stock', () => {
    const small = createPrinterProfile({ name: 'Small', cupsName: 'small', labelSize: SMALL })
    const big = createPrinterProfile({ name: 'Big', cupsName: 'big', labelSize: SHIPPING })

    // The whole point: configuring one must not touch the other.
    updatePrinterProfile(small.id, { labelSize: labelSizeFromDots(609, 406, 203, '3×2"') })

    expect(getPrinterProfile(small.id)!.labelSize.widthDots).toBe(609)
    expect(getPrinterProfile(big.id)!.labelSize.widthDots).toBe(812)
    expect(getPrinterProfile(big.id)!.labelSize.heightDots).toBe(1218)
  })

  it('derives inches from dots and DPI rather than storing them', () => {
    const printer = createPrinterProfile({
      name: 'HiRes',
      cupsName: 'hires',
      labelSize: labelSizeFromDots(1218, 1827, 300, '4×6"'),
      dpi: 300
    })

    expect(printer.labelSize.widthInches).toBe(4.06)
    expect(printer.labelSize.heightInches).toBe(6.09)
  })

  it('reports the same geometry to the job snapshot as it stores', () => {
    const printer = createPrinterProfile({ name: 'Snap', cupsName: 'snap', labelSize: SMALL, dpi: 203 })
    expect(jobLabelSizeFor(printer)).toEqual({ widthDots: 406, heightDots: 203, dpi: 203 })
  })

  it('seeds a new printer from the legacy global label size', () => {
    // Someone upgrading has a global size set; their first printer should keep
    // printing at it rather than silently reverting to the 3×5" default.
    setLabelSize({ widthInches: 4, heightInches: 2, widthDots: 812, heightDots: 406, name: '4×2"' })

    const printer = createPrinterProfile({ name: 'Upgraded', cupsName: 'upgraded' })
    expect(printer.labelSize.widthDots).toBe(812)
    expect(printer.labelSize.heightDots).toBe(406)
  })

  it('rejects a second printer on the same CUPS queue', () => {
    createPrinterProfile({ name: 'First', cupsName: 'shared' })
    expect(() => createPrinterProfile({ name: 'Second', cupsName: 'shared' }))
      .toThrow(/already configured/i)
  })

  it('finds a printer by its CUPS queue name', () => {
    const printer = createPrinterProfile({ name: 'Named', cupsName: 'ZTC-GK420d' })
    expect(getPrinterProfileByCupsName('ZTC-GK420d')?.id).toBe(printer.id)
    expect(getPrinterProfileByCupsName('nope')).toBeNull()
  })

  it('returns null for an unknown printer', () => {
    expect(getPrinterProfile('prn_missing')).toBeNull()
  })

  it('never resolves a browser-owned id against the server registry', () => {
    // Browser printers are stored client-side, so the server has no row for them.
    expect(isLocalPrinterId('local_usb-0a5f-0080-123')).toBe(true)
    expect(isLocalPrinterId('prn_abc')).toBe(false)
    expect(getPrinterProfile('local_usb-0a5f-0080-123')).toBeNull()
  })

  it('re-derives inches when only the DPI changes', () => {
    const printer = createPrinterProfile({
      name: 'Density',
      cupsName: 'density',
      labelSize: labelSizeFromDots(609, 1015, 203, '3×5"'),
      dpi: 203
    })
    expect(printer.labelSize.widthInches).toBe(3)

    // Same dots at 300 DPI is a physically smaller label.
    updatePrinterProfile(printer.id, {
      dpi: 300,
      labelSize: labelSizeFromDots(609, 1015, 300, '3×5"')
    })

    const updated = getPrinterProfile(printer.id)!
    expect(updated.dpi).toBe(300)
    expect(updated.labelSize.widthInches).toBe(2.03)
    expect(updated.labelSize.widthDots).toBe(609)
  })
})

describe('the default printer', () => {
  beforeEach(() => {
    resetDb()
  })

  afterEach(() => {
    try {
      closeDb()
    } catch { /* empty */ }
    cleanDb()
  })

  it('makes the first printer the default so a fresh install can print', () => {
    const first = createPrinterProfile({ name: 'Only', cupsName: 'only' })
    expect(first.isDefault).toBe(true)
    expect(getDefaultPrinterProfile()?.id).toBe(first.id)
  })

  it('does not make later printers the default', () => {
    createPrinterProfile({ name: 'First', cupsName: 'first' })
    const second = createPrinterProfile({ name: 'Second', cupsName: 'second' })
    expect(second.isDefault).toBe(false)
  })

  it('keeps exactly one default when the flag moves', () => {
    const first = createPrinterProfile({ name: 'First', cupsName: 'first' })
    const second = createPrinterProfile({ name: 'Second', cupsName: 'second' })

    expect(setDefaultPrinterProfile(second.id)).toBe(true)

    const defaults = listPrinterProfiles().filter(p => p.isDefault)
    expect(defaults).toHaveLength(1)
    expect(defaults[0]!.id).toBe(second.id)
    expect(getPrinterProfile(first.id)!.isDefault).toBe(false)
  })

  it('clears other defaults when one is created as the default', () => {
    const first = createPrinterProfile({ name: 'First', cupsName: 'first' })
    const second = createPrinterProfile({ name: 'Second', cupsName: 'second', isDefault: true })

    expect(getPrinterProfile(first.id)!.isDefault).toBe(false)
    expect(getDefaultPrinterProfile()?.id).toBe(second.id)
  })

  it('promotes another printer when the default is deleted', () => {
    const first = createPrinterProfile({ name: 'First', cupsName: 'first' })
    createPrinterProfile({ name: 'Second', cupsName: 'second' })

    expect(deletePrinterProfile(first.id)).toBe(true)

    // Leaving the registry with no default would make unrouted prints fail.
    expect(getDefaultPrinterProfile()).not.toBeNull()
    expect(getDefaultPrinterProfile()!.isDefault).toBe(true)
  })

  it('falls back to any printer when no default flag is set', () => {
    const printer = createPrinterProfile({ name: 'Solo', cupsName: 'solo' })
    getSqlite().exec('UPDATE printers SET is_default = 0')
    expect(getDefaultPrinterProfile()?.id).toBe(printer.id)
  })

  it('has no default when nothing is configured', () => {
    expect(getDefaultPrinterProfile()).toBeNull()
    expect(countPrinterProfiles()).toBe(0)
  })

  it('lists the default first', () => {
    createPrinterProfile({ name: 'Alpha', cupsName: 'alpha' })
    const zulu = createPrinterProfile({ name: 'Zulu', cupsName: 'zulu', isDefault: true })
    expect(listPrinterProfiles()[0]!.id).toBe(zulu.id)
  })

  it('reports deleting an unknown printer rather than throwing', () => {
    expect(deletePrinterProfile('prn_missing')).toBe(false)
    expect(setDefaultPrinterProfile('prn_missing')).toBe(false)
  })
})

describe('adopting discovered printers', () => {
  beforeEach(() => {
    resetDb()
  })

  afterEach(() => {
    try {
      closeDb()
    } catch { /* empty */ }
    cleanDb()
  })

  it('registers printers CUPS reports', () => {
    const adopted = adoptDiscoveredPrinters([discovered('ZTC-GK420d'), discovered('ZD410')])

    expect(adopted).toHaveLength(2)
    expect(listPrinterProfiles().map(p => p.cupsName).sort()).toEqual(['ZD410', 'ZTC-GK420d'])
  })

  it('is idempotent, so a restart does not duplicate printers', () => {
    const found = [discovered('ZTC-GK420d')]
    adoptDiscoveredPrinters(found)
    const second = adoptDiscoveredPrinters(found)

    expect(second).toHaveLength(0)
    expect(countPrinterProfiles()).toBe(1)
  })

  it('leaves saved configuration alone on re-adoption', () => {
    // A restart must not reset the label stock someone configured.
    const [printer] = adoptDiscoveredPrinters([discovered('ZTC-GK420d')])
    updatePrinterProfile(printer!.id, { labelSize: SMALL, tracking: 'continuous' })

    adoptDiscoveredPrinters([discovered('ZTC-GK420d')])

    const after = getPrinterProfile(printer!.id)!
    expect(after.labelSize.widthDots).toBe(406)
    expect(after.tracking).toBe('continuous')
  })

  it('uses the discovered model as the printer name', () => {
    const [printer] = adoptDiscoveredPrinters([discovered('q1', { model: 'Zebra GK420d' })])
    expect(printer!.name).toBe('Zebra GK420d')
  })

  it('records the device URI', () => {
    const [printer] = adoptDiscoveredPrinters([discovered('q1', { uri: 'usb://Zebra/GK420d?serial=42' })])
    expect(printer!.deviceUri).toBe('usb://Zebra/GK420d?serial=42')
  })

  it('adopts non-Zebra printers too', () => {
    const adopted = adoptDiscoveredPrinters([discovered('OfficeJet', { isZebra: false, model: 'HP OfficeJet' })])
    expect(adopted).toHaveLength(1)
  })

  it('skips entries with no name', () => {
    expect(adoptDiscoveredPrinters([discovered('')])).toHaveLength(0)
  })

  it('handles an empty discovery result', () => {
    expect(adoptDiscoveredPrinters([])).toHaveLength(0)
    expect(countPrinterProfiles()).toBe(0)
  })
})
