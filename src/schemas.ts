/**
 * Zod validation schemas for the webhook API.
 *
 * Every endpoint gets a strict schema. Invalid requests get a 400
 * with structured error details so callers know exactly what's wrong.
 */

import { z } from 'zod'
import {
  MAX_COPIES,
  MEDIA_TRACKINGS,
  MIN_LABEL_WIDTH_DOTS,
  MIN_LABEL_HEIGHT_DOTS,
  MAX_LABEL_LENGTH_DOTS,
  SERVER_PRINTER_TRANSPORTS,
  TEMPLATE_SHORT_NAME_PATTERN,
  MIN_TEMPLATE_SHORT_NAME_LENGTH,
  MAX_TEMPLATE_SHORT_NAME_LENGTH,
  RESERVED_TEMPLATE_SHORT_NAMES
} from './constants'

/**
 * Copy count shared by every print endpoint.
 *
 * The messages spell out the limit: the old bare `.max(10)` produced Zod's generic
 * "Too big" text, which told a caller nothing about what it was allowed to send.
 */
const copiesSchema = z.number().int()
  .min(1, 'At least 1 copy required')
  .max(MAX_COPIES, `Too many copies — the maximum is ${MAX_COPIES} per request`)
  .describe(`How many labels to print (1–${MAX_COPIES}). Emitted as a single ^PQ, so the printer repeats the label from its own buffer.`)

/** Widest supported print head (4" at 600 DPI) */
const MAX_LABEL_WIDTH_DOTS = 2400

/** Print head resolutions the API accepts */
const dpiSchema = z.union([z.literal(203), z.literal(300), z.literal(600)])

/**
 * Label geometry, in dots.
 *
 * Inches are always derived from dots and DPI server-side rather than accepted
 * from the client, so the two can't be sent inconsistently.
 */
const labelGeometrySchema = z.object({
  widthDots: z.number().int().min(MIN_LABEL_WIDTH_DOTS).max(MAX_LABEL_WIDTH_DOTS),
  heightDots: z.number().int().min(MIN_LABEL_HEIGHT_DOTS).max(MAX_LABEL_LENGTH_DOTS),
  dpi: dpiSchema.optional(),
  name: z.string().max(100).optional()
}).strict()

// ─── Shared ─────────────────────────────────────────────────────────────────

const barcodeTypeEnum = z.enum([
  'CODE128', 'CODE39', 'CODE93', 'EAN8', 'EAN13',
  'UPCA', 'UPCE', 'CODABAR', 'PDF417', 'QRCODE', 'DATAMATRIX'
])

const errorCorrectionEnum = z.enum(['L', 'M', 'Q', 'H'])

const rotationEnum = z.enum(['N', 'R', 'I', 'B'])

/**
 * Where the label is printed.
 *
 * 'server' goes through CUPS on the host. 'local' persists the job and returns
 * the generated ZPL for the browser to push over WebUSB — the job still lands
 * in history, it just isn't printed by this process.
 */
const printTargetEnum = z.enum(['server', 'local'])
  .describe('"server" prints via CUPS on the host. "local" persists the job and returns the generated ZPL for the browser to push over WebUSB, to be finalized with POST /api/jobs/{id}/result.')

/**
 * How a request says which printer to use.
 *
 * `target` alone was enough when there was one server printer and one browser
 * printer, and a single global label size that both were assumed to be loaded
 * with. `printerId` replaces that guess with an actual choice.
 *
 * `labelSize` exists because a browser-attached printer's configuration lives in
 * that browser — the server has nothing to look up, so the client sends the
 * geometry it has configured for the device it's about to print on. For server
 * printers it can be omitted and the printer's saved configuration is used.
 */
const printerSelectionFields = {
  target: printTargetEnum.optional().default('server'),
  printerId: z.string().min(1).max(64).optional()
    .describe('Configured printer to print on. Omit to use the default printer. An id beginning "local_" is a browser-attached printer, and the ZPL is returned instead of printed.'),
  printerName: z.string().min(1).max(120).optional()
    .describe('Name to record on the job, for printers the server cannot name itself.'),
  labelSize: labelGeometrySchema.optional()
    .describe('Geometry to render for, overriding the printer\'s saved configuration. Required for a browser-attached printer, whose configuration the server cannot see.')
}

