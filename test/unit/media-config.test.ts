/**
 * Tests for printer media configuration and calibration ZPL.
 *
 * These commands are what make a label-size change take effect on the hardware.
 * The ^MN parameter letters are easy to invert (N means *continuous*, not
 * non-continuous), so the mapping is pinned down explicitly here.
 */
import { describe, it, expect } from 'vitest'
import { mediaConfigZpl, calibrationZpl, MEDIA_TRACKING_CODES, ZPLBuilder } from '../../src/zpl'
import { MEDIA_TRACKINGS, MAX_LABEL_LENGTH_DOTS } from '../../src/constants'

describe('MEDIA_TRACKING_CODES', () => {
  it('maps every tracking mode to a ^MN parameter', () => {
    for (const mode of MEDIA_TRACKINGS) {
      expect(MEDIA_TRACKING_CODES[mode]).toMatch(/^[A-Z]$/)
    }
  })

  it('maps continuous to N and gap to Y, per the ZPL ^MN reference', () => {
    // Getting these backwards makes the printer stop looking for gaps and feed
    // blank labels, so assert the exact letters rather than just "some letter".
    expect(MEDIA_TRACKING_CODES.continuous).toBe('N')
    expect(MEDIA_TRACKING_CODES.gap).toBe('Y')
    expect(MEDIA_TRACKING_CODES.mark).toBe('M')
    expect(MEDIA_TRACKING_CODES.auto).toBe('A')
  })
})

describe('mediaConfigZpl', () => {
  it('emits a complete format block', () => {
    const zpl = mediaConfigZpl({ widthDots: 406, heightDots: 203 })
    expect(zpl.startsWith('^XA')).toBe(true)
    expect(zpl.endsWith('^XZ')).toBe(true)
  })

  it('sets the print width', () => {
    const zpl = mediaConfigZpl({ widthDots: 406, heightDots: 203 })
    expect(zpl).toContain('^PW406')
  })

  it('resets the label home origin', () => {
    const zpl = mediaConfigZpl({ widthDots: 406, heightDots: 203 })
    expect(zpl).toContain('^LH0,0')
  })

  it('gives the gap search an inch of headroom past the label', () => {
    const zpl = mediaConfigZpl({ widthDots: 406, heightDots: 203, dpi: 203 })
    expect(zpl).toContain('^ML406') // 203 label + 203 (1") margin
  })

  it('scales the search margin with DPI', () => {
    const zpl = mediaConfigZpl({ widthDots: 600, heightDots: 300, dpi: 300 })
    expect(zpl).toContain('^ML600') // 300 label + 300 (1" at 300dpi)
  })

  it('clamps ^ML to the documented maximum', () => {
    const zpl = mediaConfigZpl({ widthDots: 406, heightDots: 20000 })
    expect(zpl).toContain(`^ML${MAX_LABEL_LENGTH_DOTS}`)
  })

  it('omits ^LL for gap media, which ignores it', () => {
    const zpl = mediaConfigZpl({ widthDots: 406, heightDots: 203, tracking: 'gap' })
    expect(zpl).not.toContain('^LL')
  })

  it('omits ^LL for mark and auto media too', () => {
    for (const tracking of ['mark', 'auto'] as const) {
      expect(mediaConfigZpl({ widthDots: 406, heightDots: 203, tracking })).not.toContain('^LL')
    }
  })

  it('emits ^LL for continuous media, which needs it', () => {
    const zpl = mediaConfigZpl({ widthDots: 406, heightDots: 203, tracking: 'continuous' })
    expect(zpl).toContain('^LL203')
  })

  it('defaults to gap tracking', () => {
    const zpl = mediaConfigZpl({ widthDots: 406, heightDots: 203 })
    expect(zpl).toContain('^MNY')
  })

  it('includes the black mark offset only for mark tracking', () => {
    expect(mediaConfigZpl({ widthDots: 406, heightDots: 203, tracking: 'mark', markOffset: 24 }))
      .toContain('^MNM,24')
    // The offset is meaningless on gap media, so it must not leak through.
    expect(mediaConfigZpl({ widthDots: 406, heightDots: 203, tracking: 'gap', markOffset: 24 }))
      .toContain('^MNY')
    expect(mediaConfigZpl({ widthDots: 406, heightDots: 203, tracking: 'gap', markOffset: 24 }))
      .not.toContain(',24')
  })

  it('persists to non-volatile memory by default', () => {
    expect(mediaConfigZpl({ widthDots: 406, heightDots: 203 })).toContain('^JUS')
  })

  it('skips ^JUS when persist is false', () => {
    expect(mediaConfigZpl({ widthDots: 406, heightDots: 203, persist: false })).not.toContain('^JUS')
  })

  it('orders width before the media mode', () => {
    const zpl = mediaConfigZpl({ widthDots: 406, heightDots: 203 })
    expect(zpl.indexOf('^PW')).toBeLessThan(zpl.indexOf('^MN'))
  })
})

describe('calibrationZpl', () => {
  it('is the bare ~JC immediate command', () => {
    // ~JC is an immediate command and must not be wrapped in ^XA/^XZ.
    expect(calibrationZpl()).toBe('~JC')
    expect(calibrationZpl()).not.toContain('^XA')
  })
})

describe('ZPLBuilder media commands', () => {
  it('sets print width on its own', () => {
    expect(new ZPLBuilder().printWidth(812).build()).toContain('^PW812')
  })

  it('sets label length on its own', () => {
    expect(new ZPLBuilder().labelLength(1218).build()).toContain('^LL1218')
  })

  it('clamps max label length', () => {
    expect(new ZPLBuilder().maxLabelLength(99999).build()).toContain(`^ML${MAX_LABEL_LENGTH_DOTS}`)
  })

  it('rounds fractional max label length', () => {
    expect(new ZPLBuilder().maxLabelLength(406.7).build()).toContain('^ML407')
  })
})
