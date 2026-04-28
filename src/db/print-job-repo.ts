/**
 * Print job repository — CRUD for the print_jobs and job_logs tables.
 */

import { getDb } from './database';
import type { PrintResult } from '../types';

export type JobStatus = 'pending' | 'printing' | 'completed' | 'failed' | 'cancelled';
export type JobType = 'text' | 'barcode' | 'qr' | 'zpl' | 'label';

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
  level: 'debug' | 'info' | 'warn' | 'error';
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
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Create a new print job (status: pending) */
export function createJob(
  jobType: JobType,
  requestData: unknown,
  zplCommands?: string,
  printerName?: string,
): PrintJob {
  const db = getDb();
  const id = generateId();
  const data = JSON.stringify(requestData);

  db.prepare(`
    INSERT INTO print_jobs (id, status, job_type, request_data, zpl_commands, printer_name, priority)
    VALUES (?, 'pending', ?, ?, ?, ?, 0)
  `).run(id, jobType, data, zplCommands ?? null, printerName ?? null);

  addJobLog(id, 'info', `Job created (${jobType})`);
  return getJob(id)!;
}

/** Get a job by ID */
export function getJob(id: string): PrintJob | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id) as PrintJob) ?? null;
}

/** Update job status */
export function updateJobStatus(
  id: string,
  status: JobStatus,
  extra?: { cupsJobId?: string; errorMessage?: string },
): void {
  const db = getDb();
  const updates: string[] = ['status = ?'];
  const params: unknown[] = [status];

  if (status === 'printing') {
    updates.push('started_at = datetime(\'now\')');
  }
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    updates.push('completed_at = datetime(\'now\')');
  }
  if (extra?.cupsJobId) {
    updates.push('cups_job_id = ?');
    params.push(extra.cupsJobId);
  }
  if (extra?.errorMessage) {
    updates.push('error_message = ?');
    params.push(extra.errorMessage);
  }

  params.unshift(id);
  db.prepare(`UPDATE print_jobs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  addJobLog(id, 'info', `Status → ${status}`);
}

/** Set the ZPL commands for a job */
export function setJobZpl(id: string, zpl: string): void {
  const db = getDb();
  db.prepare('UPDATE print_jobs SET zpl_commands = ? WHERE id = ?').run(zpl, id);
}

/** List jobs with optional filters */
export function listJobs(options: {
  status?: JobStatus;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'completed_at' | 'priority';
  orderDir?: 'ASC' | 'DESC';
} = {}): PrintJob[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = options.orderBy ?? 'created_at';
  const orderDir = options.orderDir ?? 'DESC';
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  params.push(limit, offset);
  return db
    .prepare(`SELECT * FROM print_jobs ${where} ORDER BY ${orderBy} ${orderDir} LIMIT ? OFFSET ?`)
    .all(...params) as PrintJob[];
}

/** Get the next pending job (highest priority, oldest first) */
export function getNextPendingJob(): PrintJob | null {
  const db = getDb();
  return (
    db
      .prepare(
        'SELECT * FROM print_jobs WHERE status = ? ORDER BY priority DESC, created_at ASC LIMIT 1',
      )
      .get('pending') as PrintJob
  ) ?? null;
}

/** Count pending jobs */
export function countPendingJobs(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as cnt FROM print_jobs WHERE status = ?').get('pending') as { cnt: number };
  return row.cnt;
}

/** Get job statistics */
export function getJobStats(): JobStats {
  const db = getDb();
  const rows = db.prepare(`
    SELECT status, COUNT(*) as cnt FROM print_jobs GROUP BY status
  `).all() as Array<{ status: string; cnt: number }>;

  return {
    total: rows.reduce((s, r) => s + r.cnt, 0),
    pending: rows.find(r => r.status === 'pending')?.cnt ?? 0,
    printing: rows.find(r => r.status === 'printing')?.cnt ?? 0,
    completed: rows.find(r => r.status === 'completed')?.cnt ?? 0,
    failed: rows.find(r => r.status === 'failed')?.cnt ?? 0,
    cancelled: rows.find(r => r.status === 'cancelled')?.cnt ?? 0,
  };
}

/** Add a log entry for a job */
export function addJobLog(
  jobId: string,
  level: JobLogEntry['level'],
  message: string,
): void {
  const db = getDb();
  db.prepare('INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)').run(
    jobId,
    level,
    message,
  );
}

/** Get log entries for a job */
export function getJobLogs(jobId: string, limit = 50): JobLogEntry[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM job_logs WHERE job_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(jobId, limit) as JobLogEntry[];
}

/** Get recent logs (all jobs) */
export function getRecentLogs(limit = 100): JobLogEntry[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM job_logs ORDER BY created_at DESC LIMIT ?')
    .all(limit) as JobLogEntry[];
}

/** Delete old completed/cancelled jobs (cleanup) */
export function cleanupOldJobs(olderThanDays = 30): number {
  const db = getDb();
  const result = db
    .prepare(
      `DELETE FROM print_jobs WHERE status IN ('completed', 'cancelled')
       AND completed_at < datetime('now', ?)`,
    )
    .run(`-${olderThanDays} days`);
  return result.changes;
}
