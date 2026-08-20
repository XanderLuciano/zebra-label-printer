/**
 * Built-in example templates.
 *
 * These give the designer and the "Print from Template" page something real to
 * start from, using this shop's actual conventions rather than placeholder text:
 * part numbers like `135853-002`, bare revision letters, the `NRG` vendor code,
 * `PI-` tickets, `NRG-001` serials, and a QR payload of
 * `{{partNumber}}-{{rev}}-{{vendor}}` — the same convention the hand-built Part
 * Label page and the README recipe use.
 *
 * The 2×1" pair mirrors the layout already proven on that page. The 3×5" pair is
 * laid out to be read *landscape*, which is why every element is rotated; see
 * the note on the landscape helpers below.
 *
 * ASCII only. Zebra's built-in fonts have no UTF-8, so separators are `|` rather
 * than a middle dot or en dash.
 */

import type { TemplateDefinition } from '../schemas'
import { getJsonSetting, setSetting } from './settings-repo'
import { getTemplate, createTemplateWithId } from './template-repo'

// ─── Geometry helpers ────────────────────────────────────────────────────────

/** Percentage of a dimension, rounded to the 2dp the designer shows. */
function pct(dots: number, total: number): number {
  return Math.round((dots / total) * 10000) / 100
}

const SIZE_2X1 = { w: 406, h: 203 }
const SIZE_3X5 = { w: 609, h: 1015 }

/**
 * Landscape authoring for a portrait label read sideways.
 *
 * A 3×5" label leaves the printer 609 dots wide by 1015 long. To read it
 * landscape you turn it a quarter-turn counter-clockwise, so the edge that came
 * out of the printer first ends up on the right. Under that turn a point at label
 * `(x, y)` appears at viewer `(y, W - x)`, giving a viewer canvas of 1015 × 609.
 *
 * So authoring in viewer coordinates and converting back:
 *
 *   label y = viewer x                       (text runs along the label's feed axis)
 *   label x = W - viewer y - footprintWidth  (viewer *down* is label *x decreasing*)
 *
 * where `footprintWidth` is the element's extent along the label's x axis. For
 * rotation `R` text that is the character cell height; for a barcode it is the bar
 * height; for a square QR or an unrotated box it is that box's own width.
 *
 * Everything below is derived rather than hand-typed, because getting the sign of
 * that second line wrong is easy and the result looks almost plausible.
 */
const LS = SIZE_3X5

/** Text placed by its top-left corner in the landscape view. */
function lsText(el: {
  id: string
  name: string
  content: string
  /** Left edge in the landscape view, in dots. */
  vx: number
  /** Top edge in the landscape view, in dots. */
  vy: number
  /** Character cell height in dots — also the line's thickness in the view. */
  heightDots: number
  ratio?: number
  font?: string
}) {
  return {
    id: el.id,
    name: el.name,
    type: 'text' as const,
    content: el.content,
    xPct: pct(LS.w - el.vy - el.heightDots, LS.w),
    yPct: pct(el.vx, LS.h),
    fontHeightPct: pct(el.heightDots, LS.h),
    ratio: el.ratio ?? 0.75,
    font: el.font ?? '0',
    align: 'left' as const,
    rotation: 'R' as const
  }
}

/**
 * A rule drawn across the landscape view.
 *
 * Deliberately *not* rotated. `^GB` has no rotation parameter, so the engine
 * bakes a quarter turn into swapped dimensions — but a full-width landscape rule
 * would then need `widthPct` above the schema's 150% ceiling. An unrotated box
 * that is thin in x and long in y already reads as a horizontal rule once the
 * label is turned, and stays inside the limits.
 */
function lsRule(el: { id: string; name: string; vx: number; vy: number; length: number; thickness: number }) {
  return {
    id: el.id,
    name: el.name,
    type: 'box' as const,
    xPct: pct(LS.w - el.vy - el.thickness, LS.w),
    yPct: pct(el.vx, LS.h),
    widthPct: pct(el.thickness, LS.w),
    heightPct: pct(el.length, LS.h),
    thickness: el.thickness,
    rounding: 0,
    fill: true,
    rotation: 'N' as const
  }
}

/** QR placed by its top-left corner in the landscape view. */
function lsQr(el: { id: string; name: string; content: string; vx: number; vy: number; magnification: number }) {
  // 21 modules is the version-1 grid, which is what the engine sizes previews by.
  const size = el.magnification * 21
  return {
    id: el.id,
    name: el.name,
    type: 'qrcode' as const,
    content: el.content,
    xPct: pct(LS.w - el.vy - size, LS.w),
    yPct: pct(el.vx, LS.h),
    magnification: el.magnification,
    errorCorrection: 'M' as const,
    // A QR is square, so turning it gains nothing and `^BQ` shifts the symbol
    // slightly depending on rotation. Left unrotated on purpose.
    rotation: 'N' as const
  }
}

