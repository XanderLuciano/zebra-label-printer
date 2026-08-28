/** Type definitions for the Zebra Label Printer library */

import type { MediaTracking, PrinterConnection, PrinterTransport } from './constants'

/** A discovered printer */
export interface PrinterInfo {
  /** CUPS printer name (e.g. 'ZTC-GK420d') */
  name: string;
  /** Device URI */
  uri: string;
  /** Printer make/model */
  model: string;
  /** Current status */
  status: 'idle' | 'printing' | 'unavailable' | 'unknown';
  /** Whether the printer is accepting jobs */
  accepting: boolean;
  /** USB serial number, if available */
  serial?: string;
  /** Whether this is a Zebra printer */
  isZebra: boolean;
}

/** Options for a text element on a label */
export interface TextOptions {
  /** X position in dots (1 dot = 1/203 inch for GK420d) */
  x: number;
  /** Y position in dots */
  y: number;
  /** Font name or identifier */
  font?: string;
  /** Font height in dots */
  height?: number;
  /** Font width in dots */
  width?: number;
  /** Width-to-height ratio (0.1–3.0). Used to derive width from height or height from width when the other is not specified. Default: 0.8 */
  ratio?: number;
  /** Text rotation: N (normal), R (90°), I (180°), B (270°) */
  rotation?: 'N' | 'R' | 'I' | 'B';
  /** Reverse print (white on black) */
  reverse?: boolean;
}

/** Options for a barcode element on a label */
export interface BarcodeOptions {
  /** X position in dots */
  x: number;
  /** Y position in dots */
  y: number;
  /** Barcode type */
  type: BarcodeType;
  /** Barcode height in dots */
  height?: number;
  /** Narrow bar width (1-10) */
  narrowBarWidth?: number;
  /** Wide bar ratio (2.0-3.0) */
  wideBarRatio?: number;
  /** Print human-readable text below barcode */
  humanReadable?: boolean;
  /** Human-readable text position: Y (above) or N (below) */
  humanReadablePosition?: 'Y' | 'N';
  /** Rotation */
  rotation?: 'N' | 'R' | 'I' | 'B';
}

/** Supported barcode types */
export type BarcodeType =
  | 'CODE128'
  | 'CODE39'
  | 'CODE93'
  | 'EAN8'
  | 'EAN13'
  | 'UPCA'
  | 'UPCE'
  | 'CODABAR'
  | 'PDF417'
  | 'QRCODE'
  | 'DATAMATRIX'

/** Options for a QR code (2D barcode) element */
export interface QROptions {
  /** X position in dots */
  x: number;
  /** Y position in dots */
  y: number;
  /** Magnification factor (1-10), default 5 */
  magnification?: number;
  /** Error correction: L (7%), M (15%), Q (25%), H (30%) — default M */
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';
  /** Rotation: N (normal), R (90°), I (180°), B (270°) */
  rotation?: 'N' | 'R' | 'I' | 'B';
}

/** A single element on a label */
export type LabelElement =
  | { type: 'text'; content: string; options: TextOptions }
  | { type: 'barcode'; content: string; options: BarcodeOptions }
  | { type: 'qrcode'; content: string; options: QROptions }
  | { type: 'raw'; zpl: string }

/** Options for generating the printer's media configuration ZPL */
export interface MediaConfigOptions {
  /** Label width in dots */
  widthDots: number;
  /** Label height in dots */
  heightDots: number;
  /** Print head resolution (default: 203) */
  dpi?: number;
  /** How the printer detects the top of each label (default: 'gap') */
  tracking?: MediaTracking;
  /** Black-mark offset in dots — only used when tracking is 'mark' */
  markOffset?: number;
  /** Save the configuration to non-volatile memory via ^JUS (default: true) */
  persist?: boolean;
}

/** Options for a complete label */
export interface LabelOptions {
  /** Label width in dots (default: 609 for 3" label at 203dpi) */
  width?: number;
  /** Label height in dots (default: 1015 for 5" label at 203dpi) */
  height?: number;
  /** DPI of the printer (default: 203 for GK420d) */
  dpi?: number;
  /** Number of copies to print */
  copies?: number;
}

/** Result of a print operation */
export interface PrintResult {
  success: boolean;
  jobId?: string;
  error?: string;
}

/** Options for printer discovery */
export interface DiscoveryOptions {
  /** Filter to only Zebra printers */
  zebraOnly?: boolean;
  /** Include network printers */
  includeNetwork?: boolean;
}

/** Webhook configuration */
export interface WebhookConfig {
  port?: number;
  host?: string;
  apiKey?: string;
  defaultPrinter?: string;
  /** Raw TCP passthrough port (default: 9100, set to 0 to disable) */
  tcpPort?: number;
}

/** Label size configuration */
export interface LabelSize {
  /** Width in inches */
  widthInches: number;
  /** Height in inches */
  heightInches: number;
  /** Width in dots, at the owning printer's DPI */
  widthDots: number;
  /** Height in dots, at the owning printer's DPI */
  heightDots: number;
  /** Human-readable name */
  name: string;
}

// ─── Printer profiles ────────────────────────────────────────────────────────

/**
 * The media configuration of one printer.
 *
 * This used to be a single global setting, which meant a local 2×1" printer and
 * a server 4×6" printer couldn't both be set up at once — switching printers
 * meant re-entering the label size and hoping the hardware agreed. Every
 * printer now carries its own copy, and the fields are the same whether the
 * printer is driven by this process or by a browser over WebUSB.
 */
export interface PrinterMediaConfig {
  /** Label geometry loaded in this printer */
  labelSize: LabelSize;
  /** Print head resolution */
  dpi: number;
  /** How the printer finds the top of each label (ZPL ^MN) */
  tracking: MediaTracking;
  /** Black-mark offset in dots — only meaningful when tracking is 'mark' */
  markOffset?: number;
}

/**
 * A configured printer: its identity, how to reach it, and its media config.
 *
 * Server printers live in the `printers` table and are visible to every client.
 * Local printers live in the browser that owns the USB device, keyed by
 * `usbDeviceId`, because that pairing can't be shared. The shape is identical
 * either way so the UI and the print pipeline don't branch on it.
 */
export interface PrinterProfile extends PrinterMediaConfig {
  /** Stable id. Browser-owned printers are prefixed `local_`. */
  id: string;
  /** User-facing name */
  name: string;
  /** Who drives this printer */
  connection: PrinterConnection;
  /** How the bytes reach it */
  transport: PrinterTransport;
  /** CUPS queue name, for `transport: 'cups'` */
  cupsName?: string | null;
  /** Device URI (CUPS) or host:port (TCP) — display and matching */
  deviceUri?: string | null;
  /** WebUSB identity `vendor:product:serial`, for `transport: 'webusb'` */
  usbDeviceId?: string | null;
  /** Use this printer when a request doesn't name one */
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Fields accepted when creating or updating a server printer profile */
export interface PrinterProfileInput {
  name?: string;
  transport?: PrinterTransport;
  cupsName?: string | null;
  deviceUri?: string | null;
  usbDeviceId?: string | null;
  labelSize?: LabelSize;
  dpi?: number;
  tracking?: MediaTracking;
  markOffset?: number | null;
  isDefault?: boolean;
}
