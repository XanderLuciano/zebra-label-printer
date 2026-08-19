/**
 * Print queue — reliable job queue with persistence.
 *
 * When the printer is unavailable, jobs are queued in SQLite and
 * automatically processed when connectivity is restored.
 *
 * Design:
 *   - Job submission always succeeds (creates DB record)
 *   - Immediate print attempt; falls back to queue on failure
 *   - Background processor polls for printer availability
 *   - All state transitions logged to job_logs
 */

import type { Printer } from './printer'
import {
  createJob,
  getNextPendingJob,
  updateJobStatus,
  claimJob,
  setJobZpl,
  countPendingJobs,
  addJobLog,
  getJobLabelSize,
  failStalePrintingJobs,
  type JobType,
  type JobLabelSize
} from './db/print-job-repo'
import {
  recordPrinterEvent,
  getLabelSize
} from './db/settings-repo'
import { DEFAULT_DPI, LOCAL_PRINTER_NAME, LOCAL_PRINT_TIMEOUT_SECONDS } from './constants'

export interface QueuedPrintResult {
  success: boolean;
  jobId: string;
  queued: boolean;
  error?: string;
  /** Label geometry the job was rendered for */
  labelSize: JobLabelSize;
}

/**
 * Builds the ZPL for a job.
 *
 * Receives the label geometry that was frozen onto the job record, so the
 * generated ZPL and the stored snapshot can never disagree — including when a
 * queued job is rebuilt later, after the global label size has changed.
 */
export type ZplGenerator = (labelSize: JobLabelSize) => string

/** Read the current configured label size as a job snapshot. */
export function currentLabelSize(): JobLabelSize {
  const size = getLabelSize()
  return { widthDots: size.widthDots, heightDots: size.heightDots, dpi: DEFAULT_DPI }
}

export class PrintQueue {
  private printer: Printer
  private processorInterval: ReturnType<typeof setInterval> | null = null
  private processing = false
  private checkIntervalMs: number

  constructor(printer: Printer, checkIntervalMs = 5000) {
    this.printer = printer
    this.checkIntervalMs = checkIntervalMs
  }

  /**
   * Submit a print job. Tries to print immediately; queues if unavailable.
   *
   * The label geometry in effect right now is frozen onto the job record and
   * handed to `zplGenerator`, so the stored ZPL, the history preview, and the
   * physical output all describe the same label.
   */
  async submit(
    jobType: JobType,
    requestData: unknown,
    zplGenerator: ZplGenerator,
    printerName?: string
  ): Promise<QueuedPrintResult> {
    const labelSize = currentLabelSize()

    // Always persist the job first
    const job = createJob(jobType, requestData, undefined, printerName ?? this.printer.name, labelSize)

    // Try immediate print
    const isReady = await this.printer.isReady()
    if (isReady) {
      // Atomically claim the job so the background processor can't also grab it.
      // Without this, submit() and processNext() can race and print the same
      // job (and serial number) twice.
      if (!claimJob(job.id)) {
        // Already claimed by the background processor — it will handle printing.
        return { success: true, jobId: job.id, queued: true, labelSize }
      }
      try {
        const zpl = zplGenerator(labelSize)
        setJobZpl(job.id, zpl)

        const result = await this.printer.print(zpl)
        if (result.success) {
          updateJobStatus(job.id, 'completed', {
            cupsJobId: result.jobId
          })
          return { success: true, jobId: job.id, queued: false, labelSize }
        } else {
          updateJobStatus(job.id, 'failed', {
            errorMessage: result.error
          })
          return {
            success: false,
            jobId: job.id,
            queued: false,
            error: result.error,
            labelSize
          }
        }
      } catch (err) {
        const msg = (err as Error).message
        updateJobStatus(job.id, 'pending') // Revert to pending for retry
        addJobLog(job.id, 'warn', `Immediate print failed, queued: ${msg}`)
      }
    }

    // Queue for later
    addJobLog(job.id, 'info', 'Queued — printer not ready')
    recordPrinterEvent(this.printer.name, 'disconnected', 'Job queued: printer unavailable')

    return { success: true, jobId: job.id, queued: true, labelSize }
  }

  /**
   * Record a job that is printed outside this process (browser WebUSB), and
   * return the ZPL for the caller to transmit.
   *
   * The job is persisted exactly like a server-side print — same snapshot, same
   * history entry — but no CUPS job is spawned. The caller reports the outcome
   * via `reportExternalResult()` once the transfer finishes.
   */
  prepareExternal(
    jobType: JobType,
    requestData: unknown,
    zplGenerator: ZplGenerator,
    printerName: string = LOCAL_PRINTER_NAME
  ): { jobId: string; zpl: string; labelSize: JobLabelSize } {
    const labelSize = currentLabelSize()
    const zpl = zplGenerator(labelSize)
    const job = createJob(jobType, requestData, zpl, printerName, labelSize)
    // Claim it immediately so the background processor never prints it on the
    // server as well. reportExternalResult() closes it out; if that never
    // arrives, reapStaleLocalJobs() fails it.
    claimJob(job.id)
    addJobLog(job.id, 'info', `Handed to '${printerName}' for direct USB transfer`)
    return { jobId: job.id, zpl, labelSize }
  }

