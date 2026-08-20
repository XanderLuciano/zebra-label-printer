/**
 * ZPL font metrics — what the printer actually does with `^A`.
 *
 * The designer used to draw every text element in one hardcoded browser font at
 * `font-size = height`, and estimate its width as `characters × height × ratio`.
 * That made two of the property editor's controls do nothing you could see: the
 * Font select changed the printed label but not the canvas, and Aspect ratio
 * only nudged the selection outline. It also placed text a quarter of its height
 * too low, because ZPL treats `^FO` as the top of the *capitals*, not the
 * baseline.
 *
 * Everything below was measured by rendering ZPL through Labelary at 8 dpmm and
 * reading the ink bounding boxes out of the returned PNGs, then cross-checking
 * each number a second way (bands of fields on one label vs. one field per
 * label). Where a figure looks surprising, it is because that is what came back
 * — see the notes on the symbol advances.
 *
 * The reference is Labelary rather than a physical printer, which was worth being
 * nervous about — Labelary cannot ship Zebra's licensed fonts, so its font 0 is a
 * substitute. That nervousness turned out to be unwarranted: the advance table
 * below was cross-checked against a font built by an unrelated project by
 * remapping Roboto Condensed to Zebra firmware's CG Triumvirate metrics, and 94
 * of 95 printable ASCII glyphs agree to within 0.15% of the em. The bitmap fonts
 * are fixed-width and their cell geometry matches Zebra's published font matrix.
 *
 * The two font families behave completely differently:
 *
 *   Font '0' is scalable and *proportional*. Height and width scale smoothly to
 *   whatever you ask for, and every glyph has its own advance. `iiii` is not the
 *   same width as `WWWW`, which is why a character-count estimate can be off by
 *   3× on the same string length.
 *
 *   Fonts 'A'–'H' are fixed-width bitmaps. They only render at *integer*
 *   magnifications of a base cell, so asking for height 40 on a 9-dot cell gets
 *   you 36, and every character occupies exactly the same advance.
 *
 * @see https://docs.zebra.com/us/en/printers/software/zpl-pg/c-zpl-zpl-commands/r-zpl-a.html
 */

// ─── Font 0: proportional advances ───────────────────────────────────────────

/**
 * Per-glyph advance for scalable font '0', in thousandths of the `^A` width
 * parameter. `advance = ADVANCE_PER_MILLE[char] / 1000 × width`.
 *
 * Measured by rendering N and N+10 copies of each character and dividing the
 * difference in ink width by 10, at `^A0N,60,60`. The first attempt at this
 * produced nonsense for `C G O Q S $ ? { }` because round letters overshoot one
 * dot above the cap line and bled into the neighbouring measurement band; the
 * values here are from the corrected run and agree with one-field-per-label
 * renders to within a dot.
 *
 * Two things worth knowing before "fixing" a number that looks wrong:
 *
 *   - These are not Helvetica/Arial widths. Font 0 is CG Triumvirate Bold
 *     Condensed, and the table reflects that: fitting it against the real advance
 *     tables of a dozen free faces ranks condensed bold ones first, with Roboto
 *     Condensed Bold matching at a scale of 1.005, while Arial-metric Arimo needs
 *     0.872 and ranks near the bottom.
 *
 *   - `- + = % @` (903) and `< > ~` (995) really are close to a full width
 *     parameter each. A hyphen is nearly as wide as an `M` and prints as a long,
 *     chunky bar. It looks so wrong that it was initially assumed to be a
 *     rendering artifact, but it is genuine: this whole table was later checked
 *     against PrintLab ZPL Bold (see public/fonts/README.md), a font whose
 *     advances were remapped to Zebra firmware's CG Triumvirate metrics by an
 *     unrelated project, and 94 of 95 printable ASCII glyphs agree to within
 *     0.15% of the em — hyphen included, at 904 against 903 here. `~` is the only
 *     outlier, 995 here against their 980.
 *
 *     This matters for part numbers like `ABC-123`, and it is covered by the
 *     mixed-string checks in test/unit/zpl-fonts.test.ts.
 */
