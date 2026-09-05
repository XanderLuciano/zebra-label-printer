/**
 * Tests for ZPL font metrics used by the designer canvas and label previews.
 *
 * Every expected number here was measured by rendering ZPL through Labelary at
 * 8 dpmm and reading the ink bounding box out of the returned PNG. Predicted
 * advance width is always a little wider than measured ink — the difference is
 * the last glyph's right side bearing — so the assertions below check the
 * *relationships* the preview depends on plus the exact cell arithmetic, rather
 * than restating ink pixel counts.
 *
 * If one of these fails after a change to useZplFonts, the preview has stopped
 * matching the printer.
 */
import { describe, it, expect } from 'vitest'
import {
  zplFont,
  isZplFontId,
  bitmapMagnification,
  printableText,
  measureZplText,
  resolveFontSize,
  zplTextRender,
  ZPL_FONT_IDS,
  ZPL_PREVIEW_FACES,
  FONT0_MIN_DOTS,
  FONT0_CAP_RATIO,
  BITMAP_MAX_MAGNIFICATION,
  ZPL_BUILDER_DEFAULT_RATIO,
  type ZplFontId
} from '../../src/zpl-fonts'

describe('zplFont', () => {
  it('resolves every advertised font', () => {
    for (const id of ZPL_FONT_IDS) {
      expect(zplFont(id).id, id).toBe(id)
    }
  })

  it('falls back to font 0 for anything unknown', () => {
    // The template schema types `font` as a free string, so junk does arrive.
    expect(zplFont('Q').id).toBe('0')
    expect(zplFont('').id).toBe('0')
    expect(zplFont(undefined).id).toBe('0')
    expect(zplFont(null).id).toBe('0')
  })

  it('rejects prototype keys rather than treating them as fonts', () => {
    expect(isZplFontId('toString')).toBe(false)
    expect(isZplFontId('constructor')).toBe(false)
    expect(zplFont('toString').id).toBe('0')
  })

  it('classifies font 0 as scalable and the rest as bitmap', () => {
    expect(zplFont('0').kind).toBe('scalable')
    for (const id of ZPL_FONT_IDS.filter(f => f !== '0')) {
      expect(zplFont(id).kind, id).toBe('bitmap')
    }
  })

  it('has preview face metrics for every font', () => {
    for (const id of ZPL_FONT_IDS) {
      const face = ZPL_PREVIEW_FACES[zplFont(id).face]
      expect(face, id).toBeDefined()
      expect(face.capHeight, id).toBeGreaterThan(0.5)
      expect(face.capHeight, id).toBeLessThan(1)
      // Capitals cannot reach above the face's own cap ink.
      expect(face.capTop, id).toBeLessThanOrEqual(face.capHeight)
    }
  })
})

describe('bitmapMagnification', () => {
  it('rounds to the nearest whole cell', () => {
    // Font A's 5-dot cell: measured advances were 6 dots up to width 6, then 12
    // from width 8 — i.e. round(w/5), not floor.
    expect(bitmapMagnification(6, 5)).toBe(1)
    expect(bitmapMagnification(8, 5)).toBe(2)
    expect(bitmapMagnification(10, 5)).toBe(2)
    expect(bitmapMagnification(12, 5)).toBe(2)
  })

  it('rounds an exact half up', () => {
    // Font C at width 15 is exactly 1.5 cells and measured a 24-dot advance,
    // which is magnification 2.
    expect(bitmapMagnification(15, 10)).toBe(2)
    expect(bitmapMagnification(27, 18)).toBe(2)
  })

  it('never goes below 1', () => {
    expect(bitmapMagnification(1, 40)).toBe(1)
    expect(bitmapMagnification(0, 5)).toBe(1)
    expect(bitmapMagnification(-5, 5)).toBe(1)
  })

  it('caps at the printer maximum', () => {
    // Font A measured a 60-dot advance at widths 48, 60, 72 and 80 alike.
    expect(bitmapMagnification(48, 5)).toBe(BITMAP_MAX_MAGNIFICATION)
    expect(bitmapMagnification(400, 5)).toBe(BITMAP_MAX_MAGNIFICATION)
  })
})

