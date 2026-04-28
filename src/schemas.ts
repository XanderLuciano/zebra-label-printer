/**
 * Zod validation schemas for the webhook API.
 *
 * Every endpoint gets a strict schema. Invalid requests get a 400
 * with structured error details so callers know exactly what's wrong.
 */

import { z } from 'zod';

// ─── Shared ─────────────────────────────────────────────────────────────────

const barcodeTypeEnum = z.enum([
  'CODE128', 'CODE39', 'CODE93', 'EAN8', 'EAN13',
  'UPCA', 'UPCE', 'CODABAR', 'PDF417', 'QRCODE', 'DATAMATRIX',
]);

const errorCorrectionEnum = z.enum(['L', 'M', 'Q', 'H']);

const rotationEnum = z.enum(['N', 'R', 'I', 'B']);

// ─── Endpoint Schemas ───────────────────────────────────────────────────────

/** POST /api/print/text */
export const textLabelSchema = z.object({
  lines: z.array(z.string().min(1)).min(1, 'At least one line required').max(20, 'Max 20 lines'),
  copies: z.number().int().min(1).max(10).optional(),
}).strict();

/** POST /api/print/barcode */
export const barcodeLabelSchema = z.object({
  data: z.string().min(1, 'Barcode data is required'),
  type: barcodeTypeEnum.optional().default('CODE128'),
  text: z.string().optional(),
  height: z.number().int().min(10).max(1000).optional(),
}).strict();

/** POST /api/print/qr */
export const qrLabelSchema = z.object({
  data: z.string().min(1, 'QR code data is required'),
  text: z.string().optional(),
  magnification: z.number().int().min(1).max(10).optional().default(5),
}).strict();

/** POST /api/print/zpl — accepts raw string or JSON object */
export const zplSchema = z.union([
  z.string().min(1, 'ZPL commands required'),
  z.object({
    zpl: z.string().min(1, 'ZPL commands required'),
  }).strict(),
]);

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
    rotation: rotationEnum.optional(),
    reverse: z.boolean().optional(),
  }).strict(),
}).strict();

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
    rotation: rotationEnum.optional(),
  }).strict(),
}).strict();

const qrElementSchema = z.object({
  type: z.literal('qrcode'),
  content: z.string(),
  options: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    magnification: z.number().int().min(1).max(10).optional(),
    errorCorrection: errorCorrectionEnum.optional(),
  }).strict(),
}).strict();

const rawElementSchema = z.object({
  type: z.literal('raw'),
  zpl: z.string(),
}).strict();

const labelElementSchema = z.discriminatedUnion('type', [
  textElementSchema,
  barcodeElementSchema,
  qrElementSchema,
  rawElementSchema,
]);

/** POST /api/print/label */
export const labelSchema = z.object({
  elements: z.array(labelElementSchema).min(1, 'At least one element required'),
  copies: z.number().int().min(1).max(10).optional(),
}).strict();

// ─── Serial / batch printing ────────────────────────────────────────────────

/** POST /api/print/serial — multi-copy with auto-incrementing serial numbers */
export const serialLabelSchema = z.object({
  lines: z.array(z.string().min(1)).min(1, 'At least one line required').max(20, 'Max 20 lines'),
  copies: z.number().int().min(1).max(500, 'Max 500 copies'),
  serialStart: z.number().int().min(0).default(1),
  serialFormat: z.enum(['#', '##', '###', '####', '#####']).optional().default('###'),
}).strict();

// ─── Queue management ───────────────────────────────────────────────────────

/** POST /api/jobs/clear — bulk clear completed/cancelled jobs */
export const clearJobsSchema = z.object({
  status: z.enum(['completed', 'failed', 'cancelled', 'all']).optional().default('completed'),
  olderThanDays: z.number().int().min(1).max(365).optional(),
}).strict();

// ─── Type exports ───────────────────────────────────────────────────────────

export type TextLabelRequest = z.infer<typeof textLabelSchema>;
export type BarcodeLabelRequest = z.infer<typeof barcodeLabelSchema>;
export type QRLabelRequest = z.infer<typeof qrLabelSchema>;
export type LabelRequest = z.infer<typeof labelSchema>;
export type SerialLabelRequest = z.infer<typeof serialLabelSchema>;
export type ClearJobsRequest = z.infer<typeof clearJobsSchema>;
