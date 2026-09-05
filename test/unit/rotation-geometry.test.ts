/**
 * Tests for ZPL rotation geometry used by the designer canvas and history preview.
 *
 * The expected values come from measuring real Labelary renders: `^FO200,200`
 * fields at each rotation all produce a bounding box whose top-left is exactly
 * (200, 200), with width and height swapped on quarter turns. These tests lock
 * that behaviour in so the preview keeps matching the printer.
 */
import { describe, it, expect } from 'vitest'
import {
  isQuarterTurn,
  rotatedBounds,
  rotationTransform,
  resolveTemplate,
  emptyTemplate,
  estimateBarcodeWidth,
  is2dSymbology,
  type Box,
  type Rotation,
  type LabelTemplate
} from '../../src/template-engine'

/** Rotate a point about a pivot the same way SVG's rotate(a, cx, cy) does. */
function rotatePoint(x: number, y: number, degrees: number, cx: number, cy: number) {
  const rad = (degrees * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = x - cx
  const dy = y - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

/** Parse `rotate(a cx cy)` back out of a transform string. */
function parseTransform(t: string) {
  const m = t.match(/rotate\((-?[\d.]+) (-?[\d.]+) (-?[\d.]+)\)/)
  if (!m) throw new Error(`Not a rotate transform: ${t}`)
  return { degrees: Number(m[1]), cx: Number(m[2]), cy: Number(m[3]) }
}

/** Apply a transform to a box and return the resulting axis-aligned bounds. */
function applyTransform(box: Box, transform: string): Box {
  if (!transform) return { ...box }
  const { degrees, cx, cy } = parseTransform(transform)
  const corners = [
    rotatePoint(box.x, box.y, degrees, cx, cy),
    rotatePoint(box.x + box.w, box.y, degrees, cx, cy),
    rotatePoint(box.x, box.y + box.h, degrees, cx, cy),
    rotatePoint(box.x + box.w, box.y + box.h, degrees, cx, cy)
  ]
  const xs = corners.map(c => c.x)
  const ys = corners.map(c => c.y)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys)
  }
}

const ROTATIONS: Rotation[] = ['N', 'R', 'I', 'B']

describe('isQuarterTurn', () => {
  it('is true only for 90° and 270°', () => {
    expect(isQuarterTurn('R')).toBe(true)
    expect(isQuarterTurn('B')).toBe(true)
    expect(isQuarterTurn('N')).toBe(false)
    expect(isQuarterTurn('I')).toBe(false)
  })
})

describe('rotatedBounds', () => {
  const box: Box = { x: 200, y: 200, w: 101, h: 32 }

  it('keeps the origin pinned at ^FO for every rotation', () => {
    for (const r of ROTATIONS) {
      const b = rotatedBounds(box, r)
      expect(b.x, `rotation ${r}`).toBe(200)
      expect(b.y, `rotation ${r}`).toBe(200)
    }
  })

  it('swaps width and height on quarter turns', () => {
    expect(rotatedBounds(box, 'R')).toEqual({ x: 200, y: 200, w: 32, h: 101 })
    expect(rotatedBounds(box, 'B')).toEqual({ x: 200, y: 200, w: 32, h: 101 })
  })

  it('leaves dimensions alone at 0° and 180°', () => {
    expect(rotatedBounds(box, 'N')).toEqual(box)
    expect(rotatedBounds(box, 'I')).toEqual(box)
  })
})

