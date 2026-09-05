/**
 * Guards the OpenAPI spec against describing something the server doesn't do.
 *
 * Request bodies are generated from the Zod schemas (see src/openapi-zod.ts), so
 * their limits and enums cannot drift by construction. What these tests protect is
 * the boundary around that: that generation is actually wired up, that no
 * hand-written schema has crept back in to shadow a generated one, and that the
 * parts still written by hand — paths, error codes, response schemas — agree with
 * the code.
 *
 * When one fails, the spec is wrong. Fix the spec, not the test.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { OPENAPI_SPEC } from '../../src/openapi'
import { REQUEST_SCHEMAS, generateRequestSchemas } from '../../src/openapi-zod'
import { API_ERROR_CODES, statusForCode } from '../../src/server/errors'
import { PARAMETERISED_ROUTES } from '../../src/server/router'
import { templateShortNameSchema, TEMPLATE_PRINT_CONTROL_KEYS } from '../../src/schemas'
import { MAX_COPIES } from '../../src/constants'

const spec = OPENAPI_SPEC as any
const schemas = spec.components.schemas

/** Every `{ $ref: ... }` target found anywhere in the spec. */
function allRefs(): string[] {
  const refs: string[] = []
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') refs.push(value)
      else walk(value)
    }
  }
  walk(spec)
  return refs
}

/** Every operation object in the spec, with its path and method. */
function operations(): Array<{ path: string; method: string; op: any }> {
  const out: Array<{ path: string; method: string; op: any }> = []
  for (const [path, item] of Object.entries(spec.paths as Record<string, any>)) {
    for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
      if (item[method]) out.push({ path, method, op: item[method] })
    }
  }
  return out
}

describe('spec integrity', () => {
  it('resolves every $ref', () => {
    // A broken ref renders Swagger UI unusable and nothing else catches it. Also
    // the failure mode of deleting a component that something still points at.
    const refs = allRefs()
    expect(refs.length).toBeGreaterThan(0)
    const resolve = (ref: string) =>
      ref.replace(/^#\//, '').split('/').reduce((acc: any, part) => acc?.[part], spec)
    expect([...new Set(refs)].filter(ref => resolve(ref) === undefined)).toEqual([])
  })

  it('has no unreferenced component schemas', () => {
    // A component nothing points at is dead weight that can quietly contradict the
    // code. Generated request schemas are exempt only when a path refs them, which
    // the assertion below enforces separately.
    const referenced = new Set(allRefs().map(ref => ref.split('/').pop()))
    expect(Object.keys(schemas).filter(name => !referenced.has(name))).toEqual([])
  })

  it('serializes to JSON', () => {
    expect(() => JSON.stringify(spec)).not.toThrow()
  })

  it('reports the package version, not a hardcoded copy of it', () => {
    // `info.version` was a literal that had already drifted — it said 0.5.0 while
    // package.json moved on. Same trap `updater.ts` documents for its own version.
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8')
    ) as { version: string }
    expect(spec.info.version).toBe(pkg.version)
  })
})

