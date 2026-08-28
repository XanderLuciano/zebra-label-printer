/**
 * Printer repository — CRUD for configured server-side printers.
 *
 * Each row is one printer this process can drive, carrying its own media
 * configuration. That per-printer config is the point of this table: label size
 * used to be a single global setting, so a 2×1" printer and a 4×6" printer
 * couldn't be set up at the same time — configuring one silently redefined the
 * geometry for the other, and nothing checked that the printer you were about to
 * print on was actually loaded with that stock.
 *
 * Browser-attached (WebUSB) printers are deliberately *not* stored here. That
 * pairing belongs to one browser profile on one machine, so those printers are
 * kept client-side under the same `PrinterProfile` shape.
 *
 * Naming: `PrinterProfile` is configuration. It is not `PrinterInfo` (a printer
 * discovered from CUPS) or `Printer` (an open connection to one).
 */

import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { getDb } from './database'
import { printers } from './schema'
import { getLabelSize } from './settings-repo'
import type { LabelSize, PrinterInfo, PrinterProfile, PrinterProfileInput } from '../types'
import type { JobLabelSize } from './print-job-repo'
import {
  DEFAULT_DPI,
  DEFAULT_MEDIA_TRACKING,
  DEFAULT_PRINTER_TRANSPORT,
  LOCAL_PRINTER_ID_PREFIX,
  MEDIA_TRACKINGS,
  SERVER_PRINTER_TRANSPORTS
} from '../constants'
import type { MediaTracking } from '../constants'

type PrinterRow = typeof printers.$inferSelect
type ServerTransport = typeof SERVER_PRINTER_TRANSPORTS[number]

function generateId(): string {
  return `prn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** True for printer ids owned by a browser rather than this server. */
export function isLocalPrinterId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(LOCAL_PRINTER_ID_PREFIX)
}

/**
 * Build a full `LabelSize` from dots.
 *
 * Inches are always derived rather than stored, so they cannot drift out of step
 * with the dot dimensions or the printer's DPI.
 */
export function labelSizeFromDots(
  widthDots: number,
  heightDots: number,
  dpi: number,
  name?: string | null
): LabelSize {
  const widthInches = Number((widthDots / dpi).toFixed(2))
  const heightInches = Number((heightDots / dpi).toFixed(2))
  return {
    widthInches,
    heightInches,
    widthDots,
    heightDots,
    name: name || `${widthInches}×${heightInches}"`
  }
}

