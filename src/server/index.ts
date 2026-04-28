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
import { createReadStream, existsSync, statSync } from 'fs'
import { join, extname } from 'path'
import { Printer } from '../printer'
import { PrintQueue } from '../queue'
import { json } from './helpers'
import type { RouteTable, Handler } from './router'
import { findHandler, sendNotFound, printRoutes } from './router'
import {
  healthHandler,
  printersHandler,
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
  clearJobsHandler
} from './handlers/post-routes'
import { closeDb } from '../db/database'
import { checkForUpdates } from '../updater'
import type { WebhookConfig } from '../types'

// ─── Server ──────────────────────────────────────────────────────────────────

export class WebhookServer {
  private httpServer: ReturnType<typeof createServer> | null = null
  private printer: Printer | null = null
  private queue: PrintQueue | null = null
  private config: Required<WebhookConfig>
  private routes: RouteTable
  private updateTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: WebhookConfig = {}) {
    this.config = {
      port: config.port ?? 3420,
      host: config.host ?? '0.0.0.0',
      apiKey: config.apiKey ?? '',
      defaultPrinter: config.defaultPrinter ?? ''
    }
    this.routes = new Map() // Built in start()
  }

  private buildRoutes(): RouteTable {
    const { apiKey } = this.config
    const getQueue = () => this.queue
    const table: RouteTable = new Map()

    // ── GET routes ──────────────────────────────────────────────────────────
    const get = new Map<string, Handler>()

    // System
    get.set('/api/health', healthHandler)
    get.set('/api/printers', printersHandler(apiKey))
    get.set('/api/docs/openapi.json', openApiHandler)
    get.set('/api/docs', docsHandler)

    // Jobs
    get.set('/api/jobs', jobsListHandler(apiKey))
    get.set('/api/jobs/stats', jobsStatsHandler(apiKey))
    // /api/jobs/:id and /api/jobs/:id/cancel are matched by prefix below

    // Debug
    get.set('/api/debug', debugHandler(apiKey, getQueue))

    // Settings
    get.set('/api/settings', settingsGetHandler(apiKey))

    // Label size
    get.set('/api/label-size', labelSizeGetHandler(apiKey))
    get.set('/api/version', versionHandler(apiKey))

    table.set('GET', get)

    // ── POST routes ─────────────────────────────────────────────────────────
    const post = new Map<string, Handler>()

    post.set('/api/print/text', printTextHandler(apiKey, getQueue))
    post.set('/api/print/barcode', printBarcodeHandler(apiKey, getQueue))
    post.set('/api/print/qr', printQrHandler(apiKey, getQueue))
    post.set('/api/print/zpl', printZplHandler(apiKey, getQueue))
    post.set('/api/print/label', printLabelHandler(apiKey, getQueue))
    post.set('/api/print/serial', printSerialHandler(apiKey, getQueue))

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

    // Pattern: DELETE /api/jobs/:id
    if (method === 'DELETE' && pathname.startsWith('/api/jobs/') && !pathname.endsWith('/cancel') && !pathname.endsWith('/clear')) {
      const parts = pathname.split('/')
      const jobId = parts[3]
      return async (_req, res, _printer) => {
        const { getDb } = await import('../db/database')
        try {
          getDb().prepare('DELETE FROM print_jobs WHERE id = ?').run(jobId)
          json(res, { success: true })
        } catch {
          json(res, { error: 'Failed to delete job' }, 500)
        }
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
      await handler(req, res, this.printer!)
    } catch (err) {
      console.error('Handler error:', err)
      if (!res.headersSent) {
        json(res, { error: 'Internal server error' }, 500)
      }
    }
  }

  /**
   * Connect to a printer, initialize the queue, and start the HTTP server.
   */
  async start(printer?: Printer, printerName?: string): Promise<Printer> {
    if (printer) {
      this.printer = printer
    } else {
      this.printer = await Printer.connectOrAuto(
        printerName || this.config.defaultPrinter || undefined
      )
    }

    // Build routes now that we have printer
    this.routes = this.buildRoutes()

    // Initialize the print queue
    this.queue = new PrintQueue(this.printer)
    this.queue.start()

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
        console.log(`   Printer: ${this.printer!.name}`)
        console.log(`   Queue:   ${this.queue!.getPendingCount()} pending jobs`)
        console.log(`   Docs:    http://${addr}:${this.config.port}/api/docs\n`)
        printRoutes(this.routes)
        console.log()
        resolve(this.printer!)
      })

      this.httpServer.on('error', reject)
    })
  }

  /** Serve static Nuxt web UI files */
  private serveStatic(pathname: string, res: ServerResponse): void {
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
      '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
      '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon'
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
    }, 24 * 60 * 60 * 1000)

    // Run an initial check after 30s
    setTimeout(() => {
      checkForUpdates(0).catch(() => { /* silent */ })
    }, 30000)
  }

  /** Stop the HTTP server, queue processor, and close the database. */
  async stop(): Promise<void> {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }
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
  const port = parseInt(process.env.PORT || '3420', 10)
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
