/**
 * Settings repository — key/value config store backed by Drizzle ORM.
 */

import { eq, sql, desc } from 'drizzle-orm'
import { getDb } from './database'
import { settings, printerEvents } from './schema'
import type { PrinterEventType } from '../constants'
import { DEFAULT_EVENT_LIMIT, MAX_RECENT_SIZES } from '../constants'
import type { LabelSize } from '../types'

export type { PrinterEventType }

/** Get a setting value (returns default if not set) */
export function getSetting(key: string, defaultValue?: string): string | null {
  const db = getDb()
  const row = db.select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .get()
  return row?.value ?? defaultValue ?? null
}

/** Get a setting as a number */
export function getNumberSetting(key: string, defaultValue: number): number {
  const val = getSetting(key)
  if (val === null) return defaultValue
  const n = Number(val)
  return Number.isNaN(n) ? defaultValue : n
}

/** Get a setting as a boolean */
export function getBoolSetting(key: string, defaultValue: boolean): boolean {
  const val = getSetting(key)
  if (val === null) return defaultValue
  return val === 'true' || val === '1'
}

/** Get a setting as parsed JSON */
export function getJsonSetting<T>(key: string, defaultValue: T): T {
  const val = getSetting(key)
  if (val === null) return defaultValue
  try {
    return JSON.parse(val) as T
  } catch {
    return defaultValue
  }
}

/** Set a setting value */
export function setSetting(key: string, value: string | number | boolean | object): void {
  const db = getDb()
  const val = typeof value === 'object' ? JSON.stringify(value) : String(value)

  db.insert(settings)
    .values({ key, value: val })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: val,
        updatedAt: sql`datetime('now')`
      }
    })
    .run()
}

/** Get all settings as a record */
export function getAllSettings(): Record<string, string> {
  const db = getDb()
  const rows = db.select().from(settings).all()
  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row.key] = row.value
  }
  return result
}

/** Delete a setting */
export function deleteSetting(key: string): void {
  const db = getDb()
  db.delete(settings).where(eq(settings.key, key)).run()
}

// ─── Printer events ──────────────────────────────────────────────────────────

export interface PrinterEvent {
  id: number;
  printer_name: string;
  event_type: PrinterEventType;
  message: string | null;
  created_at: string;
}

/** Record a printer connectivity event */
export function recordPrinterEvent(
  printerName: string,
  eventType: PrinterEventType,
  message?: string
): void {
  const db = getDb()
  db.insert(printerEvents).values({
    printerName,
    eventType,
    message: message ?? null
  }).run()
}

/** Get recent printer events */
export function getPrinterEvents(limit = DEFAULT_EVENT_LIMIT): PrinterEvent[] {
  const db = getDb()
  const rows = db.select()
    .from(printerEvents)
    .orderBy(desc(printerEvents.createdAt))
    .limit(limit)
    .all()

  return rows.map(row => ({
    id: row.id,
    printer_name: row.printerName,
    event_type: row.eventType as PrinterEventType,
    message: row.message,
    created_at: row.createdAt
  }))
}

// ─── Label size management ───────────────────────────────────────────────────

/** Predefined label sizes (inches → dots at 203 DPI) */
export const STANDARD_SIZES: LabelSize[] = [
  { widthInches: 2, heightInches: 1, widthDots: 406, heightDots: 203, name: '2×1" (small)' },
  { widthInches: 3, heightInches: 1, widthDots: 609, heightDots: 203, name: '3×1" (narrow)' },
  { widthInches: 3, heightInches: 2, widthDots: 609, heightDots: 406, name: '3×2" (standard)' },
  { widthInches: 3, heightInches: 5, widthDots: 609, heightDots: 1015, name: '3×5" (large)' },
  { widthInches: 4, heightInches: 6, widthDots: 812, heightDots: 1218, name: '4×6" (shipping)' },
  { widthInches: 4, heightInches: 2, widthDots: 812, heightDots: 406, name: '4×2" (wide)' }
]

/** Get the current label size */
export function getLabelSize(): LabelSize {
  const saved = getJsonSetting<LabelSize | null>('label_size', null)
  if (saved) return saved

  // Default: 3×5"
  return STANDARD_SIZES[3]
}

/** Set the current label size */
export function setLabelSize(size: LabelSize): void {
  setSetting('label_size', size)
  addRecentSize(size)
}

/** Get recently used label sizes */
export function getRecentSizes(): LabelSize[] {
  const recents = getJsonSetting<LabelSize[]>('recent_label_sizes', [])
  // Merge with standard sizes, deduplicate by dimensions
  const seen = new Set<string>()
  const merged: LabelSize[] = []

  for (const s of [...recents, ...STANDARD_SIZES]) {
    const key = `${s.widthDots}x${s.heightDots}`
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(s)
    }
  }

  return merged
}

/** Add a size to recent list */
function addRecentSize(size: LabelSize): void {
  const recents = getJsonSetting<LabelSize[]>('recent_label_sizes', [])
  const key = `${size.widthDots}x${size.heightDots}`

  // Remove duplicate if exists
  const filtered = recents.filter(s => `${s.widthDots}x${s.heightDots}` !== key)
  // Add to front, keep last 10
  filtered.unshift(size)
  setSetting('recent_label_sizes', filtered.slice(0, MAX_RECENT_SIZES))
}
