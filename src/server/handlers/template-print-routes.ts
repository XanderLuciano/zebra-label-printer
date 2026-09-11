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
import { dispatchPrint, selectionOf, buildElementZpl, assertKnownPrinter } from './post-routes'
import type { PrinterSelection } from './post-routes'
import { findTemplateByShortName } from '../../db/template-repo'
import type { StoredTemplate } from '../../db/template-repo'
import type { PresetTemplate } from '../../db/template-presets'
import { templatePrintSchema, DEFAULT_SERIAL_VARIABLE } from '../../schemas'
import type { TemplatePrintRequest } from '../../schemas'
import { sameLabelSize, findPrinterForSize } from '../../label-size-match'
import { serialSequence } from '../../serial'
import type { PrinterProfile } from '../../types'
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
import { LOCAL_PRINTER_ID_PREFIX, LOCAL_PRINTER_NAME } from '../../constants'
import type { PrinterSelectionReason } from '../../constants'

type GetQueue = () => PrintQueue | null
type GetRegistry = () => PrinterRegistry | null

interface PrintWarning {
  code: string
  message: string
}

/**
 * Which printer this print went to, and why.
 *
 * `message` exists because `reason` alone wasn't enough: the first integrator to see
 * `pinned-label-size` had to ask what it meant, and the answer — that their own request
 * had suppressed automatic routing — was something the response could have just said.
 * `printerName` is here so a UI has something to show a person.
 */
interface PrinterSelectionInfo {
  reason: PrinterSelectionReason
  printerId: string | null
  printerName: string | null
  message: string
}

/** Plain-language account of how the printer was chosen, and what to change. */
export function describeSelection(
  reason: PrinterSelectionReason,
  tpl: Pick<LabelTemplate, 'baseWidthDots' | 'baseHeightDots'>,
  size: JobLabelSize
): string {
  const design = `${tpl.baseWidthDots}×${tpl.baseHeightDots}`
  const target = `${size.widthDots}×${size.heightDots}`

  switch (reason) {
    case 'explicit-printer':
      return `Printed on the printer named in the request, at its configured ${target} dots. `
        + 'Automatic routing was skipped because the request chose the printer.'
    case 'explicit-label-size':
      return `Printed at the ${target} dots given in the request. The printer's own configured `
        + 'stock was not consulted and automatic routing was skipped. Omit labelSize to let the '
        + `server pick a printer loaded with this template's ${design} design size.`
    case 'label-size-match':
      return `Routed to a printer loaded with ${target} dots, matching this template's design size.`
    case 'default':
      return design === target
        ? `Used the default printer, which is loaded with this template's ${design} design size.`
        : `Used the default printer at ${target} dots. No configured printer is loaded with this `
          + `template's ${design} design size, so the layout was scaled to fit. Register each `
          + "printer's real label stock in Settings to have prints routed automatically."
  }
}

/**
 * A printer loaded with the stock this template was designed for, or null to leave
 * the choice alone.
 *
 * Exists because the failure it prevents is invisible until the label comes out: a
 * 3×5 design sent to the default printer loaded with 2×1 stock scales down and prints
 * cropped and unreadable. The information needed to avoid that is already on the
 * server — each printer records the stock it holds — so it may as well use it.
 *
 * Returns null, meaning "keep the default", when:
 *
 *   - the default printer already holds the right stock, so there is nothing to fix;
 *   - the template carries a per-size override for the default printer's stock, which
 *     means the author designed for that size deliberately and scaling is intended;
 *   - no configured printer holds the right stock, in which case the caller gets the
 *     default plus a LABEL_SIZE_MISMATCH warning rather than a failure.
 */