// ─── Endpoint Schemas ───────────────────────────────────────────────────────

/** POST /api/print/text */
export const textLabelSchema = z.object({
  lines: z.array(z.string().min(1)).min(1, 'At least one line required').max(20, 'Max 20 lines'),
  copies: copiesSchema.optional(),
  ...printerSelectionFields
}).strict()

/** POST /api/print/barcode */
export const barcodeLabelSchema = z.object({
  data: z.string().min(1, 'Barcode data is required'),
  type: barcodeTypeEnum.optional().default('CODE128'),
  text: z.string().optional(),
  height: z.number().int().min(10).max(1000).optional(),
  ...printerSelectionFields
}).strict()

/** POST /api/print/qr */
export const qrLabelSchema = z.object({
  data: z.string().min(1, 'QR code data is required'),
  text: z.string().optional(),
  magnification: z.number().int().min(1).max(10).optional().default(5),
  ...printerSelectionFields
}).strict()

/** POST /api/print/zpl — accepts raw string or JSON object */
export const zplSchema = z.union([
  z.string().min(1, 'ZPL commands required'),
  z.object({
    zpl: z.string().min(1, 'ZPL commands required'),
    ...printerSelectionFields
  }).strict()
])

// ─── Label element schemas (for /api/print/label) ───────────────────────────

const textElementSchema = z.object({
  type: z.literal('text'),
  content: z.string(),
  options: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    font: z.string().optional(),
    height: z.number().int().min(1).optional(),
    width: z.number().int().min(1).optional(),
    ratio: z.number().min(0.1).max(3.0).optional(),
    rotation: rotationEnum.optional(),
    reverse: z.boolean().optional()
  }).strict()
}).strict()

const barcodeElementSchema = z.object({
  type: z.literal('barcode'),
  content: z.string(),
  options: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    type: barcodeTypeEnum,
    height: z.number().int().min(1).optional(),
    narrowBarWidth: z.number().int().min(1).max(10).optional(),
    wideBarRatio: z.number().min(2).max(3).optional(),
    humanReadable: z.boolean().optional(),
    humanReadablePosition: z.enum(['Y', 'N']).optional(),
    rotation: rotationEnum.optional()
  }).strict()
}).strict()

const qrElementSchema = z.object({
  type: z.literal('qrcode'),
  content: z.string(),
  options: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    magnification: z.number().int().min(1).max(10).optional(),
    errorCorrection: errorCorrectionEnum.optional(),
    rotation: rotationEnum.optional()
  }).strict()
}).strict()

const rawElementSchema = z.object({
  type: z.literal('raw'),
  zpl: z.string()
}).strict()

const labelElementSchema = z.discriminatedUnion('type', [
  textElementSchema,
  barcodeElementSchema,
  qrElementSchema,
  rawElementSchema
])

/** POST /api/print/label */
export const labelSchema = z.object({
  elements: z.array(labelElementSchema).min(1, 'At least one element required'),
  copies: copiesSchema.optional(),
  ...printerSelectionFields
}).strict()

/** POST /api/render/zpl — build ZPL from elements without printing (for previews) */
export const renderZplSchema = z.object({
  elements: z.array(labelElementSchema).min(1, 'At least one element required'),
  copies: copiesSchema.optional(),
  widthDots: z.number().int().min(1).optional(),
  heightDots: z.number().int().min(1).optional()
}).strict()

// ─── Label templates (designer) ─────────────────────────────────────────────
//
// Templates use *relative* positioning: positions and sizes are stored as a
// percentage of the label's dimensions so a design auto-scales to any label
// size. `content` fields may contain `{{variable}}` tokens. `overrides` lets a
// design be tweaked per target size: sizeKey ("{widthDots}x{heightDots}") →
// elementId → partial element fields.

/** A named input variable with a mock/sample value for previews */
const templateVariableSchema = z.object({
  name: z.string().min(1).max(60).regex(/^[A-Za-z0-9_]+$/, 'Use letters, numbers, and underscores only'),
  label: z.string().max(100).optional().default(''),
  sample: z.string().max(500).optional().default('')
}).strict()

