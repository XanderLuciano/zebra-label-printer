/**
 * Route handler type and router logic.
 *
 * Routes are organized as Map<HTTPMethod, Map<path, Handler>>.
 * Handlers receive (req, res, printer) and send their own responses.
 */

import type { IncomingMessage, ServerResponse } from 'http'
import type { Printer } from '../printer'
import { json } from './helpers'

/**
 * A route handler: receives request, response, and the default printer.
 *
 * The printer is nullable because a server with no printer configured is a valid
 * setup — someone printing only to a browser-attached USB printer never needs one
 * here. Handlers that require a printer check for it and answer 503.
 *
 * Handlers that need to address a *specific* printer take a registry accessor via
 * their factory instead; this argument is only the default.
 */
export type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  printer: Printer | null
) => Promise<void>

/** Complete route table: method → path → handler */
export type RouteTable = Map<string, Map<string, Handler>>

/**
 * Build a 404 response listing all available endpoints.
 */
export function sendNotFound(
  res: ServerResponse,
  method: string,
  pathname: string,
  routes: RouteTable,
  host: string,
  port: number
): void {
  const endpoints: string[] = []
  for (const [m, methodRoutes] of routes) {
    for (const [p] of methodRoutes) {
      endpoints.push(`${m} ${p}`)
    }
  }
  // Pattern-matched routes are not in the table, so they have to be added
  // explicitly or a caller reading this list concludes they don't exist.
  for (const route of PARAMETERISED_ROUTES) {
    endpoints.push(route.replace(/\s+/g, ' '))
  }
  json(res, {
    error: `No route for ${method} ${pathname}`,
    code: 'NOT_FOUND',
    endpoints: endpoints.sort(),
    docs: `http://${host}:${port}/api/docs`
  }, 404)
}

/**
 * Find a handler for the given method + path. Returns null if no match.
 */
export function findHandler(routes: RouteTable, method: string, pathname: string): Handler | null {
  const methodRoutes = routes.get(method)
  if (!methodRoutes) return null
  return methodRoutes.get(pathname) ?? null
}

// ─── Template print webhooks ─────────────────────────────────────────────────

const TEMPLATE_PRINT_PREFIX = '/api/print/template/'

/**
 * Extract the template short name from a print-webhook path, or null.
 *
 * Everything callable lives under `/api/`, so an integrator pointing a system at
 * this server can see from the URL that it is an API. A bare `/print/{shortName}`
 * alias was tried and removed: automation does not benefit from the shorter path,
 * and it collided in spirit with the web UI's own `/print` page.
 *
 * A trailing segment does not match — a short name cannot contain a slash, so the
 * caller wants something else and deserves a 404 over having part of their path
 * ignored. Malformed percent-encoding returns null rather than throwing, so a bad
 * URL is a 404 and not a 500.
 */
export function matchTemplatePrintPath(method: string, pathname: string): string | null {
  if (method !== 'POST' || !pathname.startsWith(TEMPLATE_PRINT_PREFIX)) return null

  const rest = pathname.slice(TEMPLATE_PRINT_PREFIX.length)
  if (!rest || rest.includes('/')) return null

  try {
    return decodeURIComponent(rest) || null
  } catch {
    return null
  }
}

/**
 * Routes matched by pattern rather than exact path.
 *
 * The route table holds only exact paths, so these are invisible to the startup
 * banner and the 404 endpoint list unless listed here — and an integrator's first
 * move is to hit a wrong URL and read what *is* available.
 *
 * Keep in step with `WebhookServer.matchRoute()`. This is advertisement, not
 * dispatch: adding a line here does not create a route. `openapi-drift.test.ts`
 * asserts every entry is documented.
 */
export const PARAMETERISED_ROUTES: readonly string[] = [
  'GET    /api/jobs/:id',
  'POST   /api/jobs/:id/cancel',
  'POST   /api/jobs/:id/result',
  'DELETE /api/jobs/:id',
  'GET    /api/printers/:id',
  'PUT    /api/printers/:id',
  'DELETE /api/printers/:id',
  'POST   /api/printers/:id/default',
  'GET    /api/templates/:id',
  'PUT    /api/templates/:id',
  'DELETE /api/templates/:id',
  'GET    /api/templates/:shortName/schema',
  'POST   /api/print/template/:shortName'
]

/**
 * Print all registered routes to console (startup banner).
 */
export function printRoutes(routes: RouteTable): void {
  for (const [method, methodRoutes] of routes) {
    for (const [path] of methodRoutes) {
      console.log(`   ${method.padEnd(5)} ${path}`)
    }
  }
  for (const route of PARAMETERISED_ROUTES) {
    console.log(`   ${route}`)
  }
}