export function printerForTemplate(
  registry: Pick<PrinterRegistry, 'profiles' | 'defaultProfile'> | null,
  tpl: Pick<LabelTemplate, 'baseWidthDots' | 'baseHeightDots' | 'overrides'>
): PrinterProfile | null {
  if (!registry) return null

  const base = { widthDots: tpl.baseWidthDots, heightDots: tpl.baseHeightDots }
  const fallback = registry.defaultProfile()

  if (fallback) {
    if (sameLabelSize(fallback.labelSize, base)) return null
    if (tpl.overrides?.[sizeKey(fallback.labelSize.widthDots, fallback.labelSize.heightDots)]) {
      return null
    }
  }

  const match = findPrinterForSize(registry.profiles(), base)
  return match && match.id !== fallback?.id ? match : null
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
/**
 * Warn when the geometry being rendered isn't the stock the target printer holds.
 *
 * Only reachable by pinning `labelSize`: without it the geometry *comes from* the
 * printer's configuration, so the two agree by construction. Pinning is how the
 * original cropped-label bug was worked around, and doing so silently reintroduces it
 * from the other direction — rendering 609×1015 and sending it to a printer loaded with
 * 406×203 crops the label just as badly, with nothing in the response to say so.
 *
 * Skipped for browser-owned printers, whose configuration lives in that browser and
 * which the server therefore has nothing to compare against.
 */
export function printerStockWarnings(
  registry: PrinterRegistry | null,
  selection: PrinterSelection,
  target: JobLabelSize
): PrintWarning[] {
  if (!registry || !selection.labelSize) return []
  if (selection.printerId?.startsWith(LOCAL_PRINTER_ID_PREFIX) || selection.target === 'local') {
    return []
  }

  const configured = registry.labelSizeFor(selection.printerId)
  if (!configured || sameLabelSize(configured, target)) return []

  const profile = selection.printerId
    ? registry.profile(selection.printerId)
    : registry.defaultProfile()

  return [{
    code: 'PRINTER_STOCK_MISMATCH',
    message: `Rendering at the requested ${target.widthDots}×${target.heightDots} dots, but `
      + `${profile?.name ?? 'the target printer'} is configured for `
      + `${configured.widthDots}×${configured.heightDots}. The label will not fit the stock. `
      + 'Drop labelSize to let the server route this to a printer loaded with the right size, '
      + "or correct that printer's configured stock in Settings."
  }]
}

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

/** Which variable `serialize` refers to, or null when serialization wasn't asked for. */
function serializeVariable(serialize: TemplatePrintRequest['serialize']): string | null {
  if (serialize === undefined || serialize === false) return null
  return serialize === true ? DEFAULT_SERIAL_VARIABLE : serialize
}

/**
 * Warn when a request looks like it meant to serialize but didn't say so.
 *
 * This is how `serialize` stays discoverable without being inferred. Inferring it
 * would silently change what existing callers print — five identical labels for a kit
 * would become five different serial numbers — so the request is honoured as written
 * and the caller is told what they could do instead.
 */
function serializeHints(tpl: LabelTemplate, data: TemplatePrintRequest): PrintWarning[] {
  if (data.quantity <= 1 || serializeVariable(data.serialize) !== null) return []

  const candidate = tpl.variables.find(v => v.name === DEFAULT_SERIAL_VARIABLE)
  const value = candidate ? data.variables[candidate.name] : undefined
  if (!candidate || value === undefined) return []

  return [{
    code: 'SERIAL_NOT_INCREMENTED',
    message: `Printing ${data.quantity} identical labels, all with ${candidate.name} `
      + `"${value}". Send "serialize": true to advance it across the copies instead.`
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
 * The printer this print resolves to, described for both machines and people.
 *
 * The id follows the same fallback the job record uses — the request's printer, else the
 * default — so the response cannot name one printer while the job says another. The name
 * comes from the registry, except for a browser-owned printer, which the server has no
 * profile for and can only report as whatever the caller called it.
 */
function describePrinterChoice(
  registry: PrinterRegistry | null,
  selection: PrinterSelection,
  reason: PrinterSelectionReason,
  tpl: Pick<LabelTemplate, 'baseWidthDots' | 'baseHeightDots'>,
  size: JobLabelSize
): PrinterSelectionInfo {
  const printerId = selection.printerId ?? registry?.defaultProfile()?.id ?? null
  const isLocal = !!printerId?.startsWith(LOCAL_PRINTER_ID_PREFIX) || selection.target === 'local'

  const printerName = isLocal
    ? selection.printerName ?? LOCAL_PRINTER_NAME
    : (printerId ? registry?.profile(printerId)?.name : null)
      ?? registry?.defaultProfile()?.name
      ?? selection.printerName
      ?? null

  return { reason, printerId, printerName, message: describeSelection(reason, tpl, size) }
}

/** What was serialized, without making the caller diff the values themselves. */
function serializedSummary(variable: string, serials: string[]) {
  return {
    variable,
    from: serials[0] ?? null,
    to: serials[serials.length - 1] ?? null,
    values: serials
  }
}

interface SerializedPrintContext {
  queue: PrintQueue | null
  registry: PrinterRegistry | null
  template: StoredTemplate | PresetTemplate
  tpl: LabelTemplate
  data: TemplatePrintRequest
  selection: PrinterSelection
  serialVariable: string
  serials: string[]
  projectedSize: JobLabelSize
  printerSelection: PrinterSelectionInfo
  warnings: PrintWarning[]
}

/**
 * Print one label per serial, as separate jobs.
 *
 * One job per label rather than one job holding the whole run, matching what
 * `POST /api/print/serial` already does. The reason is recoverability: serialized
 * parts go into the world carrying an identifier, so when a run fails halfway you have
 * to know exactly which serials physically came out. A single job for fifty labels
 * that fails at label thirty cannot tell you that.
 *
 * For the same reason the loop **stops at the first failure** instead of pressing on.
 * Continuing would spend more stock to produce a run with a hole in it.
 */
async function printSerialized(
  res: ServerResponse,
  ctx: SerializedPrintContext
): Promise<void> {
  const { queue, registry, tpl, data, selection, serialVariable, serials, projectedSize } = ctx

  if (!queue) {
    sendError(res, 'QUEUE_UNAVAILABLE', 'Serialized printing requires the job queue')
    return
  }
  if (!await assertKnownPrinter(res, registry, selection.printerId)) return

  const isLocal = selection.target === 'local' || !!selection.printerId?.startsWith(LOCAL_PRINTER_ID_PREFIX)
  const jobs: Array<Record<string, unknown>> = []

  for (const serial of serials) {
    const variables = { ...data.variables, [serialVariable]: serial }
    const requestData = {
      elements: renderElements(tpl, variables, projectedSize),
      copies: 1,
      template: templateRef(ctx.template),
      variables,
      serial
    }
    // Each label is one copy: the values differ, so there is nothing for ^PQ to repeat.
    const zplGen = (size: JobLabelSize): string =>
      buildElementZpl(renderElements(tpl, variables, size), size, 1)

    try {
      if (isLocal) {
        const { jobId, zpl } = queue.prepareExternal('label', requestData, zplGen, {
          printerId: selection.printerId,
          printerName: selection.printerName ?? LOCAL_PRINTER_NAME,
          labelSize: selection.labelSize
        })
        jobs.push({ success: true, serial, jobId, queued: false, zpl })
        continue
      }

      const result = await queue.submit('label', requestData, zplGen, {
        printerId: selection.printerId,
        printerName: selection.printerName,
        labelSize: selection.labelSize
      })
      jobs.push({ success: result.success, serial, jobId: result.jobId, queued: result.queued })
      if (!result.success) {
        sendError(res, 'PRINT_FAILED', result.error ?? `Failed while printing ${serial}`, {
          message: `Stopped at ${serial} to avoid spending more stock on a run with a gap. `
            + `${jobs.filter(j => j.success).length} of ${serials.length} labels were submitted.`,
          extra: serializedResponse(ctx, jobs, isLocal, false)
        })
        return
      }
    } catch (err) {
      jobs.push({ success: false, serial, error: (err as Error).message })
      sendError(res, 'RENDER_FAILED', (err as Error).message, {
        extra: serializedResponse(ctx, jobs, isLocal, false)
      })
      return
    }
  }

  json(res, serializedResponse(ctx, jobs, isLocal, true))
}

/** The serialized response body, shared by the success and partial-failure paths. */
function serializedResponse(
  ctx: SerializedPrintContext,
  jobs: Array<Record<string, unknown>>,
  isLocal: boolean,
  success: boolean
): Record<string, unknown> {
  const printed = jobs.filter(j => j.success).length
  return {
    success,
    serialized: {
      ...serializedSummary(ctx.serialVariable, ctx.serials),
      requested: ctx.serials.length,
      submitted: printed
    },
    // No single `jobId`: there are as many jobs as labels, and which serial went with
    // which job is the thing a caller needs.
    jobs,
    quantity: ctx.data.quantity,
    target: isLocal ? 'local' : 'server',
    labelSize: ctx.projectedSize,
    printerId: ctx.printerSelection.printerId,
    printerSelection: ctx.printerSelection,
    template: templateRef(ctx.template),
    warnings: ctx.warnings
  }
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

    const registry = getRegistry()
    let selection = selectionOf(data)
    let printerReason: PrinterSelectionReason = data.printerId
      ? 'explicit-printer'
      : data.labelSize ? 'explicit-label-size' : 'default'

    // Auto-routing only when the caller expressed no preference at all. Naming a
    // printer or pinning a labelSize is an explicit instruction and outranks being
    // clever — someone who pinned 406×203 wants 406×203, whatever stock is loaded.
    if (printerReason === 'default') {
      const matched = printerForTemplate(registry, tpl)
      if (matched) {
        selection = { ...selection, printerId: matched.id, printerName: matched.name }
        printerReason = 'label-size-match'
      }
    }

    // Resolved here as well as inside the queue so warnings can be computed before
    // anything prints. A read of the same rule, not a second copy of it — and it has
    // to happen after auto-routing, since the chosen printer decides the geometry.
    const projectedSize = resolveJobLabelSize(registry, {
      printerId: selection.printerId,
      labelSize: selection.labelSize
    })

    const serialVariable = serializeVariable(data.serialize)
    const warnings = [
      ...labelSizeWarnings(tpl, projectedSize),
      ...printerStockWarnings(registry, selection, projectedSize),
      ...serializeHints(tpl, data)
    ]
    const printerSelection = describePrinterChoice(registry, selection, printerReason, tpl, projectedSize)

    // Distinct values to print, one label each. Without serialization that is a
    // single label printed `quantity` times via one ^PQ, which is cheaper and what
    // the printer is built for.
    let serials: string[] | null = null
    if (serialVariable) {
      if (!tpl.variables.some(v => v.name === serialVariable)) {
        sendError(res, 'SERIALIZE_INVALID', `'${serialVariable}' is not a variable of this template`, {
          message: `This template accepts: ${tpl.variables.map(v => v.name).join(', ') || '(none)'}.`,
          extra: { serialize: serialVariable, accepts: tpl.variables.map(v => v.name) }
        })
        return
      }
      const start = data.variables[serialVariable]
      if (start === undefined) {
        sendError(res, 'SERIALIZE_INVALID', `No value given for '${serialVariable}' to count from`, {
          message: `Send the first serial as variables.${serialVariable}, e.g. "NRG-001".`,
          extra: { serialize: serialVariable }
        })
        return
      }
      serials = serialSequence(start, data.quantity)
      if (!serials) {
        sendError(res, 'SERIALIZE_INVALID', `'${start}' has no trailing number to advance`, {
          message: `${serialVariable} must end in digits so it can be counted up — `
            + '"NRG-001" becomes NRG-002, NRG-003. Prefix and zero-padding are preserved.',
          extra: { serialize: serialVariable, value: start }
        })
        return
      }
    }

    if (data.dryRun) {
      try {
        const shared = {
          success: true,
          dryRun: true,
          labelSize: projectedSize,
          quantity: data.quantity,
          template: templateRef(stored),
          printerSelection,
          warnings
        }
        if (serials) {
          json(res, {
            ...shared,
            serialized: serializedSummary(serialVariable!, serials),
            // One label per serial, each a single copy — the whole point is that they
            // differ, so there is no ^PQ to share between them.
            labels: serials.map(serial => ({
              serial,
              zpl: buildElementZpl(
                renderElements(tpl, { ...data.variables, [serialVariable!]: serial }, projectedSize),
                projectedSize,
                1
              )
            }))
          })
          return
        }
        const elements = renderElements(tpl, data.variables, projectedSize)
        json(res, {
          ...shared,
          zpl: buildElementZpl(elements, projectedSize, data.quantity),
          elements
        })
      } catch (err) {
        sendError(res, 'RENDER_FAILED', (err as Error).message, {
          extra: { template: templateRef(stored) }
        })
      }
      return
    }

    if (serials) {
      await printSerialized(res, {
        queue: getQueue(),
        registry,
        template: stored,
        tpl,
        data,
        selection,
        serialVariable: serialVariable!,
        serials,
        projectedSize,
        printerSelection,
        warnings
      })
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
        printerSelection,
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