const templateBaseFields = {
  id: z.string().min(1),
  name: z.string().max(100).optional(),
  /** Position as a percentage of label width/height (0–100) */
  xPct: z.number().min(-50).max(150),
  yPct: z.number().min(-50).max(150),
  rotation: rotationEnum.optional(),
  hidden: z.boolean().optional()
}

const templateTextElementSchema = z.object({
  ...templateBaseFields,
  type: z.literal('text'),
  content: z.string(),
  /** Font height as a percentage of label height */
  fontHeightPct: z.number().min(0.5).max(100),
  ratio: z.number().min(0.1).max(3.0).optional(),
  font: z.string().optional(),
  reverse: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional()
}).strict()

const templateBarcodeElementSchema = z.object({
  ...templateBaseFields,
  type: z.literal('barcode'),
  content: z.string(),
  barcodeType: barcodeTypeEnum,
  /** Barcode height as a percentage of label height */
  heightPct: z.number().min(1).max(100),
  narrowBarWidth: z.number().int().min(1).max(10).optional(),
  humanReadable: z.boolean().optional()
}).strict()

const templateQrElementSchema = z.object({
  ...templateBaseFields,
  type: z.literal('qrcode'),
  content: z.string(),
  magnification: z.number().int().min(1).max(10),
  errorCorrection: errorCorrectionEnum.optional()
}).strict()

const templateBoxElementSchema = z.object({
  ...templateBaseFields,
  type: z.literal('box'),
  /** Box width/height as a percentage of label width/height */
  widthPct: z.number().min(0.1).max(150),
  heightPct: z.number().min(0.1).max(150),
  /** Border/line thickness in dots */
  thickness: z.number().int().min(1).max(100),
  rounding: z.number().int().min(0).max(8).optional(),
  fill: z.boolean().optional()
}).strict()

const templateElementSchema = z.discriminatedUnion('type', [
  templateTextElementSchema,
  templateBarcodeElementSchema,
  templateQrElementSchema,
  templateBoxElementSchema
])

// ─── Template short names (webhook slugs) ───────────────────────────────────

/**
 * Trimmed and lowercased *before* validation, so nobody has to remember
 * capitalisation in a URL and there is one spelling of any slug in the database.
 * Two rows differing only in case would be indistinguishable in a webhook URL.
 */
export const templateShortNameSchema = z.string()
  .meta({
    examples: ['part-2x1'],
    description: 'Public slug for webhook printing: POST /api/print/template/{shortName}. '
      + 'Lowercase alphanumerics in hyphen-separated groups, normalised on write and matched '
      + 'case-insensitively. Unique across your own templates and the built-in presets. Omit to '
      + 'leave the template unreachable by webhook — nothing is generated automatically. Send '
      + 'null or "" to clear it.'
  })
  .trim()
  .toLowerCase()
  .min(MIN_TEMPLATE_SHORT_NAME_LENGTH, `Short name must be at least ${MIN_TEMPLATE_SHORT_NAME_LENGTH} characters`)
  .max(MAX_TEMPLATE_SHORT_NAME_LENGTH, `Short name must be at most ${MAX_TEMPLATE_SHORT_NAME_LENGTH} characters`)
  .regex(
    TEMPLATE_SHORT_NAME_PATTERN,
    'Use lowercase letters, numbers, and single hyphens between them — e.g. "part-2x1". '
      + 'No spaces, underscores, leading or trailing hyphens.'
  )
  .refine(value => !RESERVED_TEMPLATE_SHORT_NAMES.includes(value), {
    message: 'That short name is reserved for the API\'s own paths. Try adding a qualifier, e.g. "label-2x1" instead of "label".'
  })

/**
 * `''` and `null` both mean "no short name": a form binding an empty input and a
 * client explicitly nulling the field are saying the same thing.
 */
export const optionalTemplateShortNameSchema = z.preprocess(
  value => (value === '' || value === null ? undefined : value),
  templateShortNameSchema.optional()
)

/** POST/PUT /api/templates — full template definition */
export const templateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(100),
  description: z.string().max(500).optional(),
  shortName: optionalTemplateShortNameSchema,
  baseWidthDots: z.number().int().min(1),
  baseHeightDots: z.number().int().min(1),
  variables: z.array(templateVariableSchema).max(50).default([]),
  elements: z.array(templateElementSchema).max(100).default([]),
  // sizeKey -> elementId -> partial overrides (loosely validated)
  overrides: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown()))).default({})
}).strict()