/** 1D barcode placed by its top-left corner in the landscape view. */
function lsBarcode(el: {
  id: string
  name: string
  content: string
  vx: number
  vy: number
  /** Bar height in dots — the barcode's thickness in the landscape view. */
  barHeight: number
  narrowBarWidth?: number
  humanReadable?: boolean
}) {
  return {
    id: el.id,
    name: el.name,
    type: 'barcode' as const,
    content: el.content,
    barcodeType: 'CODE128' as const,
    xPct: pct(LS.w - el.vy - el.barHeight, LS.w),
    yPct: pct(el.vx, LS.h),
    heightPct: pct(el.barHeight, LS.h),
    narrowBarWidth: el.narrowBarWidth ?? 2,
    humanReadable: el.humanReadable ?? true,
    rotation: 'R' as const
  }
}

/** Upright text on a portrait label, placed by dot coordinates. */
function pText(el: {
  id: string
  name: string
  content: string
  x: number
  y: number
  heightDots: number
  widthDots: number
  size: { w: number; h: number }
}) {
  return {
    id: el.id,
    name: el.name,
    type: 'text' as const,
    content: el.content,
    xPct: pct(el.x, el.size.w),
    yPct: pct(el.y, el.size.h),
    fontHeightPct: pct(el.heightDots, el.size.h),
    ratio: Math.round((el.widthDots / el.heightDots) * 100) / 100,
    font: '0',
    align: 'left' as const,
    rotation: 'N' as const
  }
}

// ─── The QR / barcode payload every part label shares ────────────────────────

/**
 * Scan payload, matching the convention in the README and the Part Label page:
 * `{partNumber}-{rev}-{vendor}`, e.g. `135853-002-A-NRG`.
 */
const PART_SCAN_PAYLOAD = '{{partNumber}}-{{rev}}-{{vendor}}'

/** Variables shared by the part-oriented templates. */
const PART_VARIABLES = [
  { name: 'partName', label: 'Part name', sample: 'FTS Lens Mount' },
  { name: 'partNumber', label: 'Part number', sample: '135853-002' },
  // Bare letter, not "Rev A" — the Part Label page strips a typed-in "rev"
  // prefix precisely because people add it, and the templates render the word.
  { name: 'rev', label: 'Revision', sample: 'A' },
  { name: 'vendor', label: 'Vendor', sample: 'NRG' },
  { name: 'ticket', label: 'Ticket', sample: 'PI-8088' }
]

// ─── 2×1" — the everyday part label ─────────────────────────────────────────

/**
 * Mirrors `composeSingleLabel()` in web/app/pages/part-label.vue: QR on the left,
 * four lines of text to its right. Those dot coordinates are already proven on
 * real stock, so they are reproduced here rather than redesigned.
 */
function partLabel2x1(): TemplateDefinition {
  const s = SIZE_2X1
  const qrMag = 5
  const textX = 125 // QR at x=8 is 105 dots wide, plus a 12-dot gutter
  const lineSpacing = 42

  return {
    name: 'Part Label 2x1',
    description: 'Everyday part label: QR left, part name / number / rev+serial / ticket right. Matches the Part Label page.',
    baseWidthDots: s.w,
    baseHeightDots: s.h,
    variables: [
      ...PART_VARIABLES,
      { name: 'serial', label: 'Serial', sample: 'NRG-001' }
    ],
    elements: [
      {
        id: 'qr',
        name: 'Scan code',
        type: 'qrcode',
        content: PART_SCAN_PAYLOAD,
        // Vertically centred: (203 - 21*5) / 2 = 49
        xPct: pct(8, s.w),
        yPct: pct(49, s.h),
        magnification: qrMag,
        errorCorrection: 'M',
        rotation: 'N'
      },
      pText({ id: 'name', name: 'Part name', content: '{{partName}}', x: textX, y: 22, heightDots: 30, widthDots: 24, size: s }),
      pText({ id: 'number', name: 'Part number', content: '{{partNumber}}', x: textX, y: 22 + lineSpacing, heightDots: 26, widthDots: 22, size: s }),
      pText({ id: 'rev', name: 'Rev and serial', content: 'Rev {{rev}} | {{serial}}', x: textX, y: 22 + lineSpacing * 2, heightDots: 24, widthDots: 20, size: s }),
      pText({ id: 'ticket', name: 'Ticket', content: '{{ticket}}', x: textX, y: 22 + lineSpacing * 3, heightDots: 24, widthDots: 20, size: s })
    ],
    overrides: {}
  }
}

