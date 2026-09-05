/**
 * Server-side template rendering.
 *
 * The engine itself is covered by test/unit/{template-text,rotation-geometry,
 * template-presets}.test.ts. This covers what only matters once the *server*
 * resolves a template: that substitution happens and samples don't, that `quantity`
 * reaches the ZPL on the queued path as well as the immediate one, and that a
 * template resolves against the printer's stock rather than its own base size.
 */

import { describe, it, expect, beforeEach } from 'vitest'
// A dedicated database file, like every other suite in test/db — see the note in
// template-short-name.test.ts. Sharing one would both race that suite under
// Vitest's parallel file execution and delete the real development database's
// saved templates.
process.env.ZEBRA_DB_PATH = '/tmp/zebra-test-print-render.db'
import { getDb } from '../../src/db/database'
import { labelTemplates } from '../../src/db/schema'
import { createTemplate } from '../../src/db/template-repo'
import { presetTemplate, listPresetTemplates } from '../../src/db/template-presets'
import { resolveTemplate, toPrintElements, usedVariables } from '../../src/template-engine'
import type { LabelTemplate } from '../../src/template-engine'
import { ZPLBuilder } from '../../src/zpl'
import type { TemplateDefinition } from '../../src/schemas'

const SIZE_2X1 = { widthDots: 406, heightDots: 203 }
const SIZE_3X5 = { widthDots: 609, heightDots: 1015 }

/** Render a template the way the webhook handler does. */
function renderZpl(
  tpl: LabelTemplate,
  values: Record<string, string>,
  size: { widthDots: number; heightDots: number },
  copies = 1
): string {
  const elements = toPrintElements(
    // useSamples: false is the handler's setting, and the reason a missing
    // variable prints blank rather than printing the sample.
    resolveTemplate(tpl, values, size, { useSamples: false })
  )
  const builder = new ZPLBuilder({ width: size.widthDots, height: size.heightDots, copies })
  builder.labelSize(size.widthDots, size.heightDots)
  for (const el of elements) {
    builder.element(el as Parameters<ZPLBuilder['element']>[0])
  }
  return builder.build()
}

/** A small template with one text field and one QR. */
function simpleTemplate(): LabelTemplate {
  return {
    name: 'Simple',
    baseWidthDots: SIZE_2X1.widthDots,
    baseHeightDots: SIZE_2X1.heightDots,
    variables: [
      { name: 'partNumber', label: 'Part number', sample: 'SAMPLE-999' },
      { name: 'unused', label: 'Unused', sample: 'never-referenced' }
    ],
    elements: [
      {
        id: 'text', type: 'text', content: 'PN {{partNumber}}',
        xPct: 10, yPct: 20, fontHeightPct: 15, ratio: 0.6, font: '0', rotation: 'N'
      },
      {
        id: 'qr', type: 'qrcode', content: '{{partNumber}}',
        xPct: 60, yPct: 20, magnification: 4, errorCorrection: 'M', rotation: 'N'
      }
    ],
    overrides: {}
  }
}

beforeEach(() => {
  getDb().delete(labelTemplates).run()
})

describe('variable substitution', () => {
  it('puts the supplied value on the label', () => {
    const zpl = renderZpl(simpleTemplate(), { partNumber: '135853-002' }, SIZE_2X1)
    expect(zpl).toContain('PN 135853-002')
    expect(zpl).toContain('MA,135853-002')
  })

  it('never substitutes a sample value on a print', () => {
    // The designer falls back to samples so an unfilled template still previews.
    // Doing that here would put "SAMPLE-999" on real stock — a label that looks
    // right and is wrong, which is worse than a visible gap.
    const zpl = renderZpl(simpleTemplate(), {}, SIZE_2X1)
    expect(zpl).not.toContain('SAMPLE-999')
    expect(zpl).toContain('PN ^FS')
  })

  it('treats an explicit empty string as a blank, not as missing', () => {
    const zpl = renderZpl(simpleTemplate(), { partNumber: '' }, SIZE_2X1)
    expect(zpl).not.toContain('SAMPLE-999')
  })

  it('leaves an unreferenced variable out of the required set', () => {
    // `unused` is declared but never appears in an element, so a caller must not be
    // forced to supply it.
    expect(usedVariables(simpleTemplate())).toEqual(['partNumber'])
  })

  it('escapes ZPL control characters in a supplied value', () => {
    // A value containing ^ or ~ would otherwise terminate the field and be
    // interpreted as commands.
    const zpl = renderZpl(simpleTemplate(), { partNumber: 'A^XZB~JCc' }, SIZE_2X1)
    expect(zpl).not.toContain('A^XZB')
    expect(zpl).toContain('^XZ') // the label's own terminator is still there
    expect(zpl.trimEnd().endsWith('^XZ')).toBe(true)
  })
})

describe('quantity', () => {
  it('emits ^PQ for more than one copy', () => {
    expect(renderZpl(simpleTemplate(), { partNumber: 'X' }, SIZE_2X1, 5)).toContain('^PQ5')
  })

  it('emits no ^PQ for a single copy', () => {
    expect(renderZpl(simpleTemplate(), { partNumber: 'X' }, SIZE_2X1, 1)).not.toContain('^PQ')
  })
})

