/**
 * Tests for how resolveTemplate() sizes and positions text.
 *
 * The designer's canvas geometry comes from here, so these cover the parts that
 * used to be guesswork: the width of a text run, where alignment anchors it, and
 * whether a blank variable quietly inherits the designer's sample value.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveTemplate,
  substitute,
  emptyTemplate,
  type LabelTemplate,
  type TemplateElement
} from '../../web/app/composables/useTemplateEngine'
import { measureZplText } from '../../web/app/composables/useZplFonts'

const target = { widthDots: 406, heightDots: 203 }

function templateWith(el: Record<string, unknown>, patch: Partial<LabelTemplate> = {}): LabelTemplate {
  const tpl = emptyTemplate()
  tpl.baseWidthDots = 406
  tpl.baseHeightDots = 203
  tpl.elements = [el as TemplateElement]
  return { ...tpl, ...patch }
}

/** Base fields shared by the text elements under test. */
function textEl(extra: Record<string, unknown> = {}) {
  return {
    id: 't1',
    type: 'text',
    content: 'HELLO',
    xPct: 0,
    yPct: 0,
    fontHeightPct: 20, // 20% of 203 = 41 dots
    ratio: 0.6,
    font: '0',
    ...extra
  }
}

describe('resolveTemplate text width', () => {
  it('measures the actual glyphs rather than counting characters', () => {
    // Same length, very different widths. The old estimate multiplied character
    // count by a nominal cell and reported these as identical.
    const narrow = resolveTemplate(templateWith(textEl({ content: 'iiiiiiii' })), {}, target)[0]!
    const wide = resolveTemplate(templateWith(textEl({ content: 'WWWWWWWW' })), {}, target)[0]!
    expect(wide.w).toBeGreaterThan(narrow.w * 3)
  })

  it('widens text when the aspect ratio grows', () => {
    // The Aspect ratio control previously moved only the selection outline.
    const thin = resolveTemplate(templateWith(textEl({ ratio: 0.3 })), {}, target)[0]!
    const fat = resolveTemplate(templateWith(textEl({ ratio: 1.2 })), {}, target)[0]!
    expect(fat.w).toBeGreaterThan(thin.w * 3)
    // Height is unaffected — ratio only scales the character width.
    expect(fat.h).toBe(thin.h)
  })

  it('keeps rotated text anchored to the cell so ink lands where ZPL puts it', () => {
    // ^FO is the top-left of the *rotated cell*. Measuring ^A0R fields shows the
    // cap ink inset from that corner by cell height minus cap height, so the cell
    // is what has to rotate. Boxing the ink instead slides rotated text sideways.
    const flat = resolveTemplate(templateWith(textEl({ rotation: 'N' })), {}, target)[0]!
    const turned = resolveTemplate(templateWith(textEl({ rotation: 'R' })), {}, target)[0]!
    expect(turned.bounds.w).toBe(flat.bounds.h)
    expect(turned.bounds.h).toBe(flat.bounds.w)
    expect(turned.bounds.x).toBe(flat.bounds.x)
    expect(turned.bounds.y).toBe(flat.bounds.y)
  })

  it('changes width when the font changes', () => {
    // Font selection previously had no effect on the canvas at all.
    const proportional = resolveTemplate(templateWith(textEl({ font: '0' })), {}, target)[0]!
    const bitmap = resolveTemplate(templateWith(textEl({ font: 'G' })), {}, target)[0]!
    expect(bitmap.w).not.toBe(proportional.w)
  })

  it('boxes the character cell, not the ink', () => {
    // fontHeightPct 20 of 203 dots is a 41-dot ^A height. The box is the cell
    // ZPL reserves, because that is what ^FO anchors — measuring a rotated field
    // shows the cap ink offset within it by exactly cell minus cap.
    const el = resolveTemplate(templateWith(textEl()), {}, target)[0]!
    expect(el.h).toBe(41)
    expect(el.textMetrics!.capHeight).toBeCloseTo(41 * 0.75, 6)
  })

  it('uses a bitmap font\'s real cell, which need not be the requested height', () => {
    // Font C has an 18-dot cell, so a 41-dot request renders at 2× — a 36-dot
    // cell. Confirmed by measuring where ink lands on a rotated field.
    const el = resolveTemplate(templateWith(textEl({ font: 'C' })), {}, target)[0]!
    expect(el.h).toBe(36)
    expect(el.payload.options!.height).toBe(41)
  })

  it('still sends the ^A height parameter to the printer', () => {
    // The payload must carry the ZPL parameter even though the canvas box uses
    // the ink height, or changing the preview would change printed output.
    const el = resolveTemplate(templateWith(textEl()), {}, target)[0]!
    const options = el.payload.options!
    expect(options.height).toBe(41)
    expect(options.ratio).toBe(0.6)
  })

  it('exposes metrics and font for the canvas to render with', () => {
    const el = resolveTemplate(templateWith(textEl({ font: 'C' })), {}, target)[0]!
    expect(el.font).toBe('C')
    expect(el.textMetrics).toBeDefined()
    expect(el.textMetrics!.printable).toBe('HELLO')
    expect(el.textMetrics!.heightMagnification).toBeGreaterThan(0)
  })

  it('agrees with a direct measurement of the same parameters', () => {
    const el = resolveTemplate(templateWith(textEl({ content: 'Part ABC-123' })), {}, target)[0]!
    const direct = measureZplText('Part ABC-123', {
      font: '0',
      height: 41,
      width: Math.round(41 * 0.6)
    })
    expect(el.w).toBe(Math.round(direct.width))
    expect(el.h).toBe(Math.round(direct.cellHeight))
  })

  it('never collapses to zero width for empty content', () => {
    const el = resolveTemplate(templateWith(textEl({ content: '' })), {}, target)[0]!
    expect(el.w).toBeGreaterThanOrEqual(1)
    expect(el.h).toBeGreaterThanOrEqual(1)
  })

  it('applies the designer default ratio when none is set', () => {
    const withRatio = resolveTemplate(templateWith(textEl({ ratio: 0.6 })), {}, target)[0]!
    const withoutRatio = resolveTemplate(templateWith(textEl({ ratio: undefined })), {}, target)[0]!
    // Default is 0.6, so dropping the field must not change anything — otherwise
    // saved templates would reflow.
    expect(withoutRatio.w).toBe(withRatio.w)
  })
})

