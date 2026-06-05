/**
 * Print job repository — CRUD for the print_jobs and job_logs tables.
 * Uses Drizzle ORM for type-safe, database-agnostic queries.
 */

import { eq, sql, desc, asc, count, and } from 'drizzle-orm'
import { getDb } from './database'
import { printJobs, jobLogs } from './schema'
import type { JobStatus, JobType, LogLevel } from '../constants'
import { DEFAULT_JOB_LIMIT, MAX_JOB_LIMIT } from '../constants'

export type { JobStatus, JobType }

export interface PrintJob {
  id: string;
  status: JobStatus;
  job_type: JobType;
  request_data: string;   // JSON
  zpl_commands: string | null;
  printer_name: string | null;
  cups_job_id: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  priority: number;
}

export interface JobLogEntry {
  id: number;
  job_id: string;
  level: LogLevel;
  message: string;
  created_at: string;
}

export interface JobStats {
  total: number;
  pending: number;
  printing: number;
  completed: number;
  failed: number;
  cancelled: number;
}

function generateId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** Map a Drizzle row to the PrintJob interface (snake_case for backward compat) */
function toPrintJob(row: typeof printJobs.$inferSelect): PrintJob {
  return {
    id: row.id,
    status: row.status as JobStatus,
    job_type: row.jobType as JobType,
    request_data: row.requestData,
    zpl_commands: row.zplCommands,
    printer_name: row.printerName,
    cups_job_id: row.cupsJobId,
    error_message: row.errorMessage,
    created_at: row.createdAt,
    started_at: row.startedAt,
    completed_at: row.completedAt,
    priority: row.priority
  }
}

/** Map a Drizzle row to the JobLogEntry interface */
function toJobLogEntry(row: typeof jobLogs.$inferSelect): JobLogEntry {
  return {
    id: row.id,
    job_id: row.jobId,
    level: row.level as LogLevel,
    message: row.message,
    created_at: row.createdAt
  }
}

/** Create a new print job (status: pending) */
export function createJob(
  jobType: JobType,
  requestData: unknown,
  zplCommands?: string,
  printerName?: string
): PrintJob {
  const db = getDb()
  const id = generateId()
  const data = JSON.stringify(requestData)

  db.insert(printJobs).values({
    id,
    status: 'pending',
    jobType,
    requestData: data,
    zplCommands: zplCommands ?? null,
    printerName: printerName ?? null,
    priority: 0
  }).run()

  addJobLog(id, 'info', `Job created (${jobType})`)
  return getJob(id)!
}

/** Get a job by ID */
export function getJob(id: string): PrintJob | null {
  const db = getDb()
  const row = db.select().from(printJobs).where(eq(printJobs.id, id)).get()
  return row ? toPrintJob(row) : null
}

/** Update job status */
export function updateJobStatus(
  id: string,
  status: JobStatus,
  extra?: { cupsJobId?: string; errorMessage?: string }
): void {
  const db = getDb()

  // Use Record<string, unknown> for the update set because Drizzle's sql``
  // template returns a SQL token, not a plain string. This avoids double-casting.
  const updates: Record<string, unknown> = { status }

  if (status === 'printing') {
    updates.startedAt = sql`datetime('now')`
  }
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    updates.completedAt = sql`datetime('now')`
  }
  if (extra?.cupsJobId) {
    updates.cupsJobId = extra.cupsJobId
  }
  if (extra?.errorMessage) {
    updates.errorMessage = extra.errorMessage
  }

  db.update(printJobs).set(updates).where(eq(printJobs.id, id)).run()
  addJobLog(id, 'info', `Status → ${status}`)
}

/** Set the ZPL commands for a job */
export function setJobZpl(id: string, zpl: string): void {
  const db = getDb()
  db.update(printJobs).set({ zplCommands: zpl }).where(eq(printJobs.id, id)).run()
}

/** List jobs with optional filters */
export function listJobs(options: {
  status?: JobStatus;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'completed_at' | 'priority';
  orderDir?: 'ASC' | 'DESC';
} = {}): PrintJob[] {
  const db = getDb()
  const limit = Math.min(options.limit ?? DEFAULT_JOB_LIMIT, MAX_JOB_LIMIT)
  const offset = options.offset ?? 0

  // Determine ordering column
  const orderCol = options.orderBy === 'completed_at'
    ? printJobs.completedAt
    : options.orderBy === 'priority'
      ? printJobs.priority
      : printJobs.createdAt

  const orderFn = options.orderDir === 'ASC' ? asc : desc

  // Build conditions array to avoid type-unsafe query reassignment
  const conditions = []
  if (options.status) {
    conditions.push(eq(printJobs.status, options.status))
  }

  const rows = db.select()
    .from(printJobs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(orderFn(orderCol))
    .limit(limit)
    .offset(offset)
    .all()

  return rows.map(toPrintJob)
}

/** Get the next pending job (highest priority, oldest first) */
export function getNextPendingJob(): PrintJob | null {
  const db = getDb()
  const row = db.select()
    .from(printJobs)
    .where(eq(printJobs.status, 'pending'))
    .orderBy(desc(printJobs.priority), asc(printJobs.createdAt))
    .limit(1)
    .get()

  return row ? toPrintJob(row) : null
}

/** Count pending jobs */
export function countPendingJobs(): number {
  const db = getDb()
  const row = db.select({ cnt: count() })
    .from(printJobs)
    .where(eq(printJobs.status, 'pending'))
    .get()
  return row?.cnt ?? 0
}

/** Get job statistics */
export function getJobStats(): JobStats {
  const db = getDb()
  const rows = db.select({
    status: printJobs.status,
    cnt: count()
  })
    .from(printJobs)
    .groupBy(printJobs.status)
    .all()

  return {
    total: rows.reduce((s, r) => s + r.cnt, 0),
    pending: rows.find(r => r.status === 'pending')?.cnt ?? 0,
    printing: rows.find(r => r.status === 'printing')?.cnt ?? 0,
    completed: rows.find(r => r.status === 'completed')?.cnt ?? 0,
    failed: rows.find(r => r.status === 'failed')?.cnt ?? 0,
    cancelled: rows.find(r => r.status === 'cancelled')?.cnt ?? 0
  }
}

/** Add a log entry for a job */
export function addJobLog(
  jobId: string,
  level: LogLevel,
  message: string
): void {
  const db = getDb()
  db.insert(jobLogs).values({ jobId, level, message }).run()
}

/** Get log entries for a job */
export function getJobLogs(jobId: string, limit = 50): JobLogEntry[] {
  const db = getDb()
  const rows = db.select()
    .from(jobLogs)
    .where(eq(jobLogs.jobId, jobId))
    .orderBy(desc(jobLogs.createdAt))
    .limit(limit)
    .all()
  return rows.map(toJobLogEntry)
}

/** Get recent logs (all jobs) */
export function getRecentLogs(limit = 100): JobLogEntry[] {
  const db = getDb()
  const rows = db.select()
    .from(jobLogs)
    .orderBy(desc(jobLogs.createdAt))
    .limit(limit)
    .all()
  return rows.map(toJobLogEntry)
}

/** Delete old completed/cancelled jobs (cleanup) */
export function cleanupOldJobs(olderThanDays = 30): number {
  const db = getDb()
  const result = db.delete(printJobs)
    .where(
      and(
        sql`${printJobs.status} IN ('completed', 'cancelled')`,
        sql`${printJobs.completedAt} < datetime('now', ${`-${olderThanDays} days`})`
      )
    )
    .run()
  return result.changes
}