  /** Finalize a job printed outside this process. */
  reportExternalResult(jobId: string, success: boolean, error?: string): void {
    if (success) {
      updateJobStatus(jobId, 'completed')
    } else {
      updateJobStatus(jobId, 'failed', { errorMessage: error || 'Local USB transfer failed' })
    }
  }

  /**
   * Fail local jobs whose client never reported back, so they don't sit in
   * 'printing' forever. Runs as part of the normal processor tick.
   */
  reapStaleLocalJobs(): number {
    return failStalePrintingJobs(LOCAL_PRINTER_NAME, LOCAL_PRINT_TIMEOUT_SECONDS)
  }

  /**
   * Start the background queue processor.
   */
  start(): void {
    if (this.processorInterval) return

    console.log('[queue] Queue processor started')
    this.processorInterval = setInterval(() => {
      this.processNext().catch(err => {
        console.error('Queue processor error:', err)
      })
    }, this.checkIntervalMs)

    // Also check immediately
    this.processNext().catch(() => {})
  }

  /**
   * Stop the background queue processor.
   */
  stop(): void {
    if (this.processorInterval) {
      clearInterval(this.processorInterval)
      this.processorInterval = null
      console.log('[queue] Queue processor stopped')
    }
  }

  /**
   * Process the next pending job, if any.
   */
  async processNext(): Promise<boolean> {
    if (this.processing) return false
    this.processing = true

    try {
      // Independent of printer state: these jobs were never ours to print.
      this.reapStaleLocalJobs()

      const isReady = await this.printer.isReady()
      if (!isReady) return false

      const job = getNextPendingJob()
      if (!job) return false

      // Atomically claim the job. If another caller (e.g. submit) already
      // claimed it between getNextPendingJob() and here, skip it.
      if (!claimJob(job.id)) return false

      addJobLog(job.id, 'info', 'Processing from queue')

      // Generate ZPL if not already done
      let zpl = job.zpl_commands
      if (!zpl) {
        // Reconstruct from request data
        try {
          const data = JSON.parse(job.request_data)
          // Rebuild against the size frozen on the job, not the current
          // setting — otherwise a job queued on 2×1" stock prints at whatever
          // size happens to be configured when the printer comes back.
          zpl = await this.rebuildZpl(job.job_type, data, getJobLabelSize(job) ?? currentLabelSize())
          if (zpl) setJobZpl(job.id, zpl)
        } catch {
          updateJobStatus(job.id, 'failed', {
            errorMessage: 'Failed to rebuild ZPL from queued request'
          })
          return false
        }
      }

      const result = await this.printer.print(zpl!)
      if (result.success) {
        updateJobStatus(job.id, 'completed', { cupsJobId: result.jobId })
        recordPrinterEvent(this.printer.name, 'recovered', `Job ${job.id} printed from queue`)
        return true
      } else {
        updateJobStatus(job.id, 'failed', { errorMessage: result.error })
        return false
      }
    } catch (err) {
      console.error('Queue process error:', err)
      return false
    } finally {
      this.processing = false
    }
  }

  /**
   * Rebuild ZPL from stored request data (for queued jobs).
   *
   * @param labelSize - Geometry to render for, taken from the job's snapshot.
   */
  private async rebuildZpl(
    jobType: JobType,
    data: Record<string, unknown>,
    labelSize: JobLabelSize
  ): Promise<string | null> {
    // Dynamic imports to avoid circular dependencies
    const { textLabel, barcodeLabel, qrLabel } = await import('./zpl')
    const { ZPLBuilder } = await import('./zpl')

    const opts = { widthDots: labelSize.widthDots, heightDots: labelSize.heightDots }

    switch (jobType) {
      case 'text': {
        const lines = data.lines as string[]
        if (lines?.length) return textLabel(lines, opts)
        break
      }
      case 'barcode': {
        const bcData = data.data as string
        if (bcData) {
          return barcodeLabel(bcData, (data.type as 'CODE128') ?? 'CODE128', data.text as string | undefined, opts)
        }
        break
      }
      case 'qr': {
        const qrData = data.data as string
        if (qrData) {
          return qrLabel(qrData, data.text as string | undefined, {
            ...opts,
            magnification: data.magnification as number | undefined
          })
        }
        break
      }
      case 'label': {
        const elements = data.elements as Array<Record<string, unknown>>
        if (elements?.length) {
          const builder = new ZPLBuilder({ width: labelSize.widthDots, height: labelSize.heightDots })
          builder.labelSize(labelSize.widthDots, labelSize.heightDots)
          for (const el of elements) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            builder.element(el as any)
          }
          return builder.build()
        }
        break
      }
      case 'zpl': {
        const zpl = data.zpl as string
        if (zpl) return zpl
        break
      }
    }
    return null
  }

  /** Get number of pending jobs */
  getPendingCount(): number {
    return countPendingJobs()
  }

  /** Cancel a pending job */
  cancelJob(jobId: string): boolean {
    try {
      updateJobStatus(jobId, 'cancelled')
      return true
    } catch {
      return false
    }
  }
}