/**
 * Mirrors `composeBagLabel()`: the summary label that goes on the bag or bin.
 * Title across the top between two rules, smaller QR, and it always carries the
 * total quantity rather than a serial.
 */
function bagLabel2x1(): TemplateDefinition {
  const s = SIZE_2X1
  const margin = 8
  const bagQrMag = 4
  const textX = margin + bagQrMag * 21 + 10 // 102
  const startY = 58
  const spacing = 36

  return {
    name: 'Bag Label 2x1',
    description: 'Bag/bin summary label: title, rules top and bottom, and the total quantity instead of a serial.',
    baseWidthDots: s.w,
    baseHeightDots: s.h,
    variables: [
      ...PART_VARIABLES,
      { name: 'qty', label: 'Quantity', sample: '12' }
    ],
    elements: [
      pText({ id: 'title', name: 'Part name', content: '{{partName}}', x: margin, y: 14, heightDots: 30, widthDots: 24, size: s }),
      {
        id: 'rule-top',
        name: 'Rule (top)',
        type: 'box',
        xPct: pct(margin, s.w),
        yPct: pct(48, s.h),
        widthPct: pct(s.w - margin * 2, s.w),
        heightPct: pct(2, s.h),
        thickness: 2,
        rounding: 0,
        fill: true,
        rotation: 'N'
      },
      {
        id: 'qr',
        name: 'Scan code',
        type: 'qrcode',
        content: PART_SCAN_PAYLOAD,
        xPct: pct(margin, s.w),
        yPct: pct(56, s.h),
        magnification: bagQrMag,
        errorCorrection: 'M',
        rotation: 'N'
      },
      pText({ id: 'number', name: 'Part number', content: '{{partNumber}}', x: textX, y: startY, heightDots: 26, widthDots: 22, size: s }),
      pText({ id: 'rev', name: 'Rev and vendor', content: 'Rev {{rev}} | {{vendor}}', x: textX, y: startY + spacing, heightDots: 22, widthDots: 18, size: s }),
      pText({ id: 'qty', name: 'Ticket and qty', content: '{{ticket}} | Qty: {{qty}}', x: textX, y: startY + spacing * 2, heightDots: 22, widthDots: 18, size: s }),
      {
        id: 'rule-bottom',
        name: 'Rule (bottom)',
        type: 'box',
        xPct: pct(margin, s.w),
        yPct: pct(185, s.h),
        widthPct: pct(s.w - margin * 2, s.w),
        heightPct: pct(2, s.h),
        thickness: 2,
        rounding: 0,
        fill: true,
        rotation: 'N'
      }
    ],
    overrides: {}
  }
}

// ─── 3×5" — read landscape, so everything is rotated ────────────────────────

/**
 * Roomy part/traveler label for 3×5" stock used sideways.
 *
 * Landscape view is 1015 × 609. Turn the printed label a quarter-turn
 * counter-clockwise to read it. In the designer it will appear on its side, which
 * is correct — the canvas always shows the label in its printed orientation.
 */
function partLabel3x5Landscape(): TemplateDefinition {
  const margin = 30
  const qrMag = 8
  const textLeft = margin + qrMag * 21 + 26 // clear of the QR

  return {
    name: 'Part Label 3x5 (landscape)',
    description: 'Large part/traveler label for 3x5 stock read sideways. Turn the label a quarter-turn counter-clockwise. Elements are rotated 90deg, so it looks sideways in the designer.',
    baseWidthDots: SIZE_3X5.w,
    baseHeightDots: SIZE_3X5.h,
    variables: [
      ...PART_VARIABLES,
      { name: 'serial', label: 'Serial', sample: 'NRG-001' },
      { name: 'qty', label: 'Quantity', sample: '12' },
      { name: 'notes', label: 'Notes', sample: 'Handle with gloves' }
    ],
    elements: [
      lsQr({ id: 'qr', name: 'Scan code', content: PART_SCAN_PAYLOAD, vx: margin, vy: margin, magnification: qrMag }),
      lsText({ id: 'name', name: 'Part name', content: '{{partName}}', vx: textLeft, vy: 30, heightDots: 66, ratio: 0.8 }),
      lsText({ id: 'number', name: 'Part number', content: '{{partNumber}}', vx: textLeft, vy: 110, heightDots: 54, ratio: 0.8 }),
      lsText({ id: 'rev', name: 'Rev and vendor', content: 'Rev {{rev}} | {{vendor}}', vx: textLeft, vy: 178, heightDots: 42 }),
      lsText({ id: 'serial', name: 'Serial and qty', content: '{{serial}} | Qty: {{qty}}', vx: textLeft, vy: 230, heightDots: 42 }),
      lsRule({ id: 'rule', name: 'Rule', vx: margin, vy: 290, length: 955, thickness: 3 }),
      lsText({ id: 'ticket', name: 'Ticket', content: 'Ticket {{ticket}}', vx: margin, vy: 312, heightDots: 42 }),
      lsText({ id: 'notes', name: 'Notes', content: '{{notes}}', vx: margin, vy: 364, heightDots: 38 }),
      // Narrow bar 3 rather than 2: it fills the width better and scans more
      // reliably off thermal stock. 16 characters at 3 dots/module is 633 dots,
      // comfortably inside the 1015 available.
      lsBarcode({ id: 'barcode', name: 'Barcode', content: PART_SCAN_PAYLOAD, vx: margin, vy: 420, barHeight: 96, narrowBarWidth: 3 })
    ],
    overrides: {}
  }
}

