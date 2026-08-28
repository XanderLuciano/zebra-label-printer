/**
 * WebhookServer — HTTP server that exposes the label printer over the network.
 *
 * Routes: see handlers/get-routes.ts and handlers/post-routes.ts
 * Features: job queue with persistence, debug endpoints, settings management.
 * Validation: Zod schemas from ../schemas.ts
 * Docs: OpenAPI 3.1 spec served at /api/docs (Swagger UI)
 */

import type { IncomingMessage, ServerResponse } from 'http'
import { createServer } from 'http'
import type { Server as NetServer } from 'net'
import { createReadStream, existsSync, statSync } from 'fs'
import { join, extname } from 'path'
// Type-only: connections are opened by the PrinterRegistry now, not here.
import type { Printer } from '../printer'
import { PrintQueue } from '../queue'
import { startRawTcpServer } from '../raw-tcp'
import { json } from './helpers'
import type { RouteTable, Handler } from './router'
import { findHandler, sendNotFound, printRoutes } from './router'
import {
  healthHandler,
  printersDiscoveredHandler,
  openApiHandler,
  docsHandler,
  jobsListHandler,
  jobsStatsHandler,
  jobDetailHandler,
  jobCancelHandler,
  debugHandler,
  settingsGetHandler,
  settingsPutHandler,
  labelSizeGetHandler,
  labelSizePutHandler,
  versionHandler,
  updateCheckHandler,
  updateInstallHandler
} from './handlers/get-routes'
import {
  printTextHandler,
  printBarcodeHandler,
  printQrHandler,
  printZplHandler,
  printLabelHandler,
  printSerialHandler,
  clearJobsHandler,
  jobResultHandler
} from './handlers/post-routes'
import {
  printerConfigureHandler,
  printerCalibrateHandler
} from './handlers/printer-routes'
import {
  printersListHandler,
  printerGetHandler,
  printerCreateHandler,
  printerUpdateHandler,
  printerDeleteHandler,
  printerSetDefaultHandler
} from './handlers/printer-registry-routes'
import {
  templatesListHandler,
  templateGetHandler,
  templateCreateHandler,
  templateUpdateHandler,
  templateDeleteHandler,
  renderZplHandler
} from './handlers/template-routes'
import { closeDb, getDb } from '../db/database'
import { PrinterRegistry, isUnresolved } from '../printer-registry'
import { PrinterHealthMonitor } from '../printer-health'
import { seedBuiltinTemplates } from '../db/template-seed'
import { printJobs } from '../db/schema'
import { eq } from 'drizzle-orm'
import { checkForUpdates } from '../updater'
import type { WebhookConfig } from '../types'
import {
  DEFAULT_HTTP_PORT,
  DEFAULT_TCP_PORT,
  DEFAULT_HOST,
  UPDATE_CHECK_INTERVAL_MS,
  INITIAL_UPDATE_DELAY_MS
} from '../constants'

// ─── Server ──────────────────────────────────────────────────────────────────

export class WebhookServer {
  private httpServer: ReturnType<typeof createServer> | null = null
  /**
   * The default printer's connection.
   *
   * Kept as a convenience for handlers that don't name a printer, and null when
   * nothing is configured — a browser-only setup, where every label goes out over
   * WebUSB, never needs a printer here.
   */
  private printer: Printer | null = null
  private registry: PrinterRegistry = new PrinterRegistry()
  /**
   * Watches for printers being plugged in and unplugged.
   *
   * Nothing else does: the queue processor only checks a printer when there is
   * work for it, so an idle server never noticed a disconnect.
   */
  private health: PrinterHealthMonitor = new PrinterHealthMonitor()
  private queue: PrintQueue | null = null
  private config: Required<WebhookConfig>
  private routes: RouteTable
  private updateTimer: ReturnType<typeof setInterval> | null = null
  private tcpServer: NetServer | null = null

