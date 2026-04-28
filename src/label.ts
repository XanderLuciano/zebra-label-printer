/**
 * High-level label layout helpers.
 *
 * Provides pre-built label templates for common use cases:
 * shipping labels, inventory tags, barcode labels, etc.
 */

import { ZPLBuilder, inchesToDots, LABEL_SIZES } from './zpl';
import type { LabelOptions, TextOptions, BarcodeOptions } from './types';

// ─── Label Templates ────────────────────────────────────────────────────────

/** Simple text-only label with optional title */
export function simpleTextLabel(
  title: string,
  lines: string[],
  options: LabelOptions & { fontSize?: number; x?: number } = {}
): ZPLBuilder {
  const b = new ZPLBuilder(options);
  const x = options.x ?? inchesToDots(0.1);
  let y = inchesToDots(0.15);

  // Title in larger font
  if (title) {
    b.text(title, { x, y, height: 50, width: 30, font: '0' });
    y += 55;
  }

  // Body lines
  const h = options.fontSize ?? 30;
  for (const line of lines) {
    b.text(line, { x, y, height: h, font: '0' });
    y += h + 8;
  }

  return b;
}

/** Shipping label */
export function shippingLabel(
  to: { name: string; address1: string; address2?: string; city: string; state: string; zip: string },
  from?: { name: string; address1: string },
  options: LabelOptions = {}
): ZPLBuilder {
  const b = new ZPLBuilder({ ...options, width: LABEL_SIZES['3x5'].width, height: LABEL_SIZES['3x5'].height });
  const x = inchesToDots(0.15);

  // "TO:" header
  b.text('SHIP TO:', { x, y: inchesToDots(0.1), height: 40, width: 24, font: 'D' });

  // Recipient
  let y = inchesToDots(0.4);
  b.text(to.name, { x, y, height: 35, font: '0' });
  y += 40;
  b.text(to.address1, { x, y, height: 30, font: '0' });
  y += 35;
  if (to.address2) {
    b.text(to.address2, { x, y, height: 30, font: '0' });
    y += 35;
  }
  b.text(`${to.city}, ${to.state} ${to.zip}`, { x, y, height: 30, font: '0' });

  // Return address (small, top-right)
  if (from) {
    const rx = inchesToDots(1.5);
    b.text(from.name, { x: rx, y: inchesToDots(1.0), height: 22, font: '0' });
    b.text(from.address1, { x: rx, y: inchesToDots(1.12), height: 20, font: '0' });
  }

  // Separator line
  b.line(inchesToDots(0.1), inchesToDots(0.35), inchesToDots(2.8), 3);

  return b;
}

/** Inventory / asset tag with barcode */
export function assetTag(
  assetId: string,
  description: string,
  location?: string,
  options: LabelOptions & { barcodeType?: 'CODE128' | 'CODE39' } = {}
): ZPLBuilder {
  const b = new ZPLBuilder({ ...options, width: LABEL_SIZES['3x5'].width, height: LABEL_SIZES['3x5'].height });

  // Barcode centered
  const bcY = inchesToDots(0.3);
  b.barcode(assetId, {
    x: inchesToDots(0.2),
    y: bcY,
    type: options.barcodeType ?? 'CODE128',
    height: 100,
    humanReadable: false,
  });

  // Human-readable ID below barcode
  const textY = bcY + 110;
  b.text(assetId, { x: inchesToDots(0.2), y: textY, height: 35, font: '0' });

  // Description
  if (description) {
    b.text(description, {
      x: inchesToDots(0.2),
      y: textY + 40,
      height: 28,
      font: '0',
    });
  }

  // Location
  if (location) {
    b.text(`Location: ${location}`, {
      x: inchesToDots(0.2),
      y: textY + (description ? 75 : 40),
      height: 24,
      font: '0',
    });
  }

  return b;
}

/** QR code label with text */
export function qrCodeLabel(
  data: string,
  title: string,
  subtitle?: string,
  options: LabelOptions & { magnification?: number } = {}
): ZPLBuilder {
  const b = new ZPLBuilder(options);
  const mag = options.magnification ?? 5;
  const qrSize = mag * 25; // approximate

  // Title
  b.text(title, { x: inchesToDots(0.2), y: 20, height: 35, font: '0' });

  // QR code
  b.qrcode(data, {
    x: inchesToDots(0.3),
    y: 65,
    magnification: mag,
  });

  // Subtitle below QR
  if (subtitle) {
    b.text(subtitle, {
      x: inchesToDots(0.2),
      y: 65 + qrSize + 25,
      height: 24,
      font: '0',
    });
  }

  return b;
}

/** Small item label (price tag, bin label) */
export function itemLabel(
  itemName: string,
  price?: string,
  sku?: string,
  options: LabelOptions & { barcodeType?: 'CODE128' } = {}
): ZPLBuilder {
  const b = new ZPLBuilder({ ...options, width: LABEL_SIZES['3x5'].width, height: LABEL_SIZES['3x5'].height });

  // Item name at top
  b.text(itemName, {
    x: inchesToDots(0.15),
    y: inchesToDots(0.1),
    height: 35,
    font: 'D',
  });

  // Price in large font
  if (price) {
    b.text(price, {
      x: inchesToDots(0.15),
      y: inchesToDots(0.35),
      height: 60,
      width: 36,
      font: 'E',
    });
  }

  // SKU as barcode
  if (sku) {
    b.barcode(sku, {
      x: inchesToDots(0.15),
      y: inchesToDots(0.8),
      type: options.barcodeType ?? 'CODE128',
      height: 60,
      humanReadable: true,
    });
  }

  return b;
}

/** Create a label from raw elements array */
export function customLabel(
  elements: Array<
    | { type: 'text'; content: string; options: TextOptions }
    | { type: 'barcode'; content: string; options: BarcodeOptions }
    | { type: 'qrcode'; content: string; options: import('./types').QROptions }
    | { type: 'raw'; zpl: string }
  >,
  options: LabelOptions = {}
): ZPLBuilder {
  const b = new ZPLBuilder(options);
  for (const el of elements) {
    b.element(el);
  }
  return b;
}
