/**
 * Template engine — the heart of the label designer.
 *
 * A template stores its layout with *relative* positioning (percentages of the
 * label's width/height) plus `{{variable}}` tokens for dynamic data and
 * optional per-size overrides. `resolveTemplate()` turns a template + variable
 * values + a concrete target size into the plain `elements[]` array the print
 * API understands — so the same design auto-scales to any label size, and the
 * on-screen canvas renders exactly what will be printed.
 */

// ─── Types (mirror src/schemas.ts template schemas) ─────────────────────────

export type Rotation = 'N' | 'R' | 'I' | 'B'
export type ErrorCorrection = 'L' | 'M' | 'Q' | 'H'
export type BarcodeType =
  | 'CODE128' | 'CODE39' | 'CODE93' | 'EAN8' | 'EAN13'
  | 'UPCA' | 'UPCE' | 'CODABAR' | 'PDF417' | 'QRCODE' | 'DATAMATRIX'
export type ElementType = 'text' | 'barcode' | 'qrcode' | 'box'

export interface TemplateVariable {
  name: string
  label: string
  sample: string
}

interface BaseEl {
  id: string
  name?: string
  type: ElementType
  xPct: number
  yPct: number
  rotation?: Rotation
  hidden?: boolean
}

export interface TextEl extends BaseEl {
  type: 'text'
  content: string
  fontHeightPct: number
  ratio?: number
  font?: string
  reverse?: boolean
  align?: 'left' | 'center' | 'right'
}

export interface BarcodeEl extends BaseEl {
  type: 'barcode'
  content: string
  barcodeType: BarcodeType
  heightPct: number
  narrowBarWidth?: number
  humanReadable?: boolean
}

export interface QrEl extends BaseEl {
  type: 'qrcode'
  content: string
  magnification: number
  errorCorrection?: ErrorCorrection
}

export interface BoxEl extends BaseEl {
  type: 'box'
  widthPct: number
  heightPct: number
  thickness: number
  rounding?: number
  fill?: boolean
}

export type TemplateElement = TextEl | BarcodeEl | QrEl | BoxEl

export interface LabelTemplate {
  id?: string
  name: string
  description?: string
  baseWidthDots: number
  baseHeightDots: number
  variables: TemplateVariable[]
  elements: TemplateElement[]
  /** sizeKey ("{w}x{h}") -> elementId -> partial element fields */
  overrides: Record<string, Record<string, Partial<TemplateElement>>>
  createdAt?: string
  updatedAt?: string
}

/** An axis-aligned rectangle in label dots */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Options on a print-payload element (the /api/print/label element shape) */
export interface PrintElementOptions {
  x?: number
  y?: number
  height?: number
  width?: number
  ratio?: number
  magnification?: number
  /** Barcode symbology, for `barcode` elements */
  type?: string
  rotation?: Rotation
  reverse?: boolean
  humanReadable?: boolean
  narrowBarWidth?: number
  font?: string
  errorCorrection?: ErrorCorrection
}

/**
 * A single element in the /api/print/label payload.
 *
 * This is the wire format shared by the print API, `resolveTemplate()` output,
 * and the read-only LabelPreview component — so previews and prints stay in
 * step.
 */
export interface PrintLabelElement {
  type: 'text' | 'qrcode' | 'barcode' | 'raw'
  content?: string
  /** Raw ZPL, for `raw` elements */
  zpl?: string
  options?: PrintElementOptions
}

/** A concrete element after resolution — carries both the print payload and
 *  absolute geometry so the canvas can render and hit-test it.
 *
 *  `x/y/w/h` describe the element *unrotated*, which is the coordinate space
 *  the SVG shapes are drawn in. `transform` rotates that drawing into place and
 *  `bounds` is the resulting on-label footprint. See `rotationTransform()`. */
