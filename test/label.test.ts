/**
 * Tests for label templates.
 */
import { describe, it, expect } from 'vitest';
import {
  simpleTextLabel,
  shippingLabel,
  assetTag,
  qrCodeLabel,
  itemLabel,
  customLabel,
} from '../src/label';
import { inchesToDots } from '../src/zpl';

describe('simpleTextLabel', () => {
  it('builds a text label with title and lines', () => {
    const zpl = simpleTextLabel('TITLE', ['Line 1', 'Line 2']).build();
    expect(zpl).toContain('^FDTITLE');
    expect(zpl).toContain('^FDLine 1');
    expect(zpl).toContain('^FDLine 2');
    expect(zpl.startsWith('^XA')).toBe(true);
  });

  it('works without title', () => {
    const zpl = simpleTextLabel('', ['Only line']).build();
    expect(zpl).toContain('^FDOnly line');
  });

  it('respects fontSize option', () => {
    const zpl = simpleTextLabel('A', ['B'], { fontSize: 40 }).build();
    expect(zpl).toContain('^A0N,40');
  });
});

describe('shippingLabel', () => {
  it('builds a complete shipping label', () => {
    const zpl = shippingLabel(
      { name: 'John Doe', address1: '123 Main St', city: 'LA', state: 'CA', zip: '90210' },
      { name: 'Sender', address1: '456 Oak' },
    ).build();

    expect(zpl).toContain('SHIP TO:');
    expect(zpl).toContain('^FDJohn Doe');
    expect(zpl).toContain('^FD123 Main St');
    expect(zpl).toContain('LA, CA 90210');
    expect(zpl).toContain('^FDSender');
  });
});

describe('assetTag', () => {
  it('builds an asset tag with barcode', () => {
    const zpl = assetTag('ASSET-001', 'Server Rack 3', 'Closet B').build();
    expect(zpl).toContain('^FDASSET-001');
    expect(zpl).toContain('^FDServer Rack 3');
    expect(zpl).toContain('Location: Closet B');
  });

  it('works without location', () => {
    const zpl = assetTag('ASSET-002', 'Laptop').build();
    expect(zpl).toContain('^FDASSET-002');
    expect(zpl).not.toContain('Location:');
  });
});

describe('qrCodeLabel', () => {
  it('builds a QR code label', () => {
    const zpl = qrCodeLabel('https://example.com', 'Scan Me', 'Subtitle').build();
    expect(zpl).toContain('^BQ');
    expect(zpl).toContain('^FDScan Me');
    expect(zpl).toContain('^FDSubtitle');
  });

  it('works without subtitle', () => {
    const zpl = qrCodeLabel('data', 'Title').build();
    expect(zpl).toContain('^BQ');
    expect(zpl).not.toContain('^FDTitle^FS\n^FO.*^FD');
  });
});

describe('itemLabel', () => {
  it('builds an item label with price and SKU', () => {
    const zpl = itemLabel('Widget Pro', '$29.99', 'SKU-12345').build();
    expect(zpl).toContain('^FDWidget Pro');
    expect(zpl).toContain('$29.99');
    expect(zpl).toContain('^FDSKU-12345');
  });

  it('works without price and SKU', () => {
    const zpl = itemLabel('Basic Item').build();
    expect(zpl).toContain('^FDBasic Item');
  });
});

describe('customLabel', () => {
  it('builds from element definitions', () => {
    const zpl = customLabel([
      { type: 'text', content: 'Custom', options: { x: 10, y: 10 } },
      { type: 'barcode', content: 'CUSTOM-1', options: { x: 10, y: 60, type: 'CODE128' } },
    ]).build();
    expect(zpl).toContain('^FDCustom');
    expect(zpl).toContain('^FDCUSTOM-1');
  });
});