// ─── Template printing (webhooks) ───────────────────────────────────────────

/**
 * Load-bearing, not documentation: the flat payload form uses this to tell a
 * control field from a variable. Adding one is a mild compatibility event for flat
 * callers using that word as a variable name. Nested `variables` is immune, which
 * is why it is canonical.
 */
export const TEMPLATE_PRINT_CONTROL_KEYS = [
  'variables',
  'quantity',
  'copies',
  'dryRun',
  'allowMissingVariables',
  'target',
  'printerId',
  'printerName',
  'labelSize'
] as const

/**
 * Numbers and booleans are stringified, because a payload assembled by another
 * service usually has real JSON numbers in it. Objects, arrays and null are
 * rejected: `JSON.stringify`-ing one onto a label produces a bad label rather
 * than an error.
 */
const templateVariableValueSchema = z.union([
  z.string().max(2000, 'Variable values are limited to 2000 characters'),
  z.number().finite(),
  z.boolean()
]).transform(value => String(value))
  .describe('Numbers and booleans are accepted and stringified. Objects, arrays and null are rejected. An empty string is an explicit blank, distinct from omitting the variable.')

export const templateVariablesSchema = z.record(
  z.string().regex(/^[A-Za-z0-9_]+$/, 'Variable names use letters, numbers, and underscores only'),
  templateVariableValueSchema
).describe('Values keyed by variable name. Unknown names are rejected rather than ignored, so a typo is an error rather than a blank field on a physical label.')

/**
 * Fold a flat payload into the canonical nested shape, so everything downstream
 * sees one form. Flat is accepted because plenty of services emit a fixed payload
 * and cannot be persuaded to nest anything.
 *
 * A body that already has `variables` passes through untouched, so a stray sibling
 * key is reported by `.strict()` rather than silently becoming a variable — mixing
 * the forms is likelier a mistake than an intention.
 */
function foldFlatVariables(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body
  const source = body as Record<string, unknown>
  if ('variables' in source) return source

  const control: Record<string, unknown> = {}
  // Null-prototype, because variable names are allowed to contain underscores and
  // so `__proto__` matches the name pattern. Assigning that key on a plain object
  // would mutate the prototype and silently drop the value.
  const variables: Record<string, unknown> = Object.create(null)
  for (const [key, value] of Object.entries(source)) {
    if ((TEMPLATE_PRINT_CONTROL_KEYS as readonly string[]).includes(key)) {
      control[key] = value
    } else {
      variables[key] = value
    }
  }
  return { ...control, variables }
}

/**
 * POST /api/print/template/:shortName
 *
 * Every field is optional: an empty body prints one copy of a template that takes
 * no variables, on the default printer, at that printer's stock.
 *
 * Variable *names* are checked in the handler, which knows which template is being
 * printed; this schema does not.
 */
export const templatePrintSchema = z.preprocess(
  foldFlatVariables,
  z.object({
    /** Canonical; also populated from a flat payload by the preprocess above. */
    variables: templateVariablesSchema.optional().default({})
      .describe('Variable values by name. Any top-level key that is not one of the fields listed here is also read as a variable, for callers whose payload shape is fixed and flat.'),
    quantity: copiesSchema.optional(),
    copies: copiesSchema.optional()
      .describe('Synonym of `quantity`, for consistency with the other print endpoints. Sending both with different values is an error.'),
    dryRun: z.boolean().optional().default(false)
      .describe('Render and return the ZPL without printing or recording a job. Use this while wiring up an integration.'),
    allowMissingVariables: z.boolean().optional().default(false)
      .describe('Let variables the template\'s layout references be absent, rendering them blank. Off by default because a missing value leaves a gap the caller cannot see. A variable\'s sample value is never substituted either way.'),
    ...printerSelectionFields
  }).strict()
    .refine(
      data => data.quantity === undefined || data.copies === undefined || data.quantity === data.copies,
      {
        message: 'Send either `quantity` or `copies`, not both with different values',
        path: ['quantity']
      }
    )
    // Collapse the synonym so the handler only ever reads `quantity`.
    .transform(({ copies, ...rest }) => ({ ...rest, quantity: rest.quantity ?? copies ?? 1 }))
)

