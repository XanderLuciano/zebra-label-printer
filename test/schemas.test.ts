/**
 * Tests for Zod validation schemas.
 */
import { describe, it, expect } from 'vitest';
import {
  textLabelSchema,
  barcodeLabelSchema,
  qrLabelSchema,
  zplSchema,
  labelSchema,
  serialLabelSchema,
  clearJobsSchema,
} from '../src/schemas';

describe('textLabelSchema', () => {
  it('accepts valid text request', () => {
    const result = textLabelSchema.safeParse({ lines: ['Hello'] });
    expect(result.success).toBe(true);
  });

  it('accepts multi-line text', () => {
    const result = textLabelSchema.safeParse({ lines: ['A', 'B', 'C'] });
    expect(result.success).toBe(true);
  });

  it('rejects empty lines array', () => {
    const result = textLabelSchema.safeParse({ lines: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('At least one line');
    }
  });

  it('rejects missing lines', () => {
    const result = textLabelSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects extra fields (strict)', () => {
    const result = textLabelSchema.safeParse({ lines: ['Hi'], extra: true });
    expect(result.success).toBe(false);
  });

  it('accepts optional copies', () => {
    const result = textLabelSchema.safeParse({ lines: ['Hi'], copies: 3 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.copies).toBe(3);
  });

  it('rejects copies over 10', () => {
    const result = textLabelSchema.safeParse({ lines: ['Hi'], copies: 100 });
    expect(result.success).toBe(false);
  });

  it('rejects copies of 0', () => {
    const result = textLabelSchema.safeParse({ lines: ['Hi'], copies: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects more than 20 lines', () => {
    const lines = Array.from({ length: 21 }, (_, i) => `Line ${i}`);
    const result = textLabelSchema.safeParse({ lines });
    expect(result.success).toBe(false);
  });
});

describe('barcodeLabelSchema', () => {
  it('accepts valid barcode request', () => {
    const result = barcodeLabelSchema.safeParse({ data: '12345' });
    expect(result.success).toBe(true);
  });

  it('defaults type to CODE128', () => {
    const result = barcodeLabelSchema.safeParse({ data: '12345' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe('CODE128');
  });

  it('accepts all barcode types', () => {
    const types = ['CODE128', 'CODE39', 'CODE93', 'EAN8', 'EAN13', 'UPCA', 'UPCE', 'CODABAR', 'PDF417', 'QRCODE', 'DATAMATRIX'];
    for (const type of types) {
      const result = barcodeLabelSchema.safeParse({ data: 'TEST', type });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid barcode type', () => {
    const result = barcodeLabelSchema.safeParse({ data: 'TEST', type: 'INVALID' });
    expect(result.success).toBe(false);
  });

  it('accepts optional text and height', () => {
    const result = barcodeLabelSchema.safeParse({ data: '123', text: 'Label', height: 100 });
    expect(result.success).toBe(true);
  });

  it('rejects height over 1000', () => {
    const result = barcodeLabelSchema.safeParse({ data: '123', height: 1001 });
    expect(result.success).toBe(false);
  });

  it('rejects missing data', () => {
    const result = barcodeLabelSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('qrLabelSchema', () => {
  it('accepts valid QR request', () => {
    const result = qrLabelSchema.safeParse({ data: 'https://example.com' });
    expect(result.success).toBe(true);
  });

  it('defaults magnification to 5', () => {
    const result = qrLabelSchema.safeParse({ data: 'test' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.magnification).toBe(5);
  });

  it('rejects magnification over 10', () => {
    const result = qrLabelSchema.safeParse({ data: 'test', magnification: 11 });
    expect(result.success).toBe(false);
  });

  it('accepts optional text', () => {
    const result = qrLabelSchema.safeParse({ data: 'test', text: 'Scan me' });
    expect(result.success).toBe(true);
  });
});

describe('zplSchema', () => {
  it('accepts raw ZPL string', () => {
    const result = zplSchema.safeParse('^XA^FO10,10^FDHi^FS^XZ');
    expect(result.success).toBe(true);
  });

  it('accepts JSON object with zpl field', () => {
    const result = zplSchema.safeParse({ zpl: '^XA^XZ' });
    expect(result.success).toBe(true);
  });

  it('rejects empty string', () => {
    const result = zplSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('rejects object without zpl', () => {
    const result = zplSchema.safeParse({ foo: 'bar' });
    expect(result.success).toBe(false);
  });
});

describe('labelSchema', () => {
  it('accepts valid composed label', () => {
    const result = labelSchema.safeParse({
      elements: [
        { type: 'text', content: 'Hello', options: { x: 10, y: 10 } },
        { type: 'barcode', content: '123', options: { x: 10, y: 50, type: 'CODE128' } },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty elements', () => {
    const result = labelSchema.safeParse({ elements: [] });
    expect(result.success).toBe(false);
  });

  it('accepts all element types', () => {
    const result = labelSchema.safeParse({
      elements: [
        { type: 'text' as const, content: 'A', options: { x: 0, y: 0 } },
        { type: 'barcode' as const, content: 'B', options: { x: 0, y: 0, type: 'CODE128' as const } },
        { type: 'qrcode' as const, content: 'C', options: { x: 0, y: 0 } },
        { type: 'raw' as const, zpl: '^FO10,10^FS' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid element type', () => {
    const result = labelSchema.safeParse({
      elements: [{ type: 'invalid', content: 'A', options: { x: 0, y: 0 } }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional copies', () => {
    const result = labelSchema.safeParse({
      elements: [{ type: 'text', content: 'A', options: { x: 0, y: 0 } }],
      copies: 5,
    });
    expect(result.success).toBe(true);
  });
});

describe('serialLabelSchema', () => {
  it('accepts valid serial request', () => {
    const result = serialLabelSchema.safeParse({
      lines: ['Box #{serial}'],
      copies: 5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serialStart).toBe(1);
      expect(result.data.serialFormat).toBe('###');
      expect(result.data.copies).toBe(5);
    }
  });

  it('accepts custom start and format', () => {
    const result = serialLabelSchema.safeParse({
      lines: ['Item {serial}'],
      copies: 10,
      serialStart: 100,
      serialFormat: '#####',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serialStart).toBe(100);
      expect(result.data.serialFormat).toBe('#####');
    }
  });

  it('rejects 0 copies', () => {
    const result = serialLabelSchema.safeParse({ lines: ['Test'], copies: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects over 500 copies', () => {
    const result = serialLabelSchema.safeParse({ lines: ['Test'], copies: 501 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid serial format', () => {
    const result = serialLabelSchema.safeParse({
      lines: ['Test'],
      copies: 5,
      serialFormat: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid serial formats', () => {
    for (const fmt of ['#', '##', '###', '####', '#####']) {
      const result = serialLabelSchema.safeParse({ lines: ['Test'], copies: 5, serialFormat: fmt });
      expect(result.success).toBe(true);
    }
  });

  it('accepts serial start of 0', () => {
    const result = serialLabelSchema.safeParse({ lines: ['Test'], copies: 3, serialStart: 0 });
    expect(result.success).toBe(true);
  });
});

describe('clearJobsSchema', () => {
  it('defaults to completed status', () => {
    const result = clearJobsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('completed');
  });

  it('accepts all status values', () => {
    for (const status of ['completed', 'failed', 'cancelled', 'all']) {
      const result = clearJobsSchema.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    const result = clearJobsSchema.safeParse({ status: 'pending' });
    expect(result.success).toBe(false);
  });

  it('accepts olderThanDays', () => {
    const result = clearJobsSchema.safeParse({ olderThanDays: 30 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.olderThanDays).toBe(30);
  });
});
