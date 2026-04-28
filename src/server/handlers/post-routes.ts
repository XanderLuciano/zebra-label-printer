/**
 * POST route handlers — label printing endpoints.
 *
 * Each handler validates its input with Zod, builds ZPL, and sends it to the printer.
 * All handlers are self-contained: they read the body, validate, format, print, respond.
 */

import { ZodSchema } from 'zod';
import type { Handler } from '../router';
import { json, readBody, validate, checkAuth } from '../helpers';
import { ZPLBuilder, textLabel, barcodeLabel, qrLabel } from '../../zpl';
import {
  textLabelSchema,
  barcodeLabelSchema,
  qrLabelSchema,
  zplSchema,
  labelSchema,
} from '../../schemas';
import type {
  TextLabelRequest,
  BarcodeLabelRequest,
  QRLabelRequest,
  LabelRequest,
} from '../../schemas';

/** POST /api/print/text — print a multi-line text label */
export function printTextHandler(apiKey: string): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return;

    const data = await validate<TextLabelRequest>(req, res, textLabelSchema);
    if (!data) return;

    const zpl = textLabel(data.lines, {});
    const result = await printer.print(zpl);
    json(res, result, result.success ? 200 : 500);
  };
}

/** POST /api/print/barcode — print a barcode label */
export function printBarcodeHandler(apiKey: string): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return;

    const data = await validate<BarcodeLabelRequest>(req, res, barcodeLabelSchema);
    if (!data) return;

    const zpl = barcodeLabel(data.data, data.type, data.text, {
      barcodeHeight: data.height,
    });
    const result = await printer.print(zpl);
    json(res, result, result.success ? 200 : 500);
  };
}

/** POST /api/print/qr — print a QR code label */
export function printQrHandler(apiKey: string): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return;

    const data = await validate<QRLabelRequest>(req, res, qrLabelSchema);
    if (!data) return;

    const zpl = qrLabel(data.data, data.text, {
      magnification: data.magnification,
    });
    const result = await printer.print(zpl);
    json(res, result, result.success ? 200 : 500);
  };
}

/** POST /api/print/zpl — print raw ZPL (accepts text/plain or JSON) */
export function printZplHandler(apiKey: string): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return;

    const raw = await readBody(req);

    // Try as raw ZPL string first (text/plain), then as JSON
    let zpl: string;
    if (raw && !raw.trim().startsWith('{') && !raw.trim().startsWith('[')) {
      zpl = raw.trim();
    } else {
      const data = await validate<{ zpl: string }>(
        req, res,
        zplSchema as unknown as ZodSchema<{ zpl: string }>,
      );
      if (!data) return;
      zpl = (data as unknown as { zpl: string }).zpl;
    }

    if (!zpl || zpl.length === 0) {
      json(res, { error: 'ZPL commands required' }, 400);
      return;
    }

    const result = await printer.print(zpl);
    json(res, result, result.success ? 200 : 500);
  };
}

/** POST /api/print/label — print a composed label from element definitions */
export function printLabelHandler(apiKey: string): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return;

    const data = await validate<LabelRequest>(req, res, labelSchema);
    if (!data) return;

    try {
      const builder = new ZPLBuilder();
      for (const el of data.elements) {
        builder.element(el as Parameters<ZPLBuilder['element']>[0]);
      }
      const zpl = builder.build();
      const result = await printer.print(zpl);
      json(res, result, result.success ? 200 : 500);
    } catch (err) {
      json(res, { error: (err as Error).message }, 400);
    }
  };
}
