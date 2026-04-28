/**
 * GET route handlers — health, discovery, docs, jobs, debug, settings.
 */

import type { Handler } from '../router'
import { json, html, checkAuth } from '../helpers'
import { OPENAPI_SPEC, swaggerUiHtml } from '../../openapi'
import { listJobs, getJob, getJobLogs, getJobStats, countPendingJobs } from '../../db/print-job-repo'
import { getAllSettings, getPrinterEvents, getLabelSize, getRecentSizes, setLabelSize, STANDARD_SIZES } from '../../db/settings-repo'
import { getDb } from '../../db/database'
import type { PrintQueue } from '../../queue'

/** GET /api/health — server and printer status */
export const healthHandler: Handler = async (_req, res, printer) => {
  json(res, { status: 'ok', printer: printer?.name ?? null })
}

/** GET /api/printers — list available printers */
export function printersHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
    const { discoverPrinters } = await import('../../discovery')
    const printers = await discoverPrinters()
    json(res, { printers })
  }
}

/** GET /api/docs/openapi.json — OpenAPI 3.1 specification */
export const openApiHandler: Handler = async (_req, res, _printer) => {
  json(res, OPENAPI_SPEC)
}

/** GET /api/docs — Swagger UI (interactive API documentation) */
export const docsHandler: Handler = async (_req, res, _printer) => {
  html(res, swaggerUiHtml('/api/docs/openapi.json'))
}

// ─── Job management ─────────────────────────────────────────────────────────

/** GET /api/jobs — list print jobs */
export function jobsListHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const status = url.searchParams.get('status') as string | undefined
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)

    // Validate status if provided
    const validStatuses = ['pending', 'printing', 'completed', 'failed', 'cancelled']
    if (status && !validStatuses.includes(status)) {
      json(res, { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, 400)
      return
    }

    const jobs = listJobs({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      status: status as any,
      limit: Math.min(limit, 200),
      offset
    })
    const stats = getJobStats()

    json(res, { jobs, stats })
  }
}

/** GET /api/jobs/stats — job statistics summary */
export function jobsStatsHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
    json(res, getJobStats())
  }
}

/** GET /api/jobs/:id — get a single job */
export function jobDetailHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const parts = url.pathname.split('/')
    const jobId = parts[parts.length - 1]

    const job = getJob(jobId)
    if (!job) {
      json(res, { error: 'Job not found' }, 404)
      return
    }

    const logs = getJobLogs(jobId)
    json(res, { job, logs })
  }
}

/** POST /api/jobs/:id/cancel — cancel a pending job */
export function jobCancelHandler(apiKey: string, getQueue: () => PrintQueue | null): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const parts = url.pathname.split('/')
    const jobId = parts[parts.length - 2] // /api/jobs/:id/cancel

    const queue = getQueue()
    const ok = queue ? queue.cancelJob(jobId) : false
    json(res, { success: ok, message: ok ? 'Job cancelled' : 'Failed to cancel' })
  }
}

// ─── Debug ───────────────────────────────────────────────────────────────────

/** GET /api/debug — system diagnostics */
export function debugHandler(apiKey: string, getQueue: () => PrintQueue | null): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const db = getDb()
    const dbSize = db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get() as { size: number }

    const info = {
      printer: {
        name: printer.name,
        isReady: await printer.isReady()
      },
      queue: {
        pending: countPendingJobs(),
        processorRunning: getQueue() !== null
      },
      database: {
        path: db.name,
        sizeBytes: dbSize.size,
        sizeFormatted: `${(dbSize.size / 1024 / 1024).toFixed(2)} MB`,
        stats: getJobStats()
      },
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version
      },
      printerEvents: getPrinterEvents(20)
    }

    json(res, info)
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────

/** GET /api/settings — get all settings */
export function settingsGetHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
    json(res, getAllSettings())
  }
}

/** PUT /api/settings — update settings */
export function settingsPutHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const { readBody: rb, parseJson } = await import('../helpers')
    const { setSetting } = await import('../../db/settings-repo')

    const raw = await rb(req)
    const data = parseJson(raw) as Record<string, unknown> | null
    if (!data || typeof data !== 'object') {
      json(res, { error: 'Expected JSON object of key/value pairs' }, 400)
      return
    }

    for (const [key, value] of Object.entries(data)) {
      setSetting(key, String(value))
    }

    json(res, { success: true })
  }
}

// ─── Label Size ─────────────────────────────────────────────────────────────

/** GET /api/label-size — current label dimensions */
export function labelSizeGetHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const current = getLabelSize()
    const recents = getRecentSizes()
    const standards = STANDARD_SIZES

    json(res, {
      current,
      recents,
      standards,
      dpi: 203
    })
  }
}

/** PUT /api/label-size — set label dimensions */
export function labelSizePutHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const { readBody: rb, parseJson } = await import('../helpers')

    const raw = await rb(req)
    const data = parseJson(raw) as Record<string, unknown> | null
    if (!data || typeof data !== 'object') {
      json(res, { error: 'Expected JSON object with widthDots and heightDots' }, 400)
      return
    }

    const widthDots = Number(data.widthDots)
    const heightDots = Number(data.heightDots)

    if (!widthDots || !heightDots || widthDots < 100 || heightDots < 50) {
      json(res, { error: 'widthDots and heightDots required (min 100×50 dots)' }, 400)
      return
    }

    const size = {
      widthInches: Number((widthDots / 203).toFixed(2)),
      heightInches: Number((heightDots / 203).toFixed(2)),
      widthDots,
      heightDots,
      name: data.name as string || `${(widthDots / 203).toFixed(1)}×${(heightDots / 203).toFixed(1)}"`
    }

    setLabelSize(size)
    json(res, { success: true, size })
  }
}