describe('rebuilding a queued template job', () => {
  /**
   * Reproduces PrintQueue.rebuildZpl()'s 'label' branch. If it drops something, a
   * job that queued because the printer was offline prints differently from one
   * that went out immediately — and only the offline path is affected, which is
   * what hid the copies bug below.
   */
  function rebuild(data: Record<string, unknown>, size: typeof SIZE_2X1): string {
    const copies = typeof data.copies === 'number' ? data.copies : 1
    const builder = new ZPLBuilder({ width: size.widthDots, height: size.heightDots, copies })
    builder.labelSize(size.widthDots, size.heightDots)
    for (const el of data.elements as Array<Record<string, unknown>>) {
      builder.element(el as Parameters<ZPLBuilder['element']>[0])
    }
    return builder.build()
  }

  it('preserves the copy count — regression, this used to silently print one', () => {
    // The rebuild built ZPLBuilder without `copies`, so a queued request for 50
    // came back as 1. Only ever bit an offline printer, which is when nobody looks.
    const elements = toPrintElements(
      resolveTemplate(simpleTemplate(), { partNumber: 'X' }, SIZE_2X1, { useSamples: false })
    )
    const rebuilt = rebuild({ elements, copies: 50 }, SIZE_2X1)
    expect(rebuilt).toContain('^PQ50')
  })

  it('produces the same ZPL as the immediate path', () => {
    const values = { partNumber: '135853-002' }
    const immediate = renderZpl(simpleTemplate(), values, SIZE_2X1, 3)
    const elements = toPrintElements(
      resolveTemplate(simpleTemplate(), values, SIZE_2X1, { useSamples: false })
    )
    expect(rebuild({ elements, copies: 3 }, SIZE_2X1)).toBe(immediate)
  })

  it('defaults to one copy when the stored job has none', () => {
    // Jobs recorded before `copies` was carried through must still rebuild.
    const elements = toPrintElements(
      resolveTemplate(simpleTemplate(), { partNumber: 'X' }, SIZE_2X1, { useSamples: false })
    )
    expect(rebuild({ elements }, SIZE_2X1)).not.toContain('^PQ')
  })
})

describe('rendering at the printer\'s stock rather than the template\'s base size', () => {
  it('scales a design onto a different label size', () => {
    const tpl = simpleTemplate()
    const small = renderZpl(tpl, { partNumber: 'X' }, SIZE_2X1)
    const large = renderZpl(tpl, { partNumber: 'X' }, SIZE_3X5)

    expect(small).toContain(`^PW${SIZE_2X1.widthDots}`)
    expect(large).toContain(`^PW${SIZE_3X5.widthDots}`)
    // Positions are percentages, so they land at different absolute dots.
    expect(small).not.toBe(large)
  })

  it('applies a per-size override when the template has one', () => {
    const tpl = simpleTemplate()
    tpl.overrides = { '609x1015': { text: { content: 'OVERRIDDEN {{partNumber}}' } } }

    expect(renderZpl(tpl, { partNumber: 'X' }, SIZE_3X5)).toContain('OVERRIDDEN X')
    // The base size is unaffected.
    expect(renderZpl(tpl, { partNumber: 'X' }, SIZE_2X1)).toContain('PN X')
  })

  it('skips a hidden element', () => {
    const tpl = simpleTemplate()
    tpl.elements[0]!.hidden = true
    expect(renderZpl(tpl, { partNumber: 'X' }, SIZE_2X1)).not.toContain('PN X')
  })
})

describe('every preset renders through the server path', () => {
  it('produces a complete label for each preset', () => {
    // A preset that throws or emits nothing would be a webhook returning 400 on a
    // slug the docs advertise.
    for (const preset of listPresetTemplates()) {
      const values = Object.fromEntries(preset.variables.map(v => [v.name, `v-${v.name}`]))
      const zpl = renderZpl(
        preset as unknown as LabelTemplate,
        values,
        { widthDots: preset.baseWidthDots, heightDots: preset.baseHeightDots }
      )
      expect(zpl.startsWith('^XA'), `${preset.shortName} should open a label`).toBe(true)
      expect(zpl.trimEnd().endsWith('^XZ'), `${preset.shortName} should close a label`).toBe(true)
      for (const variable of preset.variables) {
        if (!usedVariables(preset as unknown as LabelTemplate).includes(variable.name)) continue
        expect(zpl, `${preset.shortName} should render ${variable.name}`)
          .toContain(`v-${variable.name}`)
      }
    }
  })
})

describe('a user template resolved from the database', () => {
  it('renders after a round-trip through storage', () => {
    // Catches a definition that survives Zod but not JSON, or vice versa.
    const stored = createTemplate(simpleTemplate() as unknown as TemplateDefinition)
    const zpl = renderZpl(stored as unknown as LabelTemplate, { partNumber: 'ROUND-TRIP' }, SIZE_2X1)
    expect(zpl).toContain('PN ROUND-TRIP')
  })

  it('renders a preset fetched by id the same as one built directly', () => {
    const built = listPresetTemplates()[0]!
    const fetched = presetTemplate(built.id)!
    const values = Object.fromEntries(built.variables.map(v => [v.name, 'x']))
    const size = { widthDots: built.baseWidthDots, heightDots: built.baseHeightDots }
    expect(renderZpl(fetched as unknown as LabelTemplate, values, size))
      .toBe(renderZpl(built as unknown as LabelTemplate, values, size))
  })
})
