/**
 * Tests for ZPLBuilder and convenience functions.
 * These are pure unit tests — no printer required.
 */
import { describe, it, expect } from 'vitest';
import {
  ZPLBuilder,
  textLabel,
  barcodeLabel,
  qrLabel,
  inchesToDots,
  mmToDots,
  LABEL_SIZES,
  ZEBRA_DPI,
  FONTS,
} from '../../src/zpl';

describe('ZPLBuilder', () => {
  it('builds a minimal text label', () => {
    const zpl = new ZPLBuilder()
      .text('Hello', { x: 50, y: 50 })
      .build();

    expect(zpl).toContain('^XA');
    expect(zpl).toContain('^FO50,50');
    expect(zpl).toContain('^FDHello^FS');
    expect(zpl).toContain('^XZ');
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl.endsWith('^XZ')).toBe(true);
  });

  it('builds a label with multiple elements', () => {
    const zpl = new ZPLBuilder()
      .text('Title', { x: 20, y: 20, height: 40, font: 'D' })
      .barcode('12345', { x: 20, y: 80, type: 'CODE128', height: 60 })
      .qrcode('https://example.com', { x: 200, y: 20, magnification: 4 })
      .line(10, 160, 580, 2)
      .build();

    expect(zpl).toContain('^FO20,20^ADN,40');
    expect(zpl).toContain('^FDTitle^FS');
    expect(zpl).toContain('^BCN,60,Y,2,,,N^FD12345^FS');
    expect(zpl).toContain('^BQN,2,4');
    expect(zpl).toContain('^GB580,2,2,B^FS');
  });

  it('supports all barcode types', () => {
    const types = ['CODE128', 'CODE39', 'CODE93', 'EAN8', 'EAN13', 'UPCA', 'UPCE', 'CODABAR'] as const;
    for (const type of types) {
      const zpl = new ZPLBuilder()
        .barcode('TEST', { x: 10, y: 10, type })
        .build();
      expect(zpl).toContain('^FD');
    }
  });

  it('handles special characters in field data', () => {
    const zpl = new ZPLBuilder()
      .text('Hello ^ World ~ Test', { x: 10, y: 10 })
      .build();

    expect(zpl).toContain('\\^');
    expect(zpl).toContain('\\~');
  });

  it('throws on empty label', () => {
    expect(() => new ZPLBuilder().build()).toThrow('empty label');
  });

  it('supports text rotation', () => {
    const rotated = new ZPLBuilder()
      .text('Rotated', { x: 50, y: 50, rotation: 'R' })
      .build();
    expect(rotated).toContain('^A0R');

    const inverted = new ZPLBuilder()
      .text('Inverted', { x: 50, y: 50, rotation: 'I' })
      .build();
    expect(inverted).toContain('^A0I');
  });

  it('supports reverse text', () => {
    const zpl = new ZPLBuilder()
      .text('Reverse', { x: 50, y: 50, reverse: true })
      .build();
    expect(zpl).toContain('^FR');
  });

  it('builds boxes', () => {
    const zpl = new ZPLBuilder()
      .box(10, 10, 200, 100, 2, 'B', 5)
      .build();
    expect(zpl).toContain('^GB200,100,2,B,5^FS');
  });

  it('builds text blocks', () => {
    const zpl = new ZPLBuilder()
      .textBlock('A long text that wraps', 20, 20, 200, 2)
      .build();
    expect(zpl).toContain('^TB200,2');
    expect(zpl).toContain('^FDA long text that wraps^FS');
  });

  it('sets label dimensions', () => {
    const zpl = new ZPLBuilder()
      .labelSize(400, 600)
      .text('Test', { x: 10, y: 10 })
      .build();
    expect(zpl).toContain('^LL600');
    expect(zpl).toContain('^PW400');
  });

  it('sets home position', () => {
    const zpl = new ZPLBuilder()
      .homePosition(10, 20)
      .text('Test', { x: 0, y: 0 })
      .build();
    expect(zpl).toContain('^LH10,20');
  });

  it('clones non-destructively', () => {
    const original = new ZPLBuilder().text('A', { x: 10, y: 10 });
    const clone = original.clone();
    clone.text('B', { x: 20, y: 20 });

    const origZpl = original.build();
    const cloneZpl = clone.build();

    expect(origZpl).not.toContain('B');
    expect(cloneZpl).toContain('B');
    expect(cloneZpl).toContain('A');
  });

  it('accepts raw ZPL', () => {
    const zpl = new ZPLBuilder()
      .raw('^FO10,10^GB100,100,3^FS')
      .text('After', { x: 10, y: 120 })
      .build();
    expect(zpl).toContain('^FO10,10^GB100,100,3^FS');
    expect(zpl).toContain('^FDAfter');
  });

  it('builds from element array', () => {
    const zpl = new ZPLBuilder()
      .elements([
        { type: 'text', content: 'Item 1', options: { x: 10, y: 10 } },
        { type: 'barcode', content: 'CODE1', options: { x: 10, y: 50, type: 'CODE128' } },
        { type: 'raw', zpl: '^FO10,120^GB100,5,2^FS' },
      ])
      .build();
    expect(zpl).toContain('^FDItem 1');
    expect(zpl).toContain('^FDCODE1');
    expect(zpl).toContain('^GB100,5,2^FS');
  });

  it('supports Data Matrix barcode', () => {
    const zpl = new ZPLBuilder()
      .barcode('DM-DATA', { x: 10, y: 10, type: 'DATAMATRIX', height: 200 })
      .build();
    expect(zpl).toContain('^BX');
    expect(zpl).toContain('^FDDM-DATA');
  });

  it('supports PDF417 barcode', () => {
    const zpl = new ZPLBuilder()
      .barcode('PDF-DATA', { x: 10, y: 10, type: 'PDF417' })
      .build();
    expect(zpl).toContain('^B7');
  });

  it('supports copies', () => {
    const zpl = new ZPLBuilder({ copies: 3 })
      .text('Hello', { x: 10, y: 10 })
      .build();
    expect(zpl).toContain('^PQ3');
  });
});