const ADVANCE_PER_MILLE: Readonly<Record<string, number>> = {
  ' ': 295,
  '!': 295, '"': 478, '#': 478, '$': 478, '%': 903, '&': 608, '\'': 295,
  '(': 295, ')': 295, '*': 478, '+': 903, ',': 295, '-': 903, '.': 295, '/': 295,
  '0': 478, '1': 478, '2': 478, '3': 478, '4': 478,
  '5': 478, '6': 478, '7': 478, '8': 478, '9': 478,
  ':': 295, ';': 295, '<': 995, '=': 903, '>': 995, '?': 442, '@': 903,
  A: 553, B: 553, C: 535, D: 590, E: 498, F: 498, G: 590, H: 608, I: 275,
  J: 442, K: 553, L: 478, M: 757, N: 608, O: 572, P: 553, Q: 572, R: 590,
  S: 535, T: 498, U: 608, V: 535, W: 812, X: 553, Y: 553, Z: 498,
  '[': 295, '\\': 478, ']': 295, '^': 498, _: 498, '`': 295,
  a: 460, b: 498, c: 442, d: 498, e: 478, f: 275, g: 498, h: 498, i: 258,
  j: 258, k: 442, l: 258, m: 757, n: 498, o: 478, p: 498, q: 498, r: 332,
  s: 425, t: 275, u: 498, v: 442, w: 663, x: 442, y: 442, z: 388,
  '{': 498, '|': 498, '}': 498, '~': 995,
}

/** Advance assumed for characters outside the measured set (accented, CJK, …). */
const FALLBACK_ADVANCE_PER_MILLE = 498

/**
 * Smallest `^A` height/width font 0 honours, in dots.
 *
 * Asking for anything from 1 to 10 renders identically to 10 — measured cap
 * height stays at 7 dots and the `M` advance at 7.5 across that whole range.
 */
export const FONT0_MIN_DOTS = 10

/**
 * Cap height as a fraction of the `^A` height parameter, for font 0.
 *
 * Exactly 0.75 across every size measured (h=12→9, 20→15, 40→30, 80→60).
 */
export const FONT0_CAP_RATIO = 0.75

/** Descender depth below the baseline, as a fraction of the height parameter. */
export const FONT0_DESCENT_RATIO = 0.183

// ─── Fonts A–H: fixed-width bitmaps ──────────────────────────────────────────

/**
 * Largest magnification a bitmap font will step up to. Beyond this the printer
 * stops growing: font A at width 60, 72 and 80 all render a 60-dot advance,
 * which is magnification 10 of its 6-dot base.
 */
export const BITMAP_MAX_MAGNIFICATION = 10

/**
 * Preview typefaces, keyed by the CSS class in assets/css/main.css that declares
 * them. The font files live in public/fonts; see the README there for what they
 * are and why the printer's own fonts can't be used.
 */
export type ZplFaceName =
  | 'zpl-face-scalable'
  | 'zpl-face-bitmap'
  | 'zpl-face-ocr-a'
  | 'zpl-face-ocr-b'

/** Vertical metrics of a preview face, as fractions of its font-size. */
export interface ZplPreviewFace {
  /**
   * Height of the capital ink. The canvas divides the ZPL cap height by this to
   * pick an SVG `font-size`, so capitals come out the height the printer makes
   * them.
   */
  capHeight: number
  /**
   * How far the top of the capitals sits above the baseline.
   *
   * Usually the same as `capHeight`, because capitals normally rest on the
   * baseline. PrintLab ZPL is the exception: its outlines are deliberately
   * shifted 0.04 em below the baseline to match where CG Triumvirate renders, so
   * placing the baseline at `y + capHeight` would sit the text slightly high.
   * Both numbers were read from the `H` glyph outlines of the shipped files.
   */
  capTop: number
}

