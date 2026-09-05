/**
 * Template print webhooks — print a saved template by its public short name.
 *
 * A caller needs a short name and some variable names, nothing else, which is what
 * lets a template be redesigned without breaking integrations pointed at it.
 *
 * Everything after rendering delegates to `dispatchPrint()`, the same function
 * every other print endpoint uses, so job records, printer selection, the
 * browser/WebUSB handoff, label-size snapshots and queueing cannot diverge.
 *
 * Decisions and rationale: .ai/template-print-api.md. Read it before changing
 * anything here.
 */

import type { IncomingMessage, ServerResponse } from 'http'
import type { Handler } from '../router'
import { json, validate, checkAuth } from '../helpers'
import { sendError } from '../errors'
import { dispatchPrint, selectionOf, buildElementZpl } from './post-routes'
import { findTemplateByShortName } from '../../db/template-repo'
import type { StoredTemplate } from '../../db/template-repo'
import type { PresetTemplate } from '../../db/template-presets'
import { templatePrintSchema } from '../../schemas'
import type { TemplatePrintRequest } from '../../schemas'
import {
  resolveTemplate,
  toPrintElements,
  usedVariables,
  sizeKey
} from '../../template-engine'
import type { LabelTemplate, PrintLabelElement } from '../../template-engine'
import type { PrintQueue } from '../../queue'
import type { PrinterRegistry } from '../../printer-registry'
import { resolveJobLabelSize } from '../../printer-registry'
import type { JobLabelSize } from '../../db/print-job-repo'
import type { RateLimiter } from '../rate-limit'
import { rateLimitKey } from '../rate-limit'

type GetQueue = () => PrintQueue | null
type GetRegistry = () => PrinterRegistry | null

interface PrintWarning {
  code: string
  message: string
}

/**
 * `StoredTemplate` (inferred from `templateSchema`) and `LabelTemplate` (the
 * engine's interface) describe the same thing and agree on every field except
 * `overrides`, which the schema validates loosely because per-size overrides are
 * arbitrary partial element fields — pinning them to a discriminated union would
 * reject valid designs.
 *
 * The cast is that boundary. A bad override degrades to a mispositioned element
 * rather than a crash, since `ZPLBuilder` ignores unknown keys.
 */
function asLabelTemplate(tpl: StoredTemplate | PresetTemplate): LabelTemplate {
  return tpl as unknown as LabelTemplate
}

function requiredVariables(tpl: LabelTemplate): string[] {
  const declared = new Set(tpl.variables.map(v => v.name))
  // Referenced-but-undeclared is a template bug, not a caller problem — the caller
  // cannot supply it, since an undeclared name is rejected as unknown. Excluded so
  // the error a caller gets is about their request.
  return usedVariables(tpl).filter(name => declared.has(name))
}

/**
 * Both directions are checked because the output is physical: an unknown name
 * ignored would print `partNumbr`'s value nowhere, leaving a blank field the
 * caller cannot see and the operator cannot diagnose. Rejecting unknowns is also
 * what makes the flat payload form safe to offer.
 *
 * @returns true when the request may proceed.
 */
function checkVariables(
  res: ServerResponse,
  tpl: LabelTemplate,
  supplied: Record<string, string>,
  allowMissing: boolean
): boolean {
  const declared = tpl.variables.map(v => v.name)
  const declaredSet = new Set(declared)

  const unknown = Object.keys(supplied).filter(name => !declaredSet.has(name))
  if (unknown.length > 0) {
    sendError(res, 'UNKNOWN_VARIABLES', `Unknown variable${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`, {
      message: declared.length > 0
        ? `This template accepts: ${declared.join(', ')}.`
        : 'This template takes no variables.',
      details: unknown.map(name => ({
        field: `variables.${name}`,
        message: 'Not a variable of this template'
      })),
      extra: { accepts: declared, unknown }
    })
    return false
  }

  if (allowMissing) return true

  const missing = requiredVariables(tpl).filter(name => supplied[name] === undefined)
  if (missing.length > 0) {
    sendError(res, 'MISSING_VARIABLES', `Missing required variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`, {
      message: 'Every variable the template\'s layout references needs a value. '
        + 'Send `allowMissingVariables: true` to print them blank instead.',
      details: missing.map(name => ({
        field: `variables.${name}`,
        message: 'Required by this template'
      })),
      extra: { missing, accepts: declared }
    })
    return false
  }

  return true
}

/**
 * Reported rather than refused: auto-scaling is the point of percentage
 * positioning. Worth reporting because it is also the commonest way to get a
 * surprising label — a 2×1" design on 4×6" stock is correct and rarely wanted. A
 * template with an override for the target size has been considered there, so it
 * stays quiet.
 */
function labelSizeWarnings(tpl: LabelTemplate, target: JobLabelSize): PrintWarning[] {
  const matchesBase = target.widthDots === tpl.baseWidthDots
    && target.heightDots === tpl.baseHeightDots
  if (matchesBase) return []

  const hasOverride = !!tpl.overrides?.[sizeKey(target.widthDots, target.heightDots)]
  if (hasOverride) return []

  return [{
    code: 'LABEL_SIZE_MISMATCH',
    message: `Template was designed for ${tpl.baseWidthDots}×${tpl.baseHeightDots} dots but is `
      + `printing at ${target.widthDots}×${target.heightDots}. The layout was scaled to fit; `
      + 'add a per-size override in the designer to control it.'
  }]
}

