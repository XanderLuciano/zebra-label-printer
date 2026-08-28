/**
 * Print queue — reliable job queue with persistence.
 *
 * When a printer is unavailable, jobs are queued in SQLite and automatically
 * processed when connectivity is restored.
 *
 * Design:
 *   - Job submission always succeeds (creates DB record)
 *   - Immediate print attempt; falls back to queue on failure
 *   - Background processor polls for printer availability
 *   - All state transitions logged to job_logs
 *
 * The queue is multi-printer: every job records the printer it's bound for, and
 * the processor resolves that per job rather than holding one connection. That
 * matters for correctness, not just capacity — the head of the queue may be
 * waiting on an offline printer while another sits idle, and a job queued for a
 * 2×1" printer must not be printed on the 4×6" one just because that's the one
 * that came back.
 */

import type { Printer } from './printer'
import {
  createJob,
  listPendingJobs,
  updateJobStatus,
  claimJob,
  setJobZpl,
  countPendingJobs,
  addJobLog,
  getJobLabelSize,
  failStaleLocalPrintingJobs,
  type JobType,
  type JobLabelSize,
  type PrintJob
} from './db/print-job-repo'
import { recordPrinterEvent, getLabelSize } from './db/settings-repo'
import {
  isUnresolved,
  resolveJobLabelSize,
  type LabelSizeSource,
  type ResolvedPrinter,
  type UnresolvedReason
} from './printer-registry'
import {
  DEFAULT_DPI,
  LOCAL_PRINTER_NAME,
  LOCAL_PRINT_TIMEOUT_SECONDS,
  PENDING_SCAN_LIMIT,
  QUEUE_CHECK_INTERVAL_MS
} from './constants'

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

/**
 * Read the legacy global label size as a job snapshot.
 *
 * Only reached when no printer is configured — a fresh install, or a library
 * caller with no registry. Prefer `resolveJobLabelSize()`, which asks the printer
 * that's actually going to print the label.
 */
export function currentLabelSize(): JobLabelSize {
  const size = getLabelSize()
  return { widthDots: size.widthDots, heightDots: size.heightDots, dpi: DEFAULT_DPI }
}

/**
 * The slice of `PrinterRegistry` the queue depends on.
 *
 * Stated as an interface so the queue can be exercised without CUPS, and so it
 * has no say in how connections are opened or cached.
 */
export interface QueuePrinterSource extends LabelSizeSource {
  resolve(id?: string | null): Promise<ResolvedPrinter | { reason: UnresolvedReason }>
  resolveForJob(
    job: Pick<PrintJob, 'printer_id' | 'printer_name'>
  ): Promise<ResolvedPrinter | { reason: UnresolvedReason }>
}

/** Which printer a job is for, and what geometry to render it at. */
export interface SubmitOptions {
  /** Configured printer to print on. Omit to use the default printer. */
  printerId?: string | null
  /** Name to record on the job. Defaults to the resolved printer's name. */
  printerName?: string | null
  /**
   * Geometry to render for, overriding the printer's saved configuration.
   *
   * Browser-attached printers keep their config client-side, so the browser sends
   * its geometry along with the request.
   */
  labelSize?: { widthDots: number; heightDots: number; dpi?: number } | null
}

export class PrintQueue {
  private printers: QueuePrinterSource
  private processorInterval: ReturnType<typeof setInterval> | null = null
  private processing = false
  private checkIntervalMs: number

  constructor(printers: QueuePrinterSource, checkIntervalMs = QUEUE_CHECK_INTERVAL_MS) {
    this.printers = printers
    this.checkIntervalMs = checkIntervalMs
  }

