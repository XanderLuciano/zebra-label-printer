/**
 * Tests for Zod validation schemas.
 */
import { describe, it, expect } from 'vitest'
import {
  textLabelSchema,
  barcodeLabelSchema,
  qrLabelSchema,
  zplSchema,
  labelSchema,
  serialLabelSchema,
  clearJobsSchema,
  printerConfigSchema,
  printerCalibrateSchema,
  printerCreateSchema,
  printerUpdateSchema
} from '../../src/schemas'

describe('textLabelSchema', () => {
  it('accepts valid text request', () => {
    const result = textLabelSchema.safeParse({ lines: ['Hello'] })
    expect(result.success).toBe(true)
  })

  it('accepts multi-line text', () => {
    const result = textLabelSchema.safeParse({ lines: ['A', 'B', 'C'] })
    expect(result.success).toBe(true)
  })

  it('rejects empty lines array', () => {
    const result = textLabelSchema.safeParse({ lines: [] })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('At least one line')
    }
  })

  it('rejects missing lines', () => {
    const result = textLabelSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects extra fields (strict)', () => {
    const result = textLabelSchema.safeParse({ lines: ['Hi'], extra: true })
    expect(result.success).toBe(false)
  })

  it('accepts optional copies', () => {
    const result = textLabelSchema.safeParse({ lines: ['Hi'], copies: 3 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.copies).toBe(3)
  })

  it('rejects copies over 10', () => {
    const result = textLabelSchema.safeParse({ lines: ['Hi'], copies: 100 })
    expect(result.success).toBe(false)
  })

  it('rejects copies of 0', () => {
    const result = textLabelSchema.safeParse({ lines: ['Hi'], copies: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects more than 20 lines', () => {
    const lines = Array.from({ length: 21 }, (_, i) => `Line ${i}`)
    const result = textLabelSchema.safeParse({ lines })
    expect(result.success).toBe(false)
  })
})

describe('barcodeLabelSchema', () => {
  it('accepts valid barcode request', () => {
    const result = barcodeLabelSchema.safeParse({ data: '12345' })
    expect(result.success).toBe(true)
  })

  it('defaults type to CODE128', () => {
    const result = barcodeLabelSchema.safeParse({ data: '12345' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.type).toBe('CODE128')
  })

  it('accepts all barcode types', () => {
    const types = ['CODE128', 'CODE39', 'CODE93', 'EAN8', 'EAN13', 'UPCA', 'UPCE', 'CODABAR', 'PDF417', 'QRCODE', 'DATAMATRIX']
    for (const type of types) {
      const result = barcodeLabelSchema.safeParse({ data: 'TEST', type })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid barcode type', () => {
    const result = barcodeLabelSchema.safeParse({ data: 'TEST', type: 'INVALID' })
    expect(result.success).toBe(false)
  })

  it('accepts optional text and height', () => {
    const result = barcodeLabelSchema.safeParse({ data: '123', text: 'Label', height: 100 })
    expect(result.success).toBe(true)
  })

  it('rejects height over 1000', () => {
    const result = barcodeLabelSchema.safeParse({ data: '123', height: 1001 })
    expect(result.success).toBe(false)
  })

  it('rejects missing data', () => {
    const result = barcodeLabelSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('qrLabelSchema', () => {
  it('accepts valid QR request', () => {
    const result = qrLabelSchema.safeParse({ data: 'https://example.com' })
    expect(result.success).toBe(true)
  })

  it('defaults magnification to 5', () => {
    const result = qrLabelSchema.safeParse({ data: 'test' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.magnification).toBe(5)
  })

  it('rejects magnification over 10', () => {
    const result = qrLabelSchema.safeParse({ data: 'test', magnification: 11 })
    expect(result.success).toBe(false)
  })

  it('accepts optional text', () => {
    const result = qrLabelSchema.safeParse({ data: 'test', text: 'Scan me' })
    expect(result.success).toBe(true)
  })
})

describe('zplSchema', () => {
  it('accepts raw ZPL string', () => {
    const result = zplSchema.safeParse('^XA^FO10,10^FDHi^FS^XZ')
    expect(result.success).toBe(true)
  })

  it('accepts JSON object with zpl field', () => {
    const result = zplSchema.safeParse({ zpl: '^XA^XZ' })
    expect(result.success).toBe(true)
  })

  it('rejects empty string', () => {
    const result = zplSchema.safeParse('')
    expect(result.success).toBe(false)
  })

  it('rejects object without zpl', () => {
    const result = zplSchema.safeParse({ foo: 'bar' })
    expect(result.success).toBe(false)
  })
})

describe('labelSchema', () => {
  it('accepts valid composed label', () => {
    const result = labelSchema.safeParse({
      elements: [
        { type: 'text', content: 'Hello', options: { x: 10, y: 10 } },
        { type: 'barcode', content: '123', options: { x: 10, y: 50, type: 'CODE128' } }
      ]
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty elements', () => {
    const result = labelSchema.safeParse({ elements: [] })
    expect(result.success).toBe(false)
  })

  it('accepts all element types', () => {
    const result = labelSchema.safeParse({
      elements: [
        { type: 'text' as const, content: 'A', options: { x: 0, y: 0 } },
        { type: 'barcode' as const, content: 'B', options: { x: 0, y: 0, type: 'CODE128' as const } },
        { type: 'qrcode' as const, content: 'C', options: { x: 0, y: 0 } },
        { type: 'raw' as const, zpl: '^FO10,10^FS' }
      ]
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid element type', () => {
    const result = labelSchema.safeParse({
      elements: [{ type: 'invalid', content: 'A', options: { x: 0, y: 0 } }]
    })
    expect(result.success).toBe(false)
  })

  it('accepts rotation on qrcode elements', () => {
    // The element schemas are .strict(), so an unlisted field is a hard reject.
    // The designer emits rotation for QR codes, so it has to be allowed here.
    const result = labelSchema.safeParse({
      elements: [{ type: 'qrcode' as const, content: 'C', options: { x: 0, y: 0, rotation: 'R' as const } }]
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid qrcode rotation', () => {
    const result = labelSchema.safeParse({
      elements: [{ type: 'qrcode' as const, content: 'C', options: { x: 0, y: 0, rotation: 'X' } }]
    })
    expect(result.success).toBe(false)
  })

  it('accepts a print target on every print schema', () => {
    expect(textLabelSchema.safeParse({ lines: ['A'], target: 'local' }).success).toBe(true)
    expect(labelSchema.safeParse({
      elements: [{ type: 'raw' as const, zpl: '^FO0,0^FS' }],
      target: 'local'
    }).success).toBe(true)
  })

  it('defaults the print target to server', () => {
    const result = textLabelSchema.safeParse({ lines: ['A'] })
    expect(result.success).toBe(true)
    expect(result.success && result.data.target).toBe('server')
  })

  it('rejects an unknown print target', () => {
    expect(textLabelSchema.safeParse({ lines: ['A'], target: 'cloud' }).success).toBe(false)
  })

  it('accepts optional copies', () => {
    const result = labelSchema.safeParse({
      elements: [{ type: 'text', content: 'A', options: { x: 0, y: 0 } }],
      copies: 5
    })
    expect(result.success).toBe(true)
  })
})

describe('serialLabelSchema', () => {
  it('accepts valid serial request', () => {
    const result = serialLabelSchema.safeParse({
      lines: ['Box #{serial}'],
      copies: 5
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.serialStart).toBe(1)
      expect(result.data.serialFormat).toBe('###')
      expect(result.data.copies).toBe(5)
    }
  })

  it('accepts custom start and format', () => {
    const result = serialLabelSchema.safeParse({
      lines: ['Item {serial}'],
      copies: 10,
      serialStart: 100,
      serialFormat: '#####'
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.serialStart).toBe(100)
      expect(result.data.serialFormat).toBe('#####')
    }
  })

  it('rejects 0 copies', () => {
    const result = serialLabelSchema.safeParse({ lines: ['Test'], copies: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects over 500 copies', () => {
    const result = serialLabelSchema.safeParse({ lines: ['Test'], copies: 501 })
    expect(result.success).toBe(false)
  })

  it('rejects invalid serial format', () => {
    const result = serialLabelSchema.safeParse({
      lines: ['Test'],
      copies: 5,
      serialFormat: 'invalid'
    })
    expect(result.success).toBe(false)
  })

  it('accepts all valid serial formats', () => {
    for (const fmt of ['#', '##', '###', '####', '#####']) {
      const result = serialLabelSchema.safeParse({ lines: ['Test'], copies: 5, serialFormat: fmt })
      expect(result.success).toBe(true)
    }
  })

  it('accepts serial start of 0', () => {
    const result = serialLabelSchema.safeParse({ lines: ['Test'], copies: 3, serialStart: 0 })
    expect(result.success).toBe(true)
  })
})

describe('clearJobsSchema', () => {
  it('defaults to completed status', () => {
    const result = clearJobsSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.status).toBe('completed')
  })

  it('accepts all status values', () => {
    for (const status of ['completed', 'failed', 'cancelled', 'all']) {
      const result = clearJobsSchema.safeParse({ status })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid status', () => {
    const result = clearJobsSchema.safeParse({ status: 'pending' })
    expect(result.success).toBe(false)
  })

  it('accepts olderThanDays', () => {
    const result = clearJobsSchema.safeParse({ olderThanDays: 30 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.olderThanDays).toBe(30)
  })
})

// ─── Printer selection ──────────────────────────────────────────────────────
//
// `target` alone was enough when there was one server printer, one browser
// printer, and one global label size both were assumed to be loaded with.
// `printerId` replaces that assumption with an explicit choice, and `labelSize`
// carries the geometry for printers whose configuration the server cannot read.

describe('printer selection on print endpoints', () => {
  it('accepts a printer id', () => {
    const result = textLabelSchema.safeParse({ lines: ['Hi'], printerId: 'prn_abc123' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.printerId).toBe('prn_abc123')
  })

  it('accepts a browser-owned printer id', () => {
    const result = textLabelSchema.safeParse({ lines: ['Hi'], printerId: 'local_usb-0a5f-0080-123' })
    expect(result.success).toBe(true)
  })

  it('still defaults target to server when no printer is named', () => {
    const result = textLabelSchema.safeParse({ lines: ['Hi'] })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.target).toBe('server')
      expect(result.data.printerId).toBeUndefined()
    }
  })

  it('accepts an explicit label geometry', () => {
    const result = textLabelSchema.safeParse({
      lines: ['Hi'],
      printerId: 'local_usb-0a5f-0080-123',
      labelSize: { widthDots: 406, heightDots: 203, dpi: 203 }
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.labelSize?.widthDots).toBe(406)
  })

  it('does not accept inches — they are derived from dots and DPI', () => {
    const result = textLabelSchema.safeParse({
      lines: ['Hi'],
      labelSize: { widthDots: 406, heightDots: 203, widthInches: 2 }
    })
    expect(result.success).toBe(false)
  })

  it('requires both dimensions in a label geometry', () => {
    const result = textLabelSchema.safeParse({ lines: ['Hi'], labelSize: { widthDots: 406 } })
    expect(result.success).toBe(false)
  })

  it('rejects an unsupported DPI', () => {
    const result = textLabelSchema.safeParse({
      lines: ['Hi'],
      labelSize: { widthDots: 406, heightDots: 203, dpi: 150 }
    })
    expect(result.success).toBe(false)
  })

  it('rejects a label narrower than the minimum', () => {
    const result = textLabelSchema.safeParse({
      lines: ['Hi'],
      labelSize: { widthDots: 10, heightDots: 203 }
    })
    expect(result.success).toBe(false)
  })

  it('accepts a printer name for jobs the server cannot name itself', () => {
    const result = labelSchema.safeParse({
      elements: [{ type: 'raw', zpl: '^FO0,0' }],
      printerId: 'local_usb-0a5f-0080-123',
      printerName: 'Desk GK420d'
    })
    expect(result.success).toBe(true)
  })

  it('carries the selection on every print endpoint', () => {
    const selection = { printerId: 'prn_abc', labelSize: { widthDots: 406, heightDots: 203 } }

    expect(textLabelSchema.safeParse({ lines: ['a'], ...selection }).success).toBe(true)
    expect(barcodeLabelSchema.safeParse({ data: '123', ...selection }).success).toBe(true)
    expect(qrLabelSchema.safeParse({ data: 'https://x', ...selection }).success).toBe(true)
    expect(labelSchema.safeParse({ elements: [{ type: 'raw', zpl: '^FO0,0' }], ...selection }).success).toBe(true)
    expect(zplSchema.safeParse({ zpl: '^XA^XZ', ...selection }).success).toBe(true)
  })

  it('accepts a printer id on a serial run', () => {
    const result = serialLabelSchema.safeParse({ lines: ['SN {serial}'], copies: 5, printerId: 'prn_abc' })
    expect(result.success).toBe(true)
  })
})

describe('printerConfigSchema', () => {
  it('accepts an empty body, meaning "apply this printer\'s own configuration"', () => {
    const result = printerConfigSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.target).toBe('server')
  })

  it('accepts a printer id', () => {
    const result = printerConfigSchema.safeParse({ printerId: 'prn_abc', calibrate: true })
    expect(result.success).toBe(true)
  })

  it('accepts a browser-owned printer with target local', () => {
    const result = printerConfigSchema.safeParse({
      printerId: 'local_usb-0a5f-0080-123',
      target: 'local',
      widthDots: 406,
      heightDots: 203
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown field', () => {
    expect(printerConfigSchema.safeParse({ widthInches: 2 }).success).toBe(false)
  })
})

describe('printerCalibrateSchema', () => {
  it('accepts a printer id', () => {
    expect(printerCalibrateSchema.safeParse({ printerId: 'prn_abc' }).success).toBe(true)
  })

  it('defaults to the server', () => {
    const result = printerCalibrateSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.target).toBe('server')
  })
})

describe('printerCreateSchema', () => {
  it('accepts a CUPS printer with just a queue name', () => {
    const result = printerCreateSchema.safeParse({ name: 'Warehouse', cupsName: 'ZTC-GK420d' })
    expect(result.success).toBe(true)
  })

  it('requires a queue name for a CUPS printer', () => {
    // A CUPS printer with no queue name can never be printed to, so storing one
    // would create a profile that silently never works.
    const result = printerCreateSchema.safeParse({ name: 'Nameless' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['cupsName'])
    }
  })

  it('requires a queue name when transport is explicitly cups', () => {
    expect(printerCreateSchema.safeParse({ name: 'X', transport: 'cups' }).success).toBe(false)
  })

  it('does not require a queue name for other transports', () => {
    expect(printerCreateSchema.safeParse({ name: 'Networked', transport: 'tcp', deviceUri: '10.0.0.5:9100' }).success).toBe(true)
  })

  it('rejects webusb, which the server cannot drive', () => {
    // Browser-attached printers are configured client-side, never here.
    expect(printerCreateSchema.safeParse({ name: 'Desk', transport: 'webusb' }).success).toBe(false)
  })

  it('accepts a full media configuration', () => {
    const result = printerCreateSchema.safeParse({
      name: 'Bench',
      cupsName: 'bench',
      labelSize: { widthDots: 406, heightDots: 203, name: '2×1"' },
      dpi: 300,
      tracking: 'mark',
      markOffset: 40,
      isDefault: true
    })
    expect(result.success).toBe(true)
  })

  it('rejects an out-of-range mark offset', () => {
    expect(printerCreateSchema.safeParse({ name: 'X', cupsName: 'x', markOffset: 9999 }).success).toBe(false)
  })

  it('rejects an unknown field', () => {
    expect(printerCreateSchema.safeParse({ name: 'X', cupsName: 'x', colour: 'blue' }).success).toBe(false)
  })
})

describe('printerUpdateSchema', () => {
  it('accepts a partial update', () => {
    expect(printerUpdateSchema.safeParse({ name: 'Renamed' }).success).toBe(true)
    expect(printerUpdateSchema.safeParse({ tracking: 'continuous' }).success).toBe(true)
  })

  it('does not require a queue name, unlike creation', () => {
    // An existing printer already has one; an update touching only the label size
    // shouldn't have to restate it.
    expect(printerUpdateSchema.safeParse({ labelSize: { widthDots: 812, heightDots: 1218 } }).success).toBe(true)
  })

  it('accepts clearing the mark offset', () => {
    expect(printerUpdateSchema.safeParse({ markOffset: null }).success).toBe(true)
  })

  it('accepts an empty body', () => {
    expect(printerUpdateSchema.safeParse({}).success).toBe(true)
  })
})