describe('measureZplText — font 0 (proportional)', () => {
  it('gives narrow and wide glyphs different widths', () => {
    // The whole reason the old character-count estimate was wrong: same length,
    // 3× the width. Measured 98 vs 323 dots of ink at ^A0N,40,40.
    const narrow = measureZplText('iiiiiiiiii', { font: '0', height: 40, width: 40 })
    const wide = measureZplText('WWWWWWWWWW', { font: '0', height: 40, width: 40 })
    expect(wide.width / narrow.width).toBeGreaterThan(3)
  })

  it('scales width linearly with the width parameter', () => {
    const at20 = measureZplText('MMMM', { font: '0', height: 40, width: 20 })
    const at40 = measureZplText('MMMM', { font: '0', height: 40, width: 40 })
    expect(at40.width).toBeCloseTo(at20.width * 2, 6)
  })

  it('leaves width alone when only the height changes', () => {
    const short = measureZplText('MMMM', { font: '0', height: 20, width: 30 })
    const tall = measureZplText('MMMM', { font: '0', height: 80, width: 30 })
    expect(tall.width).toBe(short.width)
    expect(tall.capHeight).toBeGreaterThan(short.capHeight)
  })

  it('puts cap height at three quarters of the height parameter', () => {
    // h=40 measured 30 dots of cap ink, h=80 measured 60.
    expect(measureZplText('HELLO', { font: '0', height: 40, width: 40 }).capHeight).toBe(30)
    expect(measureZplText('HELLO', { font: '0', height: 80, width: 80 }).capHeight).toBe(60)
    expect(FONT0_CAP_RATIO).toBe(0.75)
  })

  it('treats the baseline as the cap height below the field origin', () => {
    // ^FO y is the top of the capitals, not the baseline — the canvas used to
    // put text a quarter of its height too low.
    const m = measureZplText('HELLO', { font: '0', height: 40, width: 40 })
    expect(m.baseline).toBe(m.capHeight)
  })

  it('reports the cell as the height parameter', () => {
    // Scalable fonts render exactly what was asked, so the cell is the ^A height
    // — and the cell, not the ink, is what ^FO anchors.
    const m = measureZplText('HELLO', { font: '0', height: 41, width: 25 })
    expect(m.cellHeight).toBe(41)
    expect(m.capHeight).toBeLessThan(m.cellHeight)
  })

  it('clamps height and width to the 10-dot minimum', () => {
    // Everything from 1 to 10 rendered identically: 7 dots of cap, 7.5 advance.
    const tiny = measureZplText('MMMMM', { font: '0', height: 4, width: 4 })
    const atMin = measureZplText('MMMMM', { font: '0', height: FONT0_MIN_DOTS, width: FONT0_MIN_DOTS })
    expect(tiny.width).toBe(atMin.width)
    expect(tiny.capHeight).toBe(atMin.capHeight)
    expect(tiny.snapped).toBe(true)
    expect(atMin.snapped).toBe(false)
  })

  it('charges a hyphen almost a full width parameter', () => {
    // Counter-intuitive but measured twice: '-' is 0.903 of the width parameter,
    // nearly as wide as an 'M'. Verified end-to-end — ABC-123 and ABCD123
    // rendered 236 and 217 dots of ink, a 19-dot gap this reproduces.
    const withHyphen = measureZplText('ABC-123', { font: '0', height: 60, width: 60 })
    const without = measureZplText('ABCD123', { font: '0', height: 60, width: 60 })
    expect(withHyphen.width - without.width).toBeCloseTo(18.78, 1)
  })

  it('reports a mean character width, not a cell width', () => {
    const m = measureZplText('iW', { font: '0', height: 40, width: 40 })
    expect(m.charWidth).toBeCloseTo(m.width / 2, 6)
  })

  it('measures empty text as zero width without dividing by zero', () => {
    const m = measureZplText('', { font: '0', height: 40, width: 40 })
    expect(m.width).toBe(0)
    expect(m.charWidth).toBe(0)
    expect(Number.isFinite(m.charWidth)).toBe(true)
  })

  it('falls back to a sane advance for unmeasured characters', () => {
    const m = measureZplText('é', { font: '0', height: 40, width: 40 })
    expect(m.width).toBeGreaterThan(0)
    expect(m.width).toBeLessThan(40)
  })
})

