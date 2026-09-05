/**
 * Server helpers — HTTP response utilities, body parsing, auth, and validation.
 *
 * Small, pure functions with no side effects beyond the response object.
 *
 * Error responses are built by `sendError()` in ./errors, which owns the status
 * code and the `code` taxonomy. Handlers should prefer it over `json(res, {
 * error }, status)` so failures stay branchable by machines as well as readable
 * by people.
 */

import type { IncomingMessage, ServerResponse } from 'http'
import type { ZodSchema } from 'zod'
import { sendError, zodDetails, zodSummary } from './errors'

/** Send a JSON response */
export function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data, null, 2))
}

/** Send an HTML response */
export function html(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(body)
}

/** Read the full request body as a UTF-8 string */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
  })
}

/** Safely parse JSON, returning null on failure */
export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Validate request body against a Zod schema.
 * Returns parsed data, or sends a 400 and returns null on failure.
 *
 * The failure body keeps its original `error` and `details` fields and gains a
 * machine-readable `code`, so existing clients are unaffected and integrations
 * have something stable to branch on. See src/server/errors.ts.
 */
export async function validate<T>(
  req: IncomingMessage,
  res: ServerResponse,
  schema: ZodSchema<T>
): Promise<T | null> {
  const raw = await readBody(req)

  const parsed = parseJson(raw)
  if (parsed === null) {
    sendError(res, 'INVALID_JSON', 'Invalid JSON body', {
      message: 'The request body could not be parsed as JSON.'
    })
    return null
  }

  const result = schema.safeParse(parsed)
  if (result.success) {
    return result.data
  }

  sendError(res, 'VALIDATION_FAILED', 'Validation failed', {
    message: zodSummary(result.error),
    details: zodDetails(result.error)
  })
  return null
}

/**
 * Validate an already-parsed value against a Zod schema.
 *
 * Same response shape as `validate()`, for handlers that have the body in hand
 * already — a path parameter folded into the payload, say.
 */
export function validateValue<T>(
  res: ServerResponse,
  schema: ZodSchema<T>,
  value: unknown
): T | null {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  sendError(res, 'VALIDATION_FAILED', 'Validation failed', {
    message: zodSummary(result.error),
    details: zodDetails(result.error)
  })
  return null
}

/**
 * Check API key authentication.
 * Returns true if authorized, sends 401 and returns false otherwise.
 * If no apiKey is configured, all requests pass.
 */
export function checkAuth(
  req: IncomingMessage,
  res: ServerResponse,
  apiKey: string
): boolean {
  if (!apiKey) return true

  const authHeader = req.headers['authorization']
  if (authHeader === `Bearer ${apiKey}`) return true

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  if (url.searchParams.get('key') === apiKey) return true

  sendError(
    res,
    'UNAUTHORIZED',
    'Unauthorized — provide a valid API key via Bearer auth or ?key= query param'
  )
  return false
}