describe('rotationTransform', () => {
  it('emits nothing for unrotated elements', () => {
    expect(rotationTransform({ x: 10, y: 20, w: 30, h: 40 }, 'N')).toBe('')
  })

  it('produces a transform whose result matches rotatedBounds', () => {
    // This is the core invariant: drawing the shape unrotated and applying the
    // transform must land it exactly where ZPL puts the rotated field.
    const boxes: Box[] = [
      { x: 200, y: 200, w: 101, h: 32 },
      { x: 0, y: 0, w: 105, h: 105 },
      { x: 37, y: 512, w: 180, h: 80 },
      { x: 5, y: 5, w: 1, h: 400 }
    ]

    for (const box of boxes) {
      for (const r of ROTATIONS) {
        const actual = applyTransform(box, rotationTransform(box, r))
        const expected = rotatedBounds(box, r)
        expect(actual.x, `${r} x of ${JSON.stringify(box)}`).toBeCloseTo(expected.x, 6)
        expect(actual.y, `${r} y of ${JSON.stringify(box)}`).toBeCloseTo(expected.y, 6)
        expect(actual.w, `${r} w of ${JSON.stringify(box)}`).toBeCloseTo(expected.w, 6)
        expect(actual.h, `${r} h of ${JSON.stringify(box)}`).toBeCloseTo(expected.h, 6)
      }
    }
  })

  it('matches the measured Labelary geometry for 90° text', () => {
    // ^FO200,200 ^A0R,40,40 "HELLO" measured as 32×101 ink at (200, 200).
    const box: Box = { x: 200, y: 200, w: 101, h: 32 }
    const result = applyTransform(box, rotationTransform(box, 'R'))
    expect(result).toEqual({ x: 200, y: 200, w: 32, h: 101 })
  })

  it('rotates 180° about the element centre', () => {
    const box: Box = { x: 100, y: 100, w: 60, h: 20 }
    const { degrees, cx, cy } = parseTransform(rotationTransform(box, 'I'))
    expect(degrees).toBe(180)
    expect(cx).toBe(130)
    expect(cy).toBe(110)
  })
})

