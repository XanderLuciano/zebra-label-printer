/**
 * ZPL (Zebra Programming Language) command builder.
 *
 * Provides a fluent, type-safe API for generating ZPL commands
 * for Zebra label printers like the GK420d.
 */

import type {
  TextOptions,
  BarcodeOptions,
  BarcodeType,
  QROptions,
  LabelElement,
  LabelOptions,
  MediaConfigOptions
} from './types'
import type { MediaTracking } from './constants'
import { LABEL_LENGTH_SEARCH_MARGIN_INCHES, MAX_LABEL_LENGTH_DOTS } from './constants'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default DPI for GK420d */
export const ZEBRA_DPI = 203

/**
 * Media tracking mode → `^MN` parameter.
 *
 * Straight from the ZPL reference for `^MN`: `N` is *continuous* stock (no gap,
 * notch, or mark), `Y`/`W` are non-continuous web sensing, `M` is mark sensing,
 * and `A` auto-detects during calibration (G-series only, which includes the
 * GK420d).
 *
 * The naming here is deliberate — `'continuous' → 'N'` is easy to invert by
 * accident, and getting it backwards makes the printer feed blank labels
 * forever because it stops looking for gaps.
 *
 * @see https://docs.zebra.com/us/en/printers/software/zpl-pg/c-zpl-zpl-commands/r-zpl-mn.html
 */
export const MEDIA_TRACKING_CODES: Record<MediaTracking, string> = {
  /** Die-cut / gapped labels — non-continuous web sensing */
  gap: 'Y',
  /** Black-mark backing — non-continuous mark sensing */
  mark: 'M',
  /** Continuous roll — length comes from ^LL */
  continuous: 'N',
  /** Let the printer work it out during calibration */
  auto: 'A'
}

/** Common label sizes (in dots at 203 DPI) */
export const LABEL_SIZES = {
  /** 3" x 5" label */
  '3x5': { width: 609, height: 1015 },
  /** 3" x 2" label */
  '3x2': { width: 609, height: 406 },
  /** 4" x 6" label */
  '4x6': { width: 812, height: 1218 },
  /** 2" x 1" label */
  '2x1': { width: 406, height: 203 }
} as const

/** Supported built-in fonts */
export const FONTS = {
  /** 6.5 pt scalable (A0 = smallest) */
  A: { height: 15, width: 12 },
  B: { height: 18, width: 15 },
  C: { height: 21, width: 18 },
  D: { height: 27, width: 21 },
  E: { height: 36, width: 27 },
  F: { height: 45, width: 36 },
  G: { height: 60, width: 45 },
  H: { height: 90, width: 60 },
  /** 11.7 pt bitmap */
  ZERO: { height: 24, width: 15 }
} as const

/** Barcode type → ZPL command mapping */
const BARCODE_COMMANDS: Record<BarcodeType, string> = {
  CODE128: 'BC',
  CODE39: 'B3',
  CODE93: 'BA',
  EAN8: 'B8',
  EAN13: 'BE',
  UPCA: 'BU',
  UPCE: 'B9',
  CODABAR: 'BK',
  PDF417: 'B7',
  QRCODE: 'BQ',
  DATAMATRIX: 'BX'
}

// ─── ZPL Builder ────────────────────────────────────────────────────────────

/**
 * Builds ZPL commands for a complete label.
 * Fluent API — chain methods together to compose your label.
 *
 * @example
 * ```ts
 * const zpl = new ZPLBuilder()
 *   .text('Hello World!', { x: 50, y: 50, height: 40 })
 *   .barcode('12345678', { x: 50, y: 120, type: 'CODE128', height: 80 })
 *   .build();
 * ```
 */
export class ZPLBuilder {
  private commands: string[] = []
  private options: Required<LabelOptions>

  constructor(options: LabelOptions = {}) {
    this.options = {
      width: options.width ?? 609,
      height: options.height ?? 1015,
      dpi: options.dpi ?? ZEBRA_DPI,
      copies: options.copies ?? 1
    }
  }

  /** Start the label format */
  private ensureStart(): void {
    if (this.commands.length === 0) {
      this.commands.push('^XA')
    }
  }

  /** Set label home position (top-left offset) */
  homePosition(x: number, y: number): this {
    this.ensureStart()
    this.commands.push(`^LH${x},${y}`)
    return this
  }