  constructor(config: WebhookConfig = {}) {
    this.config = {
      port: config.port ?? DEFAULT_HTTP_PORT,
      host: config.host ?? DEFAULT_HOST,
      apiKey: config.apiKey ?? '',
      defaultPrinter: config.defaultPrinter ?? '',
      tcpPort: config.tcpPort ?? DEFAULT_TCP_PORT
    }
    this.routes = new Map() // Built in start()
  }

  private buildRoutes(): RouteTable {
    const { apiKey } = this.config
    const getQueue = () => this.queue
    const getRegistry = () => this.registry
    const table: RouteTable = new Map()

    // ── GET routes ──────────────────────────────────────────────────────────
    const get = new Map<string, Handler>()

    // System
    get.set('/api/health', healthHandler)
    get.set('/api/docs/openapi.json', openApiHandler)
    get.set('/api/docs', docsHandler)

    // Printers. /api/printers is the *configured* list with each printer's media
    // config; /api/printers/discovered is the raw CUPS view.
    // /api/printers/:id is matched by prefix below.
    get.set('/api/printers', printersListHandler(apiKey))
    get.set('/api/printers/discovered', printersDiscoveredHandler(apiKey))

    // Jobs
    get.set('/api/jobs', jobsListHandler(apiKey))
    get.set('/api/jobs/stats', jobsStatsHandler(apiKey))
    // /api/jobs/:id and /api/jobs/:id/cancel are matched by prefix below

    // Debug
    get.set('/api/debug', debugHandler(apiKey, getQueue, () => this.health))

    // Settings
    get.set('/api/settings', settingsGetHandler(apiKey))

    // Label size
    get.set('/api/label-size', labelSizeGetHandler(apiKey))
    get.set('/api/version', versionHandler(apiKey))

    // Templates (/api/templates/:id handled by prefix below)
    get.set('/api/templates', templatesListHandler(apiKey))

    table.set('GET', get)

    // ── POST routes ─────────────────────────────────────────────────────────
    const post = new Map<string, Handler>()

    post.set('/api/print/text', printTextHandler(apiKey, getQueue, getRegistry))
    post.set('/api/print/barcode', printBarcodeHandler(apiKey, getQueue, getRegistry))
    post.set('/api/print/qr', printQrHandler(apiKey, getQueue, getRegistry))
    post.set('/api/print/zpl', printZplHandler(apiKey, getQueue, getRegistry))
    post.set('/api/print/label', printLabelHandler(apiKey, getQueue, getRegistry))
    post.set('/api/print/serial', printSerialHandler(apiKey, getQueue, getRegistry))

    // Templates + rendering
    post.set('/api/templates', templateCreateHandler(apiKey))
    post.set('/api/render/zpl', renderZplHandler(apiKey))

    // Printer registry (/api/printers/:id/default matched by prefix below)
    post.set('/api/printers', printerCreateHandler(apiKey, getRegistry))

    // Printer media configuration
    post.set('/api/printer/configure', printerConfigureHandler(apiKey, getRegistry))
    post.set('/api/printer/calibrate', printerCalibrateHandler(apiKey, getRegistry))

    // Job actions
    post.set('/api/jobs/cancel', jobCancelHandler(apiKey, getQueue))
    post.set('/api/jobs/clear', clearJobsHandler(apiKey))
    post.set('/api/update/check', updateCheckHandler(apiKey))
    post.set('/api/update/install', updateInstallHandler(apiKey))

    table.set('POST', post)

    // ── PUT routes ──────────────────────────────────────────────────────────
    const put = new Map<string, Handler>()
    put.set('/api/settings', settingsPutHandler(apiKey))
    put.set('/api/label-size', labelSizePutHandler(apiKey))
    table.set('PUT', put)

    // ── DELETE routes ──────────────────────────────────────────────────────
    const del = new Map<string, Handler>()
    del.set('/api/jobs/clear', clearJobsHandler(apiKey))
    table.set('DELETE', del)

    return table
  }