describe('resolveTemplate rotation handling', () => {
  function templateWith(el: Record<string, unknown>): LabelTemplate {
    const tpl = emptyTemplate()
    tpl.baseWidthDots = 406
    tpl.baseHeightDots = 203
    tpl.elements = [el as LabelTemplate['elements'][number]]
    return tpl
  }

  const target = { widthDots: 406, heightDots: 203 }

  it('passes rotation through to text payloads', () => {
    const tpl = templateWith({
      id: 't1', type: 'text', content: 'Hi', xPct: 10, yPct: 10, fontHeightPct: 10, rotation: 'R'
    })
    const [el] = resolveTemplate(tpl, {}, target)
    expect((el!.payload.options as Record<string, unknown>).rotation).toBe('R')
  })

  it('passes rotation through to QR payloads', () => {
    // Previously dropped: the canvas knew the QR was rotated but the printer didn't.
    const tpl = templateWith({
      id: 'q1', type: 'qrcode', content: 'DATA', xPct: 10, yPct: 10, magnification: 5, rotation: 'B'
    })
    const [el] = resolveTemplate(tpl, {}, target)
    expect((el!.payload.options as Record<string, unknown>).rotation).toBe('B')
  })

  it('omits rotation from payloads when unrotated', () => {
    const tpl = templateWith({
      id: 'q2', type: 'qrcode', content: 'DATA', xPct: 10, yPct: 10, magnification: 5, rotation: 'N'
    })
    const [el] = resolveTemplate(tpl, {}, target)
    expect((el!.payload.options as Record<string, unknown>).rotation).toBeUndefined()
  })

  it('bakes quarter-turn rotation into ^GB box dimensions', () => {
    // ^GB has no rotation parameter, but a rotated rectangle is the same
    // rectangle with swapped dimensions.
    const upright = templateWith({
      id: 'b1', type: 'box', xPct: 0, yPct: 0, widthPct: 50, heightPct: 10, thickness: 3, rotation: 'N'
    })
    const rotated = templateWith({
      id: 'b1', type: 'box', xPct: 0, yPct: 0, widthPct: 50, heightPct: 10, thickness: 3, rotation: 'R'
    })
    expect(resolveTemplate(upright, {}, target)[0]!.payload.zpl).toContain('^GB203,20,')
    expect(resolveTemplate(rotated, {}, target)[0]!.payload.zpl).toContain('^GB20,203,')
  })

  it('sizes a CODE128 barcode from its data, matching measured output', () => {
    // Verified against a Labelary render: '12345678' at ^BY2 measures 246 dots.
    // The old flat "50% of label width" ignored the data, and because a quarter
    // turn swaps width and height that error surfaced as a wrong height.
    const tpl = templateWith({
      id: 'c1', type: 'barcode', content: '12345678', xPct: 15, yPct: 15,
      barcodeType: 'CODE128', heightPct: 20, narrowBarWidth: 2
    })
    const [el] = resolveTemplate(tpl, {}, target)
    expect(el!.w).toBe(246)
  })

  it('scales barcode width with the narrow bar width', () => {
    const wide = templateWith({
      id: 'c2', type: 'barcode', content: '12345678', xPct: 0, yPct: 0,
      barcodeType: 'CODE128', heightPct: 20, narrowBarWidth: 4
    })
    expect(resolveTemplate(wide, {}, target)[0]!.w).toBe(492)
  })

  it('treats 2D symbologies as square', () => {
    const tpl = templateWith({
      id: 'c3', type: 'barcode', content: 'ANYTHING-AT-ALL', xPct: 0, yPct: 0,
      barcodeType: 'DATAMATRIX', heightPct: 20
    })
    const [el] = resolveTemplate(tpl, {}, target)
    expect(el!.w).toBe(el!.h)
  })

  it('ignores data length for fixed-width symbologies', () => {
    // EAN13 is always 95 modules regardless of what you feed it.
    expect(estimateBarcodeWidth('123456789012', 'EAN13', 2)).toBe(190)
    expect(estimateBarcodeWidth('1', 'EAN13', 2)).toBe(190)
  })

  it('identifies 2D symbologies', () => {
    expect(is2dSymbology('QRCODE')).toBe(true)
    expect(is2dSymbology('DATAMATRIX')).toBe(true)
    expect(is2dSymbology('CODE128')).toBe(false)
  })

  it('reports a rotated footprint with swapped dimensions', () => {
    const tpl = templateWith({
      id: 'q3', type: 'barcode', content: '12345', xPct: 0, yPct: 0,
      barcodeType: 'CODE128', heightPct: 40, rotation: 'R'
    })
    const [el] = resolveTemplate(tpl, {}, target)
    expect(el!.bounds.w).toBe(el!.h)
    expect(el!.bounds.h).toBe(el!.w)
  })

  it('anchors centred text along the flow axis, which rotation changes', () => {
    // Unrotated text flows across the label, so centring moves it on X.
    const flat = templateWith({
      id: 'x1', type: 'text', content: 'ABCDEFGH', xPct: 50, yPct: 50,
      fontHeightPct: 10, ratio: 0.6, align: 'center', rotation: 'N'
    })
    const [flatEl] = resolveTemplate(flat, {}, target)
    expect(flatEl!.x).toBeLessThan(203)
    expect(flatEl!.y).toBe(102) // Y untouched

    // Rotated 90° the text flows *down*, so centring has to move it on Y
    // instead — shifting X would slide it sideways off its anchor.
    const turned = templateWith({
      id: 'x1', type: 'text', content: 'ABCDEFGH', xPct: 50, yPct: 50,
      fontHeightPct: 10, ratio: 0.6, align: 'center', rotation: 'R'
    })
    const [turnedEl] = resolveTemplate(turned, {}, target)
    expect(turnedEl!.x).toBe(203) // X untouched
    expect(turnedEl!.y).toBeLessThan(102)
  })

  it('never places an anchored element at a negative coordinate', () => {
    const tpl = templateWith({
      id: 'x2', type: 'text', content: 'A VERY LONG STRING OF TEXT', xPct: 1, yPct: 1,
      fontHeightPct: 10, align: 'right', rotation: 'R'
    })
    const [el] = resolveTemplate(tpl, {}, target)
    expect(el!.x).toBeGreaterThanOrEqual(0)
    expect(el!.y).toBeGreaterThanOrEqual(0)
  })
})