  /** Set label dimensions */
  labelSize(width?: number, height?: number): this {
    if (width) this.options.width = width
    if (height) this.options.height = height
    if (width || height) {
      this.ensureStart()
      this.commands.push(`^LL${this.options.height}`)
      this.commands.push(`^PW${this.options.width}`)
    }
    return this
  }

  /** Set print width in dots (`^PW`) */
  printWidth(dots: number): this {
    this.ensureStart()
    this.options.width = dots
    this.commands.push(`^PW${dots}`)
    return this
  }

  /** Set label length in dots (`^LL`). Only honoured on continuous media. */
  labelLength(dots: number): this {
    this.ensureStart()
    this.options.height = dots
    this.commands.push(`^LL${dots}`)
    return this
  }

  /**
   * Set the maximum label length (`^ML`) — how far the printer will feed while
   * hunting for a gap or mark. Too small and calibration never finds the gap.
   */
  maxLabelLength(dots: number): this {
    this.ensureStart()
    this.commands.push(`^ML${Math.min(Math.round(dots), MAX_LABEL_LENGTH_DOTS)}`)
    return this
  }

  /**
   * Set media tracking (`^MN`) — how the printer finds the top of each label.
   *
   * @param markOffset - Black-mark offset in dots; only meaningful for `mark`.
   */
  mediaTracking(tracking: MediaTracking, markOffset?: number): this {
    this.ensureStart()
    const code = MEDIA_TRACKING_CODES[tracking]
    this.commands.push(
      tracking === 'mark' && markOffset !== undefined
        ? `^MN${code},${markOffset}`
        : `^MN${code}`
    )
    return this
  }

  /**
   * Persist the current configuration to the printer's non-volatile memory
   * (`^JUS`), so it survives a power cycle.
   */
  saveConfig(): this {
    this.ensureStart()
    this.commands.push('^JUS')
    return this
  }

  /** Add a text field */
  text(content: string, options: TextOptions): this {
    this.ensureStart()

    const font = options.font ?? '0'
    const ratio = options.ratio ?? 0.8
    const height = options.height ?? (options.width ? Math.round(options.width / ratio) : FONTS.ZERO.height)
    const width = options.width ?? (options.height ? Math.round(options.height * ratio) : FONTS.ZERO.width)

    let field = `^FO${options.x},${options.y}`
    field += `^A${font}${options.rotation ?? 'N'},${height},${width}`

    if (options.reverse) {
      field += '^FR'
    }

    field += `^FD${this.escapeFieldData(content)}^FS`
    this.commands.push(field)
    return this
  }

  /**
   * Add a text block that wraps to fit within a width.
   * Uses the ^TB (Text Block) command.
   */
  textBlock(content: string, x: number, y: number, maxWidth: number, maxLines: number = 1, options: { height?: number; font?: string } = {}): this {
    this.ensureStart()

    const font = options.font ?? '0'
    const height = options.height ?? FONTS.ZERO.height
    const h = Math.round(height * 1.5)

    let cmd = `^FO${x},${y}`
    cmd += `^A${font}N,${height}`
    cmd += `^TB${maxWidth},${maxLines},${h}`
    cmd += `^FD${this.escapeFieldData(content)}^FS`
    this.commands.push(cmd)
    return this
  }

  /** Add a 1D barcode */
  barcode(content: string, options: BarcodeOptions): this {
    this.ensureStart()

    const cmd = BARCODE_COMMANDS[options.type]
    if (!cmd) {
      throw new Error(`Unsupported barcode type: ${options.type}`)
    }

    let field = `^FO${options.x},${options.y}`

    // QR and Data Matrix use different fields
    if (options.type === 'QRCODE') {
      field += `^BQ${options.rotation ?? 'N'},2,${options.narrowBarWidth ?? 5}`
      field += `^FDLA,${this.escapeFieldData(content)}^FS`
    } else if (options.type === 'DATAMATRIX') {
      field += `^BX${options.rotation ?? 'N'},${options.height ?? 200},200`
      field += `^FD${this.escapeFieldData(content)}^FS`
    } else {
      // 1D barcodes
      const orientation = options.rotation ?? 'N'
      const h = options.height ?? 50
      const hr = options.humanReadable ?? true
      const hrPos = options.humanReadablePosition ?? (hr ? 'Y' : 'N')
      const narrow = options.narrowBarWidth ?? 2
      const ratio = options.wideBarRatio ?? 2.0

      field += `^${cmd}${orientation},${h},${hrPos === 'Y' ? 'Y' : 'N'},${narrow},,,${ratio === 3.0 ? 'Y' : 'N'}`
      field += `^FD${this.escapeFieldData(content)}^FS`
    }

    this.commands.push(field)
    return this
  }