export const ZPL_PREVIEW_FACES: Readonly<Record<ZplFaceName, ZplPreviewFace>> = {
  // PrintLab ZPL Bold: 'H' spans -0.0400 … 0.7275 em.
  'zpl-face-scalable': { capHeight: 0.7675, capTop: 0.7275 },
  // PrintLab Mono: 'H' spans 0 … 0.7290 em.
  'zpl-face-bitmap': { capHeight: 0.7290, capTop: 0.7290 },
  // OCR A: 'H' spans 0 … 0.7800 em.
  'zpl-face-ocr-a': { capHeight: 0.7800, capTop: 0.7800 },
  // OCR B: 'H' spans -0.0100 … 0.7130 em.
  'zpl-face-ocr-b': { capHeight: 0.7230, capTop: 0.7130 },
}

/** Which characters a font can print at all. */
export type ZplCharset =
  /** Full upper/lower/digits/symbols. */
  | 'full'
  /** Uppercase only — lowercase input is folded up. */
  | 'upper'
  /** OCR-A: uppercase, digits and symbols. Lowercase leaves a blank gap. */
  | 'ocr-a'

export interface ZplFontSpec {
  id: ZplFontId
  /** Menu label, e.g. "0 — Swiss 721 (scalable)". */
  label: string
  /** One-line explanation for the designer's help text. */
  description: string
  /**
   * 'scalable' stretches smoothly to any height/width; 'bitmap' snaps to
   * integer magnifications of `cellHeight` × `cellWidth`.
   */
  kind: 'scalable' | 'bitmap'
  /** Base cell height in dots at magnification 1. Bitmap fonts only. */
  cellHeight: number
  /** Base cell width in dots at magnification 1. Bitmap fonts only. */
  cellWidth: number
  /** Advance per character in dots at magnification 1. Bitmap fonts only. */
  baseAdvance: number
  /** Capital ink height in dots at magnification 1. Bitmap fonts only. */
  baseCapHeight: number
  /** Dots between `^FO` y and the top of the capitals, at magnification 1. */
  baseTopOffset: number
  charset: ZplCharset
  face: ZplFaceName
}

export type ZplFontId = '0' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'

/**
 * The built-in fonts, with cell geometry measured rather than taken from the
 * manual — several published tables disagree with what the printer emits.
 *
 * Height and width magnifications are derived independently as
 * `clamp(round(param / cell), 1, 10)`. Rounding is half-up, which the data
 * confirms: font C at width 15 is exactly 1.5 cells and renders at
 * magnification 2 (advance 24, not 12).
 *
 * `baseCapHeight` is the *ink* height of capitals, which is not the cell height:
 * font A fits 7 dots of capital inside a 9-dot cell, leaving 2 for descenders.
 * Fonts B and H fill their cell completely because they have no lowercase.
 */