// ─── Serial / batch printing ────────────────────────────────────────────────

/**
 * POST /api/print/serial — multi-copy with auto-incrementing serial numbers.
 *
 * Server-side only: each copy is printed in turn, which the browser handoff has
 * no way to express. It still takes a `printerId` so the run goes to a chosen
 * printer rather than whichever one happens to be the default.
 */
export const serialLabelSchema = z.object({
  lines: z.array(z.string().min(1)).min(1, 'At least one line required').max(20, 'Max 20 lines'),
  copies: copiesSchema,
  serialStart: z.number().int().min(0).default(1),
  serialFormat: z.enum(['#', '##', '###', '####', '#####']).optional().default('###'),
  /** Configured printer to print on. Omit to use the default printer. */
  printerId: z.string().min(1).max(64).optional()
}).strict()

// ─── Settings and label size ────────────────────────────────────────────────

/**
 * PUT /api/settings — key/value settings.
 *
 * Open-ended by design: the settings store is a key/value table and callers add
 * keys the server has no opinion about. Values are coerced to strings, which is how
 * the column stores them either way — accepting a number here and writing "3" is
 * friendlier than rejecting it.
 *
 * Previously this endpoint hand-rolled its validation, which meant it was the one
 * PUT body with no schema to generate documentation from.
 */
export const settingsSchema = z.record(
  z.string().min(1).max(200),
  z.union([z.string().max(4000), z.number().finite(), z.boolean()])
    .transform(value => String(value))
    .describe('Setting value. Numbers and booleans are accepted and stored as strings.')
).describe('Settings to write, keyed by name. Existing keys are overwritten; keys not sent are left alone.')

/**
 * PUT /api/label-size — the legacy global label size.
 *
 * Superseded by per-printer configuration; kept for installs with no printers
 * registered and for library callers with no registry.
 */
export const labelSizeSchema = z.object({
  widthDots: z.number().int()
    .min(MIN_LABEL_WIDTH_DOTS, `Label width must be at least ${MIN_LABEL_WIDTH_DOTS} dots`)
    .max(MAX_LABEL_WIDTH_DOTS),
  heightDots: z.number().int()
    .min(MIN_LABEL_HEIGHT_DOTS, `Label height must be at least ${MIN_LABEL_HEIGHT_DOTS} dots`)
    .max(MAX_LABEL_LENGTH_DOTS),
  name: z.string().max(100).optional()
    .describe('Human-readable size name. Derived from the dimensions when omitted.'),
  tracking: z.enum(MEDIA_TRACKINGS).optional()
    .describe('Media tracking to send with the geometry. Defaults to the configured tracking.'),
  applyToPrinter: z.boolean().optional()
    .describe('Also push the geometry to the connected printer (^PW/^ML/^MN). Defaults to true — saving the setting alone only changes the ZPL this app generates, which is how a size change ends up producing clipped labels.')
}).strict()

// ─── Queue management ───────────────────────────────────────────────────────

/** POST /api/jobs/clear — bulk clear completed/cancelled jobs */
export const clearJobsSchema = z.object({
  status: z.enum(['completed', 'failed', 'cancelled', 'all']).optional().default('completed'),
  olderThanDays: z.number().int().min(1).max(365).optional()
}).strict()

/**
 * POST /api/jobs/:id/result — report the outcome of a locally printed job.
 *
 * Used by the browser after a WebUSB transfer so the job doesn't sit in
 * 'printing' forever.
 */
export const jobResultSchema = z.object({
  success: z.boolean(),
  error: z.string().max(500).optional()
}).strict()

// ─── Printer media configuration ────────────────────────────────────────────

/**
 * POST /api/printer/configure — push media geometry to the printer.
 *
 * Falls back to the configured label size when dimensions are omitted, so the
 * common case is an empty body meaning "apply the current label size".
 */
