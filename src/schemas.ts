/**
 * Zod validation schemas for the webhook API.
 *
 * Every endpoint gets a strict schema. Invalid requests get a 400
 * with structured error details so callers know exactly what's wrong.
 */

import { z } from 'zod'
import {
  MEDIA_TRACKINGS,
  MIN_LABEL_WIDTH_DOTS,
  MIN_LABEL_HEIGHT_DOTS,
  MAX_LABEL_LENGTH_DOTS,
  SERVER_PRINTER_TRANSPORTS
} from './constants'

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
  /** Configured printer to print on. Omit to use the default printer. */
  printerId: z.string().min(1).max(64).optional(),
  /** Name to record on the job, for printers the server can't name itself. */
  printerName: z.string().min(1).max(120).optional(),
  /** Geometry to render for, overriding the printer's saved configuration. */
  labelSize: labelGeometrySchema.optional()
}

// ─── Endpoint Schemas ───────────────────────────────────────────────────────

/** POST /api/print/text */
export const textLabelSchema = z.object({
  lines: z.array(z.string().min(1)).min(1, 'At least one line required').max(20, 'Max 20 lines'),
  copies: z.number().int().min(1).max(10).optional(),
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
  copies: z.number().int().min(1).max(10).optional(),
  ...printerSelectionFields
}).strict()

/** POST /api/render/zpl — build ZPL from elements without printing (for previews) */
export const renderZplSchema = z.object({
  elements: z.array(labelElementSchema).min(1, 'At least one element required'),
  copies: z.number().int().min(1).max(10).optional(),
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

/** POST/PUT /api/templates — full template definition */
export const templateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(100),
  description: z.string().max(500).optional(),
  baseWidthDots: z.number().int().min(1),
  baseHeightDots: z.number().int().min(1),
  variables: z.array(templateVariableSchema).max(50).default([]),
  elements: z.array(templateElementSchema).max(100).default([]),
  // sizeKey -> elementId -> partial overrides (loosely validated)
  overrides: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown()))).default({})
}).strict()

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
  copies: z.number().int().min(1).max(500, 'Max 500 copies'),
  serialStart: z.number().int().min(0).default(1),
  serialFormat: z.enum(['#', '##', '###', '####', '#####']).optional().default('###'),
  /** Configured printer to print on. Omit to use the default printer. */
  printerId: z.string().min(1).max(64).optional()
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
  /** Printer to configure. Omit to use the default printer. */
  printerId: z.string().min(1).max(64).optional(),
  widthDots: z.number().int().min(MIN_LABEL_WIDTH_DOTS).max(MAX_LABEL_WIDTH_DOTS).optional(),
  heightDots: z.number().int().min(MIN_LABEL_HEIGHT_DOTS).max(MAX_LABEL_LENGTH_DOTS).optional(),
  dpi: dpiSchema.optional(),
  tracking: z.enum(MEDIA_TRACKINGS).optional(),
  /** Black-mark offset in dots; only meaningful when tracking is 'mark' */
  markOffset: z.number().int().min(-240).max(566).optional(),
  /** Persist to the printer's non-volatile memory (^JUS) */
  persist: z.boolean().optional(),
  /** Run a sensor calibration (~JC) straight after applying the config */
  calibrate: z.boolean().optional(),
  /** 'local' returns the ZPL for the browser to send over WebUSB instead of printing */
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
export type PrinterUpdateRequest = z.infer<typeof printerUpdateSchema>
export type LabelGeometryRequest = z.infer<typeof labelGeometrySchema>
export type TemplateDefinition = z.infer<typeof templateSchema>
export type TemplateVariable = z.infer<typeof templateVariableSchema>
export type TemplateElement = z.infer<typeof templateElementSchema>