function renderElements(
  tpl: LabelTemplate,
  variables: Record<string, string>,
  size: JobLabelSize
): PrintLabelElement[] {
  return toPrintElements(
    resolveTemplate(
      tpl,
      variables,
      { widthDots: size.widthDots, heightDots: size.heightDots },
      // Never fall back to samples on a real print. The designer does, so an
      // unfilled template still previews; here it would put the sample part number
      // on actual stock.
      { useSamples: false }
    )
  )
}
function withinRateLimit(
  req: IncomingMessage,
  res: ServerResponse,
  limiter: RateLimiter | null
): boolean {
  if (!limiter?.enabled) return true

  const result = limiter.check(rateLimitKey(req))
  res.setHeader('X-RateLimit-Limit', String(result.limit))
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.remaining)))
  if (result.allowed) return true

  sendError(res, 'RATE_LIMITED', 'Too many print requests', {
    message: `This endpoint accepts ${result.limit} requests per minute. `
      + `Retry in ${result.retryAfterSeconds}s.`,
    headers: { 'Retry-After': String(result.retryAfterSeconds) },
    extra: { retryAfterSeconds: result.retryAfterSeconds }
  })
  return false
}

function templateRef(tpl: StoredTemplate | PresetTemplate) {
  return { id: tpl.id, shortName: tpl.shortName ?? null, name: tpl.name }
}

/**
 * POST /api/print/template/:shortName
 *
 * @param shortName - Normalised during lookup, so `/PART-2X1` resolves.
 */
export function templatePrintHandler(
  apiKey: string,
  shortName: string,
  getQueue: GetQueue,
  getRegistry: GetRegistry,
  limiter: RateLimiter | null = null
): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return
    if (!withinRateLimit(req, res, limiter)) return

    const stored = findTemplateByShortName(shortName)
    if (!stored) {
      sendError(res, 'TEMPLATE_NOT_FOUND', 'Template not found', {
        message: `No template has the short name '${shortName}'. `
          + 'Short names are set in the template designer; GET /api/templates lists them.',
        extra: { shortName }
      })
      return
    }

    const data = await validate<TemplatePrintRequest>(req, res, templatePrintSchema)
    if (!data) return

    const tpl = asLabelTemplate(stored)
    if (!checkVariables(res, tpl, data.variables, data.allowMissingVariables)) return

    const selection = selectionOf(data)
    const registry = getRegistry()

    // Resolved here as well as inside the queue so the warning can be computed
    // before anything prints. A read of the same rule, not a second copy of it.
    const projectedSize = resolveJobLabelSize(registry, {
      printerId: selection.printerId,
      labelSize: selection.labelSize
    })
    const warnings = labelSizeWarnings(tpl, projectedSize)

    if (data.dryRun) {
      try {
        const elements = renderElements(tpl, data.variables, projectedSize)
        json(res, {
          success: true,
          dryRun: true,
          zpl: buildElementZpl(elements, projectedSize, data.quantity),
          elements,
          labelSize: projectedSize,
          quantity: data.quantity,
          template: templateRef(stored),
          warnings
        })
      } catch (err) {
        sendError(res, 'RENDER_FAILED', (err as Error).message, {
          extra: { template: templateRef(stored) }
        })
      }
      return
    }

    // Resolves against the size dispatchPrint hands it, not the projection above,
    // so the ZPL is composed for the geometry frozen onto the job record. The two
    // agree in practice; this keeps the generator's size authoritative.
    const zplGen = (size: JobLabelSize): string =>
      buildElementZpl(renderElements(tpl, data.variables, size), size, data.quantity)

    await dispatchPrint(
      res,
      printer,
      getQueue(),
      registry,
      'label',
      // Stored as resolved `elements` because that is what PrintQueue.rebuildZpl()
      // can reconstruct a queued job from; `{ shortName, variables }` would need
      // re-resolving a template that may have been edited since. Resolved eagerly
      // so the record is populated even on paths that never call the generator.
      // The template ref and variables ride along for provenance; rebuild ignores
      // the extra keys.
      {
        elements: renderElements(tpl, data.variables, projectedSize),
        copies: data.quantity,
        template: templateRef(stored),
        variables: data.variables
      },
      selection,
      zplGen,
      {
        quantity: data.quantity,
        template: templateRef(stored),
        warnings
      }
    )
  }
}

/**
 * GET /api/templates/:shortName/schema
 *
 * Deliberately not the full definition: exposing the layout would invite callers
 * to depend on it, which is the coupling short names exist to avoid.
 */
export function templateSchemaHandler(apiKey: string, shortName: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const stored = findTemplateByShortName(shortName)
    if (!stored) {
      sendError(res, 'TEMPLATE_NOT_FOUND', 'Template not found', {
        message: `No template has the short name '${shortName}'.`,
        extra: { shortName }
      })
      return
    }

    const tpl = asLabelTemplate(stored)
    const required = new Set(requiredVariables(tpl))

    json(res, {
      template: templateRef(stored),
      description: stored.description ?? null,
      readOnly: stored.readOnly,
      labelSize: {
        widthDots: stored.baseWidthDots,
        heightDots: stored.baseHeightDots
      },
      variables: tpl.variables.map(v => ({
        name: v.name,
        label: v.label || v.name,
        sample: v.sample,
        required: required.has(v.name)
      })),
      endpoint: {
        method: 'POST',
        path: `/api/print/template/${stored.shortName ?? shortName}`
      }
    })
  }
}
