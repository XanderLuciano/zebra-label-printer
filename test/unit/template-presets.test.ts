/**
 * Tests for the built-in template presets.
 *
 * These are the first thing a new install sees, so a broken one is worse than
 * none. Each is checked against the same schema the API enforces, then resolved
 * with its own sample data and verified to actually fit the label — which is the
 * check that catches a layout edit that pushes text off the edge.
 *
 * Every expected position here was confirmed by rendering the templates through
 * Labelary; the numbers in this file are the offline consequences of that.
 */
import { describe, it, expect } from 'vitest'
import { TEMPLATE_PRESETS } from '../../src/db/template-presets'
import { templateSchema } from '../../src/schemas'
import { ZPLBuilder } from '../../src/zpl'
import {
  resolveTemplate,
  toPrintElements,
  usedVariables,
  type LabelTemplate
} from '../../web/app/composables/useTemplateEngine'

/** Resolve a preset with every variable set to its sample value. */
function resolveWithSamples(build: () => ReturnType<typeof TEMPLATE_PRESETS[number]['build']>) {
  const def = build()
  const values: Record<string, string> = {}
  for (const v of def.variables) values[v.name] = v.sample ?? ''
  const resolved = resolveTemplate(
    { ...def, overrides: {} } as unknown as LabelTemplate,
    values,
    { widthDots: def.baseWidthDots, heightDots: def.baseHeightDots }
  )
  return { def, resolved }
}

describe('template presets', () => {
  it('ships the expected set, one pair per label size', () => {
    expect(TEMPLATE_PRESETS.map(t => t.id)).toEqual([
      'tpl_builtin_part_2x1',
      'tpl_builtin_bag_2x1',
      'tpl_builtin_part_3x5_landscape',
      'tpl_builtin_asset_3x5_landscape'
    ])
  })

  it('uses stable ids marked as presets', () => {
    // Ids are referenced by saved selections and by the migration off the old
    // seeded rows, so they must not drift.
    for (const { id } of TEMPLATE_PRESETS) {
      expect(id).toMatch(/^tpl_builtin_[a-z0-9_]+$/)
    }
  })

  for (const { id, build } of TEMPLATE_PRESETS) {
    describe(id, () => {
      it('satisfies the API template schema', () => {
        const result = templateSchema.safeParse(build())
        expect(result.success ? [] : result.error.issues).toEqual([])
      })

      it('has unique element ids', () => {
        // Element ids key the per-size overrides map, so duplicates silently
        // merge two elements' overrides.
        const ids = build().elements.map(e => (e as { id: string }).id)
        expect(new Set(ids).size).toBe(ids.length)
      })

      it('declares every variable it references', () => {
        const def = build()
        const declared = new Set(def.variables.map(v => v.name))
        const undeclared = usedVariables({ ...def, overrides: {} } as unknown as LabelTemplate)
          .filter(name => !declared.has(name))
        expect(undeclared).toEqual([])
      })

      it('gives every variable a sample so the preview is meaningful', () => {
        for (const v of build().variables) {
          expect(v.sample, v.name).toBeTruthy()
        }
      })

      it('stays ASCII — the built-in fonts have no UTF-8', () => {
        const def = build()
        const strings = [
          def.name,
          def.description ?? '',
          ...def.variables.flatMap(v => [v.label ?? '', v.sample ?? '']),
          ...def.elements.map(e => (e as { content?: string }).content ?? '')
        ]
        for (const s of strings) {
          expect(s, JSON.stringify(s)).toMatch(/^[\x20-\x7E]*$/)
        }
      })

      it('fits inside the label with sample data', () => {
        const { def, resolved } = resolveWithSamples(build)
        const outside = resolved
          .filter(el =>
            el.bounds.x < 0
            || el.bounds.y < 0
            || el.bounds.x + el.bounds.w > def.baseWidthDots
            || el.bounds.y + el.bounds.h > def.baseHeightDots
          )
          .map(el => `${el.id} at ${el.bounds.x},${el.bounds.y} ${el.bounds.w}x${el.bounds.h}`)
        expect(outside).toEqual([])
      })

      it('builds printable ZPL', () => {
        const { def, resolved } = resolveWithSamples(build)
        const b = new ZPLBuilder({ width: def.baseWidthDots, height: def.baseHeightDots })
        b.labelSize(def.baseWidthDots, def.baseHeightDots)
        for (const el of toPrintElements(resolved)) {
          b.element(el as Parameters<ZPLBuilder['element']>[0])
        }
        const zpl = b.build()
        expect(zpl.startsWith('^XA')).toBe(true)
        expect(zpl.endsWith('^XZ')).toBe(true)
        expect(resolved.length).toBe(def.elements.length)
      })
    })
  }
})

describe('landscape 3x5 templates', () => {
  const landscape = TEMPLATE_PRESETS.filter(t => t.id.endsWith('_landscape'))

  it('rotates the text so the label reads sideways', () => {
    for (const { id, build } of landscape) {
      const def = build()
      const text = def.elements.filter(e => e.type === 'text')
      expect(text.length, id).toBeGreaterThan(0)
      for (const el of text) {
        expect((el as { rotation?: string }).rotation, `${id} ${(el as { id: string }).id}`).toBe('R')
      }
    }
  })

  it('leaves rules unrotated, since ^GB has no rotation parameter', () => {
    // A quarter turn gets baked into swapped ^GB dimensions, and a full-width
    // landscape rule expressed that way would exceed the schema's 150% widthPct
    // ceiling. Thin-in-x and long-in-y already reads as a horizontal rule.
    for (const { id, build } of landscape) {
      for (const el of build().elements.filter(e => e.type === 'box')) {
        const box = el as { id: string; rotation?: string; widthPct: number; heightPct: number }
        expect(box.rotation, `${id} ${box.id}`).toBe('N')
        expect(box.heightPct, `${id} ${box.id} runs along the feed axis`).toBeGreaterThan(box.widthPct)
      }
    }
  })

  it('stacks lines down the landscape view, which is decreasing label x', () => {
    // The mapping is label x = W - viewerTop - cellHeight, so a line further down
    // the page has a *smaller* xPct. Getting that sign wrong still looks plausible
    // on screen, so it is pinned here.
    const def = TEMPLATE_PRESETS.find(t => t.id === 'tpl_builtin_part_3x5_landscape')!.build()
    const byId = new Map(def.elements.map(e => [(e as { id: string }).id, e as { xPct: number }]))
    const topToBottom = ['name', 'number', 'rev', 'serial', 'ticket', 'notes', 'barcode']
    for (let i = 1; i < topToBottom.length; i++) {
      const above = byId.get(topToBottom[i - 1]!)!
      const below = byId.get(topToBottom[i]!)!
      expect(below.xPct, `${topToBottom[i]} sits below ${topToBottom[i - 1]}`).toBeLessThan(above.xPct)
    }
  })

  it('keeps every element within the printable width when turned', () => {
    // The landscape view is 1015 x 609; nothing may exceed the 609 short edge.
    for (const { id, build } of landscape) {
      const { def, resolved } = resolveWithSamples(build)
      for (const el of resolved) {
        expect(el.bounds.x + el.bounds.w, `${id} ${el.id}`).toBeLessThanOrEqual(def.baseWidthDots)
      }
    }
  })
})
