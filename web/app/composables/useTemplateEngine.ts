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

/** A concrete element after resolution — carries both the print payload and
 *  absolute geometry so the canvas can render and hit-test it. */
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
      while ((m = re.exec(content)) !== null) found.add(m[1])
    }
  }
  return [...found]
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
      // Anchor alignment: xAbs is the anchor point.
      let x = xAbs
      if (el.align === 'center') x = Math.round(xAbs - estWidth / 2)
      else if (el.align === 'right') x = xAbs - estWidth
      x = Math.max(0, x)

      out.push({
        id: el.id,
        type: 'text',
        x,
        y: yAbs,
        w: estWidth,
        h: height,
        text,
        rotation,
        reverse: el.reverse,
        payload: {
          type: 'text',
          content: text,
          options: {
            x,
            y: yAbs,
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
      out.push({
        id: el.id,
        type: 'barcode',
        x: xAbs,
        y: yAbs,
        w: Math.round(W * 0.5),
        h: height,
        text: content,
        rotation,
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
      const size = mag * 21 // approximate module count for preview
      out.push({
        id: el.id,
        type: 'qrcode',
        x: xAbs,
        y: yAbs,
        w: size,
        h: size,
        text: content,
        rotation,
        payload: {
          type: 'qrcode',
          content,
          options: {
            x: xAbs,
            y: yAbs,
            magnification: mag,
            ...(el.errorCorrection ? { errorCorrection: el.errorCorrection } : {}),
          },
        },
      })
    } else if (el.type === 'box') {
      const w = Math.max(1, Math.round((el.widthPct / 100) * W))
      const h = Math.max(1, Math.round((el.heightPct / 100) * H))
      const rounding = el.rounding ?? 0
      const thickness = el.fill ? Math.min(w, h) : Math.max(1, el.thickness)
      out.push({
        id: el.id,
        type: 'box',
        x: xAbs,
        y: yAbs,
        w,
        h,
        rotation,
        fill: el.fill,
        payload: {
          type: 'raw',
          zpl: `^FO${xAbs},${yAbs}^GB${w},${h},${thickness},B,${rounding}^FS`,
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