  /**
   * Match routes that contain path parameters.
   * e.g., /api/jobs/job_123 → jobDetailHandler
   *        /api/jobs/job_123/cancel → jobCancelHandler (handled by POST for now)
   */
  private matchRoute(method: string, pathname: string): Handler | null {
    // Try exact match first
    const handler = findHandler(this.routes, method, pathname)
    if (handler) return handler

    // Pattern: /api/jobs/:id
    if (method === 'GET' && pathname.startsWith('/api/jobs/')) {
      const parts = pathname.split('/')
      if (parts.length === 4) {
        return jobDetailHandler(this.config.apiKey)
      }
    }

    // Pattern: POST /api/jobs/:id/cancel
    if (method === 'POST' && pathname.startsWith('/api/jobs/') && pathname.endsWith('/cancel')) {
      return jobCancelHandler(this.config.apiKey, () => this.queue)
    }

    // Pattern: POST /api/jobs/:id/result — outcome of a locally printed job
    if (method === 'POST' && pathname.startsWith('/api/jobs/') && pathname.endsWith('/result')) {
      return jobResultHandler(this.config.apiKey, () => this.queue)
    }

    // Pattern: DELETE /api/jobs/:id
    if (method === 'DELETE' && pathname.startsWith('/api/jobs/') && !pathname.endsWith('/cancel') && !pathname.endsWith('/clear')) {
      const parts = pathname.split('/')
      const jobId = parts[3]
      return async (_req, res, _printer) => {
        try {
          getDb().delete(printJobs).where(eq(printJobs.id, jobId)).run()
          json(res, { success: true })
        } catch {
          json(res, { error: 'Failed to delete job' }, 500)
        }
      }
    }

    // Pattern: POST /api/printers/:id/default
    if (method === 'POST' && pathname.startsWith('/api/printers/') && pathname.endsWith('/default')) {
      const id = decodeURIComponent(pathname.split('/')[3] ?? '')
      if (id) return printerSetDefaultHandler(this.config.apiKey, id)
    }

    // Pattern: /api/printers/:id (GET, PUT, DELETE).
    // '/api/printers/discovered' is an exact GET route, matched above.
    if (pathname.startsWith('/api/printers/')) {
      const parts = pathname.split('/')
      if (parts.length === 4 && parts[3]) {
        const id = decodeURIComponent(parts[3])
        const getRegistry = () => this.registry
        if (method === 'GET') return printerGetHandler(this.config.apiKey, id)
        if (method === 'PUT') return printerUpdateHandler(this.config.apiKey, id, getRegistry)
        if (method === 'DELETE') return printerDeleteHandler(this.config.apiKey, id, getRegistry)
      }
    }

    // Pattern: /api/templates/:id (GET, PUT, DELETE)
    if (pathname.startsWith('/api/templates/')) {
      const parts = pathname.split('/')
      if (parts.length === 4 && parts[3]) {
        const id = decodeURIComponent(parts[3])
        if (method === 'GET') return templateGetHandler(this.config.apiKey, id)
        if (method === 'PUT') return templateUpdateHandler(this.config.apiKey, id)
        if (method === 'DELETE') return templateDeleteHandler(this.config.apiKey, id)
      }
    }

    return null
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const method = req.method?.toUpperCase() ?? 'GET'

    // Serve static web UI for non-API routes
    if (method === 'GET' && !url.pathname.startsWith('/api/')) {
      this.serveStatic(url.pathname, res)
      return
    }

    const handler = this.matchRoute(method, url.pathname)

    if (!handler) {
      sendNotFound(
        res, method, url.pathname, this.routes,
        req.headers.host ?? 'localhost', this.config.port
      )
      return
    }

    // Printer and queue are optional for GET requests like /api/debug
    // The handlers themselves check if printer is available when needed

    try {
      await handler(req, res, this.printer)
    } catch (err) {
      console.error('Handler error:', err)
      if (!res.headersSent) {
        json(res, { error: 'Internal server error' }, 500)
      }
    }
  }

