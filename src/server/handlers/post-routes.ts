/**
 * POST route handlers — label printing endpoints.
 *
 * All handlers now use the PrintQueue for reliable delivery:
 * jobs are persisted to SQLite and automatically retried if the printer is offline.
 */

import { eq } from 'drizzle-orm'
import type { ServerResponse } from 'http'
import type { ZodSchema } from 'zod'
import type { Handler } from '../router'
import { json, readBody, validate, checkAuth } from '../helpers'
import { ZPLBuilder, textLabel, barcodeLabel, qrLabel } from '../../zpl'
import { getDb } from '../../db/database'
import { printJobs } from '../../db/schema'
import {
  textLabelSchema,
  barcodeLabelSchema,
  qrLabelSchema,
  zplSchema,
  labelSchema,
  serialLabelSchema,
  clearJobsSchema,
  jobResultSchema
} from '../../schemas'
import type {
  TextLabelRequest,
  BarcodeLabelRequest,
  QRLabelRequest,
  LabelRequest,
  SerialLabelRequest,
  ClearJobsRequest,
  JobResultRequest
} from '../../schemas'
import type { PrintQueue, ZplGenerator } from '../../queue'
import { currentLabelSize } from '../../queue'
import type { JobType, JobLabelSize } from '../../db/print-job-repo'
import type { Printer } from '../../printer'
import type { PrintTarget } from '../../constants'
import { LOCAL_PRINTER_NAME } from '../../constants'

/**
 * Route a print request to the queue, a local (browser USB) printer, or
 * straight at CUPS, and write the response.
 *
 * Every path records a job with a label-size snapshot, so history is consistent
 * no matter where the label physically came out.
 *
 * @param target - 'local' persists the job and returns `zpl` for the caller to
 *   transmit over WebUSB; the caller then reports back via /api/jobs/:id/result.
 */
async function dispatchPrint(
  res: ServerResponse,
  printer: Printer,
  queue: PrintQueue | null,
  jobType: JobType,
  requestData: unknown,
  target: PrintTarget,
  zplGen: ZplGenerator
): Promise<void> {
  try {
    if (target === 'local') {
      if (!queue) {
        json(res, { error: 'Local printing requires the job queue' }, 503)
        return
      }
      const { jobId, zpl, labelSize } = queue.prepareExternal(jobType, requestData, zplGen, LOCAL_PRINTER_NAME)
      json(res, { success: true, jobId, zpl, target: 'local', queued: false, labelSize })
      return
    }

    if (queue) {
      const result = await queue.submit(jobType, requestData, zplGen)
      json(res, {
        success: result.success,
        jobId: result.jobId,
        queued: result.queued,
        target: 'server',
        labelSize: result.labelSize,
        ...(result.error ? { error: result.error } : {})
      }, result.success ? 200 : 500)
      return
    }

    // No queue (library/CLI usage): print directly, no job record
    const labelSize = currentLabelSize()
    const result = await printer.print(zplGen(labelSize))
    json(res, { ...result, labelSize }, result.success ? 200 : 500)
  } catch (err) {
    json(res, { error: (err as Error).message }, 400)
  }
}

/** Shared ZPL builder setup for element-composed labels. */
function buildElementZpl(
  elements: LabelRequest['elements'],
  labelSize: JobLabelSize,
  copies?: number
): string {
  const builder = new ZPLBuilder({
    width: labelSize.widthDots,
    height: labelSize.heightDots,
    dpi: labelSize.dpi,
    copies: copies ?? 1
  })
  builder.labelSize(labelSize.widthDots, labelSize.heightDots)
  for (const el of elements) {
    builder.element(el as Parameters<ZPLBuilder['element']>[0])
  }
  return builder.build()
}

/** POST /api/print/text — print a multi-line text label */
export function printTextHandler(apiKey: string, getQueue: () => PrintQueue | null): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<TextLabelRequest>(req, res, textLabelSchema)
    if (!data) return

    await dispatchPrint(res, printer, getQueue(), 'text', data, data.target, size =>
      textLabel(data.lines, { widthDots: size.widthDots, heightDots: size.heightDots })
    )
  }
}

/** POST /api/print/barcode — print a barcode label */
export function printBarcodeHandler(apiKey: string, getQueue: () => PrintQueue | null): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<BarcodeLabelRequest>(req, res, barcodeLabelSchema)
    if (!data) return

    await dispatchPrint(res, printer, getQueue(), 'barcode', data, data.target, size =>
      barcodeLabel(data.data, data.type, data.text, {
        barcodeHeight: data.height,
        widthDots: size.widthDots,
        heightDots: size.heightDots
      })
    )
  }
}

/** POST /api/print/qr — print a QR code label */
export function printQrHandler(apiKey: string, getQueue: () => PrintQueue | null): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<QRLabelRequest>(req, res, qrLabelSchema)
    if (!data) return

    await dispatchPrint(res, printer, getQueue(), 'qr', data, data.target, size =>
      qrLabel(data.data, data.text, {
        magnification: data.magnification,
        widthDots: size.widthDots,
        heightDots: size.heightDots
      })
    )
  }
}

