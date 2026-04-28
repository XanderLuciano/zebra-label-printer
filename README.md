# 🦓 Zebra Label Printer

TypeScript library for Zebra GK420d label printers (and compatible ZPL printers). Print text, barcodes, QR codes, and custom labels — programmatically, via CLI, or through a REST webhook.

## Features

- **Zero-config discovery** — auto-finds Zebra printers via CUPS
- **Fluent ZPL builder** — type-safe label composition with text, 1D barcodes, QR codes, lines, and boxes
- **Label templates** — shipping labels, asset tags, item labels, QR code labels
- **CLI tool** — quick printing from the terminal
- **Webhook server** — REST API for network printing from any device
- **Full TypeScript** — strict mode, types included

## Quick Start

```bash
npm install
npm run build
```

### Print from CLI

```bash
# Discover printers
npx tsx src/cli.ts discover

# Test print (text + barcode + QR on one label)
npx tsx src/cli.ts print-test

# Text label
npx tsx src/cli.ts print-text "Kitchen Utensils"

# Barcode label
npx tsx src/cli.ts print-bc "INV-42069" "Kitchen Cabinet Hardware"

# QR code label
npx tsx src/cli.ts print-qr "https://github.com" "Scan Me"
```

### Start the webhook server

```bash
npx tsx src/cli.ts serve
# Or: PORT=3420 ZEBRA_PRINTER=ZTC-GK420d npx tsx src/cli.ts serve
```

### Use as a library

```ts
import { Printer, ZPLBuilder } from 'zebra-label-printer';

// Auto-connect to any Zebra printer
const printer = await Printer.auto();

// Build a label
const zpl = new ZPLBuilder()
  .text('Hello World!', { x: 50, y: 50, height: 40, font: 'D' })
  .barcode('ABC-12345', { x: 50, y: 120, type: 'CODE128', height: 80 })
  .qrcode('https://example.com', { x: 50, y: 250, magnification: 5 })
  .build();

// Print it
const result = await printer.print(zpl);
console.log(result.success ? `Printed! Job: ${result.jobId}` : `Failed: ${result.error}`);
```

## API Reference

### Printer

```ts
// Connect by name
const printer = await Printer.connect('ZTC-GK420d');

// Auto-discover first Zebra
const printer = await Printer.auto();

// Connect by name or auto-discover
const printer = await Printer.connectOrAuto('ZTC-GK420d');

// Print ZPL
await printer.print(zplString);

// Check readiness
const ready = await printer.isReady();
```

### ZPLBuilder

```ts
new ZPLBuilder({ width: 609, height: 1015 })  // 3x5" at 203 DPI
  .text('Hello', { x: 50, y: 50, height: 40 })
  .barcode('12345', { x: 50, y: 120, type: 'CODE128', height: 80 })
  .qrcode('data', { x: 100, y: 250, magnification: 5 })
  .line(20, 180, 500, 2)
  .box(10, 10, 200, 100, 2)
  .build()  // Returns ZPL string
```

### Label Templates

```ts
import { shippingLabel, assetTag, itemLabel, qrCodeLabel } from 'zebra-label-printer';

shippingLabel(
  { name: 'John', address1: '123 Main', city: 'LA', state: 'CA', zip: '90210' },
  { name: 'From Co', address1: '456 Oak' }
).build();

assetTag('ASSET-001', 'Server Rack 3', 'Closet B').build();
itemLabel('Widget Pro', '$29.99', 'SKU-12345').build();
```

### Supported Barcode Types

`CODE128`, `CODE39`, `CODE93`, `EAN8`, `EAN13`, `UPCA`, `UPCE`, `CODABAR`, `PDF417`, `QRCODE`, `DATAMATRIX`

### Webhook API

All endpoints accept JSON. All POST bodies are validated with [Zod](https://zod.dev) — invalid requests get structured 400s with field-level error details.

For full interactive docs, start the server and open **http://localhost:3420/api/docs** (Swagger UI).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/printers` | List available printers |
| GET | `/api/docs` | Swagger UI (interactive docs) |
| GET | `/api/docs/openapi.json` | OpenAPI 3.1 spec |
| POST | `/api/print/text` | Print text label |
| POST | `/api/print/barcode` | Print barcode label |
| POST | `/api/print/qr` | Print QR code label |
| POST | `/api/print/zpl` | Print raw ZPL (text/plain or JSON) |
| POST | `/api/print/label` | Print composed label from elements |

**Examples:**

```bash
# Text label
curl -X POST http://localhost:3420/api/print/text \
  -H "Content-Type: application/json" \
  -d '{"lines": ["Living Room", "Box #3"]}'

# Barcode
curl -X POST http://localhost:3420/api/print/barcode \
  -H "Content-Type: application/json" \
  -d '{"data": "INV-42069", "text": "Inventory Tag"}'

# Raw ZPL (direct string)
curl -X POST http://localhost:3420/api/print/zpl \
  -H "Content-Type: text/plain" \
  -d '^XA
^FO50,50^A0N,40,40^FDHello^FS
^XZ'

# Validation errors return structured details:
curl -X POST http://localhost:3420/api/print/text \
  -H "Content-Type: application/json" \
  -d '{"lines": []}'
# → { "error": "Validation failed", "details": [{ "field": "lines", "message": "At least one line required" }] }
```

**API Key auth:** Set `ZEBRA_API_KEY` env var, then use `Authorization: Bearer <key>` header or `?key=<key>` query param.

### Network Setup

1. Start the server on the machine connected to the printer:
   ```bash
   npx tsx src/cli.ts serve
   ```
2. Any device on the same network can print:
   ```bash
   curl -X POST http://nuc.local:3420/api/print/text \
     -H "Content-Type: application/json" \
     -d '{"lines": ["Hello from my laptop!"]}'
   ```
3. For PM2 (auto-start on boot):
   ```bash
   pm2 start npx --name zebra-label -- tsx src/webhook.ts
   pm2 save
   ```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ZEBRA_PRINTER` | auto-detect | CUPS printer name |
| `ZEBRA_API_KEY` | none | Webhook API key (Bearer auth) |
| `PORT` | 3420 | Webhook server port |

## Printer Setup

The GK420d should be auto-detected by CUPS when plugged in via USB. On this NUC it appears as `ZTC-GK420d`. If CUPS doesn't pick it up:

```bash
# Check USB detection
lsusb | grep -i zebra  # Should show "Zebra Technologies GK420d"

# Configure CUPS
sudo lpadmin -p ZTC-GK420d -E -v "usb://Zebra%20Technologies/ZTC%20GK420d?serial=YOURSERIAL" -m raw
```

Labels used: 3" x 5" thermal labels (no ink!).
