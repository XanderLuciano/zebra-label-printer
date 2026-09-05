/**
 * The API error envelope. The contract under test is backwards compatibility:
 * `error` stays a plain string because the web UI reads it, while `code` is added
 * for integrations. Breaking the first half breaks the UI silently.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import type { ServerResponse } from 'http'
import {
  sendError,
  statusForCode,
  zodDetails,
  zodSummary,
  API_ERROR_CODES
} from '../../src/server/errors'

/** A ServerResponse stand-in that records what was written. */
function fakeRes() {
  const state = {
    status: 0,
    headers: {} as Record<string, string>,
    body: '' as string,
    get json() {
      return JSON.parse(state.body) as Record<string, unknown>
    }
  }
  const res = {
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value
    },
    writeHead(status: number, headers?: Record<string, string>) {
      state.status = status
      for (const [name, value] of Object.entries(headers ?? {})) {
        state.headers[name.toLowerCase()] = value
      }
      return res
    },
    end(chunk?: string) {
      state.body = chunk ?? ''
    }
  } as unknown as ServerResponse
  return { res, state }
}

describe('sendError', () => {
  it('keeps `error` a plain string for backwards compatibility', () => {
    // The web UI's apiError() reads exactly this field. If it ever became an
    // object, every error message in the UI would render as "[object Object]".
    const { res, state } = fakeRes()
    sendError(res, 'TEMPLATE_NOT_FOUND', 'Template not found')
    expect(typeof state.json.error).toBe('string')
    expect(state.json.error).toBe('Template not found')
  })

  it('adds a machine-readable code', () => {
    const { res, state } = fakeRes()
    sendError(res, 'TEMPLATE_NOT_FOUND', 'Template not found')
    expect(state.json.code).toBe('TEMPLATE_NOT_FOUND')
  })

  it('derives the status from the code', () => {
    const cases: Array<[Parameters<typeof sendError>[1], number]> = [
      ['VALIDATION_FAILED', 400],
      ['UNAUTHORIZED', 401],
      ['PRESET_IMMUTABLE', 403],
      ['TEMPLATE_NOT_FOUND', 404],
      ['SHORT_NAME_TAKEN', 409],
      ['RATE_LIMITED', 429],
      ['PRINT_FAILED', 500],
      ['NO_PRINTER', 503]
    ]
    for (const [code, status] of cases) {
      const { res, state } = fakeRes()
      sendError(res, code, 'x')
      expect(state.status, `${code} should be ${status}`).toBe(status)
    }
  })

  it('sends JSON', () => {
    const { res, state } = fakeRes()
    sendError(res, 'BAD_REQUEST', 'nope')
    expect(state.headers['content-type']).toBe('application/json')
  })

  it('omits message and details when there is nothing to say', () => {
    const { res, state } = fakeRes()
    sendError(res, 'BAD_REQUEST', 'nope')
    expect(state.json).not.toHaveProperty('message')
    expect(state.json).not.toHaveProperty('details')
  })

  it('includes message, details, and extra context when given', () => {
    const { res, state } = fakeRes()
    sendError(res, 'UNKNOWN_VARIABLES', 'Unknown variable: x', {
      message: 'This template accepts: a, b',
      details: [{ field: 'variables.x', message: 'Not a variable of this template' }],
      extra: { accepts: ['a', 'b'] }
    })
    expect(state.json.message).toBe('This template accepts: a, b')
    expect(state.json.details).toHaveLength(1)
    expect(state.json.accepts).toEqual(['a', 'b'])
  })

  it('drops an empty details array rather than sending a useless key', () => {
    const { res, state } = fakeRes()
    sendError(res, 'BAD_REQUEST', 'nope', { details: [] })
    expect(state.json).not.toHaveProperty('details')
  })

  it('sets response headers, so Retry-After can accompany a 429', () => {
    const { res, state } = fakeRes()
    sendError(res, 'RATE_LIMITED', 'Too many', { headers: { 'Retry-After': '60' } })
    expect(state.headers['retry-after']).toBe('60')
    expect(state.status).toBe(429)
  })

  it('honours an explicit status override', () => {
    const { res, state } = fakeRes()
    sendError(res, 'BAD_REQUEST', 'nope', { status: 422 })
    expect(state.status).toBe(422)
  })
})

describe('statusForCode', () => {
  it('maps every declared code to a sensible HTTP status', () => {
    // A missing entry would send `undefined` as a status and throw at runtime.
    for (const code of API_ERROR_CODES) {
      const status = statusForCode(code)
      expect(typeof status, `${code} has no status`).toBe('number')
      expect(status).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(600)
    }
  })
})

describe('zodDetails', () => {
  const schema = z.object({
    quantity: z.number().int().max(500, 'Too many copies'),
    nested: z.object({ deep: z.string() })
  }).strict()

  it('reports a dotted path per issue', () => {
    const result = schema.safeParse({ quantity: 501, nested: { deep: 7 } })
    expect(result.success).toBe(false)
    const details = zodDetails(result.error!)
    const fields = details.map(d => d.field)
    expect(fields).toContain('quantity')
    expect(fields).toContain('nested.deep')
  })

  it('labels a root-level problem rather than sending an empty field', () => {
    // An unrecognised key on a strict object has no path; '(root)' is more useful
    // to a caller than ''.
    const result = schema.safeParse({ quantity: 1, nested: { deep: 'x' }, stray: true })
    expect(zodDetails(result.error!).some(d => d.field === '(root)')).toBe(true)
  })

  it('carries Zod\'s own issue code through', () => {
    const result = schema.safeParse({ quantity: 501, nested: { deep: 'x' } })
    expect(zodDetails(result.error!)[0]?.code).toBe('too_big')
  })
})

describe('zodSummary', () => {
  const schema = z.object({ quantity: z.number().max(500, 'Too many copies') }).strict()

  it('prefixes the first problem with its field', () => {
    const result = schema.safeParse({ quantity: 501 })
    expect(zodSummary(result.error!)).toBe('quantity: Too many copies')
  })

  it('says how many more problems there are', () => {
    const multi = z.object({ a: z.string(), b: z.string() }).strict()
    const result = multi.safeParse({ a: 1, b: 2 })
    expect(zodSummary(result.error!)).toMatch(/\(and 1 more problem\)$/)
  })
})