describe('measureZplText — bitmap fonts', () => {
  it('gives every character the same advance', () => {
    // Font C measured 480 dots for both ten i's and ten W's.
    const narrow = measureZplText('iiiiiiiiii', { font: 'C', height: 40, width: 40 })
    const wide = measureZplText('WWWWWWWWWW', { font: 'C', height: 40, width: 40 })
    expect(narrow.width).toBe(wide.width)
    expect(narrow.width).toBe(480)
  })

  it('snaps to whole magnifications of the cell', () => {
    // Font A: cell 9 high, 7-dot capital. h=40 → round(40/9)=4 → 28 dots of cap,
    // which is what Labelary rendered.
    const m = measureZplText('M', { font: 'A', height: 40, width: 40 })
    expect(m.heightMagnification).toBe(4)
    expect(m.capHeight).toBe(28)
    expect(m.snapped).toBe(true)
  })

  it('reports no snapping when the request lands on the cell exactly', () => {
    const m = measureZplText('M', { font: 'C', height: 36, width: 20 })
    expect(m.heightMagnification).toBe(2)
    expect(m.widthMagnification).toBe(2)
    expect(m.snapped).toBe(false)
  })

  it('stops growing past the magnification cap', () => {
    // Font A at h=200,w=200 measured the same 70-dot cap and 60-dot advance as
    // h=90,w=50.
    const huge = measureZplText('MMMM', { font: 'A', height: 200, width: 200 })
    const atCap = measureZplText('MMMM', { font: 'A', height: 90, width: 50 })
    expect(huge.capHeight).toBe(atCap.capHeight)
    expect(huge.width).toBe(atCap.width)
    expect(huge.capHeight).toBe(70)
    expect(huge.charWidth).toBe(60)
  })

  it('scales height and width magnification independently', () => {
    const m = measureZplText('M', { font: 'C', height: 54, width: 10 })
    expect(m.heightMagnification).toBe(3)
    expect(m.widthMagnification).toBe(1)
  })

  it('matches the measured cell geometry for every bitmap font', () => {
    // Base advance and capital height at magnification 1, from the height and
    // advance sweeps.
    const expected: Record<string, { advance: number; cap: number }> = {
      A: { advance: 6, cap: 7 },
      B: { advance: 9, cap: 11 },
      C: { advance: 12, cap: 14 },
      D: { advance: 12, cap: 14 },
      E: { advance: 20, cap: 20 },
      F: { advance: 16, cap: 21 },
      G: { advance: 48, cap: 48 },
      H: { advance: 19, cap: 21 }
    }
    for (const [id, want] of Object.entries(expected)) {
      const spec = zplFont(id)
      const m = measureZplText('M', { font: id, height: spec.cellHeight, width: spec.cellWidth })
      expect(m.charWidth, `font ${id} advance`).toBe(want.advance)
      expect(m.capHeight, `font ${id} cap height`).toBe(want.cap)
    }
  })

  it('treats fonts C and D as identical', () => {
    // They measured the same at every height and width tried.
    const c = measureZplText('SAMPLE', { font: 'C', height: 40, width: 24 })
    const d = measureZplText('SAMPLE', { font: 'D', height: 40, width: 24 })
    expect(d).toEqual({ ...c })
  })

  it('reports the real cell height, not the requested one', () => {
    // Font C at height 41 renders a 2× cell — 36 dots, not 41. Verified by
    // measuring where ink lands inside a rotated field.
    const m = measureZplText('HELLO', { font: 'C', height: 41, width: 25 })
    expect(m.heightMagnification).toBe(2)
    expect(m.cellHeight).toBe(36)
  })

  it('rounds the width magnification half up', () => {
    // Font C at width 25 is exactly 2.5 cells; the printer renders 3×, measured
    // as a 36-dot advance.
    const m = measureZplText('M', { font: 'C', height: 36, width: 25 })
    expect(m.widthMagnification).toBe(3)
    expect(m.charWidth).toBe(36)
  })

  it('offsets font E below the field origin', () => {
    // OCR-B is the only font whose ink does not start at ^FO y: 6 dots at
    // magnification 2.
    const m = measureZplText('ABC', { font: 'E', height: 56, width: 30 })
    expect(m.baseline).toBe(m.capHeight + 6)
  })
})

describe('printableText', () => {
  it('leaves a full-charset font alone', () => {
    expect(printableText('Mixed Case 123', 'full')).toBe('Mixed Case 123')
  })

  it('folds lowercase up for an uppercase-only font', () => {
    expect(printableText('Widget', 'upper')).toBe('WIDGET')
  })

  it('blanks lowercase for OCR-A but keeps its width', () => {
    // Font H prints nothing for lowercase yet still advances a full cell:
    // measured 'AB' at 65 dots of ink and 'AxB' at 103, one advance apart.
    expect(printableText('AxB', 'ocr-a')).toBe('A B')
    const two = measureZplText('AB', { font: 'H', height: 42, width: 26 })
    const three = measureZplText('AxB', { font: 'H', height: 42, width: 26 })
    expect(three.width - two.width).toBe(three.charWidth)
  })

  it('applies the charset through measureZplText', () => {
    expect(measureZplText('abc', { font: 'B', height: 22, width: 14 }).printable).toBe('ABC')
    expect(measureZplText('abc', { font: 'H', height: 21, width: 13 }).printable).toBe('   ')
  })
})

