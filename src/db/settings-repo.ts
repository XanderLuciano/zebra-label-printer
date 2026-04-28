/**
 * Settings repository — key/value config store backed by SQLite.
 */

import { getDb } from './database';

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

/** Get a setting value (returns default if not set) */
export function getSetting(key: string, defaultValue?: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? defaultValue ?? null;
}

/** Get a setting as a number */
export function getNumberSetting(key: string, defaultValue: number): number {
  const val = getSetting(key);
  if (val === null) return defaultValue;
  const n = Number(val);
  return Number.isNaN(n) ? defaultValue : n;
}

/** Get a setting as a boolean */
export function getBoolSetting(key: string, defaultValue: boolean): boolean {
  const val = getSetting(key);
  if (val === null) return defaultValue;
  return val === 'true' || val === '1';
}

/** Get a setting as parsed JSON */
export function getJsonSetting<T>(key: string, defaultValue: T): T {
  const val = getSetting(key);
  if (val === null) return defaultValue;
  try {
    return JSON.parse(val) as T;
  } catch {
    return defaultValue;
  }
}

/** Set a setting value */
export function setSetting(key: string, value: string | number | boolean | object): void {
  const db = getDb();
  const val = typeof value === 'object' ? JSON.stringify(value) : String(value);
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, val);
}

/** Get all settings as a record */
export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings ORDER BY key').all() as SettingRow[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

/** Delete a setting */
export function deleteSetting(key: string): void {
  const db = getDb();
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

// ─── Printer events ──────────────────────────────────────────────────────────

export type PrinterEventType = 'connected' | 'disconnected' | 'error' | 'recovered';

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
  message?: string,
): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO printer_events (printer_name, event_type, message) VALUES (?, ?, ?)',
  ).run(printerName, eventType, message ?? null);
}

/** Get recent printer events */
export function getPrinterEvents(limit = 50): PrinterEvent[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM printer_events ORDER BY created_at DESC LIMIT ?')
    .all(limit) as PrinterEvent[];
}