const FONT_SPECS: Readonly<Record<ZplFontId, ZplFontSpec>> = {
  '0': {
    id: '0',
    label: '0 — CG Triumvirate Bold Condensed (scalable)',
    description: 'Scalable proportional font. Smooth at any size; character widths vary per letter.',
    kind: 'scalable',
    // Unused for scalable fonts, but kept non-zero so the shape is uniform and
    // no caller has to special-case an optional field.
    cellHeight: FONT0_MIN_DOTS,
    cellWidth: FONT0_MIN_DOTS,
    baseAdvance: FONT0_MIN_DOTS,
    baseCapHeight: Math.round(FONT0_MIN_DOTS * FONT0_CAP_RATIO),
    baseTopOffset: 0,
    charset: 'full',
    face: 'zpl-face-scalable',
  },
  A: {
    id: 'A',
    label: 'A — 9×5 bitmap',
    description: 'Smallest bitmap font. Fixed width, upper/lowercase.',
    kind: 'bitmap',
    cellHeight: 9,
    cellWidth: 5,
    baseAdvance: 6,
    baseCapHeight: 7,
    baseTopOffset: 0,
    charset: 'full',
    face: 'zpl-face-bitmap',
  },
  B: {
    id: 'B',
    label: 'B — 11×7 bitmap (caps)',
    description: 'Fixed-width bitmap, uppercase only.',
    kind: 'bitmap',
    cellHeight: 11,
    cellWidth: 7,
    baseAdvance: 9,
    baseCapHeight: 11,
    baseTopOffset: 0,
    charset: 'upper',
    face: 'zpl-face-bitmap',
  },
  C: {
    id: 'C',
    label: 'C — 18×10 bitmap',
    description: 'Fixed-width bitmap, upper/lowercase.',
    kind: 'bitmap',
    cellHeight: 18,
    cellWidth: 10,
    baseAdvance: 12,
    baseCapHeight: 14,
    baseTopOffset: 0,
    charset: 'full',
    face: 'zpl-face-bitmap',
  },
  D: {
    id: 'D',
    // Not a copy-paste slip: D measured identically to C at every height and
    // width tried, which matches Zebra listing both as 18×10.
    label: 'D — 18×10 bitmap',
    description: 'Fixed-width bitmap, identical metrics to font C.',
    kind: 'bitmap',
    cellHeight: 18,
    cellWidth: 10,
    baseAdvance: 12,
    baseCapHeight: 14,
    baseTopOffset: 0,
    charset: 'full',
    face: 'zpl-face-bitmap',
  },
  E: {
    id: 'E',
    label: 'E — 28×15 OCR-B',
    description: 'OCR-B. Machine-readable, wide spacing.',
    kind: 'bitmap',
    cellHeight: 28,
    cellWidth: 15,
    baseAdvance: 20,
    baseCapHeight: 20,
    // The only font whose ink starts below the field origin: measured 6 dots at
    // magnification 2, so 3 per step.
    baseTopOffset: 3,
    charset: 'full',
    face: 'zpl-face-ocr-b',
  },
  F: {
    id: 'F',
    label: 'F — 26×13 bitmap',
    description: 'Fixed-width bitmap, upper/lowercase.',
    kind: 'bitmap',
    cellHeight: 26,
    cellWidth: 13,
    baseAdvance: 16,
    baseCapHeight: 21,
    baseTopOffset: 0,
    charset: 'full',
    face: 'zpl-face-bitmap',
  },
  G: {
    id: 'G',
    label: 'G — 60×40 bitmap',
    description: 'Largest bitmap font. Coarse steps: nothing between 1× and 2×.',
    kind: 'bitmap',
    cellHeight: 60,
    cellWidth: 40,
    baseAdvance: 48,
    baseCapHeight: 48,
    baseTopOffset: 0,
    charset: 'full',
    face: 'zpl-face-bitmap',
  },
  H: {
    id: 'H',
    label: 'H — 21×13 OCR-A',
    description: 'OCR-A. Uppercase and digits only — lowercase prints blank.',
    kind: 'bitmap',
    cellHeight: 21,
    cellWidth: 13,
    baseAdvance: 19,
    baseCapHeight: 21,
    baseTopOffset: 0,
    charset: 'ocr-a',
    face: 'zpl-face-ocr-a',
  },
}

/** Selectable fonts, in menu order. */
export const ZPL_FONT_IDS: readonly ZplFontId[] = ['0', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

/**
 * Default `^A` font when an element doesn't name one, matching
 * `ZPLBuilder.text()`.
 */
export const DEFAULT_ZPL_FONT: ZplFontId = '0'

/** True when `id` names a font we have metrics for. */
export function isZplFontId(id: unknown): id is ZplFontId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(FONT_SPECS, id)
}

/**
 * Metrics for a font, falling back to font 0.
 *
 * The template schema types `font` as a free string, so unknown values do reach
 * here; the printer would fall back to its default too.
 */
export function zplFont(id?: string | null): ZplFontSpec {
  return isZplFontId(id) ? FONT_SPECS[id] : FONT_SPECS[DEFAULT_ZPL_FONT]
}

/**
 * Magnification a bitmap font uses for a requested dimension.
 *
 * Bitmap glyphs are scaled by whole numbers only, so a request lands on the
 * nearest multiple of the base cell and is capped at 10×.
 */
export function bitmapMagnification(param: number, cell: number): number {
  if (!Number.isFinite(param) || param <= 0 || cell <= 0) return 1
  return Math.min(BITMAP_MAX_MAGNIFICATION, Math.max(1, Math.round(param / cell)))
}