function toProfile(row: PrinterRow): PrinterProfile {
  return {
    id: row.id,
    name: row.name,
    connection: 'server',
    transport: row.transport,
    cupsName: row.cupsName,
    deviceUri: row.deviceUri,
    usbDeviceId: row.usbDeviceId,
    labelSize: labelSizeFromDots(row.labelWidthDots, row.labelHeightDots, row.dpi, row.labelName),
    dpi: row.dpi,
    tracking: row.tracking,
    markOffset: row.markOffset ?? undefined,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

/** The label geometry to render for when printing on this printer. */
export function jobLabelSizeFor(profile: PrinterProfile): JobLabelSize {
  return {
    widthDots: profile.labelSize.widthDots,
    heightDots: profile.labelSize.heightDots,
    dpi: profile.dpi
  }
}

function normalizeTransport(value: unknown): ServerTransport {
  return SERVER_PRINTER_TRANSPORTS.includes(value as ServerTransport)
    ? value as ServerTransport
    : DEFAULT_PRINTER_TRANSPORT as ServerTransport
}

function normalizeTracking(value: unknown): MediaTracking {
  return MEDIA_TRACKINGS.includes(value as MediaTracking)
    ? value as MediaTracking
    : DEFAULT_MEDIA_TRACKING
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** All configured server printers, default first, then by name. */
export function listPrinterProfiles(): PrinterProfile[] {
  const db = getDb()
  const rows = db.select().from(printers).orderBy(asc(printers.name)).all()
  const profiles = rows.map(toProfile)
  return profiles.sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
}

/** One printer by id, or null. Local (`local_…`) ids never match. */
export function getPrinterProfile(id: string): PrinterProfile | null {
  if (!id || isLocalPrinterId(id)) return null
  const db = getDb()
  const row = db.select().from(printers).where(eq(printers.id, id)).get()
  return row ? toProfile(row) : null
}

/** Look up a printer by its CUPS queue name. */
export function getPrinterProfileByCupsName(cupsName: string): PrinterProfile | null {
  if (!cupsName) return null
  const db = getDb()
  const row = db.select().from(printers).where(eq(printers.cupsName, cupsName)).get()
  return row ? toProfile(row) : null
}

/**
 * The printer to use when a request doesn't name one.
 *
 * Falls back to the oldest configured printer, so a registry with rows always
 * resolves to something rather than refusing to print.
 */
export function getDefaultPrinterProfile(): PrinterProfile | null {
  const db = getDb()
  const preferred = db.select().from(printers).where(eq(printers.isDefault, true)).get()
  if (preferred) return toProfile(preferred)

  const oldest = db.select().from(printers).orderBy(asc(printers.createdAt)).get()
  return oldest ? toProfile(oldest) : null
}

/** Number of configured server printers. */
export function countPrinterProfiles(): number {
  const db = getDb()
  return db.select().from(printers).all().length
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/**
 * Media configuration for a printer being registered for the first time.
 *
 * Seeded from the legacy global label size so an existing install keeps printing
 * at the geometry it was already set to, rather than silently reverting to the
 * 3×5" default the first time the registry is populated.
 */
function defaultMediaConfig(): { labelSize: LabelSize; dpi: number; tracking: MediaTracking } {
  return { labelSize: getLabelSize(), dpi: DEFAULT_DPI, tracking: DEFAULT_MEDIA_TRACKING }
}

/** Register a new server printer. */
export function createPrinterProfile(input: PrinterProfileInput): PrinterProfile {
  const db = getDb()
  const defaults = defaultMediaConfig()

  const cupsName = input.cupsName ?? null
  if (cupsName) {
    const existing = getPrinterProfileByCupsName(cupsName)
    if (existing) {
      throw new Error(`Printer '${cupsName}' is already configured as '${existing.name}'`)
    }
  }

  const id = generateId()
  const dpi = input.dpi ?? defaults.dpi
  const labelSize = input.labelSize ?? defaults.labelSize
  // A new printer is the default when it's the only one, so a fresh install can
  // print without visiting settings first.
  const isDefault = input.isDefault ?? countPrinterProfiles() === 0

  db.insert(printers).values({
    id,
    name: input.name || cupsName || 'Printer',
    transport: normalizeTransport(input.transport),
    cupsName,
    deviceUri: input.deviceUri ?? null,
    usbDeviceId: input.usbDeviceId ?? null,
    labelWidthDots: labelSize.widthDots,
    labelHeightDots: labelSize.heightDots,
    labelName: labelSize.name ?? null,
    dpi,
    tracking: normalizeTracking(input.tracking ?? defaults.tracking),
    markOffset: input.markOffset ?? null,
    isDefault
  }).run()

  if (isDefault) clearOtherDefaults(id)

  return getPrinterProfile(id)!
}

/** Update a printer's identity or media configuration. Returns null if unknown. */
export function updatePrinterProfile(id: string, input: PrinterProfileInput): PrinterProfile | null {
  const existing = getPrinterProfile(id)
  if (!existing) return null

  const db = getDb()
  const updates: Record<string, unknown> = { updatedAt: sql`datetime('now')` }

  if (input.name !== undefined) updates.name = input.name
  if (input.transport !== undefined) updates.transport = normalizeTransport(input.transport)
  if (input.cupsName !== undefined) updates.cupsName = input.cupsName
  if (input.deviceUri !== undefined) updates.deviceUri = input.deviceUri
  if (input.usbDeviceId !== undefined) updates.usbDeviceId = input.usbDeviceId
  if (input.dpi !== undefined) updates.dpi = input.dpi
  if (input.tracking !== undefined) updates.tracking = normalizeTracking(input.tracking)
  if (input.markOffset !== undefined) updates.markOffset = input.markOffset

  if (input.labelSize) {
    updates.labelWidthDots = input.labelSize.widthDots
    updates.labelHeightDots = input.labelSize.heightDots
    updates.labelName = input.labelSize.name ?? null
  }

  if (input.isDefault === true) updates.isDefault = true

  db.update(printers).set(updates).where(eq(printers.id, id)).run()

  if (input.isDefault === true) clearOtherDefaults(id)

  return getPrinterProfile(id)
}

/**
 * Remove a printer. Its print history is kept — jobs record `printer_id` as a
 * plain string precisely so deleting a printer doesn't delete what it printed.
 */
export function deletePrinterProfile(id: string): boolean {
  const existing = getPrinterProfile(id)
  if (!existing) return false

  const db = getDb()
  db.delete(printers).where(eq(printers.id, id)).run()

  // Don't leave the registry without a default.
  if (existing.isDefault) {
    const next = db.select().from(printers).orderBy(asc(printers.createdAt)).get()
    if (next) {
      db.update(printers).set({ isDefault: true }).where(eq(printers.id, next.id)).run()
    }
  }

  return true
}

/** Make this printer the default, clearing the flag on every other row. */
export function setDefaultPrinterProfile(id: string): boolean {
  const db = getDb()
  const result = db.update(printers).set({ isDefault: true, updatedAt: sql`datetime('now')` })
    .where(eq(printers.id, id)).run()
  if (result.changes === 0) return false
  clearOtherDefaults(id)
  return true
}

function clearOtherDefaults(keepId: string): void {
  const db = getDb()
  db.update(printers)
    .set({ isDefault: false })
    .where(and(ne(printers.id, keepId), eq(printers.isDefault, true)))
    .run()
}

/**
 * Register any discovered CUPS printers that aren't in the registry yet.
 *
 * Run at startup so an existing install finds its printer already configured
 * instead of an empty dropdown. Printers already registered are left alone —
 * their saved media config is the whole point and must survive a restart.
 *
 * @returns the profiles that were newly created.
 */
export function adoptDiscoveredPrinters(discovered: PrinterInfo[]): PrinterProfile[] {
  const created: PrinterProfile[] = []

  for (const info of discovered) {
    if (!info.name || getPrinterProfileByCupsName(info.name)) continue
    try {
      created.push(createPrinterProfile({
        name: info.model || info.name,
        transport: 'cups',
        cupsName: info.name,
        deviceUri: info.uri || null,
        // Prefer a Zebra as the default when nothing is set yet.
        isDefault: info.isZebra && getDefaultPrinterProfile() === null ? true : undefined
      }))
    } catch {
      // Raced with another adopt, or a unique-index clash. Not worth failing
      // startup over — the printer is registered either way.
    }
  }

  return created
}