describe('ink height', () => {
  it('is just the cap height for text without descenders', () => {
    const m = measureZplText('HELLO', { font: '0', height: 40, width: 40 })
    expect(m.inkHeight).toBe(m.capHeight)
  })

  it('adds the descender only when the text has one', () => {
    const plain = measureZplText('HELLO', { font: '0', height: 40, width: 40 })
    const deep = measureZplText('Happy', { font: '0', height: 40, width: 40 })
    expect(deep.inkHeight).toBeGreaterThan(plain.inkHeight)
    expect(deep.inkHeight).toBeCloseTo(plain.capHeight + plain.descent, 6)
  })

  it('ignores a descender the font cannot print', () => {
    // Font B folds to uppercase, so there is no descender left to allow for.
    const m = measureZplText('Happy', { font: 'B', height: 22, width: 14 })
    expect(m.inkHeight).toBe(m.baseline)
  })
})

describe('resolveFontSize', () => {
  it('derives width from height using the builder default ratio', () => {
    // Mirrors ZPLBuilder.text(), which the raw-payload preview has to match.
    expect(resolveFontSize({ height: 40 })).toEqual({ height: 40, width: 32 })
    expect(ZPL_BUILDER_DEFAULT_RATIO).toBe(0.8)
  })

  it('derives height from width', () => {
    expect(resolveFontSize({ width: 32 })).toEqual({ height: 40, width: 32 })
  })

  it('honours an explicit ratio', () => {
    expect(resolveFontSize({ height: 40, ratio: 0.5 })).toEqual({ height: 40, width: 20 })
  })

  it('keeps both dimensions when both are given', () => {
    expect(resolveFontSize({ height: 40, width: 10, ratio: 0.5 })).toEqual({ height: 40, width: 10 })
  })

  it('falls back to font 0 defaults when nothing is given', () => {
    expect(resolveFontSize({})).toEqual({ height: 24, width: 15 })
  })
})

describe('zplTextRender', () => {
  it('sizes the browser face so its capitals match the printer', () => {
    const m = measureZplText('HELLO', { font: '0', height: 40, width: 40 })
    const r = zplTextRender(m, '0', 100)
    // font-size × the face's cap height should reproduce the ZPL cap height.
    expect(r.fontSize * ZPL_PREVIEW_FACES[r.faceClass].capHeight).toBeCloseTo(m.capHeight, 6)
  })

  it('puts the top of the capitals on the field origin', () => {
    // This is the invariant that matters: ^FO anchors the cap top, so wherever
    // the baseline lands, cap top must come back to y.
    for (const font of ZPL_FONT_IDS) {
      const m = measureZplText('HELLO', { font, height: 40, width: 32 })
      const r = zplTextRender(m, font, 100)
      const face = ZPL_PREVIEW_FACES[r.faceClass]
      const capTopY = r.baselineY - face.capTop * r.fontSize
      // Allowing for fonts (E) whose ink starts a few dots below the origin.
      expect(capTopY, `font ${font}`).toBeCloseTo(100 + (m.baseline - m.capHeight), 6)
    }
  })

  it('offsets the baseline for a face whose capitals sit below it', () => {
    // PrintLab ZPL's outlines are shifted 0.04 em down to match CG Triumvirate,
    // so the baseline is not simply y + capHeight.
    const m = measureZplText('HELLO', { font: '0', height: 40, width: 40 })
    const r = zplTextRender(m, '0', 100)
    const face = ZPL_PREVIEW_FACES['zpl-face-scalable']
    expect(face.capTop).toBeLessThan(face.capHeight)
    expect(r.baselineY).toBeGreaterThan(100)
    expect(r.baselineY).toBeLessThan(100 + m.capHeight)
  })

  it('forces the advance width so aspect ratio stretches the glyphs', () => {
    const narrow = zplTextRender(
      measureZplText('HELLO', { font: '0', height: 40, width: 20 }), '0', 0
    )
    const wide = zplTextRender(
      measureZplText('HELLO', { font: '0', height: 40, width: 60 }), '0', 0
    )
    expect(narrow.textLength).toBeDefined()
    expect(wide.textLength!).toBeCloseTo(narrow.textLength! * 3, 6)
    // Same height either way — only the width parameter changed.
    expect(wide.fontSize).toBe(narrow.fontSize)
  })

  it('omits textLength for empty text so SVG has nothing to fit', () => {
    expect(zplTextRender(measureZplText('', { font: '0', height: 40, width: 40 }), '0', 0).textLength)
      .toBeUndefined()
  })

  it('picks a distinct face per font family', () => {
    const faceOf = (f: ZplFontId) =>
      zplTextRender(measureZplText('A', { font: f, height: 40, width: 24 }), f, 0).faceClass
    expect(faceOf('0')).toBe('zpl-face-scalable')
    expect(faceOf('C')).toBe('zpl-face-bitmap')
    // OCR-A and OCR-B are genuinely different typefaces, so they get their own
    // faces rather than sharing one approximation.
    expect(faceOf('H')).toBe('zpl-face-ocr-a')
    expect(faceOf('E')).toBe('zpl-face-ocr-b')
  })
})
