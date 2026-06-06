/**
 * Drizzle ORM schema — single source of truth for database structure.
 *
 * This schema defines all tables and their columns. Types are inferred
 * automatically. To add a migration, modify this file and run:
 *
 *   npx drizzle-kit generate
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'
import { JOB_STATUSES, JOB_TYPES, LOG_LEVELS, PRINTER_EVENT_TYPES } from '../constants'

// ─── Print Jobs ──────────────────────────────────────────────────────────────

export const printJobs = sqliteTable('print_jobs', {
  id: text('id').primaryKey(),
  status: text('status', { enum: JOB_STATUSES }).notNull().default('pending'),
  jobType: text('job_type', { enum: JOB_TYPES }).notNull(),
  requestData: text('request_data').notNull(),       // JSON: the original request body
  zplCommands: text('zpl_commands'),                 // Generated ZPL (null until processed)
  printerName: text('printer_name'),                 // Target printer
  cupsJobId: text('cups_job_id'),                    // CUPS job ID after printing
  errorMessage: text('error_message'),               // Error details if failed
  createdAt: text('created_at').notNull().default("(datetime('now'))"),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  priority: integer('priority').notNull().default(0)
}, table => [
  index('idx_print_jobs_status').on(table.status),
  index('idx_print_jobs_created').on(table.createdAt)
])

// ─── Job Logs ────────────────────────────────────────────────────────────────

export const jobLogs = sqliteTable('job_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: text('job_id').notNull().references(() => printJobs.id, { onDelete: 'cascade' }),
  level: text('level', { enum: LOG_LEVELS }).notNull().default('info'),
  message: text('message').notNull(),
  createdAt: text('created_at').notNull().default("(datetime('now'))")
}, table => [
  index('idx_job_logs_job').on(table.jobId)
])

// ─── Settings ────────────────────────────────────────────────────────────────

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default("(datetime('now'))")
})

// ─── Printer Events ──────────────────────────────────────────────────────────

export const printerEvents = sqliteTable('printer_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  printerName: text('printer_name').notNull(),
  eventType: text('event_type', { enum: PRINTER_EVENT_TYPES }).notNull(),
  message: text('message'),
  createdAt: text('created_at').notNull().default("(datetime('now'))")
})

// ─── Migrations ──────────────────────────────────────────────────────────────
// Drizzle-kit manages its own __drizzle_migrations table automatically.
// Migration files live in /drizzle/*.sql and are applied on app startup.
