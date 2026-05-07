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
  LabelOptions
} from './types'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default DPI for GK420d */
export const ZEBRA_DPI = 203

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
      field += `^BQN,2,${options.narrowBarWidth ?? 5}`
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
    field += `^BQN,2,${mag}`
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

// ─── Convenience Functions ──────────────────────────────────────────────────

/** Quick one-off text label */
export function textLabel(
  lines: string[],
  options: { x?: number; y?: number; lineHeight?: number; height?: number; width?: number; font?: string } = {}
): string {
  const b = new ZPLBuilder()
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
  options: { barcodeY?: number; textY?: number; barcodeHeight?: number } = {}
): string {
  const b = new ZPLBuilder()
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
  options: { qrY?: number; qrX?: number; textY?: number; magnification?: number } = {}
): string {
  const b = new ZPLBuilder()

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
