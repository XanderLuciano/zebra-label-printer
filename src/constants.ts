/**
 * Shared constants — single source of truth for configuration values,
 * enum values, and magic numbers used across the codebase.
 *
 * ─── NAMING CONVENTION ──────────────────────────────────────────────────────
 *
 *   • UPPER_SNAKE_CASE for all exported constants
 *   • Prefix with domain: DEFAULT_, MAX_, MIN_ for config boundaries
 *   • Suffix with unit: _MS, _DOTS, _INCHES, _DPI for dimensional values
 *   • Enum arrays: plural noun (JOB_STATUSES, BARCODE_TYPES)
 *   • Derived types: PascalCase singular (JobStatus, BarcodeType)
 *
 * ─── WHEN TO ADD A CONSTANT HERE ────────────────────────────────────────────
 *
 *   1. Value is used in 2+ files
 *   2. Value is a "magic number" that needs a name for clarity
 *   3. Value defines a system-wide default or limit
 *   4. Value is an enum shared between DB schema, Zod validation, or types
 *
 * ─── WHEN NOT TO ADD HERE ───────────────────────────────────────────────────
 *
 *   • Local layout offsets used only in one function (keep them inline)
 *   • One-off string literals that are self-documenting
 *   • Values that are clearly parameters (function args with defaults)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ENUMS — Used by Drizzle schema, Zod schemas, and TypeScript types
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Job Status ──────────────────────────────────────────────────────────────

export const JOB_STATUSES = ['pending', 'printing', 'completed', 'failed', 'cancelled'] as const
export type JobStatus = typeof JOB_STATUSES[number]

// ─── Job Type ────────────────────────────────────────────────────────────────

export const JOB_TYPES = ['text', 'barcode', 'qr', 'zpl', 'label'] as const
export type JobType = typeof JOB_TYPES[number]

// ─── Log Level ───────────────────────────────────────────────────────────────

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = typeof LOG_LEVELS[number]

// ─── Printer Event Type ──────────────────────────────────────────────────────

export const PRINTER_EVENT_TYPES = ['connected', 'disconnected', 'error', 'recovered'] as const
export type PrinterEventType = typeof PRINTER_EVENT_TYPES[number]

// ─── Barcode Types ───────────────────────────────────────────────────────────

export const BARCODE_TYPES = [
  'CODE128', 'CODE39', 'CODE93', 'EAN8', 'EAN13',
  'UPCA', 'UPCE', 'CODABAR', 'PDF417', 'QRCODE', 'DATAMATRIX'
] as const
export type BarcodeType = typeof BARCODE_TYPES[number]

// ─── Label Element Enums ─────────────────────────────────────────────────────

export const ROTATIONS = ['N', 'R', 'I', 'B'] as const
export type Rotation = typeof ROTATIONS[number]

export const ERROR_CORRECTIONS = ['L', 'M', 'Q', 'H'] as const
export type ErrorCorrection = typeof ERROR_CORRECTIONS[number]

// ═══════════════════════════════════════════════════════════════════════════════
// PRINTER & LABEL DEFAULTS
// ═══════════════════════════════════════════════════════════════════════════════

/** GK420d print head resolution */
export const DEFAULT_DPI = 203

/** Default label: 3" × 5" at 203 DPI */
export const DEFAULT_LABEL_WIDTH_DOTS = 609
export const DEFAULT_LABEL_HEIGHT_DOTS = 1015

/** Minimum label dimensions accepted by the API */
export const MIN_LABEL_WIDTH_DOTS = 100
export const MIN_LABEL_HEIGHT_DOTS = 50

/** Default ZPL font (Zebra font '0' = scalable bitmap) */
export const DEFAULT_FONT = '0'

// ═══════════════════════════════════════════════════════════════════════════════
// NETWORK & SERVER
// ═══════════════════════════════════════════════════════════════════════════════

/** HTTP API default port */
export const DEFAULT_HTTP_PORT = 3420

/** Raw TCP (Zebra network protocol) default port */
export const DEFAULT_TCP_PORT = 9100

/** Default bind address (all interfaces) */
export const DEFAULT_HOST = '0.0.0.0'

// ═══════════════════════════════════════════════════════════════════════════════
// TIMEOUTS (milliseconds)
// ═══════════════════════════════════════════════════════════════════════════════

/** CUPS command execution timeout */
export const CUPS_COMMAND_TIMEOUT_MS = 5000

/** How long to wait for a print job to complete via CUPS */
export const PRINT_WAIT_TIMEOUT_MS = 30000

/** Poll interval when waiting for CUPS job completion */
export const PRINT_POLL_INTERVAL_MS = 500

/** Queue processor: how often to check for pending jobs */
export const QUEUE_CHECK_INTERVAL_MS = 5000

/** Raw TCP: time to wait for additional data before flushing to printer */
export const TCP_FLUSH_TIMEOUT_MS = 500

/** GitHub API request timeout */
export const GITHUB_API_TIMEOUT_MS = 10000

/** Periodic update check interval (24 hours) */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Delay before first update check after startup */
export const INITIAL_UPDATE_DELAY_MS = 30000

/** Default minutes to cache update check results */
export const UPDATE_CACHE_MINUTES = 60

// ═══════════════════════════════════════════════════════════════════════════════
// PAGINATION & LIMITS
// ═══════════════════════════════════════════════════════════════════════════════

/** Default number of jobs returned per listing request */
export const DEFAULT_JOB_LIMIT = 50

/** Maximum jobs a single listing request can return */
export const MAX_JOB_LIMIT = 200

/** Default number of printer events returned */
export const DEFAULT_EVENT_LIMIT = 50

/** Number of recent label sizes to remember */
export const MAX_RECENT_SIZES = 10