/** POST /api/print/zpl — print raw ZPL (accepts text/plain or JSON) */
export function printZplHandler(apiKey: string, getQueue: () => PrintQueue | null): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const raw = await readBody(req)

    let zpl: string
    let target: PrintTarget = 'server'
    if (raw && !raw.trim().startsWith('{') && !raw.trim().startsWith('[')) {
      zpl = raw.trim()
    } else {
      const data = await validate<{ zpl: string; target?: PrintTarget }>(
        req, res,
        zplSchema as unknown as ZodSchema<{ zpl: string; target?: PrintTarget }>
      )
      if (!data) return
      zpl = data.zpl
      target = data.target ?? 'server'
    }

    if (!zpl || zpl.length === 0) {
      json(res, { error: 'ZPL commands required' }, 400)
      return
    }

    // Raw ZPL is passed through verbatim — the caller owns its geometry.
    const zplCopy = zpl
    await dispatchPrint(res, printer, getQueue(), 'zpl', { zpl }, target, () => zplCopy)
  }
}

/** POST /api/print/label — print a composed label from element definitions */
export function printLabelHandler(apiKey: string, getQueue: () => PrintQueue | null): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<LabelRequest>(req, res, labelSchema)
    if (!data) return

    await dispatchPrint(res, printer, getQueue(), 'label', data, data.target, size =>
      buildElementZpl(data.elements, size, data.copies)
    )
  }
}

/**
 * POST /api/jobs/:id/result — record the outcome of a locally printed job.
 *
 * The browser calls this after pushing ZPL over WebUSB. Without it, jobs handed
 * to a local printer would sit in 'printing' indefinitely.
 */
export function jobResultHandler(apiKey: string, getQueue: () => PrintQueue | null): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const parts = url.pathname.split('/')
    const jobId = parts[parts.length - 2] // /api/jobs/:id/result

    const { getJob } = await import('../../db/print-job-repo')
    if (!getJob(jobId)) {
      json(res, { error: 'Job not found' }, 404)
      return
    }

    const data = await validate<JobResultRequest>(req, res, jobResultSchema)
    if (!data) return

    const queue = getQueue()
    if (!queue) {
      json(res, { error: 'Job queue unavailable' }, 503)
      return
    }

    queue.reportExternalResult(jobId, data.success, data.error)
    json(res, { success: true, jobId, status: data.success ? 'completed' : 'failed' })
  }
}

/** POST /api/print/serial — multi-copy print with auto-incrementing serial numbers */
export function printSerialHandler(apiKey: string, getQueue: () => PrintQueue | null): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<SerialLabelRequest>(req, res, serialLabelSchema)
    if (!data) return

    const format = data.serialFormat || '###'
    const padLength = format.length
    const results: Array<{ copy: number; serial: string; jobId: string; queued: boolean }> = []

    for (let i = 0; i < data.copies; i++) {
      const serialNum = data.serialStart + i
      const serial = String(serialNum).padStart(padLength, '0')

      // Replace {serial} placeholder in each line
      const lines = data.lines.map(line => line.replace(/\{serial\}/g, serial))
      const zplGen: ZplGenerator = size =>
        textLabel(lines, { widthDots: size.widthDots, heightDots: size.heightDots })

      const queue = getQueue()
      if (queue) {
        const result = await queue.submit('text', { lines }, zplGen)
        results.push({ copy: i + 1, serial, jobId: result.jobId, queued: result.queued })
      } else {
        const result = await printer.print(zplGen(currentLabelSize()))
        results.push({ copy: i + 1, serial, jobId: result.jobId || 'direct', queued: false })
      }
    }

    json(res, {
      success: true,
      totalCopies: data.copies,
      serialStart: data.serialStart,
      serialEnd: data.serialStart + data.copies - 1,
      results
    })
  }
}

/** POST /api/jobs/clear — bulk clear jobs by status */
export function clearJobsHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<ClearJobsRequest>(req, res, clearJobsSchema)
    if (!data) return

    const { cleanupOldJobs, updateJobStatus, listJobs } = await import('../../db/print-job-repo')

    let count = 0
    if (data.olderThanDays) {
      count = cleanupOldJobs(data.olderThanDays)
    } else {
      const statuses = data.status === 'all'
        ? ['completed', 'failed', 'cancelled'] as const
        : [data.status]
      for (const s of statuses) {
        const jobs = listJobs({ status: s, limit: 1000 })
        for (const job of jobs) {
          try {
            updateJobStatus(job.id, 'cancelled')
          } catch { /* empty */ }
        }
        // Hard delete cancelled jobs
        const result = getDb().delete(printJobs).where(eq(printJobs.status, 'cancelled')).run()
        count += result.changes
      }
    }

    json(res, { success: true, deleted: count })
  }
}
