/**
 * Drizzle ORM schema — single source of truth for database structure.
 *
 * This schema defines all tables and their columns. Types are inferred
 * automatically. To add a migration, modify this file and run:
 *
 *   npx drizzle-kit generate
 */

import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import {
  JOB_STATUSES,
  JOB_TYPES,
  LOG_LEVELS,
  PRINTER_EVENT_TYPES,
  MEDIA_TRACKINGS,
  SERVER_PRINTER_TRANSPORTS,
  DEFAULT_DPI,
  DEFAULT_MEDIA_TRACKING,
  DEFAULT_LABEL_WIDTH_DOTS,
  DEFAULT_LABEL_HEIGHT_DOTS
} from '../constants'

// ─── Print Jobs ──────────────────────────────────────────────────────────────

export const printJobs = sqliteTable('print_jobs', {
  id: text('id').primaryKey(),
  status: text('status', { enum: JOB_STATUSES }).notNull().default('pending'),
  jobType: text('job_type', { enum: JOB_TYPES }).notNull(),
  requestData: text('request_data').notNull(),       // JSON: the original request body
  zplCommands: text('zpl_commands'),                 // Generated ZPL (null until processed)
  printerName: text('printer_name'),                 // Target printer, for display
  // Which configured printer this job was routed to. Deliberately not a foreign
  // key: browser-owned printers are stored client-side (ids prefixed `local_`),
  // so the server has no row to reference, and deleting a printer must not take
  // its print history with it.
  printerId: text('printer_id'),
  cupsJobId: text('cups_job_id'),                    // CUPS job ID after printing
  errorMessage: text('error_message'),               // Error details if failed
  // Label geometry snapshot, captured when the job is created. Print history
  // must show the label this job was actually printed on, so these are frozen
  // here rather than read back from the (mutable) label_size setting.
  // Nullable: rows created before this column existed have no snapshot.
  labelWidthDots: integer('label_width_dots'),
  labelHeightDots: integer('label_height_dots'),
  labelDpi: integer('label_dpi'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  priority: integer('priority').notNull().default(0)
}, table => [
  index('idx_print_jobs_status').on(table.status),
  index('idx_print_jobs_created').on(table.createdAt),
  // The queue processor scans pending work per printer, so an offline printer
  // doesn't hold up the others.
  index('idx_print_jobs_printer').on(table.printerId)
])

// ─── Job Logs ────────────────────────────────────────────────────────────────

export const jobLogs = sqliteTable('job_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: text('job_id').notNull().references(() => printJobs.id, { onDelete: 'cascade' }),
  level: text('level', { enum: LOG_LEVELS }).notNull().default('info'),
  message: text('message').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
}, table => [
  index('idx_job_logs_job').on(table.jobId)
])

// ─── Settings ────────────────────────────────────────────────────────────────

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`)
})

// ─── Label Templates ─────────────────────────────────────────────────────────

export const labelTemplates = sqliteTable('label_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  data: text('data').notNull(),                      // JSON: full template definition
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`)
}, table => [
  index('idx_label_templates_name').on(table.name)
])

// ─── Printers ────────────────────────────────────────────────────────────────
//
// One row per printer this *server* can drive. Media configuration lives here
// rather than in `settings` because a global label size can only ever describe
// one printer: with a 2×1" printer and a 4×6" printer set up at the same time,
// whichever was configured last silently decided the geometry for both.
//
// Browser-attached printers are not in this table. The WebUSB pairing belongs to
// one browser profile on one machine and can't be shared, so those profiles are
// stored client-side under the same shape (see web/app/composables/usePrinters).
//
// Label dimensions are stored in dots only; inches are derived from `dpi` so the
// two can't drift apart.

export const printers = sqliteTable('printers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  transport: text('transport', { enum: SERVER_PRINTER_TRANSPORTS })
    .notNull().default('cups'),
  /** CUPS queue name — the handle `lp -d` needs */
  cupsName: text('cups_name'),
  /** CUPS device URI, or host:port for a networked printer */
  deviceUri: text('device_uri'),
  /** USB identity, for direct-USB transports */
  usbDeviceId: text('usb_device_id'),
  labelWidthDots: integer('label_width_dots').notNull().default(DEFAULT_LABEL_WIDTH_DOTS),
  labelHeightDots: integer('label_height_dots').notNull().default(DEFAULT_LABEL_HEIGHT_DOTS),
  /** Human-readable size name, e.g. '3×5" (large)' */
  labelName: text('label_name'),
  dpi: integer('dpi').notNull().default(DEFAULT_DPI),
  tracking: text('tracking', { enum: MEDIA_TRACKINGS }).notNull().default(DEFAULT_MEDIA_TRACKING),
  markOffset: integer('mark_offset'),
  /** Printer used when a request doesn't name one. At most one row is set. */
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  // sql`` rather than a plain string: `.default("(datetime('now'))")` makes
  // drizzle-kit emit a quoted SQL *literal*, so the column ends up holding the
  // text "(datetime('now'))" instead of a timestamp. The older tables in this
  // schema still have that defect.
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`)
}, table => [
  // Adopting a discovered printer twice would otherwise create duplicate rows
  // pointing at the same CUPS queue. SQLite treats NULLs as distinct, so
  // non-CUPS printers are unaffected.
  uniqueIndex('idx_printers_cups_name').on(table.cupsName),
  index('idx_printers_default').on(table.isDefault)
])

// ─── Printer Events ──────────────────────────────────────────────────────────

export const printerEvents = sqliteTable('printer_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  printerName: text('printer_name').notNull(),
  eventType: text('event_type', { enum: PRINTER_EVENT_TYPES }).notNull(),
  message: text('message'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
})

// ─── Migrations ──────────────────────────────────────────────────────────────
// Drizzle-kit manages its own __drizzle_migrations table automatically.
// Migration files live in /drizzle/*.sql and are applied on app startup.