/**
 * Glyphs that drop below the baseline.
 *
 * Used so the reported ink height — and therefore the designer's selection
 * outline — hugs the text: `HELLO` occupies just its cap height, while `Happy`
 * reaches a descender deeper. Measuring `^A0N,40,40 HELLO` gives 32 dots of ink
 * against a 30-dot cap height, so treating every string as cap-plus-descender
 * would draw the box a quarter too tall on the common all-caps label.
 */
const DESCENDER_GLYPHS = /[gjpqy,;$()[\]{}/\\|@]/

/** Text as the printer would render it, given the font's character set. */
export function printableText(text: string, charset: ZplCharset): string {
  switch (charset) {
    case 'upper':
      return text.toUpperCase()
    case 'ocr-a':
      // OCR-A has no lowercase glyphs, but the printer still advances the full
      // cell for them — measured "Widget 4000" in font H occupies all eleven
      // character widths with four of them blank. Dropping the characters would
      // under-predict the field width by 44%; folding them to uppercase would
      // hide that the label comes out with holes in it.
      return text.replace(/[a-z]/g, ' ')
    default:
      return text
  }
}

// ─── Measurement ─────────────────────────────────────────────────────────────

/** Aspect ratio `ZPLBuilder.text()` assumes when only one dimension is given. */
export const ZPL_BUILDER_DEFAULT_RATIO = 0.8

/**
 * Aspect ratio the designer applies to template text without an explicit one.
 *
 * Deliberately different from {@link ZPL_BUILDER_DEFAULT_RATIO}: the designer
 * always sends `ratio` in the print payload, so this value — not the builder's —
 * decides what a ratio-less template prints, and changing it would silently
 * reflow existing saved templates.
 */
export const DESIGNER_DEFAULT_RATIO = 0.6

/** Height/width the printer resolves `^A` to, in dots. */
export interface ResolvedFontSize {
  height: number
  width: number
}

/**
 * Resolve `^A` height and width the way `ZPLBuilder.text()` does, so a preview
 * built from a raw print payload measures the same glyphs the printer draws.
 *
 * Mirrors src/zpl.ts: an absent dimension is derived from the other via `ratio`,
 * and with neither given both fall back to font 0's 24×15 default.
 */
export function resolveFontSize(options: {
  height?: number
  width?: number
  ratio?: number
}): ResolvedFontSize {
  const ratio = options.ratio ?? ZPL_BUILDER_DEFAULT_RATIO
  const height = options.height ?? (options.width ? Math.round(options.width / ratio) : 24)
  const width = options.width ?? (options.height ? Math.round(options.height * ratio) : 15)
  return { height, width }
}

export interface ZplTextMetrics {
  /** Advance width of the whole string, in dots. */
  width: number
  /** Capital ink height in dots. */
  capHeight: number
  /**
   * Height of the character cell the field occupies, in dots.
   *
   * This — not the ink — is what `^FO` anchors, so it is the box to rotate and
   * the box to test for running off the label. For scalable font 0 it is the
   * (clamped) `^A` height parameter. For a bitmap font it is the base cell times
   * the magnification, which can differ noticeably from what was asked for:
   * font C at height 41 renders a 36-dot cell, confirmed by measuring where the
   * ink lands on a rotated field.
   */
  cellHeight: number
  /** How far this font's descenders reach below the baseline, in dots. */
  descent: number
  /** Baseline offset below the `^FO` y origin, in dots. */
  baseline: number
  /**
   * Height of the ink *this string* produces, in dots — cap height, plus the
   * descender only when the text actually contains one.
   */
  inkHeight: number
  /** Per-character advance: exact for bitmap fonts, the mean for font 0. */
  charWidth: number
  /** Height magnification. Always 1 for scalable font 0. */
  heightMagnification: number
  /** Width magnification. Always 1 for scalable font 0. */
  widthMagnification: number
  /** What the printer actually renders, after charset folding. */
  printable: string
  /** True when the request was clamped or snapped away from what was asked. */
  snapped: boolean
}

