/**
 * Route handler type and router logic.
 *
 * Routes are organized as Map<HTTPMethod, Map<path, Handler>>.
 * Handlers receive (req, res, printer) and send their own responses.
 */

import type { IncomingMessage, ServerResponse } from 'http'
import type { Printer } from '../printer'
import { json } from './helpers'

/** A route handler: receives request, response, and the active printer */
export type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  printer: Printer
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
  json(res, {
    error: `No route for ${method} ${pathname}`,
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

/**
 * Print all registered routes to console (startup banner).
 */
export function printRoutes(routes: RouteTable): void {
  for (const [method, methodRoutes] of routes) {
    for (const [path] of methodRoutes) {
      console.log(`   ${method.padEnd(5)} ${path}`)
    }
  }
}