export interface ResolvedElement {
  id: string
  type: ElementType
  payload: Record<string, unknown>
  x: number
  y: number
  w: number
  h: number
  text?: string
  rotation: Rotation
  /** SVG transform that rotates this element to match printed output ('' for 'N') */
  transform: string
  /** On-label footprint after rotation — width/height swap on quarter turns */
  bounds: Box
  reverse?: boolean
  fill?: boolean
  barcodeType?: BarcodeType
}

export interface LabelSizeOption {
  name: string
  widthInches: number
  heightInches: number
  widthDots: number
  heightDots: number
}

// ─── Presets ────────────────────────────────────────────────────────────────

export const DPI = 203

export const SIZE_PRESETS: LabelSizeOption[] = [
  { name: '2×1"', widthInches: 2, heightInches: 1, widthDots: 406, heightDots: 203 },
  { name: '3×1"', widthInches: 3, heightInches: 1, widthDots: 609, heightDots: 203 },
  { name: '3×2"', widthInches: 3, heightInches: 2, widthDots: 609, heightDots: 406 },
  { name: '3×5"', widthInches: 3, heightInches: 5, widthDots: 609, heightDots: 1015 },
  { name: '4×2"', widthInches: 4, heightInches: 2, widthDots: 812, heightDots: 406 },
  { name: '4×6"', widthInches: 4, heightInches: 6, widthDots: 812, heightDots: 1218 },
]

export const BARCODE_TYPES: BarcodeType[] = [
  'CODE128', 'CODE39', 'CODE93', 'EAN8', 'EAN13',
  'UPCA', 'UPCE', 'CODABAR', 'PDF417', 'QRCODE', 'DATAMATRIX',
]

