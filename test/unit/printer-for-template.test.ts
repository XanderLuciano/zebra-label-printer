/**
 * Auto-routing a template to a printer loaded with the stock it was designed for.
 *
 * The bug this exists to prevent: a 3×5 template sent with no `printerId` went to the
 * default printer, which held 2×1 stock, and the layout scaled down into an unreadable
 * cropped label. Nothing failed, so nothing surfaced it until the label came out.
 *
 * `null` means "leave the default alone", which is the answer in more cases than not.
 */

import { describe, it, expect } from 'vitest'
import { printerForTemplate } from '../../src/server/handlers/template-print-routes'
import type { PrinterProfile } from '../../src/types'

const SIZE_2X1 = { widthDots: 406, heightDots: 203 }
const SIZE_3X5 = { widthDots: 609, heightDots: 1015 }
const SIZE_4X6 = { widthDots: 812, heightDots: 1218 }

function printer(
  id: string,
  size: { widthDots: number; heightDots: number },
  isDefault = false,
  connection: 'server' | 'local' = 'server'
): PrinterProfile {
  return {
    id,
    name: id,
    connection,
    transport: 'cups',
    isDefault,
    labelSize: { ...size, widthInches: 0, heightInches: 0, name: id },
    dpi: 203,
    tracking: 'gap'
  } as PrinterProfile
}

/** A registry stand-in exposing only what the function reads. */
function registry(profiles: PrinterProfile[]) {
  return {
    profiles: () => profiles,
    defaultProfile: () => profiles.find(p => p.isDefault) ?? null
  }
}

function template(
  size: { widthDots: number; heightDots: number },
  overrides: Record<string, unknown> = {}
) {
  return {
    baseWidthDots: size.widthDots,
    baseHeightDots: size.heightDots,
    overrides: overrides as never
  }
}

describe('printerForTemplate', () => {
  it('routes to the printer holding the stock the template was designed for', () => {
    // The reported bug, in one assertion.
    const printers = [printer('p2x1', SIZE_2X1, true), printer('p3x5', SIZE_3X5)]
    expect(printerForTemplate(registry(printers), template(SIZE_3X5))?.id).toBe('p3x5')
  })

  it('leaves the default alone when it already holds the right stock', () => {
    const printers = [printer('p2x1', SIZE_2X1, true), printer('p3x5', SIZE_3X5)]
    expect(printerForTemplate(registry(printers), template(SIZE_2X1))).toBeNull()
  })

  it('leaves the default alone when it is itself the only match', () => {
    // Switching to the printer already selected would be a no-op reported as a change.
    const printers = [printer('p3x5', SIZE_3X5, true)]
    expect(printerForTemplate(registry(printers), template(SIZE_3X5))).toBeNull()
  })

  it('leaves the default alone when no printer holds the right stock', () => {
    // The caller gets the default plus a LABEL_SIZE_MISMATCH warning rather than a
    // failure — refusing to print at all would be worse than printing scaled.
    const printers = [printer('p2x1', SIZE_2X1, true), printer('p4x6', SIZE_4X6)]
    expect(printerForTemplate(registry(printers), template(SIZE_3X5))).toBeNull()
  })

  it('leaves the default alone when the template has an override for its stock', () => {
    // An override means the author laid this template out for that size deliberately,
    // so scaling is intended and rerouting would override their decision.
    const printers = [printer('p2x1', SIZE_2X1, true), printer('p3x5', SIZE_3X5)]
    const tpl = template(SIZE_3X5, { '406x203': { someElement: { xPct: 10 } } })
    expect(printerForTemplate(registry(printers), tpl)).toBeNull()
  })

  it('still routes when the override is for some other unrelated size', () => {
    const printers = [printer('p2x1', SIZE_2X1, true), printer('p3x5', SIZE_3X5)]
    const tpl = template(SIZE_3X5, { '812x1218': { someElement: { xPct: 10 } } })
    expect(printerForTemplate(registry(printers), tpl)?.id).toBe('p3x5')
  })

  it('returns null without a registry', () => {
    expect(printerForTemplate(null, template(SIZE_3X5))).toBeNull()
  })

  it('returns null when nothing is configured', () => {
    expect(printerForTemplate(registry([]), template(SIZE_3X5))).toBeNull()
  })

  it('routes even when no printer is marked default', () => {
    const printers = [printer('p2x1', SIZE_2X1), printer('p3x5', SIZE_3X5)]
    expect(printerForTemplate(registry(printers), template(SIZE_3X5))?.id).toBe('p3x5')
  })

  it('prefers the default among several printers holding the right stock', () => {
    const printers = [
      printer('other', SIZE_3X5),
      printer('wrong', SIZE_2X1),
      printer('preferred', SIZE_3X5, true)
    ]
    // The default already matches, so nothing to change.
    expect(printerForTemplate(registry(printers), template(SIZE_3X5))).toBeNull()
  })

  it('picks a deterministic winner when several non-default printers match', () => {
    const printers = [
      printer('def', SIZE_2X1, true),
      printer('first', SIZE_3X5),
      printer('second', SIZE_3X5)
    ]
    const chosen = printerForTemplate(registry(printers), template(SIZE_3X5))?.id
    expect(chosen).toBe('first')
    // Same answer on a repeat call — no ordering surprises between requests.
    expect(printerForTemplate(registry(printers), template(SIZE_3X5))?.id).toBe(chosen)
  })
})