export const printerConfigSchema = z.object({
  printerId: z.string().min(1).max(64).optional()
    .describe('Printer to configure. Omit to apply this printer\'s own saved configuration, which is what you want after swapping stock.'),
  widthDots: z.number().int().min(MIN_LABEL_WIDTH_DOTS).max(MAX_LABEL_WIDTH_DOTS).optional(),
  heightDots: z.number().int().min(MIN_LABEL_HEIGHT_DOTS).max(MAX_LABEL_LENGTH_DOTS).optional(),
  dpi: dpiSchema.optional(),
  tracking: z.enum(MEDIA_TRACKINGS).optional(),
  /** Black-mark offset in dots; only meaningful when tracking is 'mark' */
  markOffset: z.number().int().min(-240).max(566).optional()
    .describe('Black-mark offset in dots. Only meaningful when tracking is "mark".'),
  persist: z.boolean().optional()
    .describe('Save to the printer\'s non-volatile memory (^JUS). Defaults to true.'),
  calibrate: z.boolean().optional()
    .describe('Run a sensor calibration (~JC) straight after applying. Feeds 2–4 labels.'),
  target: printTargetEnum.optional().default('server')
}).strict()

/** POST /api/printer/calibrate */
export const printerCalibrateSchema = z.object({
  /** Printer to calibrate. Omit to use the default printer. */
  printerId: z.string().min(1).max(64).optional(),
  target: printTargetEnum.optional().default('server')
}).strict()

// ─── Printer registry ───────────────────────────────────────────────────────
//
// Server-side printers, each with its own media configuration. Browser-attached
// printers never reach these endpoints — the WebUSB pairing belongs to one
// browser, so those profiles are stored client-side instead.

const printerProfileFields = {
  name: z.string().min(1, 'Printer name is required').max(120).optional(),
  transport: z.enum(SERVER_PRINTER_TRANSPORTS).optional(),
  /** CUPS queue name — required for `transport: 'cups'` */
  cupsName: z.string().min(1).max(200).nullable().optional(),
  /** CUPS device URI, or host:port for a networked printer */
  deviceUri: z.string().max(500).nullable().optional(),
  usbDeviceId: z.string().max(200).nullable().optional(),
  /** Label stock loaded in this printer */
  labelSize: labelGeometrySchema.optional(),
  dpi: dpiSchema.optional(),
  tracking: z.enum(MEDIA_TRACKINGS).optional(),
  markOffset: z.number().int().min(-240).max(566).nullable().optional(),
  /** Use this printer when a request doesn't name one */
  isDefault: z.boolean().optional()
}

/** POST /api/printers — register a server printer */
export const printerCreateSchema = z.object(printerProfileFields).strict()
  // `transport` defaults to 'cups', and a CUPS printer without a queue name
  // can't be printed to at all — better to reject it than to store a profile
  // that silently never works.
  .refine(data => (data.transport ?? 'cups') !== 'cups' || !!data.cupsName, {
    message: 'cupsName is required for a CUPS printer',
    path: ['cupsName']
  })

/** PUT /api/printers/:id — update any subset of a printer's configuration */
export const printerUpdateSchema = z.object(printerProfileFields).strict()

// ─── Type exports ───────────────────────────────────────────────────────────

export type TextLabelRequest = z.infer<typeof textLabelSchema>
export type BarcodeLabelRequest = z.infer<typeof barcodeLabelSchema>
export type QRLabelRequest = z.infer<typeof qrLabelSchema>
export type LabelRequest = z.infer<typeof labelSchema>
export type RenderZplRequest = z.infer<typeof renderZplSchema>
export type SerialLabelRequest = z.infer<typeof serialLabelSchema>
export type ClearJobsRequest = z.infer<typeof clearJobsSchema>
export type JobResultRequest = z.infer<typeof jobResultSchema>
export type PrinterConfigRequest = z.infer<typeof printerConfigSchema>
export type PrinterCalibrateRequest = z.infer<typeof printerCalibrateSchema>
export type PrinterCreateRequest = z.infer<typeof printerCreateSchema>
export type TemplatePrintRequest = z.infer<typeof templatePrintSchema>
export type SettingsRequest = z.infer<typeof settingsSchema>
export type LabelSizeRequest = z.infer<typeof labelSizeSchema>
export type PrinterUpdateRequest = z.infer<typeof printerUpdateSchema>
export type LabelGeometryRequest = z.infer<typeof labelGeometrySchema>
export type TemplateDefinition = z.infer<typeof templateSchema>
export type TemplateVariable = z.infer<typeof templateVariableSchema>
export type TemplateElement = z.infer<typeof templateElementSchema>