describe('Convenience functions', () => {
  it('textLabel produces valid ZPL', () => {
    const zpl = textLabel(['Line 1', 'Line 2']);
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl.endsWith('^XZ')).toBe(true);
    expect(zpl).toContain('^FDLine 1');
    expect(zpl).toContain('^FDLine 2');
  });

  it('textLabel accepts font and size options', () => {
    const zpl = textLabel(['Test'], { x: 100, y: 50, height: 30, font: 'D' });
    expect(zpl).toContain('^FO100,50');
    expect(zpl).toContain('^ADN,30');
  });

  it('barcodeLabel produces valid ZPL with text', () => {
    const zpl = barcodeLabel('12345', 'CODE128', 'My Label');
    expect(zpl).toContain('^BC');
    expect(zpl).toContain('^FD12345');
    expect(zpl).toContain('^FDMy Label');
  });

  it('barcodeLabel works without label text', () => {
    const zpl = barcodeLabel('CODE39TEST', 'CODE39');
    expect(zpl).toContain('^B3');
    expect(zpl).toContain('^FDCODE39TEST');
    expect(zpl).not.toContain('^FDCODE39TEST^FS\n^FO');
  });

  it('qrLabel produces valid ZPL', () => {
    const zpl = qrLabel('hello world', 'QR Label', { magnification: 6 });
    expect(zpl).toContain('^BQN,2,6');
    expect(zpl).toContain('^FDQR Label');
  });

  it('qrLabel works without label text', () => {
    const zpl = qrLabel('data');
    expect(zpl).toContain('^BQ');
    expect(zpl).not.toContain('^FDdata^FS\n^FO');
  });
});

describe('Unit helpers', () => {
  it('inchesToDots converts correctly at 203 DPI', () => {
    expect(inchesToDots(3)).toBe(609);
    expect(inchesToDots(1)).toBe(203);
    expect(inchesToDots(2.5)).toBe(508);
  });

  it('inchesToDots respects custom DPI', () => {
    expect(inchesToDots(1, 300)).toBe(300);
    expect(inchesToDots(2, 150)).toBe(300);
  });

  it('mmToDots converts correctly at 203 DPI', () => {
    expect(mmToDots(25.4)).toBe(203);
    expect(mmToDots(50.8)).toBe(406);
  });

  it('LABEL_SIZES has expected entries', () => {
    expect(LABEL_SIZES['3x5']).toEqual({ width: 609, height: 1015 });
    expect(LABEL_SIZES['4x6']).toEqual({ width: 812, height: 1218 });
    expect(LABEL_SIZES['2x1']).toEqual({ width: 406, height: 203 });
  });

  it('ZEBRA_DPI is 203', () => {
    expect(ZEBRA_DPI).toBe(203);
  });

  it('FONTS has expected entries', () => {
    expect(FONTS.A).toEqual({ height: 15, width: 12 });
    expect(FONTS.H).toEqual({ height: 90, width: 60 });
    expect(FONTS.ZERO).toEqual({ height: 24, width: 15 });
  });
});