  /**
   * Populate the printer registry and connect the default printer.
   *
   * Discovered CUPS printers are registered if they aren't already, so an existing
   * install comes up with its printer configured rather than an empty list.
   *
   * Starting without any printer is allowed: someone printing only to a
   * browser-attached USB printer has no CUPS queue here, and refusing to start
   * would lock them out of the app entirely.
   */
  private async initPrinters(printerName?: string): Promise<void> {
    const { adopted } = await this.registry.sync()
    if (adopted.length > 0) {
      console.log(`   Registered ${adopted.length} printer${adopted.length > 1 ? 's' : ''} from CUPS`)
    }

    // An explicitly requested printer wins over the stored default.
    const requested = printerName || this.config.defaultPrinter || ''
    if (requested) {
      const { getPrinterProfileByCupsName } = await import('../db/printer-repo')
      const profile = getPrinterProfileByCupsName(requested)
      if (profile) {
        this.registry.invalidate(profile.id)
        const resolved = await this.registry.resolve(profile.id)
        if (!isUnresolved(resolved)) {
          this.printer = resolved.printer
          return
        }
      }
    }

    const resolved = await this.registry.resolve()
    this.printer = isUnresolved(resolved) ? null : resolved.printer
  }

  /**
   * Connect to a printer, initialize the queue, and start the HTTP + TCP servers.
   *
   * @param printer - Use this connection as the default instead of resolving one.
   * @param printerName - CUPS name of the printer to prefer as the default.
   * @returns the default printer connection, or null when none is configured.
   */
  async start(printer?: Printer, printerName?: string): Promise<Printer | null> {
    if (printer) {
      this.printer = printer
    } else {
      await this.initPrinters(printerName)
    }

    // Build routes now that the registry is populated
    this.routes = this.buildRoutes()

    // Initialize the print queue. It resolves each job's printer through the
    // registry rather than holding one connection, so jobs for different printers
    // don't block each other.
    this.queue = new PrintQueue(this.registry)
    this.queue.start()

    // Watch for printers coming and going, recording the transitions so
    // printer_events is a real connectivity history.
    this.health.start()

    // Offer the built-in example templates once, so a fresh install has
    // something to print from. Deleting or editing one is respected.
    try {
      const { seeded } = seedBuiltinTemplates()
      if (seeded.length > 0) {
        console.log(`   Seeded ${seeded.length} example template${seeded.length > 1 ? 's' : ''}`)
      }
    } catch (err) {
      // Examples are a convenience; never block startup over them.
      console.error(`Could not seed example templates: ${(err as Error).message}`)
    }

    // Start periodic update check (once per day)
    this.startUpdateCheck()

    return new Promise((resolve, reject) => {
      this.httpServer = createServer((req, res) => {
        this.handleRequest(req, res).catch(err => {
          console.error('Request error:', err)
          if (!res.headersSent) {
            json(res, { error: 'Internal server error' }, 500)
          }
        })
      })

      this.httpServer.listen(this.config.port, this.config.host, () => {
        const addr = this.config.host === '0.0.0.0' ? 'localhost' : this.config.host
        console.log('\n🦓  Zebra Label Printer API')
        console.log(`   Server:  http://${addr}:${this.config.port}`)

        const profiles = this.registry.profiles()
        if (profiles.length === 0) {
          console.log('   Printer: none configured — add one in Settings, or print from a browser over WebUSB')
        } else {
          for (const profile of profiles) {
            const marker = profile.isDefault ? '*' : ' '
            const size = `${profile.labelSize.widthInches}×${profile.labelSize.heightInches}"`
            console.log(`   Printer:${marker}${profile.name} (${profile.transport}, ${size} @ ${profile.dpi} DPI)`)
          }
        }

        console.log(`   Queue:   ${this.queue!.getPendingCount()} pending jobs`)
        console.log(`   Docs:    http://${addr}:${this.config.port}/api/docs\n`)
        printRoutes(this.routes)
        console.log()

        // Start raw TCP passthrough (Zebra network protocol)
        const tcpPort = this.config.tcpPort ?? parseInt(process.env.ZEBRA_TCP_PORT || String(DEFAULT_TCP_PORT), 10)
        if (tcpPort > 0) {
          const tcpHost = this.config.host
          try {
            this.tcpServer = startRawTcpServer(tcpPort, tcpHost, () => this.queue, () => this.printer)
          } catch (err) {
            console.error(`   \u26a0 Failed to start raw TCP on port ${tcpPort}: ${(err as Error).message}`)
          }
        }

        resolve(this.printer)
      })

      this.httpServer.on('error', reject)
    })
  }