  /**
   * Submit a print job. Tries to print immediately; queues if unavailable.
   *
   * The geometry of the printer this job is bound for is frozen onto the job
   * record and handed to `zplGenerator`, so the stored ZPL, the history preview,
   * and the physical output all describe the same label — even if that printer is
   * reconfigured before a queued job goes out.
   */
  async submit(
    jobType: JobType,
    requestData: unknown,
    zplGenerator: ZplGenerator,
    options: SubmitOptions = {}
  ): Promise<QueuedPrintResult> {
    const resolved = await this.printers.resolve(options.printerId)
    const profile = isUnresolved(resolved) ? null : resolved.profile
    const printer = isUnresolved(resolved) ? null : resolved.printer

    const printerId = options.printerId ?? profile?.id ?? null
    const printerName = options.printerName ?? profile?.name ?? profile?.cupsName ?? null
    const labelSize = resolveJobLabelSize(this.printers, {
      printerId,
      labelSize: options.labelSize
    })

    // Always persist the job first, even when the printer can't be reached — the
    // record is what lets it go out later.
    const job = createJob(jobType, requestData, undefined, printerName, labelSize, printerId)

    // Try immediate print
    const isReady = printer ? await printer.isReady() : false
    if (printer && isReady) {
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

        const result = await printer.print(zpl)
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
    const reason = isUnresolved(resolved)
      ? `Queued — ${resolved.reason === 'unavailable' ? 'printer unreachable' : resolved.reason}`
      : 'Queued — printer not ready'
    addJobLog(job.id, 'info', reason)
    if (printerName) {
      recordPrinterEvent(printerName, 'disconnected', 'Job queued: printer unavailable')
    }

    return { success: true, jobId: job.id, queued: true, labelSize }
  }

  /**
   * Record a job that is printed outside this process (browser WebUSB), and
   * return the ZPL for the caller to transmit.
   *
   * The job is persisted exactly like a server-side print — same snapshot, same
   * history entry — but no CUPS job is spawned. The caller reports the outcome
   * via `reportExternalResult()` once the transfer finishes.
   *
   * A browser-attached printer's configuration lives in that browser, so
   * `options.labelSize` is how its geometry reaches the job record. Without it the
   * job falls back to the default printer's size, which is very likely wrong.
   */
  prepareExternal(
    jobType: JobType,
    requestData: unknown,
    zplGenerator: ZplGenerator,
    options: SubmitOptions = {}
  ): { jobId: string; zpl: string; labelSize: JobLabelSize } {
    const printerName = options.printerName ?? LOCAL_PRINTER_NAME
    const labelSize = resolveJobLabelSize(this.printers, {
      printerId: options.printerId,
      labelSize: options.labelSize
    })
    const zpl = zplGenerator(labelSize)
    const job = createJob(jobType, requestData, zpl, printerName, labelSize, options.printerId ?? null)
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
    return failStaleLocalPrintingJobs(LOCAL_PRINT_TIMEOUT_SECONDS)
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
   * Print the next pending job that has a ready printer.
   *
   * Walks a window of the queue rather than only its head. With one printer those
   * are the same thing, but with several, the oldest job may be waiting on a
   * printer that's switched off while the next job's printer is idle — taking only
   * the head would stall the whole queue behind it.
   *
   * Jobs whose printer can't be resolved are skipped, not reassigned: printing a
   * job on a different printer than it was rendered for would put it on the wrong
   * label stock.
   *
   * @returns true if a job was printed.
   */
  async processNext(): Promise<boolean> {
    if (this.processing) return false
    this.processing = true

    try {
      // Independent of printer state: these jobs were never ours to print.
      this.reapStaleLocalJobs()

      const pending = listPendingJobs(PENDING_SCAN_LIMIT)
      if (pending.length === 0) return false

      // isReady() shells out to CUPS, so cache the answer for this tick rather
      // than re-asking once per queued job.
      const readiness = new Map<string, boolean>()

      for (const job of pending) {
        const resolved = await this.printers.resolveForJob(job)
        if (isUnresolved(resolved)) continue

        const { profile, printer } = resolved
        let ready = readiness.get(profile.id)
        if (ready === undefined) {
          ready = await printer.isReady()
          readiness.set(profile.id, ready)
        }
        if (!ready) continue

        if (await this.printJob(job, printer, profile.name)) return true
      }

      return false
    } catch (err) {
      console.error('Queue process error:', err)
      return false
    } finally {
      this.processing = false
    }
  }

  /**
   * Claim and print one queued job on a specific printer.
   *
   * @returns true if the job was claimed and printed successfully.
   */
  private async printJob(job: PrintJob, printer: Printer, printerName: string): Promise<boolean> {
    // Atomically claim the job. If another caller (e.g. submit) already claimed
    // it between the pending scan and here, skip it.
    if (!claimJob(job.id)) return false

    addJobLog(job.id, 'info', `Processing from queue on '${printerName}'`)

    // Generate ZPL if not already done
    let zpl = job.zpl_commands
    if (!zpl) {
      // Reconstruct from request data
      try {
        const data = JSON.parse(job.request_data)
        // Rebuild against the size frozen on the job, not the printer's current
        // configuration — otherwise a job queued on 2×1" stock prints at whatever
        // size happens to be set when the printer comes back.
        zpl = await this.rebuildZpl(
          job.job_type,
          data,
          getJobLabelSize(job) ?? this.printers.labelSizeFor(job.printer_id) ?? currentLabelSize()
        )
        if (zpl) setJobZpl(job.id, zpl)
      } catch {
        updateJobStatus(job.id, 'failed', {
          errorMessage: 'Failed to rebuild ZPL from queued request'
        })
        return false
      }
    }

    if (!zpl) {
      updateJobStatus(job.id, 'failed', { errorMessage: 'No ZPL to print' })
      return false
    }

    const result = await printer.print(zpl)
    if (result.success) {
      updateJobStatus(job.id, 'completed', { cupsJobId: result.jobId })
      recordPrinterEvent(printerName, 'recovered', `Job ${job.id} printed from queue`)
      return true
    }

    updateJobStatus(job.id, 'failed', { errorMessage: result.error })
    return false
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
