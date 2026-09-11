/**
 * What the response tells a caller about the printer it chose.
 *
 * Both halves here came out of one piece of feedback: an integrator saw
 * `reason: "pinned-label-size"` and had to ask what it meant. The reason codes were
 * renamed to be self-describing, a `message` was added so the response explains itself,
 * and `PRINTER_STOCK_MISMATCH` was added because the case they were in — a pinned
 * `labelSize` that doesn't match the target printer's stock — produced a cropped label
 * with no warning at all.
 */

import { describe, it, expect } from 'vitest'
import {
  describeSelection,
  printerStockWarnings
} from '../../src/server/handlers/template-print-routes'
import { PRINTER_SELECTION_REASONS } from '../../src/constants'
import type { PrinterProfile } from '../../src/types'
import type { JobLabelSize } from '../../src/db/print-job-repo'

const SIZE_2X1: JobLabelSize = { widthDots: 406, heightDots: 203, dpi: 203 }
const SIZE_3X5: JobLabelSize = { widthDots: 609, heightDots: 1015, dpi: 203 }
const TPL_3X5 = { baseWidthDots: 609, baseHeightDots: 1015 }
const TPL_2X1 = { baseWidthDots: 406, baseHeightDots: 203 }

function profile(id: string, name: string, size: JobLabelSize, isDefault = false): PrinterProfile {
  return {
    id,
    name,
    connection: 'server',
    transport: 'cups',
    isDefault,
    labelSize: { ...size, widthInches: 0, heightInches: 0, name },
    dpi: size.dpi,
    tracking: 'gap'
  } as PrinterProfile
}

/** A registry stand-in exposing only what these functions read. */
function registry(profiles: PrinterProfile[]) {
  const byId = new Map(profiles.map(p => [p.id, p]))
  const fallback = profiles.find(p => p.isDefault) ?? null
  return {
    profiles: () => profiles,
    profile: (id: string) => byId.get(id) ?? null,
    defaultProfile: () => fallback,
    labelSizeFor: (id?: string | null) => {
      const p = id ? byId.get(id) : fallback
      return p ? { widthDots: p.labelSize.widthDots, heightDots: p.labelSize.heightDots, dpi: p.dpi } : null
    }
  }
}

const selection = (over: Record<string, unknown> = {}) => ({
  target: 'server' as const,
  printerId: null,
  printerName: null,
  labelSize: null,
  ...over
})

describe('describeSelection', () => {
  it('produces a distinct, non-empty message for every reason', () => {
    // Guards a missing or copy-pasted switch arm.
    const messages = PRINTER_SELECTION_REASONS.map(r => describeSelection(r, TPL_3X5, SIZE_3X5))
    for (const m of messages) expect(m.length).toBeGreaterThan(30)
    expect(new Set(messages).size).toBe(PRINTER_SELECTION_REASONS.length)
  })

  it('explains that a pinned labelSize suppressed routing, and how to undo it', () => {
    // The exact confusion that prompted this: the caller's own request disabled the
    // feature, and the message should say so rather than leaving them to guess.
    const m = describeSelection('explicit-label-size', TPL_3X5, SIZE_3X5)
    expect(m).toMatch(/not consulted|skipped/)
    expect(m).toMatch(/Omit labelSize/)
  })

  it('distinguishes a default printer that fits from one that does not', () => {
    const fits = describeSelection('default', TPL_2X1, SIZE_2X1)
    const scaled = describeSelection('default', TPL_3X5, SIZE_2X1)
    expect(fits).not.toBe(scaled)
    expect(scaled).toMatch(/scaled/)
    // The actionable part: routing needs each printer's stock registered.
    expect(scaled).toMatch(/Settings/)
    expect(fits).not.toMatch(/scaled/)
  })

  it('names both sizes when they differ, so the mismatch is legible', () => {
    const m = describeSelection('default', TPL_3X5, SIZE_2X1)
    expect(m).toContain('406×203')
    expect(m).toContain('609×1015')
  })
})

describe('printerStockWarnings', () => {
  const printers = [
    profile('p2x1', 'Bench GK420d (2x1)', SIZE_2X1, true),
    profile('p3x5', 'Traveler 3x5', SIZE_3X5)
  ]

  it('warns when a pinned labelSize does not match the target printer stock', () => {
    // Rendering 3x5 geometry onto a printer loaded with 2x1 crops the label just as
    // badly as the original bug, and nothing else in the response says so.
    const warnings = printerStockWarnings(
      registry(printers) as never,
      selection({ labelSize: { widthDots: 609, heightDots: 1015 } }),
      SIZE_3X5
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.code).toBe('PRINTER_STOCK_MISMATCH')
    expect(warnings[0]!.message).toContain('Bench GK420d (2x1)')
    expect(warnings[0]!.message).toContain('406×203')
  })

  it('stays quiet when the pinned size matches the named printer', () => {
    expect(printerStockWarnings(
      registry(printers) as never,
      selection({ printerId: 'p3x5', labelSize: { widthDots: 609, heightDots: 1015 } }),
      SIZE_3X5
    )).toEqual([])
  })

  it('stays quiet when no labelSize was pinned', () => {
    // Without a pin the geometry comes from the printer, so the two agree by construction
    // and this check has nothing to add.
    expect(printerStockWarnings(registry(printers) as never, selection(), SIZE_2X1)).toEqual([])
  })

  it('stays quiet for a browser-owned printer, whose stock the server cannot see', () => {
    expect(printerStockWarnings(
      registry(printers) as never,
      selection({ printerId: 'local_abc', labelSize: { widthDots: 609, heightDots: 1015 } }),
      SIZE_3X5
    )).toEqual([])
    expect(printerStockWarnings(
      registry(printers) as never,
      selection({ target: 'local', labelSize: { widthDots: 609, heightDots: 1015 } }),
      SIZE_3X5
    )).toEqual([])
  })

  it('stays quiet without a registry', () => {
    expect(printerStockWarnings(
      null,
      selection({ labelSize: { widthDots: 609, heightDots: 1015 } }),
      SIZE_3X5
    )).toEqual([])
  })

  it('stays quiet when nothing is configured to compare against', () => {
    expect(printerStockWarnings(
      registry([]) as never,
      selection({ labelSize: { widthDots: 609, heightDots: 1015 } }),
      SIZE_3X5
    )).toEqual([])
  })
})
