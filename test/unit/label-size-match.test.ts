/**
 * Tests for label-size matching between a print job and configured printers.
 *
 * This is what decides whether the print page warns about a mismatch and which
 * printer it offers instead — a wrong answer either nags people printing on the
 * right stock, or lets a 3×5 label print silently cropped on a 2×1 printer.
 */
import { describe, it, expect } from 'vitest'
import { sameLabelSize, findPrinterForSize } from '../../web/app/utils/label-size-match'

const SIZE_2X1 = { widthDots: 406, heightDots: 203 }
const SIZE_3X5 = { widthDots: 609, heightDots: 1015 }

interface TestPrinter {
  id: string
  ready: boolean
  connection: 'server' | 'local'
  isDefault: boolean
  labelSize: { widthDots: number; heightDots: number }
}

function printer(overrides: Partial<TestPrinter> & { id: string }): TestPrinter {
  return {
    ready: true,
    connection: 'server',
    isDefault: false,
    labelSize: { ...SIZE_2X1 },
    ...overrides
  }
}

describe('sameLabelSize', () => {
  it('matches identical dot dimensions', () => {
    expect(sameLabelSize(SIZE_2X1, { widthDots: 406, heightDots: 203 })).toBe(true)
  })

  it('rejects different sizes', () => {
    expect(sameLabelSize(SIZE_2X1, SIZE_3X5)).toBe(false)
  })

  it('rejects a rotated size — the elements are laid out for one orientation', () => {
    expect(sameLabelSize(SIZE_2X1, { widthDots: 203, heightDots: 406 })).toBe(false)
  })

  it('compares dots, so the same paper at a different DPI does not match', () => {
    // 2×1" at 300 DPI is 600×300 dots; element coordinates resolved for 203 DPI
    // would land in the wrong places.
    expect(sameLabelSize(SIZE_2X1, { widthDots: 600, heightDots: 300 })).toBe(false)
  })
})

describe('findPrinterForSize', () => {
  it('finds the printer configured with the wanted size', () => {
    const list = [
      printer({ id: 'a', labelSize: SIZE_2X1 }),
      printer({ id: 'b', labelSize: SIZE_3X5 })
    ]
    expect(findPrinterForSize(list, SIZE_3X5)?.id).toBe('b')
  })

  it('returns null when nothing matches', () => {
    const list = [printer({ id: 'a', labelSize: SIZE_2X1 })]
    expect(findPrinterForSize(list, SIZE_3X5)).toBeNull()
  })

  it('never offers a printer that is not ready', () => {
    // Offering an unplugged printer would swap one failed print for another.
    const list = [printer({ id: 'a', labelSize: SIZE_3X5, ready: false })]
    expect(findPrinterForSize(list, SIZE_3X5)).toBeNull()
  })

  it('excludes the printer the job was already going to', () => {
    // The caller asks because the selected printer mismatched; offering it back
    // would be nonsense even if its config raced to the right size.
    const list = [printer({ id: 'selected', labelSize: SIZE_3X5 })]
    expect(findPrinterForSize(list, SIZE_3X5, 'selected')).toBeNull()
  })

  it('prefers the server default over other server printers', () => {
    const list = [
      printer({ id: 'other', labelSize: SIZE_3X5 }),
      printer({ id: 'default', labelSize: SIZE_3X5, isDefault: true })
    ]
    expect(findPrinterForSize(list, SIZE_3X5)?.id).toBe('default')
  })

  it('prefers a server printer over a browser-paired one', () => {
    // The shared printer is the one most likely to be loaded with what its
    // configuration claims.
    const list = [
      printer({ id: 'usb', labelSize: SIZE_3X5, connection: 'local' }),
      printer({ id: 'srv', labelSize: SIZE_3X5 })
    ]
    expect(findPrinterForSize(list, SIZE_3X5)?.id).toBe('srv')
  })

  it('falls back to a ready local printer when no server printer matches', () => {
    const list = [
      printer({ id: 'srv-wrong-size', labelSize: SIZE_2X1 }),
      printer({ id: 'usb', labelSize: SIZE_3X5, connection: 'local' })
    ]
    expect(findPrinterForSize(list, SIZE_3X5)?.id).toBe('usb')
  })

  it('handles an empty printer list', () => {
    expect(findPrinterForSize([], SIZE_3X5)).toBeNull()
  })
})
