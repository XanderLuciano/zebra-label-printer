/**
 * POST route handlers — label printing endpoints.
 *
 * All handlers now use the PrintQueue for reliable delivery:
 * jobs are persisted to SQLite and automatically retried if the printer is offline.
 */

import type { ZodSchema } from 'zod'
import type { Handler } from '../router'
import { json, readBody, validate, checkAuth } from '../helpers'
import { ZPLBuilder, textLabel, barcodeLabel, qrLabel } from '../../zpl'
import {
  textLabelSchema,
  barcodeLabelSchema,
  qrLabelSchema,
  zplSchema,
  labelSchema,
  serialLabelSchema,
  clearJobsSchema
} from '../../schemas'
import type {
  TextLabelRequest,
  BarcodeLabelRequest,
  QRLabelRequest,
  LabelRequest,
  SerialLabelRequest,
  ClearJobsRequest
} from '../../schemas'
import type { PrintQueue } from '../../queue'

/** POST /api/print/text — print a multi-line text label */
export function printTextHandler(apiKey: string, getQueue: () => PrintQueue | null): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<TextLabelRequest>(req, res, textLabelSchema)
    if (!data) return

    const queue = getQueue()
    if (queue) {
      const result = await queue.submit('text', data, () => textLabel(data.lines, {}))
      json(res, {
        success: true,
        jobId: result.jobId,
        queued: result.queued
      })
    } else {
      // Fallback: print directly (no queue)
      const zpl = textLabel(data.lines, {})
      const result = await printer.print(zpl)
      json(res, result, result.success ? 200 : 500)
    }
  }
}

/** POST /api/print/barcode — print a barcode label */
export function printBarcodeHandler(apiKey: string, getQueue: () => PrintQueue | null): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<BarcodeLabelRequest>(req, res, barcodeLabelSchema)
    if (!data) return

    const queue = getQueue()
    if (queue) {
      const result = await queue.submit('barcode', data, () =>
        barcodeLabel(data.data, data.type, data.text, { barcodeHeight: data.height })
      )
      json(res, { success: true, jobId: result.jobId, queued: result.queued })
    } else {
      const zpl = barcodeLabel(data.data, data.type, data.text, { barcodeHeight: data.height })
      const result = await printer.print(zpl)
      json(res, result, result.success ? 200 : 500)
    }
  }
}

/** POST /api/print/qr — print a QR code label */
export function printQrHandler(apiKey: string, getQueue: () => PrintQueue | null): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<QRLabelRequest>(req, res, qrLabelSchema)
    if (!data) return

    const queue = getQueue()
    if (queue) {
      const result = await queue.submit('qr', data, () =>
        qrLabel(data.data, data.text, { magnification: data.magnification })
      )
      json(res, { success: true, jobId: result.jobId, queued: result.queued })
    } else {
      const zpl = qrLabel(data.data, data.text, { magnification: data.magnification })
      const result = await printer.print(zpl)
      json(res, result, result.success ? 200 : 500)
    }
  }
}

/** POST /api/print/zpl — print raw ZPL (accepts text/plain or JSON) */
export function printZplHandler(apiKey: string, getQueue: () => PrintQueue | null): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const raw = await readBody(req)

    let zpl: string
    if (raw && !raw.trim().startsWith('{') && !raw.trim().startsWith('[')) {
      zpl = raw.trim()
    } else {
      const data = await validate<{ zpl: string }>(
        req, res,
        zplSchema as unknown as ZodSchema<{ zpl: string }>
      )
      if (!data) return
      zpl = (data as unknown as { zpl: string }).zpl
    }

    if (!zpl || zpl.length === 0) {
      json(res, { error: 'ZPL commands required' }, 400)
      return
    }

    const queue = getQueue()
    if (queue) {
      const zplCopy = zpl
      const result = await queue.submit('zpl', { zpl }, () => zplCopy)
      json(res, { success: true, jobId: result.jobId, queued: result.queued })
    } else {
      const result = await printer.print(zpl)
      json(res, result, result.success ? 200 : 500)
    }
  }
}

/** POST /api/print/label — print a composed label from element definitions */
export function printLabelHandler(apiKey: string, getQueue: () => PrintQueue | null): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<LabelRequest>(req, res, labelSchema)
    if (!data) return

    const zplGen = () => {
      const builder = new ZPLBuilder()
      for (const el of data.elements) {
        builder.element(el as Parameters<ZPLBuilder['element']>[0])
      }
      return builder.build()
    }

    try {
      const queue = getQueue()
      if (queue) {
        const zpl = zplGen() // Generate once for validation + storage
        const result = await queue.submit('label', data, () => zpl)
        json(res, { success: true, jobId: result.jobId, queued: result.queued })
      } else {
        const zpl = zplGen()
        const result = await printer.print(zpl)
        json(res, result, result.success ? 200 : 500)
      }
    } catch (err) {
      json(res, { error: (err as Error).message }, 400)
    }
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

      const queue = getQueue()
      if (queue) {
        const result = await queue.submit('text', { lines }, () => textLabel(lines, {}))
        results.push({ copy: i + 1, serial, jobId: result.jobId, queued: result.queued })
      } else {
        const zpl = textLabel(lines, {})
        const result = await printer.print(zpl)
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
        const db = (await import('../../db/database')).getDb()
        const result = db.prepare('DELETE FROM print_jobs WHERE status = ?').run('cancelled')
        count += result.changes
      }
    }

    json(res, { success: true, deleted: count })
  }
}