  /** Add a QR code (2D barcode) with cleaner API */
  qrcode(content: string, options: QROptions): this {
    this.ensureStart()

    const mag = options.magnification ?? 5
    const ec = options.errorCorrection ?? 'M'

    let field = `^FO${options.x},${options.y}`
    field += `^BQ${options.rotation ?? 'N'},2,${mag}`
    field += `^FD${ec}A,${this.escapeFieldData(content)}^FS`
    this.commands.push(field)
    return this
  }

  /** Add a horizontal line */
  line(x: number, y: number, length: number, thickness: number = 2, color: 'B' | 'W' = 'B'): this {
    this.ensureStart()
    this.commands.push(`^FO${x},${y}^GB${length},${thickness},${thickness},${color}^FS`)
    return this
  }

  /** Add a box/rectangle */
  box(x: number, y: number, width: number, height: number, thickness: number = 2, color: 'B' | 'W' = 'B', rounding: number = 0): this {
    this.ensureStart()
    this.commands.push(`^FO${x},${y}^GB${width},${height},${thickness},${color},${rounding}^FS`)
    return this
  }

  /** Add a label element (union type) */
  element(el: LabelElement): this {
    switch (el.type) {
      case 'text':
        return this.text(el.content, el.options)
      case 'barcode':
        return this.barcode(el.content, el.options)
      case 'qrcode':
        return this.qrcode(el.content, el.options)
      case 'raw':
        this.ensureStart()
        this.commands.push(el.zpl)
        return this
    }
  }

  /** Add raw ZPL (advanced use) */
  raw(zpl: string): this {
    this.ensureStart()
    this.commands.push(zpl)
    return this
  }

  /** Add a label element array */
  elements(items: LabelElement[]): this {
    for (const item of items) {
      this.element(item)
    }
    return this
  }

  /** Build and return the complete ZPL string */
  build(): string {
    if (this.commands.length === 0) {
      throw new Error('Cannot build empty label. Add at least one element.')
    }

    // Set copies if more than 1
    if (this.options.copies > 1 && !this.commands.some(c => c.startsWith('^PQ'))) {
      const xaIdx = this.commands.findIndex(c => c === '^XA')
      this.commands.splice(xaIdx + 1, 0, `^PQ${this.options.copies}`)
    }

    return [...this.commands, '^XZ'].join('\n')
  }

  /** Escape special characters for ^FD (field data) */
  private escapeFieldData(data: string): string {
    return data
      .replace(/\\/g, '\\\\')
      .replace(/\^/g, '\\^')
      .replace(/~/g, '\\~')
  }

  /** Clone this builder (non-destructive build preview) */
  clone(): ZPLBuilder {
    const b = new ZPLBuilder({ ...this.options })
    b.commands = [...this.commands]
    return b
  }
}

// ─── Printer Media Configuration ────────────────────────────────────────────

/**
 * Build the ZPL that tells the printer what media is loaded.
 *
 * Sending this is what makes a label-size change actually take effect on the
 * hardware. Without it the printer keeps using its own stored width and gap
 * settings, so labels come out clipped, offset, or with blank feeds even though
 * the app thinks it changed size.
 *
 * Commands emitted:
 *   - `^PW`  print width in dots
 *   - `^ML`  maximum label length — the gap-search window
 *   - `^LL`  label length, **continuous media only** (see below)
 *   - `^LH`  reset the label home origin to 0,0
 *   - `^MN`  media tracking mode
 *   - `^JUS` persist to non-volatile memory (optional)
 *
 * `^LL` is deliberately omitted for gap/mark media: Zebra documents it as
 * ignored on non-continuous stock, where the real length comes from the gap
 * sensor during calibration. Emitting it there is misleading at best.
 * `^ML` is what bounds the search, and it is set a full inch longer than the
 * label so the printer can actually reach the next gap.
 *
 * @see https://supportcommunity.zebra.com/s/article/ZPL-Label-Length-Command-Information-with-Stored-Format-Details
 */
