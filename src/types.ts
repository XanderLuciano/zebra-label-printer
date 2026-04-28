/** Type definitions for the Zebra Label Printer library */

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
}

/** A single element on a label */
export type LabelElement =
  | { type: 'text'; content: string; options: TextOptions }
  | { type: 'barcode'; content: string; options: BarcodeOptions }
  | { type: 'qrcode'; content: string; options: QROptions }
  | { type: 'raw'; zpl: string }

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
}

/** Label size configuration */
export interface LabelSize {
  /** Width in inches */
  widthInches: number;
  /** Height in inches */
  heightInches: number;
  /** Width in dots (at 203 DPI) */
  widthDots: number;
  /** Height in dots (at 203 DPI) */
  heightDots: number;
  /** Human-readable name */
  name: string;
}