/**
 * Measure a string as the printer would set it.
 *
 * `height` and `width` are the `^A` parameters in dots. Pass the same numbers
 * the ZPL will carry and the result describes the ink the printer produces:
 * where to put the baseline, how tall capitals come out, and how wide the field
 * ends up — including the fact that a bitmap font ignores most of the sizes you
 * can type into a number input.
 */
export function measureZplText(
  text: string,
  options: { font?: string | null; height: number; width: number },
): ZplTextMetrics {
  const spec = zplFont(options.font)
  const printable = printableText(text, spec.charset)

  if (spec.kind === 'scalable') {
    const height = Math.max(FONT0_MIN_DOTS, options.height)
    const width = Math.max(FONT0_MIN_DOTS, options.width)
    let perMille = 0
    for (const ch of printable) {
      perMille += ADVANCE_PER_MILLE[ch] ?? FALLBACK_ADVANCE_PER_MILLE
    }
    const capHeight = height * FONT0_CAP_RATIO
    const descent = height * FONT0_DESCENT_RATIO
    const advance = (perMille / 1000) * width
    return {
      width: advance,
      capHeight,
      cellHeight: height,
      descent,
      baseline: capHeight,
      inkHeight: capHeight + (DESCENDER_GLYPHS.test(printable) ? descent : 0),
      charWidth: printable.length > 0 ? advance / printable.length : 0,
      heightMagnification: 1,
      widthMagnification: 1,
      printable,
      snapped: height !== options.height || width !== options.width,
    }
  }

  const hMag = bitmapMagnification(options.height, spec.cellHeight)
  const wMag = bitmapMagnification(options.width, spec.cellWidth)
  const capHeight = spec.baseCapHeight * hMag
  const topOffset = spec.baseTopOffset * hMag
  // The cell leaves room below the capitals for descenders; whatever is left
  // over after the cap and top offset is that space.
  const descent = Math.max(0, (spec.cellHeight - spec.baseCapHeight - spec.baseTopOffset) * hMag)
  const charWidth = spec.baseAdvance * wMag
  return {
    width: printable.length * charWidth,
    capHeight,
    cellHeight: spec.cellHeight * hMag,
    descent,
    baseline: topOffset + capHeight,
    inkHeight: topOffset + capHeight + (DESCENDER_GLYPHS.test(printable) ? descent : 0),
    charWidth,
    heightMagnification: hMag,
    widthMagnification: wMag,
    printable,
    snapped:
      spec.cellHeight * hMag !== options.height || spec.cellWidth * wMag !== options.width,
  }
}

/**
 * SVG `<text>` attributes that reproduce a measured ZPL string on the canvas.
 *
 * `fontSize` scales the browser face so its capitals match the printer's, and
 * `textLength` with `lengthAdjust="spacingAndGlyphs"` forces the run to the
 * measured advance width. That combination is what makes Font and Aspect ratio
 * visible: stretching the width parameter now stretches the glyphs on screen
 * exactly as it does on the label.
 */
export interface ZplTextRender {
  /** Baseline y, in label dots, given the element's `^FO` y. */
  baselineY: number
  /** SVG font-size in dots. */
  fontSize: number
  /** CSS class carrying the preview font-family. */
  faceClass: ZplFaceName
  /** Advance width to force, in dots. Undefined for empty text. */
  textLength?: number
  /** Text to draw — charset-folded to match the printer. */
  content: string
}

export function zplTextRender(metrics: ZplTextMetrics, font: string | null | undefined, y: number): ZplTextRender {
  const face = zplFont(font).face
  const { capHeight, capTop } = ZPL_PREVIEW_FACES[face]
  // Scale the face so its capital ink matches the printer's cap height...
  const fontSize = metrics.capHeight / capHeight
  return {
    // ...then place the baseline so the *top* of those capitals lands on the
    // field origin, which is where ZPL puts it. Deriving this from the face's own
    // cap-top rather than from the cap height matters for faces whose capitals
    // don't rest on the baseline.
    baselineY: y + (metrics.baseline - metrics.capHeight) + capTop * fontSize,
    fontSize,
    faceClass: face,
    textLength: metrics.printable.length > 0 && metrics.width > 0 ? metrics.width : undefined,
    content: metrics.printable,
  }
}