export function mediaConfigZpl(options: MediaConfigOptions): string {
  const dpi = options.dpi ?? ZEBRA_DPI
  const tracking = options.tracking ?? 'gap'
  const isContinuous = tracking === 'continuous'

  const b = new ZPLBuilder({ width: options.widthDots, height: options.heightDots, dpi })

  b.printWidth(options.widthDots)
  // Give the gap search a full inch of headroom past the label.
  b.maxLabelLength(options.heightDots + Math.round(dpi * LABEL_LENGTH_SEARCH_MARGIN_INCHES))
  if (isContinuous) b.labelLength(options.heightDots)
  b.homePosition(0, 0)
  b.mediaTracking(tracking, options.markOffset)
  if (options.persist ?? true) b.saveConfig()

  return b.build()
}

/**
 * Build the ZPL that triggers a full media sensor calibration (`~JC`).
 *
 * The printer feeds a few labels while measuring gap/mark sensor thresholds and
 * the actual label length. This is what removes cumulative Y drift after a
 * media change.
 *
 * Send `mediaConfigZpl()` first: calibration needs to know the media type and
 * the search window before it can learn anything useful.
 *
 * `~JC` is an immediate command, so it stands alone rather than living inside a
 * `^XA`/`^XZ` format block.
 */
export function calibrationZpl(): string {
  return '~JC'
}

// ─── Convenience Functions ──────────────────────────────────────────────────

/** Options shared by the one-off label helpers */
interface LabelSizeOptions {
  /** Label width in dots — emitted as ^PW so output isn't at the mercy of printer state */
  widthDots?: number;
  /** Label length in dots — emitted as ^LL */
  heightDots?: number;
}

/** Apply ^PW/^LL when the caller told us the label geometry. */
function applyLabelSize(b: ZPLBuilder, options: LabelSizeOptions): void {
  if (options.widthDots || options.heightDots) {
    b.labelSize(options.widthDots, options.heightDots)
  }
}

/** Quick one-off text label */
export function textLabel(
  lines: string[],
  options: LabelSizeOptions & { x?: number; y?: number; lineHeight?: number; height?: number; width?: number; font?: string } = {}
): string {
  const b = new ZPLBuilder()
  applyLabelSize(b, options)
  const x = options.x ?? 20
  const startY = options.y ?? 20
  const gap = options.lineHeight ?? 40

  lines.forEach((line, i) => {
    b.text(line, {
      x,
      y: startY + i * gap,
      height: options.height,
      width: options.width,
      font: options.font
    })
  })

  return b.build()
}

/** Quick one-off barcode label with optional text */
export function barcodeLabel(
  barcodeData: string,
  barcodeType: BarcodeType = 'CODE128',
  labelText?: string,
  options: LabelSizeOptions & { barcodeY?: number; textY?: number; barcodeHeight?: number } = {}
): string {
  const b = new ZPLBuilder()
  applyLabelSize(b, options)
  const bcY = options.barcodeY ?? 50
  const bcH = options.barcodeHeight ?? 100

  b.barcode(barcodeData, {
    x: 50,
    y: bcY,
    type: barcodeType,
    height: bcH,
    humanReadable: true
  })

  if (labelText) {
    b.text(labelText, {
      x: 50,
      y: options.textY ?? bcY + bcH + 30,
      height: 30,
      font: '0'
    })
  }

  return b.build()
}

/** Quick QR code label with optional label text */
export function qrLabel(
  data: string,
  labelText?: string,
  options: LabelSizeOptions & { qrY?: number; qrX?: number; textY?: number; magnification?: number } = {}
): string {
  const b = new ZPLBuilder()
  applyLabelSize(b, options)

  b.qrcode(data, {
    x: options.qrX ?? 80,
    y: options.qrY ?? 50,
    magnification: options.magnification ?? 5
  })

  if (labelText) {
    const qrSize = (options.magnification ?? 5) * 25 // approximate QR size in dots
    b.text(labelText, {
      x: options.qrX ?? 80,
      y: options.textY ?? options.qrY ?? 50 + qrSize + 20,
      height: 30,
      font: '0'
    })
  }

  return b.build()
}

/** Convert inches to dots at 203 DPI */
export function inchesToDots(inches: number, dpi: number = 203): number {
  return Math.round(inches * dpi)
}

/** Convert mm to dots at 203 DPI */
export function mmToDots(mm: number, dpi: number = 203): number {
  return Math.round((mm / 25.4) * dpi)
}
