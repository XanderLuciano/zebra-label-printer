/**
 * Tests for hot-plug detection.
 *
 * CUPS does not watch USB. It only discovers a missing device when it next tries
 * to print, so a queue happily reports `idle` and `accepting` with the cable
 * unplugged — and `cupsenable` succeeds whether or not any hardware is there, so
 * the old auto-recovery in `isReady()` actively masked a pulled cable.
 *
 * The fix is to enumerate devices (`lpinfo`) and compare against each queue's
 * configured URI (`lpstat -v`). Two properties matter most and are easy to get
 * wrong, so they are covered hard here:
 *
 *   1. A **networked** printer must never be reported unplugged. Its absence from
 *      local device enumeration proves nothing.
 *   2. When enumeration **fails** — no `lpinfo`, or it needs privileges — the
 *      answer must be 'unknown', never 'absent'. Otherwise every printer on such
 *      a host would be declared unplugged.
 */
import { describe, it, expect } from 'vitest'
import { devicePresence } from '../../src/discovery'
import { printerHealth, healthMessage, healthFor } from '../../src/printer-health'
import type { PrinterInfo, PrinterProfile } from '../../src/types'

const GK_URI = 'usb://Zebra%20Technologies/ZTC%20GK420d?serial=38J154200130'
const ZD_URI = 'usb://Zebra%20Technologies/ZTC%20ZD410?serial=D8N201900771'

/** Devices as `lpinfo` would report them, minus the leading class word. */
const ATTACHED = [GK_URI]

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

function profile(overrides: Partial<PrinterProfile> = {}): PrinterProfile {
  return {
    id: 'prn_1',
    name: 'Bench',
    connection: 'server',
    transport: 'cups',
    cupsName: 'ZTC-GK420d',
    labelSize: { widthInches: 2, heightInches: 1, widthDots: 406, heightDots: 203, name: '2×1"' },
    dpi: 203,
    tracking: 'gap',
    isDefault: true,
    ...overrides
  }
}

describe('devicePresence', () => {
  it('reports a device that is enumerated as present', () => {
    expect(devicePresence(GK_URI, ATTACHED)).toBe('present')
  })

  it('reports a USB device missing from enumeration as absent', () => {
    // This is the pulled cable. CUPS may still call the queue idle.
    expect(devicePresence(ZD_URI, ATTACHED)).toBe('absent')
  })

  it('reports absent when nothing at all is attached', () => {
    expect(devicePresence(GK_URI, [])).toBe('absent')
  })

  it('never reports a networked printer as absent', () => {
    // lpinfo only enumerates locally attached devices, so a socket:// or ipp://
    // printer missing from the list says nothing about reachability.
    expect(devicePresence('socket://10.0.0.50:9100', ATTACHED)).toBe('unknown')
    expect(devicePresence('ipp://printer.local/ipp/print', ATTACHED)).toBe('unknown')
    expect(devicePresence('dnssd://Zebra._ipp._tcp.local/', ATTACHED)).toBe('unknown')
  })

  it('returns unknown when enumeration was unavailable', () => {
    // null means "could not ask" — no lpinfo, or it needs privileges. Treating
    // that as absent would declare every printer on the host unplugged.
    expect(devicePresence(GK_URI, null)).toBe('unknown')
    expect(devicePresence(ZD_URI, null)).toBe('unknown')
  })

  it('returns unknown when the queue has no device URI', () => {
    expect(devicePresence(undefined, ATTACHED)).toBe('unknown')
    expect(devicePresence('', ATTACHED)).toBe('unknown')
  })

  it('matches regardless of percent-encoding and case', () => {
    expect(devicePresence('usb://Zebra Technologies/ZTC GK420d?serial=38J154200130', ATTACHED))
      .toBe('present')
    expect(devicePresence(GK_URI.toUpperCase(), ATTACHED)).toBe('present')
  })

  it('matches when one side carries extra query parameters', () => {
    // CUPS stores a queue's URI with parameters enumeration may not report.
    const configured = `${GK_URI}&interface=1`
    expect(devicePresence(configured, ATTACHED)).toBe('present')
  })

  it('tells two printers of the same model apart by serial number', () => {
    // Without the serial these collapse into one device and unplugging either
    // would look like both were still attached.
    expect(devicePresence(GK_URI, [ZD_URI])).toBe('absent')
    expect(devicePresence(ZD_URI, [ZD_URI])).toBe('present')
  })

  it('handles serial and parallel devices, which CUPS spells with one slash', () => {
    expect(devicePresence('serial:/dev/ttyS0?baud=9600', ['serial:/dev/ttyS0?baud=9600'])).toBe('present')
    expect(devicePresence('serial:/dev/ttyS0?baud=9600', [])).toBe('absent')
    expect(devicePresence('parallel:/dev/lp0', ['parallel:/dev/lp0'])).toBe('present')
  })

  it('still treats an unrecognised scheme as unknowable', () => {
    expect(devicePresence('bluetooth://00:11:22:33', ATTACHED)).toBe('unknown')
    expect(devicePresence('no-scheme-at-all', ATTACHED)).toBe('unknown')
  })
})