describe('request bodies are generated, not hand-written', () => {
  const generated = generateRequestSchemas()

  it('publishes a component for every validated request schema', () => {
    for (const name of Object.keys(REQUEST_SCHEMAS)) {
      expect(schemas[name], `${name} should be in components.schemas`).toBeDefined()
    }
  })

  it('publishes the generated schema, not a hand-written override', () => {
    // Spreading the generated schemas first means a later hand-written entry of the
    // same name silently wins. This is what catches that.
    for (const [name, expected] of Object.entries(generated)) {
      expect(schemas[name], `${name} should be the generated schema`).toEqual(expected)
    }
  })

  it('points every requestBody at a generated component', () => {
    // An inline schema in a path is a hand-written copy by definition, and the thing
    // this whole mechanism exists to eliminate.
    const inline: string[] = []
    for (const { path, method, op } of operations()) {
      const schema = op.requestBody?.content?.['application/json']?.schema
      if (!schema) continue
      const name = typeof schema.$ref === 'string' ? schema.$ref.split('/').pop() : null
      if (!name || !(name in REQUEST_SCHEMAS)) {
        inline.push(`${method.toUpperCase()} ${path}`)
      }
    }
    expect(inline).toEqual([])
  })

  it('carries the real limits through, proving generation is wired up', () => {
    // Cheap end-to-end check that these numbers come from the constants rather than
    // from a literal someone typed into the spec.
    expect(schemas.TemplatePrintRequest.properties.quantity.maximum).toBe(MAX_COPIES)
    expect(schemas.TextLabelRequest.properties.copies.maximum).toBe(MAX_COPIES)
  })

  it('carries field prose from .describe() in the schemas', () => {
    // Descriptions live on the Zod schema so there is one source for them. If this
    // fails, the prose was written in the spec instead.
    expect(schemas.TemplatePrintRequest.properties.variables.description).toBeTruthy()
    expect(schemas.TemplatePrintRequest.properties.allowMissingVariables.description).toBeTruthy()
    expect(schemas.TemplateDefinition.properties.shortName.description).toBeTruthy()
  })

  it('documents a shortName example that the schema actually accepts', () => {
    const [example] = schemas.TemplateDefinition.properties.shortName.examples ?? []
    expect(example).toBeTruthy()
    expect(templateShortNameSchema.safeParse(example).success).toBe(true)
  })

  it('documents every control key of the template print body, and only those', () => {
    // The control keys separate a control field from a variable in the flat payload
    // form, so a mismatch here means the docs disagree about what a variable is.
    expect(Object.keys(schemas.TemplatePrintRequest.properties).sort())
      .toEqual([...TEMPLATE_PRINT_CONTROL_KEYS].sort())
  })
})

describe('documented routes match the router', () => {
  it('documents every parameterised route', () => {
    // PARAMETERISED_ROUTES is what the server dispatches and advertises; an
    // undocumented endpoint is one an integrator cannot discover.
    const undocumented = PARAMETERISED_ROUTES.filter(route => {
      const [method, path] = route.split(/\s+/)
      const specPath = path!.replace(/:([A-Za-z]+)/g, '{$1}')
      return !spec.paths[specPath]?.[method!.toLowerCase()]
    })
    expect(undocumented).toEqual([])
  })

  it('documents only paths under /api/', () => {
    // The bare /print/{shortName} alias was removed; nothing should reintroduce a
    // documented endpoint outside the /api/ namespace.
    expect(Object.keys(spec.paths).filter(p => !p.startsWith('/api/'))).toEqual([])
  })

  it('gives every operation a unique operationId', () => {
    const ids = operations().map(({ op }) => op.operationId)
    expect(ids.filter(id => !id)).toEqual([])
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('error codes', () => {
  it('lists exactly the codes the server can send', () => {
    expect([...(schemas.ApiError.properties.code.enum as string[])].sort())
      .toEqual([...API_ERROR_CODES].sort())
  })

  it('declares each documented response under the status that code maps to', () => {
    // A 404 documented against a code that answers 409 teaches a caller to branch on
    // the wrong pair.
    const cases: Array<[string, string]> = [
      ['TemplateNotFound', 'TEMPLATE_NOT_FOUND'],
      ['Unauthorized', 'UNAUTHORIZED'],
      ['RateLimited', 'RATE_LIMITED'],
      ['PrintFailed', 'PRINT_FAILED']
    ]
    const templatePrint = spec.paths['/api/print/template/{shortName}'].post
    for (const [responseName, code] of cases) {
      const example = spec.components.responses[responseName].content['application/json'].example
      expect(example.code, `${responseName} should exemplify ${code}`).toBe(code)
      const status = String(statusForCode(code as never))
      expect(
        templatePrint.responses[status],
        `${code} is a ${status}, so the print endpoint should document ${status}`
      ).toBeDefined()
    }
  })
})