/**
 * Asset / inventory tag for 3×5" stock used sideways: a big scannable code up
 * top, then the human-readable identity below it.
 */
function assetTag3x5Landscape(): TemplateDefinition {
  const margin = 40
  const qrMag = 6

  return {
    name: 'Asset Tag 3x5 (landscape)',
    description: 'Asset/inventory tag for 3x5 stock read sideways: large CODE128 plus QR, then asset ID, description and location.',
    baseWidthDots: SIZE_3X5.w,
    baseHeightDots: SIZE_3X5.h,
    variables: [
      { name: 'assetId', label: 'Asset ID', sample: 'NRG-001' },
      { name: 'description', label: 'Description', sample: 'FTS Lens Mount' },
      { name: 'location', label: 'Location', sample: 'Bay 3 / Shelf B' },
      { name: 'owner', label: 'Owner', sample: 'Production' }
    ],
    elements: [
      // Human-readable text is drawn separately below so its size and position
      // are under the template's control rather than the printer's.
      lsBarcode({
        id: 'barcode',
        name: 'Asset barcode',
        content: '{{assetId}}',
        vx: margin,
        vy: 40,
        barHeight: 130,
        narrowBarWidth: 3,
        humanReadable: false
      }),
      lsQr({ id: 'qr', name: 'Scan code', content: '{{assetId}}', vx: 849, vy: 40, magnification: qrMag }),
      lsText({ id: 'assetId', name: 'Asset ID', content: '{{assetId}}', vx: margin, vy: 186, heightDots: 70, ratio: 0.8 }),
      lsText({ id: 'description', name: 'Description', content: '{{description}}', vx: margin, vy: 270, heightDots: 48 }),
      lsText({ id: 'location', name: 'Location', content: 'Loc: {{location}}', vx: margin, vy: 332, heightDots: 42 }),
      // Footer pinned near the bottom edge rather than left floating mid-label.
      lsRule({ id: 'rule', name: 'Rule', vx: margin, vy: 480, length: 935, thickness: 3 }),
      lsText({ id: 'owner', name: 'Owner', content: 'Owner: {{owner}}', vx: margin, vy: 500, heightDots: 36 })
    ],
    overrides: {}
  }
}

// ─── Seeding ─────────────────────────────────────────────────────────────────

/** Stable ids so a built-in is recognisable and only ever seeded once. */
export const BUILTIN_TEMPLATES: ReadonlyArray<{ id: string; build: () => TemplateDefinition }> = [
  { id: 'tpl_builtin_part_2x1', build: partLabel2x1 },
  { id: 'tpl_builtin_bag_2x1', build: bagLabel2x1 },
  { id: 'tpl_builtin_part_3x5_landscape', build: partLabel3x5Landscape },
  { id: 'tpl_builtin_asset_3x5_landscape', build: assetTag3x5Landscape }
]

/** Setting tracking which built-ins have already been offered. */
const SEEDED_KEY = 'builtin_templates_seeded'

/**
 * Insert any built-in example template that has never been seeded before.
 *
 * Tracks seeded ids rather than just checking whether the row exists, so that
 * deleting an example keeps it deleted instead of having it reappear on the next
 * restart — while still letting a later release add new examples. Editing one is
 * safe for the same reason: it is never rewritten once seeded.
 *
 * Safe to call on every startup.
 */
export function seedBuiltinTemplates(): { seeded: string[] } {
  const already = new Set(getJsonSetting<string[]>(SEEDED_KEY, []))
  const seeded: string[] = []

  for (const { id, build } of BUILTIN_TEMPLATES) {
    if (already.has(id)) continue
    // Guard against a half-written previous run leaving the row without the marker.
    if (!getTemplate(id)) createTemplateWithId(id, build())
    already.add(id)
    seeded.push(id)
  }

  if (seeded.length > 0) setSetting(SEEDED_KEY, [...already])
  return { seeded }
}