describe('printerHealth', () => {
  it('is ready when the queue is up and the device is attached', () => {
    expect(printerHealth(info(), true)).toBe('ready')
    expect(printerHealth(info({ status: 'printing' }), true)).toBe('ready')
  })

  it('is unplugged when the device is gone, even if CUPS still says idle', () => {
    // The whole point: presence outranks the queue's own opinion.
    const stale = info({ status: 'idle', accepting: true, presence: 'absent' })
    expect(printerHealth(stale, true)).toBe('unplugged')
  })

  it('is offline when the device is there but CUPS stopped the queue', () => {
    expect(printerHealth(info({ status: 'unavailable' }), true)).toBe('offline')
    expect(printerHealth(info({ accepting: false }), true)).toBe('offline')
  })

  it('distinguishes unplugged from offline', () => {
    // Different problems, different fixes: check the cable vs re-enable the queue.
    expect(printerHealth(info({ status: 'unavailable', presence: 'absent' }), true)).toBe('unplugged')
    expect(printerHealth(info({ status: 'unavailable', presence: 'present' }), true)).toBe('offline')
  })

  it('is missing when CUPS has no such queue', () => {
    expect(printerHealth(undefined, true)).toBe('missing')
  })

  it('is unknown when CUPS could not be consulted at all', () => {
    // Not 'missing': a CUPS outage is not someone deleting a queue.
    expect(printerHealth(undefined, false)).toBe('unknown')
    expect(printerHealth(info(), false)).toBe('unknown')
  })

  it('is ready for a networked printer whose presence is unknowable', () => {
    expect(printerHealth(info({ presence: 'unknown' }), true)).toBe('ready')
  })

  it('explains every verdict', () => {
    for (const health of ['ready', 'unplugged', 'offline', 'missing', 'unknown'] as const) {
      expect(healthMessage(health, info()), health).toMatch(/\w/)
    }
    expect(healthMessage('unplugged', info())).toMatch(/cable/i)
  })
})

describe('healthFor', () => {
  it('pairs each configured printer with what discovery found', () => {
    const states = healthFor(
      [profile(), profile({ id: 'prn_2', name: 'Shipping', cupsName: 'ZTC-ZD410' })],
      [info(), info({ name: 'ZTC-ZD410', uri: ZD_URI, presence: 'absent' })]
    )

    expect(states.map(s => [s.name, s.health])).toEqual([
      ['Bench', 'ready'],
      ['Shipping', 'unplugged']
    ])
  })

  it('marks a printer missing when its queue is gone', () => {
    const [state] = healthFor([profile({ cupsName: 'deleted-queue' })], [info()])
    expect(state!.health).toBe('missing')
  })

  it('reports unknown for every printer when discovery failed', () => {
    const states = healthFor([profile(), profile({ id: 'prn_2', cupsName: 'ZTC-ZD410' })], null)
    expect(states.every(s => s.health === 'unknown')).toBe(true)
    expect(states.every(s => s.presence === 'unknown')).toBe(true)
  })

  it('carries the printer id through, so events can be attributed', () => {
    const [state] = healthFor([profile({ id: 'prn_abc' })], [info()])
    expect(state!.printerId).toBe('prn_abc')
  })
})