export const ZPL_FONTS = ['0', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function sizeKey(widthDots: number, heightDots: number): string {
  return `${widthDots}x${heightDots}`
}

let idCounter = 0
export function newId(prefix = 'el'): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`
}

/** Substitute `{{var}}` tokens using provided values, falling back to samples. */
export function substitute(
  input: string,
  values: Record<string, string>,
  variables: TemplateVariable[]
): string {
  return input.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    if (values[key] !== undefined && values[key] !== '') return values[key]
    const v = variables.find(x => x.name === key)
    if (v && v.sample) return v.sample
    return values[key] ?? ''
  })
}

/** List variable names referenced anywhere in the template's content fields. */
export function usedVariables(tpl: LabelTemplate): string[] {
  const found = new Set<string>()
  const re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g
  for (const el of tpl.elements) {
    const content = (el as TextEl).content
    if (typeof content === 'string') {
      let m: RegExpExecArray | null
      while ((m = re.exec(content)) !== null) {
        if (m[1]) found.add(m[1])
      }
    }
  }
  return [...found]
}

// ─── Barcode width estimation ────────────────────────────────────────────────

/** Default ^BY narrow bar width, matching ZPLBuilder's default. */
const DEFAULT_NARROW_BAR_WIDTH = 2

/**
 * Module count for a 1D symbology at a given data length.
 *
 * A "module" is one narrow-bar width, so printed width is modules × ^BY. The
 * CODE128 figure is exact and verified against a Labelary render: 8 characters
 * at ^BY2 measured 246 dots, which is `(11 × (8 + 3) + 2) × 2`. The others are
 * standard encodings; fixed-length symbologies ignore the data length.
 */
function barcodeModules(type: BarcodeType, length: number): number {
  switch (type) {
    case 'CODE128':
      // 11 modules per symbol, plus start, checksum, and stop, plus a 2-module
      // termination bar.
      return 11 * (length + 3) + 2
    case 'CODE39':
    case 'CODABAR':
      // 9 bars + 1 inter-character gap per symbol, plus start and stop.
      return 16 * (length + 2)
    case 'CODE93':
      return 9 * (length + 4) + 1
    // Fixed-length symbologies — data length is irrelevant.
    case 'EAN13':
    case 'UPCA':
      return 95
    case 'EAN8':
      return 67
    case 'UPCE':
      return 51
    default:
      return 11 * (length + 3) + 2
  }
}

/** True for symbologies that render as a square 2D matrix rather than bars. */
export function is2dSymbology(type: BarcodeType): boolean {
  return type === 'QRCODE' || type === 'DATAMATRIX'
}

/**
 * Estimated printed width of a barcode, in dots.
 *
 * Used so the preview can show a barcode overrunning the label edge. The old
 * behaviour was a flat 50% of label width, which ignored the data entirely — and
 * because a quarter turn swaps width and height, that error showed up as a wrong
 * *height* on rotated barcodes.
 */
export function estimateBarcodeWidth(
  content: string,
  type: BarcodeType,
  narrowBarWidth = DEFAULT_NARROW_BAR_WIDTH,
): number {
  return Math.max(1, barcodeModules(type, content.length) * narrowBarWidth)
}

// ─── Rotation geometry ───────────────────────────────────────────────────────
//
// How ZPL positions a rotated field, verified by rendering `^FO200,200` fields
// at every rotation through Labelary and measuring the ink bounding box:
//
//   rotation  ^FO      measured bbox        footprint
//   N (0°)    200,200  x:200 y:200 101×32   w × h
//   R (90°)   200,200  x:200 y:200  32×101  h × w
//   I (180°)  200,200  x:200 y:200 101×32   w × h
//   B (270°)  200,200  x:200 y:200  32×101  h × w
//
// The rule: `^FO` is the top-left corner of the field's *rotated* bounding box,
// and quarter turns swap width and height. The field never moves off its origin,
// it only grows in a different direction. That is what these helpers encode, so
// the on-screen canvas matches the printer instead of drawing everything
// horizontally and hoping for the best.

/** True for rotations that swap an element's width and height (90° / 270°). */
export function isQuarterTurn(rotation: Rotation): boolean {
  return rotation === 'R' || rotation === 'B'
}

/**
 * On-label footprint of an element once rotated.
 * Top-left stays at (x, y); quarter turns swap the dimensions.
 */
export function rotatedBounds(box: Box, rotation: Rotation): Box {
  return isQuarterTurn(rotation)
    ? { x: box.x, y: box.y, w: box.h, h: box.w }
    : { ...box }
}

/**
 * SVG transform that rotates an element drawn at its unrotated coordinates so
 * it lands where ZPL would print it.
 *
 * Each pivot is chosen so the rotated bounding box keeps its top-left at
 * (x, y) — the ZPL `^FO` behaviour documented above. Returns '' for 'N' so no
 * attribute is emitted in the common case.
 */
export function rotationTransform(box: Box, rotation: Rotation): string {
  const { x, y, w, h } = box
  switch (rotation) {
    case 'R': // 90° clockwise — text flows downward
      return `rotate(90 ${x + h / 2} ${y + h / 2})`
    case 'I': // 180° — spin about the centre
      return `rotate(180 ${x + w / 2} ${y + h / 2})`
    case 'B': // 270° clockwise — text reads bottom-up
      return `rotate(-90 ${x + w / 2} ${y + w / 2})`
    default:
      return ''
  }
}

/** Effective element after applying the override for a given size. */
export function effectiveElement(
  el: TemplateElement,
  tpl: LabelTemplate,
  target: { widthDots: number; heightDots: number }
): TemplateElement {
  const key = sizeKey(target.widthDots, target.heightDots)
  const isBase = target.widthDots === tpl.baseWidthDots && target.heightDots === tpl.baseHeightDots
  const ov = !isBase ? tpl.overrides?.[key]?.[el.id] : undefined
  return ov ? ({ ...el, ...ov } as TemplateElement) : el
}

// ─── Resolution ───────────────────────────────────────────────────────────────

/**
 * Resolve a template into concrete, print-ready elements for a target size.
 * Returns both the API payloads and absolute geometry for canvas rendering.
 */
export function resolveTemplate(
  tpl: LabelTemplate,
  values: Record<string, string>,
  target: { widthDots: number; heightDots: number }
): ResolvedElement[] {
  const W = target.widthDots
  const H = target.heightDots
  const out: ResolvedElement[] = []

  for (const raw of tpl.elements) {
    const el = effectiveElement(raw, tpl, target)
    if (el.hidden) continue

    const xAbs = Math.round((el.xPct / 100) * W)
    const yAbs = Math.round((el.yPct / 100) * H)
    const rotation: Rotation = el.rotation ?? 'N'

    if (el.type === 'text') {
      const text = substitute(el.content, values, tpl.variables)
      const height = Math.max(1, Math.round((el.fontHeightPct / 100) * H))
      const ratio = el.ratio ?? 0.6
      const charW = Math.round(height * ratio)
      const estWidth = Math.max(charW, text.length * charW)

      // Anchor alignment shifts the field along the axis the text runs on.
      // Rotated text flows down the label, not across it, so a centred 90°
      // label has to move on Y — shifting X would slide it sideways instead.
      let shift = 0
      if (el.align === 'center') shift = -Math.round(estWidth / 2)
      else if (el.align === 'right') shift = -estWidth

      const quarter = isQuarterTurn(rotation)
      const x = quarter ? xAbs : Math.max(0, xAbs + shift)
      const y = quarter ? Math.max(0, yAbs + shift) : yAbs

      out.push({
        id: el.id,
        type: 'text',
        x,
        y,
        w: estWidth,
        h: height,
        text,
        rotation,
        transform: rotationTransform({ x, y, w: estWidth, h: height }, rotation),
        bounds: rotatedBounds({ x, y, w: estWidth, h: height }, rotation),
        reverse: el.reverse,
        payload: {
          type: 'text',
          content: text,
          options: {
            x,
            y,
            height,
            ratio,
            ...(el.font ? { font: el.font } : {}),
            ...(rotation !== 'N' ? { rotation } : {}),
            ...(el.reverse ? { reverse: true } : {}),
          },
        },
      })
    } else if (el.type === 'barcode') {
      const content = substitute(el.content, values, tpl.variables)
      const height = Math.max(1, Math.round((el.heightPct / 100) * H))
      // 2D symbologies are square; 1D width comes from the encoded data.
      const width = is2dSymbology(el.barcodeType)
        ? height
        : estimateBarcodeWidth(content, el.barcodeType, el.narrowBarWidth)
      out.push({
        id: el.id,
        type: 'barcode',
        x: xAbs,
        y: yAbs,
        w: width,
        h: height,
        text: content,
        rotation,
        transform: rotationTransform({ x: xAbs, y: yAbs, w: width, h: height }, rotation),
        bounds: rotatedBounds({ x: xAbs, y: yAbs, w: width, h: height }, rotation),
        barcodeType: el.barcodeType,
        payload: {
          type: 'barcode',
          content,
          options: {
            x: xAbs,
            y: yAbs,
            type: el.barcodeType,
            height,
            humanReadable: el.humanReadable ?? true,
            ...(el.narrowBarWidth ? { narrowBarWidth: el.narrowBarWidth } : {}),
            ...(rotation !== 'N' ? { rotation } : {}),
          },
        },
      })
    } else if (el.type === 'qrcode') {
      const content = substitute(el.content, values, tpl.variables)
      const mag = el.magnification ?? 5
      // 21 modules is the version-1 QR grid; larger payloads step up to 25, 29,
      // ... so this is a floor, not an exact size.
      //
      // Known approximation: ^BQ offsets the symbol from the field origin by
      // about 2 modules, in a direction that follows the rotation (down for 'N',
      // right for 'B', none for 'R'/'I'). At 203 DPI that is ~0.05", so the
      // preview ignores it rather than modelling a printer quirk.
      const size = mag * 21
      out.push({
        id: el.id,
        type: 'qrcode',
        x: xAbs,
        y: yAbs,
        w: size,
        h: size,
        text: content,
        rotation,
        // A QR code is square, so rotation doesn't move it — but the modules do
        // turn, and the printer needs telling. This used to be dropped.
        transform: rotationTransform({ x: xAbs, y: yAbs, w: size, h: size }, rotation),
        bounds: rotatedBounds({ x: xAbs, y: yAbs, w: size, h: size }, rotation),
        payload: {
          type: 'qrcode',
          content,
          options: {
            x: xAbs,
            y: yAbs,
            magnification: mag,
            ...(el.errorCorrection ? { errorCorrection: el.errorCorrection } : {}),
            ...(rotation !== 'N' ? { rotation } : {}),
          },
        },
      })
    } else if (el.type === 'box') {
      const w = Math.max(1, Math.round((el.widthPct / 100) * W))
      const h = Math.max(1, Math.round((el.heightPct / 100) * H))
      const rounding = el.rounding ?? 0
      const thickness = el.fill ? Math.min(w, h) : Math.max(1, el.thickness)
      // ^GB has no rotation parameter, but a rectangle rotated a quarter turn is
      // just the same rectangle with its dimensions swapped — so bake the
      // rotation into the box dimensions rather than dropping it.
      const quarter = isQuarterTurn(rotation)
      const zplW = quarter ? h : w
      const zplH = quarter ? w : h
      out.push({
        id: el.id,
        type: 'box',
        x: xAbs,
        y: yAbs,
        w,
        h,
        rotation,
        transform: rotationTransform({ x: xAbs, y: yAbs, w, h }, rotation),
        bounds: rotatedBounds({ x: xAbs, y: yAbs, w, h }, rotation),
        fill: el.fill,
        payload: {
          type: 'raw',
          zpl: `^FO${xAbs},${yAbs}^GB${zplW},${zplH},${thickness},B,${rounding}^FS`,
        },
      })
    }
  }

  return out
}

/** Just the print payloads (drops canvas metadata). */
export function toPrintElements(resolved: ResolvedElement[]): Array<Record<string, unknown>> {
  return resolved.map(r => r.payload)
}

// ─── Factories ────────────────────────────────────────────────────────────────

export function newElement(type: ElementType): TemplateElement {
  const base = { id: newId(type), xPct: 8, yPct: 10, rotation: 'N' as Rotation }
  switch (type) {
    case 'text':
      return { ...base, type: 'text', name: 'Text', content: 'Text', fontHeightPct: 14, ratio: 0.6, font: '0', align: 'left' }
    case 'barcode':
      return { ...base, type: 'barcode', name: 'Barcode', content: '{{barcode}}', barcodeType: 'CODE128', heightPct: 40, humanReadable: true }
    case 'qrcode':
      return { ...base, type: 'qrcode', name: 'QR Code', content: '{{barcode}}', magnification: 5, errorCorrection: 'M' }
    case 'box':
      return { ...base, type: 'box', name: 'Box', widthPct: 84, heightPct: 2, thickness: 3, rounding: 0, fill: false }
  }
}

export function emptyTemplate(): LabelTemplate {
  return {
    name: 'Untitled Template',
    description: '',
    baseWidthDots: 406,
    baseHeightDots: 203,
    variables: [
      { name: 'barcode', label: 'Barcode / QR data', sample: 'ABC-123' },
      { name: 'title', label: 'Title', sample: 'Sample Part' },
    ],
    elements: [
      { id: newId('qrcode'), type: 'qrcode', name: 'QR Code', xPct: 2, yPct: 12, magnification: 5, errorCorrection: 'M', content: '{{barcode}}', rotation: 'N' },
      { id: newId('text'), type: 'text', name: 'Title', xPct: 32, yPct: 12, fontHeightPct: 16, ratio: 0.6, font: '0', align: 'left', content: '{{title}}', rotation: 'N' },
      { id: newId('text'), type: 'text', name: 'Subtitle', xPct: 32, yPct: 40, fontHeightPct: 12, ratio: 0.6, font: '0', align: 'left', content: '{{barcode}}', rotation: 'N' },
    ],
    overrides: {},
  }
}
