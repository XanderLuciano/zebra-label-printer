/**
 * GET route handlers — health, discovery, docs, jobs, debug, settings.
 */

import type { Handler } from '../router'
import { json, html, checkAuth } from '../helpers'
import { OPENAPI_SPEC, swaggerUiHtml } from '../../openapi'
import {
  listJobs,
  getJob,
  getJobLogs,
  getJobStats,
  countPendingJobs,
  countPendingJobsForPrinter
} from '../../db/print-job-repo'
import { getAllSettings, getPrinterEvents, getLabelSize, getRecentSizes, setLabelSize, STANDARD_SIZES } from '../../db/settings-repo'
import { listPrinterProfiles } from '../../db/printer-repo'
import { checkForUpdates } from '../../updater'
import { getSqlite } from '../../db/database'
import { mediaConfigZpl } from '../../zpl'
import {
  JOB_STATUSES,
  DEFAULT_DPI,
  DEFAULT_MEDIA_TRACKING,
  MIN_LABEL_WIDTH_DOTS,
  MIN_LABEL_HEIGHT_DOTS,
  UPDATE_CACHE_MINUTES
} from '../../constants'
import type { MediaTracking } from '../../constants'
import type { PrintQueue } from '../../queue'
import type { PrinterHealthMonitor } from '../../printer-health'

/** GET /api/health — server and printer status */
export const healthHandler: Handler = async (_req, res, printer) => {
  json(res, { status: 'ok', printer: printer?.name ?? null })
}

/**
 * GET /api/printers/discovered — printers CUPS can see, configured or not.
 *
 * The configured printer list lives at `GET /api/printers`; this is the raw
 * discovery view, kept for diagnostics and for callers that only want to know
 * what hardware is attached.
 */
export function printersDiscoveredHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
    const { discoverPrinters } = await import('../../discovery')
    try {
      json(res, { printers: await discoverPrinters() })
    } catch (err) {
      // No CUPS here. An empty list is the honest answer, not an error.
      json(res, { printers: [], error: (err as Error).message })
    }
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
    const printerId = url.searchParams.get('printerId') ?? undefined
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
      printerId,
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
export function debugHandler(
  apiKey: string,
  getQueue: () => PrintQueue | null,
  getHealth?: () => PrinterHealthMonitor | null
): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const sqlite = getSqlite()
    const dbSize = sqlite.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get() as { size: number }

    // Reported per configured printer rather than for a single one, since the
    // interesting failure now is "which of my printers is offline" — and whether
    // it's offline or simply unplugged, which are different problems.
    // Poll rather than serving the last scheduled observation: diagnostics are
    // requested by a human who wants the current truth, and it keeps this in step
    // with GET /api/printers, which computes health live.
    const monitor = getHealth?.() ?? null
    if (monitor) await monitor.check().catch(() => { /* fall back to last known */ })

    const printers = []
    for (const profile of listPrinterProfiles()) {
      const state = monitor?.get(profile.id)
      printers.push({
        id: profile.id,
        name: profile.name,
        transport: profile.transport,
        cupsName: profile.cupsName,
        isDefault: profile.isDefault,
        labelSize: profile.labelSize,
        dpi: profile.dpi,
        tracking: profile.tracking,
        pending: countPendingJobsForPrinter(profile.id),
        health: state?.health ?? 'unknown',
        presence: state?.presence ?? 'unknown',
        healthChangedAt: state?.changedAt ?? null
      })
    }

    const info = {
      printer: printer
        ? { name: printer.name, isReady: await printer.isReady() }
        : { name: null, isReady: false },
      printers,
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

/**
 * PUT /api/label-size — set label dimensions.
 *
 * Also pushes the geometry to the connected printer unless
 * `applyToPrinter: false` is passed.
 */
export function labelSizePutHandler(apiKey: string): Handler {
  return async (req, res, printer) => {
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

    // Push the new geometry to the printer as well. Saving the setting alone
    // only changes the ZPL we generate — the printer keeps its own stored print
    // width and media settings, which is how a size change ends up producing
    // clipped or drifting labels. Set `applyToPrinter: false` to skip.
    let printerConfig: { applied: boolean; error?: string } = { applied: false }
    if (data.applyToPrinter !== false && printer) {
      const zpl = mediaConfigZpl({
        widthDots,
        heightDots,
        dpi: DEFAULT_DPI,
        tracking: (data.tracking as MediaTracking) ?? DEFAULT_MEDIA_TRACKING
      })
      const result = await printer.print(zpl)
      printerConfig = result.success
        ? { applied: true }
        : { applied: false, error: result.error }
    }

    json(res, { success: true, size, printerConfig })
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
