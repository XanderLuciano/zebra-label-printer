/**
 * Tests for route table and dispatch logic.
 */
import { describe, it, expect } from 'vitest'
import type { RouteTable } from '../../src/server/router'
import {
  findHandler,
  printRoutes,
  matchTemplatePrintPath,
  PARAMETERISED_ROUTES
} from '../../src/server/router'

import type { Handler } from '../../src/server/router'

const noopHandler: Handler = async (_req, _res, _printer) => {}

describe('router', () => {
  it('finds handler for exact method + path', () => {
    const routes: RouteTable = new Map()
    const get = new Map<string, Handler>()
    get.set('/api/health', noopHandler)
    routes.set('GET', get)

    const handler = findHandler(routes, 'GET', '/api/health')
    expect(handler).toBe(noopHandler)
  })

  it('returns null for unknown path', () => {
    const routes: RouteTable = new Map()
    const get = new Map<string, Handler>()
    get.set('/api/health', noopHandler)
    routes.set('GET', get)

    expect(findHandler(routes, 'GET', '/api/unknown')).toBeNull()
  })

  it('returns null for unknown method', () => {
    const routes: RouteTable = new Map()
    routes.set('GET', new Map([['/api/health', noopHandler]]))

    expect(findHandler(routes, 'POST', '/api/health')).toBeNull()
  })

  it('handles empty route table', () => {
    const routes: RouteTable = new Map()
    expect(findHandler(routes, 'GET', '/api/anything')).toBeNull()
  })

  it('supports multiple methods', () => {
    const routes: RouteTable = new Map()
    const getHandler: Handler = async () => {}
    const postHandler: Handler = async () => {}

    routes.set('GET', new Map([['/api/test', getHandler]]))
    routes.set('POST', new Map([['/api/test', postHandler]]))
    routes.set('PUT', new Map([['/api/test', noopHandler]]))

    expect(findHandler(routes, 'GET', '/api/test')).toBe(getHandler)
    expect(findHandler(routes, 'POST', '/api/test')).toBe(postHandler)
    expect(findHandler(routes, 'PUT', '/api/test')).toBe(noopHandler)
  })

  it('printRoutes does not throw', () => {
    const routes: RouteTable = new Map()
    routes.set('GET', new Map([['/a', noopHandler], ['/b', noopHandler]]))
    routes.set('POST', new Map([['/c', noopHandler]]))

    // Save and restore console.log
    const orig = console.log
    const logs: string[] = []
    console.log = (...args: any[]) => logs.push(args.join(' '))

    printRoutes(routes)

    console.log = orig
    expect(logs.some(l => l.includes('GET') && l.includes('/a'))).toBe(true)
    expect(logs.some(l => l.includes('POST') && l.includes('/c'))).toBe(true)
  })

  it('printRoutes lists the parameterised routes too', () => {
    // They are not in the route table, so without this the startup banner implies
    // the template webhooks don't exist.
    const orig = console.log
    const logs: string[] = []
    console.log = (...args: any[]) => logs.push(args.join(' '))

    printRoutes(new Map())

    console.log = orig
    expect(logs.some(l => l.includes('/api/print/template/:shortName'))).toBe(true)
    expect(logs.length).toBe(PARAMETERISED_ROUTES.length)
  })
})

describe('PARAMETERISED_ROUTES', () => {
  it('covers the template print webhook and its discovery endpoint', () => {
    const joined = PARAMETERISED_ROUTES.join('\n')
    expect(joined).toContain('/api/print/template/:shortName')
    expect(joined).toContain('/api/templates/:shortName/schema')
  })

  it('advertises nothing outside /api/', () => {
    for (const route of PARAMETERISED_ROUTES) {
      expect(route, `'${route}' should be under /api/`).toMatch(/\s+\/api\//)
    }
  })

  it('names a method on every entry', () => {
    for (const route of PARAMETERISED_ROUTES) {
      expect(route, `'${route}' should start with an HTTP method`)
        .toMatch(/^(GET|POST|PUT|DELETE|PATCH)\s+\//)
    }
  })
})

describe('matchTemplatePrintPath', () => {
  it('matches the canonical path and returns the short name', () => {
    expect(matchTemplatePrintPath('POST', '/api/print/template/part-2x1')).toBe('part-2x1')
  })

  it('does not match outside /api/', () => {
    // The bare /print/:shortName alias was removed: everything callable lives under
    // /api/, and /print is the web UI's own page route.
    expect(matchTemplatePrintPath('POST', '/print/part-2x1')).toBeNull()
    expect(matchTemplatePrintPath('POST', '/print/template/part-2x1')).toBeNull()
  })

  it('only matches POST', () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']) {
      expect(matchTemplatePrintPath(method, '/api/print/template/part-2x1')).toBeNull()
    }
  })

  it('does not match the existing print verbs', () => {
    // These are exact routes registered in the table. If the pattern swallowed
    // them, /api/print/text would start looking for a template called "text".
    for (const verb of ['text', 'barcode', 'qr', 'zpl', 'label', 'serial']) {
      expect(matchTemplatePrintPath('POST', `/api/print/${verb}`)).toBeNull()
    }
  })

  it('does not match a missing short name', () => {
    expect(matchTemplatePrintPath('POST', '/api/print/template/')).toBeNull()
    expect(matchTemplatePrintPath('POST', '/api/print/template')).toBeNull()
  })

  it('does not match a trailing extra segment', () => {
    // A short name cannot contain a slash, so an extra segment means the caller
    // wants something else — better a 404 than silently ignoring part of the path.
    expect(matchTemplatePrintPath('POST', '/api/print/template/part-2x1/extra')).toBeNull()
    expect(matchTemplatePrintPath('POST', '/api/print/template/part-2x1/')).toBeNull()
  })

  it('does not match other API paths that begin similarly', () => {
    expect(matchTemplatePrintPath('POST', '/api/printer/configure')).toBeNull()
    expect(matchTemplatePrintPath('POST', '/api/printers')).toBeNull()
    expect(matchTemplatePrintPath('POST', '/api/templates')).toBeNull()
    expect(matchTemplatePrintPath('POST', '/printers/x')).toBeNull()
  })

  it('passes through a mixed-case slug for the lookup to normalise', () => {
    expect(matchTemplatePrintPath('POST', '/api/print/template/PART-2X1')).toBe('PART-2X1')
  })

  it('decodes percent-encoding', () => {
    expect(matchTemplatePrintPath('POST', '/api/print/template/part%2D2x1')).toBe('part-2x1')
  })

  it('returns null rather than throwing on malformed encoding', () => {
    // decodeURIComponent throws on a lone '%'. A bad URL must be a 404, not a 500.
    expect(matchTemplatePrintPath('POST', '/api/print/template/bad%')).toBeNull()
    expect(matchTemplatePrintPath('POST', '/api/print/template/%E0%A4%A')).toBeNull()
  })
})