  /** Serve static Nuxt web UI files */
  private serveStatic(pathname: string, res: ServerResponse): void {
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
      '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
      // The label previews self-host the ZPL preview faces from public/fonts, and
      // three of them are TrueType. Without these they fell back to
      // application/octet-stream, which browsers tolerate but shouldn't have to.
      '.ttf': 'font/ttf', '.otf': 'font/otf',
      // Those fonts ship licence notices next to them that the Apache 2.0 and
      // Bitstream Vera terms require to travel with the files; serve them as text
      // so they're readable rather than downloaded as binary.
      '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
    }

    // Check multiple possible locations (dev vs distributed)
    const candidates = [
      'public',                          // dist-zebra/public/
      'web/.output/public'              // dev: web/.output/public/
    ]

    let staticDir = ''
    for (const cand of candidates) {
      const full = join(process.cwd(), cand)
      if (existsSync(join(full, 'index.html'))) {
        staticDir = full
        break
      }
    }

    if (!staticDir) {
      res.writeHead(404)
      res.end('UI not found — run build.sh first')
      return
    }

    let filePath = join(staticDir, pathname === '/' ? 'index.html' : pathname)

    // SPA fallback: if file doesn't exist, serve index.html
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      filePath = join(staticDir, 'index.html')
    }

    if (!existsSync(filePath)) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    const ext = extname(filePath)
    const contentType = mimeTypes[ext] || 'application/octet-stream'

    try {
      const stream = createReadStream(filePath)
      res.writeHead(200, { 'Content-Type': contentType })
      stream.pipe(res)
    } catch {
      res.writeHead(500)
      res.end('Internal error')
    }
  }

  /** Start periodic update check (once every 24 hours) */
  private async startUpdateCheck(): Promise<void> {
    const { getBoolSetting } = await import('../db/settings-repo')
    if (!getBoolSetting('auto_update_check', true)) {
      return
    }

    this.updateTimer = setInterval(() => {
      checkForUpdates(0).catch(() => { /* silent */ })
    }, UPDATE_CHECK_INTERVAL_MS)

    // Run an initial check after startup delay
    setTimeout(() => {
      checkForUpdates(0).catch(() => { /* silent */ })
    }, INITIAL_UPDATE_DELAY_MS)
  }

  /** Stop the HTTP server, queue processor, and close the database. */
  async stop(): Promise<void> {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }
    // Stop raw TCP server
    const tcpServer = this.tcpServer
    if (tcpServer) {
      tcpServer.close(() => {
        console.log('  Raw TCP server stopped')
      })
    }

    this.health.stop()

    if (this.queue) {
      this.queue.stop()
      this.queue = null
    }

    return new Promise(resolve => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          console.log('Server stopped')
          this.httpServer = null
          try {
            closeDb()
          } catch { /* ok */ }
          resolve()
        })
      } else {
        try {
          closeDb()
        } catch { /* ok */ }
        resolve()
      }
    })
  }
}

/**
 * Quick-start helper: creates and starts a WebhookServer with auto-discovery.
 */
export async function startServer(config: WebhookConfig = {}): Promise<WebhookServer> {
  const server = new WebhookServer(config)
  await server.start()
  return server
}

// Run directly if executed as main module
if (require.main === module) {
  const port = parseInt(process.env.PORT || String(DEFAULT_HTTP_PORT), 10)
  const printerName = process.env.ZEBRA_PRINTER || undefined
  const apiKey = process.env.ZEBRA_API_KEY || ''

  const server = new WebhookServer({ port, defaultPrinter: printerName, apiKey })

  server.start().catch(err => {
    console.error('Failed to start server:', err)
    process.exit(1)
  })

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...')
    await server.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
