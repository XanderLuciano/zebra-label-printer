/**
 * Standardized API error responses.
 *
 * `code` was added *alongside* the pre-existing `error` string rather than
 * replacing it, so the web UI and every existing caller keep working. `code` is
 * the contract; `error` and `message` are for humans and may be reworded freely.
 *
 * See .ai/template-print-api.md.
 */

import type { ServerResponse } from 'http'
import type { ZodError } from 'zod'

/** Adding a member is a compatible change; renaming or removing one is not. */
export const API_ERROR_CODES = [
  // 400
  'INVALID_JSON',
  'VALIDATION_FAILED',
  'UNKNOWN_VARIABLES',
  'MISSING_VARIABLES',
  'RENDER_FAILED',
  'BAD_REQUEST',
  // 401 / 403
  'UNAUTHORIZED',
  'PRESET_IMMUTABLE',
  // 404
  'TEMPLATE_NOT_FOUND',
  'PRINTER_NOT_FOUND',
  'NOT_FOUND',
  // 409
  'SHORT_NAME_TAKEN',
  // 429
  'RATE_LIMITED',
  // 500
  'PRINT_FAILED',
  'INTERNAL_ERROR',
  // 503
  'NO_PRINTER',
  'QUEUE_UNAVAILABLE'
] as const

export type ApiErrorCode = typeof API_ERROR_CODES[number]

export interface ApiErrorDetail {
  /** Dotted path to the offending field, or '(root)' for the body itself. */
  field: string
  message: string
  /** Zod's own issue code, e.g. 'too_big'. */
  code?: string
}

export interface ApiErrorBody {
  error: string
  code: ApiErrorCode
  message?: string
  details?: ApiErrorDetail[]
  /** Free-form context, e.g. the printer id that wasn't found. */
  [key: string]: unknown
}

/**
 * One table, so a code cannot be sent with an inconsistent status from two
 * handlers — which is how a caller ends up trusting neither field.
 */
const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  INVALID_JSON: 400,
  VALIDATION_FAILED: 400,
  UNKNOWN_VARIABLES: 400,
  MISSING_VARIABLES: 400,
  RENDER_FAILED: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PRESET_IMMUTABLE: 403,
  TEMPLATE_NOT_FOUND: 404,
  PRINTER_NOT_FOUND: 404,
  NOT_FOUND: 404,
  SHORT_NAME_TAKEN: 409,
  RATE_LIMITED: 429,
  PRINT_FAILED: 500,
  INTERNAL_ERROR: 500,
  NO_PRINTER: 503,
  QUEUE_UNAVAILABLE: 503
}

export function statusForCode(code: ApiErrorCode): number {
  return STATUS_BY_CODE[code]
}

export interface SendErrorOptions {
  message?: string
  details?: ApiErrorDetail[]
  /** Extra top-level fields, e.g. `{ printerId }` or `{ accepts: [...] }`. */
  extra?: Record<string, unknown>
  /** Override the code's default status. Use sparingly. */
  status?: number
  headers?: Record<string, string>
}
export function sendError(
  res: ServerResponse,
  code: ApiErrorCode,
  error: string,
  options: SendErrorOptions = {}
): void {
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    res.setHeader(name, value)
  }
  const body: ApiErrorBody = {
    error,
    code,
    ...(options.message ? { message: options.message } : {}),
    ...(options.details?.length ? { details: options.details } : {}),
    ...(options.extra ?? {})
  }
  // Written directly rather than through helpers.json(): helpers.ts calls
  // sendError() from validate(), so importing json() here would make the two
  // modules circular. Same two lines, no cycle.
  res.writeHead(options.status ?? statusForCode(code), { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body, null, 2))
}

export function zodDetails(err: ZodError): ApiErrorDetail[] {
  return err.issues.map(issue => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
    code: issue.code
  }))
}

/**
 * One-line summary, so a caller reading a log line gets something actionable
 * without unpacking `details`.
 */
export function zodSummary(err: ZodError): string {
  const [first] = zodDetails(err)
  if (!first) return 'Validation failed'
  const more = err.issues.length - 1
  const suffix = more > 0 ? ` (and ${more} more problem${more > 1 ? 's' : ''})` : ''
  return `${first.field}: ${first.message}${suffix}`
}