describe('resolveTemplate text alignment', () => {
  it('centres on the measured width', () => {
    const el = resolveTemplate(
      templateWith(textEl({ xPct: 50, align: 'center' })), {}, target
    )[0]!
    expect(el.x).toBe(203 - Math.round(el.w / 2))
  })

  it('right-aligns on the measured width', () => {
    const el = resolveTemplate(
      templateWith(textEl({ xPct: 50, align: 'right' })), {}, target
    )[0]!
    expect(el.x).toBe(203 - el.w)
  })

  it('anchors a narrow string differently from a wide one', () => {
    // Centring used to shift by character count, so 'iiii' and 'WWWW' anchored
    // at the same place despite printing very different widths.
    const narrow = resolveTemplate(
      templateWith(textEl({ content: 'iiii', xPct: 50, align: 'center' })), {}, target
    )[0]!
    const wide = resolveTemplate(
      templateWith(textEl({ content: 'WWWW', xPct: 50, align: 'center' })), {}, target
    )[0]!
    expect(narrow.x).toBeGreaterThan(wide.x)
  })
})

describe('substitute sample fallback', () => {
  const variables = [{ name: 'part', label: 'Part', sample: 'SAMPLE-1' }]

  it('uses the sample for a blank value by default', () => {
    // The designer relies on this so an unfilled template still previews.
    expect(substitute('{{part}}', {}, variables)).toBe('SAMPLE-1')
    expect(substitute('{{part}}', { part: '' }, variables)).toBe('SAMPLE-1')
  })

  it('prefers a supplied value over the sample', () => {
    expect(substitute('{{part}}', { part: 'REAL-9' }, variables)).toBe('REAL-9')
  })

  it('leaves a blank value blank when samples are disabled', () => {
    // Printing the designer's mock part number on a real label looks correct and
    // isn't, which is worse than an obvious gap.
    expect(substitute('{{part}}', {}, variables, { useSamples: false })).toBe('')
    expect(substitute('{{part}}', { part: '' }, variables, { useSamples: false })).toBe('')
  })

  it('still substitutes real values when samples are disabled', () => {
    expect(substitute('{{part}}', { part: 'REAL-9' }, variables, { useSamples: false })).toBe('REAL-9')
  })

  it('passes the option through resolveTemplate', () => {
    const tpl = templateWith(textEl({ content: '{{part}}' }), { variables })

    const withSamples = resolveTemplate(tpl, {}, target)[0]!
    expect(withSamples.text).toBe('SAMPLE-1')

    const withoutSamples = resolveTemplate(tpl, {}, target, { useSamples: false })[0]!
    expect(withoutSamples.text).toBe('')
  })

  it('applies to barcode and QR content too', () => {
    const tpl = templateWith(
      { id: 'q1', type: 'qrcode', content: '{{part}}', xPct: 0, yPct: 0, magnification: 5 },
      { variables }
    )
    expect(resolveTemplate(tpl, {}, target)[0]!.text).toBe('SAMPLE-1')
    expect(resolveTemplate(tpl, {}, target, { useSamples: false })[0]!.text).toBe('')
  })
})
