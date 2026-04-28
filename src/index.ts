/**
 * Zebra Label Printer Library
 *
 * Connect to, discover, and print labels on Zebra printers (GK420d and compatibles).
 * Supports text labels, 1D barcodes, QR codes, and Data Matrix.
 *
 * @example Quick start
 * ```ts
 * import { Printer, ZPLBuilder } from 'zebra-label-printer';
 *
 * const printer = await Printer.auto();
 *
 * const zpl = new ZPLBuilder()
 *   .text('Hello World!', { x: 50, y: 50, height: 40 })
 *   .barcode('123456', { x: 50, y: 120, type: 'CODE128', height: 80 })
 *   .build();
 *
 * await printer.print(zpl);
 * ```
 *
 * @example Webhook server
 * ```ts
 * import { startServer } from 'zebra-label-printer';
 * await startServer({ port: 3420 });
 * ```
 */

// Core classes
export { Printer } from './printer';
export { ZPLBuilder } from './zpl';
export { WebhookServer, startServer } from './webhook';

// Discovery
export { discoverPrinters, findFirstZebra, getPrinter } from './discovery';

// ZPL helpers
export {
  textLabel,
  barcodeLabel,
  qrLabel,
  inchesToDots,
  mmToDots,
  LABEL_SIZES,
  ZEBRA_DPI,
  FONTS,
} from './zpl';

// Label templates
export {
  simpleTextLabel,
  shippingLabel,
  assetTag,
  qrCodeLabel,
  itemLabel,
  customLabel,
} from './label';

// Types
export type {
  PrinterInfo,
  TextOptions,
  BarcodeOptions,
  QROptions,
  LabelElement,
  LabelOptions,
  PrintResult,
  DiscoveryOptions,
  WebhookConfig,
  BarcodeType,
} from './types';
