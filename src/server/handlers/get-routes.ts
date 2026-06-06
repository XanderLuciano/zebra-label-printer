/**
 * GET route handlers — health, discovery, docs, jobs, debug, settings.
 */

import type { Handler } from '../router'
import { json, html, checkAuth } from '../helpers'
import { OPENAPI_SPEC, swaggerUiHtml } from '../../openapi'
import { listJobs, getJob, getJobLogs, getJobStats, countPendingJobs } from '../../db/print-job-repo'
import { getAllSettings, getPrinterEvents, getLabelSize, getRecentSizes, setLabelSize, STANDARD_SIZES } from '../../db/settings-repo'
import { checkForUpdates } from '../../updater'
import { getSqlite } from '../../db/database'
import {
  JOB_STATUSES,
  DEFAULT_DPI,
  MIN_LABEL_WIDTH_DOTS,
  MIN_LABEL_HEIGHT_DOTS,
  UPDATE_CACHE_MINUTES
} from '../../constants'
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
    if (status && !JOB_STATUSES.includes(status as typeof JOB_STATUSES[number])) {
      json(res, { error: `Invalid status. Must be one of: ${JOB_STATUSES.join(', ')}` }, 400)
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

    const sqlite = getSqlite()
    const dbSize = sqlite.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get() as { size: number }

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
        path: sqlite.name,
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
      dpi: DEFAULT_DPI
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

    if (!widthDots || !heightDots || widthDots < MIN_LABEL_WIDTH_DOTS || heightDots < MIN_LABEL_HEIGHT_DOTS) {
      json(res, { error: `widthDots and heightDots required (min ${MIN_LABEL_WIDTH_DOTS}×${MIN_LABEL_HEIGHT_DOTS} dots)` }, 400)
      return
    }

    const size = {
      widthInches: Number((widthDots / DEFAULT_DPI).toFixed(2)),
      heightInches: Number((heightDots / DEFAULT_DPI).toFixed(2)),
      widthDots,
      heightDots,
      name: data.name as string || `${(widthDots / DEFAULT_DPI).toFixed(1)}×${(heightDots / DEFAULT_DPI).toFixed(1)}"`
    }

    setLabelSize(size)
    json(res, { success: true, size })
  }
}

// ─── Updates ────────────────────────────────────────────────────────────────

/** GET /api/version — current and latest version info */
export function versionHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
    const info = await checkForUpdates(UPDATE_CACHE_MINUTES)
    json(res, info)
  }
}

/** POST /api/update/check — force an update check (bypasses cache) */
export function updateCheckHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
    const info = await checkForUpdates(0) // bypass cache
    json(res, info)
  }
}

/** POST /api/update/install — trigger update installation */
export function updateInstallHandler(apiKey: string): Handler {
  return async (_req, res, _printer) => {
    if (!checkAuth(_req, res, apiKey)) return

    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execP = promisify(exec)

    try {
      // git pull
      const pull = await execP('git pull origin main', { timeout: 30000, cwd: process.cwd() })

      // npm install (production only)
      const install = await execP('npm ci --omit=dev', { timeout: 60000, cwd: process.cwd() })

      // rebuild
      const build = await execP('npm run build', { timeout: 30000, cwd: process.cwd() })

      json(res, {
        success: true,
        message: 'Update installed. Restart the server to apply changes.',
        details: {
          pull: pull.stdout.trim(),
          install: install.stderr.slice(-200),
          build: build.stderr.slice(-200)
        }
      })
    } catch (err) {
      json(res, {
        success: false,
        error: `Update failed: ${(err as Error).message}`
      }, 500)
    }
  }
}
