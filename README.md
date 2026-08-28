# 🦓 Zebra Label Printer

Print labels on Zebra GK420d printers from any device on your network. Text, barcodes, QR codes, serial numbers — via web dashboard, REST API, or CLI.

```bash
# One-command install (always latest)
curl -fsSL https://raw.githubusercontent.com/XanderLuciano/zebra-label-printer/main/install.sh | bash

# Print a label
curl -X POST http://localhost:3420/api/print/text \
  -H "Content-Type: application/json" \
  -d '{"lines":["Hello World"]}'

# Open the web dashboard
open http://localhost:3420
```

## Quick Install

| Method | Command |
|--------|---------|
| **One-liner** (Linux/Mac) | `curl -fsSL https://raw.githubusercontent.com/XanderLuciano/zebra-label-printer/main/install.sh \| bash` |
| **From source** | `git clone` → `bash build.sh` → `node dist/server/index.js` |
| **Docker** | `docker compose up -d` |
| **npm global** | `npm install -g zebra-label-printer && zebra-label serve` |

Everything runs on **port 3420**: web dashboard at `/`, API at `/api/*`, docs at `/api/docs`.

## Features

- **Web dashboard** — Nuxt 4 UI with printer status, quick print, history, queue management, debug info, settings
- **Persistent job queue** — SQLite-backed, survives reboots, auto-retries when printer reconnects
- **Auto-recovery** — CUPS auto-re-enable on USB disconnect/reconnect
- **Serial number printing** — batch print with auto-incrementing `{serial}` placeholder
- **Multiple printers** — each with its own label stock, DPI, and media settings, so switching
  printers doesn't mean reconfiguring one
- **Print from any browser** — a USB printer plugged into your own machine works over WebUSB
  without installing a second server, and shows up in the same printer list
- **Zod validation** — all endpoints validated, structured 400s with field-level errors
- **OpenAPI docs** — interactive Swagger UI at `/api/docs`
- **ZPL builder** — fluent TypeScript API for text, 8 barcode types, QR codes, Data Matrix
- **CLI tool** — `zebra-label print-text`, `zebra-label print-bc`, `zebra-label discover`
- **Zero-config discovery** — auto-finds Zebra printers via CUPS

## CLI

```bash
zebra-label discover        # List printers
zebra-label print-test       # Test label (text + barcode + QR)
zebra-label print-text "Hi"  # Quick text label
zebra-label print-bc "SKU-123" "Widget"  # Barcode label
zebra-label print-qr "https://example.com" "Scan"  # QR code
zebra-label serve            # Start API + web UI
```

### Docker

```bash
docker-compose up -d
# → http://localhost:3420
```

### Development

```bash
# API server
npx tsx src/server/index.ts    # → :3420

# UI dev (optional — already bundled in API server)
cd web && npm install && npm run dev   # → :3000
```

## API Reference

All endpoints accept JSON. All POST bodies are validated with Zod — invalid requests get structured 400s with field-level error details.

For full interactive docs, start the server and open **http://localhost:3420/api/docs** (Swagger UI).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/printers` | Configured printers + unconfigured CUPS queues |
| POST | `/api/printers` | Configure a printer |
| GET | `/api/printers/discovered` | Raw CUPS discovery |
| GET | `/api/printers/:id` | One configured printer |
| PUT | `/api/printers/:id` | Update a printer's name or label stock |
| DELETE | `/api/printers/:id` | Remove a printer (its print history is kept) |
| POST | `/api/printers/:id/default` | Use this printer when a request names none |
| GET | `/api/docs` | Swagger UI |
| GET | `/api/docs/openapi.json` | OpenAPI 3.1 spec |
| GET | `/api/jobs` | List print jobs (filterable by status) |
| GET | `/api/jobs/stats` | Job counts by status |
| GET | `/api/jobs/:id` | Job detail with event log |
| POST | `/api/jobs/:id/cancel` | Cancel a pending job |
| GET | `/api/debug` | System diagnostics (printer, queue, DB, server) |
| GET | `/api/settings` | Get all settings |
| PUT | `/api/settings` | Update settings |
| POST | `/api/printer/configure` | Push media geometry to a printer (^PW/^ML/^MN) |
| POST | `/api/printer/calibrate` | Run a media sensor calibration (~JC) |
| GET | `/api/label-size` | Legacy global label size (superseded by per-printer config) |
| PUT | `/api/label-size` | Legacy global label size |
| POST | `/api/print/text` | Print text label |
| POST | `/api/print/barcode` | Print barcode label |
| POST | `/api/print/qr` | Print QR code label |
| POST | `/api/print/zpl` | Print raw ZPL (text/plain or JSON) |
| POST | `/api/print/label` | Print composed label from elements |

**Examples:**

```bash
# Health check
curl http://localhost:3420/api/health

# Text label
curl -X POST http://localhost:3420/api/print/text \
  -H "Content-Type: application/json" \
  -d '{"lines": ["Living Room", "Box #3"]}'

# Barcode
curl -X POST http://localhost:3420/api/print/barcode \
  -H "Content-Type: application/json" \
  -d '{"data": "INV-42069", "text": "Inventory Tag"}'

# List configured printers (and anything CUPS sees that isn't set up yet)
curl http://localhost:3420/api/printers

# Configure a printer with its own label stock
curl -X POST http://localhost:3420/api/printers \
  -H "Content-Type: application/json" \
  -d '{"name": "Shipping desk", "cupsName": "ZTC-GK420d",
       "labelSize": {"widthDots": 812, "heightDots": 1218, "name": "4x6\" shipping"}}'

# Print on a specific printer, at that printer's configured size
curl -X POST http://localhost:3420/api/print/text \
  -H "Content-Type: application/json" \
  -d '{"lines": ["Order 1234"], "printerId": "prn_m9x2k1_a7b3c9"}'

# Change what stock a printer is loaded with, and push it to the hardware
curl -X PUT http://localhost:3420/api/printers/prn_m9x2k1_a7b3c9 \
  -H "Content-Type: application/json" \
  -d '{"labelSize": {"widthDots": 609, "heightDots": 406, "name": "3x2\""}}'
curl -X POST http://localhost:3420/api/printer/configure \
  -H "Content-Type: application/json" \
  -d '{"printerId": "prn_m9x2k1_a7b3c9"}'

# Print a part label (QR code + part info, 2x1" layout)
curl -X POST http://localhost:3420/api/print/label \
  -H "Content-Type: application/json" \
  -d '{
    "elements": [
      {"type": "qrcode", "content": "135853-002-A-NRG", "options": {"x": 40, "y": 50, "magnification": 4}},
      {"type": "text", "content": "FTS Lens Mount", "options": {"x": 160, "y": 50, "height": 35, "width": 28}},
      {"type": "text", "content": "135853-002", "options": {"x": 160, "y": 95, "height": 30, "width": 28}},
      {"type": "text", "content": "Rev A | NRG", "options": {"x": 160, "y": 135, "height": 25, "width": 20}}
    ]
  }'

# Print 5 copies of a part label (one label per part)
curl -X POST http://localhost:3420/api/print/label \
  -H "Content-Type: application/json" \
  -d '{
    "elements": [
      {"type": "qrcode", "content": "135853-002-A-NRG", "options": {"x": 40, "y": 50, "magnification": 4}},
      {"type": "text", "content": "FTS Lens Mount", "options": {"x": 160, "y": 50, "height": 35, "width": 28}},
      {"type": "text", "content": "135853-002", "options": {"x": 160, "y": 95, "height": 30, "width": 28}},
      {"type": "text", "content": "Rev A | NRG", "options": {"x": 160, "y": 135, "height": 25, "width": 20}},
      {"type": "raw", "zpl": "^PQ5"}
    ]
  }'

# Validation errors return structured details:
curl -X POST http://localhost:3420/api/print/text \
  -H "Content-Type: application/json" \
  -d '{"lines": []}'
# → { "error": "Validation failed", "details": [{ "field": "lines", "message": "At least one line required" }] }
```

### POST `/api/print/text`

Print a multi-line text label.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `lines` | `string[]` | Yes | — | 1–20 lines of text |
| `copies` | `integer` | No | `1` | Number of copies (1–10) |

### POST `/api/print/barcode`

Print a standalone barcode label.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `data` | `string` | Yes | — | Barcode data to encode |
| `type` | `string` | No | `CODE128` | Barcode type (see supported types below) |
| `text` | `string` | No | — | Optional text printed below the barcode |
| `height` | `integer` | No | `100` | Barcode height in dots (10–1000) |

### POST `/api/print/qr`

Print a QR code label.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `data` | `string` | Yes | — | Data to encode in QR code |
| `text` | `string` | No | — | Optional text printed below the QR code |
| `magnification` | `integer` | No | `5` | QR module size (1–10) |

### POST `/api/print/zpl`

Print raw ZPL commands. Accepts either `text/plain` body (raw ZPL string) or JSON:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `zpl` | `string` | Yes | — | Raw ZPL commands |

### POST `/api/print/label`

Print a composed label from element definitions. Uses the configured label size from settings for print width/height.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `elements` | `array` | Yes | — | Array of label elements (min 1) |
| `copies` | `integer` | No | `1` | Number of copies (1–10) |

Each element has a `type` discriminator. Supported element types:

#### Element: `text`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | `"text"` | Yes | — | Element type |
| `content` | `string` | Yes | — | Text to print |
| `options.x` | `integer` | Yes | — | X position in dots |
| `options.y` | `integer` | Yes | — | Y position in dots |
| `options.font` | `string` | No | `"0"` | Zebra font ID |
| `options.height` | `integer` | No | `24` | Font height in dots |
| `options.width` | `integer` | No | `height × ratio` | Font width in dots (auto-derived from height if not specified) |
| `options.ratio` | `number` | No | `0.8` | Width-to-height ratio (0.1–3.0). Used to derive width from height or height from width when the other is not specified |
| `options.rotation` | `string` | No | `"N"` | Rotation: `N` (normal), `R` (90°), `I` (180°), `B` (270°) |
| `options.reverse` | `boolean` | No | `false` | Reverse print (white on black) |

#### Element: `barcode`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | `"barcode"` | Yes | — | Element type |
| `content` | `string` | Yes | — | Data to encode |
| `options.x` | `integer` | Yes | — | X position in dots |
| `options.y` | `integer` | Yes | — | Y position in dots |
| `options.type` | `string` | **Yes** | — | Barcode type (see table below) |
| `options.height` | `integer` | No | `50` | Barcode height in dots |
| `options.narrowBarWidth` | `integer` | No | `2` | Narrow bar width (1–10) |
| `options.wideBarRatio` | `number` | No | `2.0` | Wide-to-narrow ratio (2.0–3.0) |
| `options.humanReadable` | `boolean` | No | `true` | Print human-readable text below barcode |
| `options.humanReadablePosition` | `string` | No | `"Y"` | `Y` = below, `N` = hidden |
| `options.rotation` | `string` | No | `"N"` | Rotation: `N`, `R`, `I`, `B` |

#### Element: `qrcode`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | `"qrcode"` | Yes | — | Element type |
| `content` | `string` | Yes | — | Data to encode |
| `options.x` | `integer` | Yes | — | X position in dots |
| `options.y` | `integer` | Yes | — | Y position in dots |
| `options.magnification` | `integer` | No | `5` | QR module size (1–10) |
| `options.errorCorrection` | `string` | No | `"M"` | Error correction: `L` (7%), `M` (15%), `Q` (25%), `H` (30%) |

#### Element: `raw`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `type` | `"raw"` | Yes | — | Element type |
| `zpl` | `string` | Yes | — | Raw ZPL commands to inject |

### Part Label Recipe

The web dashboard's "Quick Print Part Label" uses the `/api/print/label` endpoint with this layout (2×1" label at 203 DPI):

```
┌──────────────────────────────────┐
│  ┌─────┐  Part Name             │
│  │ QR  │  Part Number           │
│  │Code │  Rev X | Vendor        │
│  └─────┘                        │
└──────────────────────────────────┘
```

**Barcode convention:** The QR code content is `{partNumber}-{rev}-{vendor}`, which uniquely identifies the exact part variant. For example: `135853-002-A-NRG`.

**Multi-copy printing:** To print one label per physical part, include a `raw` element with `^PQ{n}` where `n` is the quantity. This tells the printer firmware to repeat the label without re-sending data.

**Full example (3 copies):**

```bash
curl -X POST http://localhost:3420/api/print/label \
  -H "Content-Type: application/json" \
  -d '{
    "elements": [
      {"type": "qrcode", "content": "135853-002-A-NRG", "options": {"x": 40, "y": 50, "magnification": 4}},
      {"type": "text", "content": "FTS Lens Mount", "options": {"x": 160, "y": 50, "height": 35, "width": 28}},
      {"type": "text", "content": "135853-002", "options": {"x": 160, "y": 95, "height": 30, "width": 28}},
      {"type": "text", "content": "Rev A | NRG", "options": {"x": 160, "y": 135, "height": 25, "width": 20}},
      {"type": "raw", "zpl": "^PQ3"}
    ]
  }'
```

> **Note:** Use only ASCII characters in text content. Zebra printers do not support UTF-8 — multi-byte characters (em dashes, middle dots, accented letters) will render as garbled output.

### POST `/api/print/serial`

Multi-copy print with auto-incrementing serial numbers. Use `{serial}` as placeholder in lines.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `lines` | `string[]` | Yes | — | 1–20 lines (use `{serial}` placeholder) |
| `copies` | `integer` | Yes | — | Number of copies (1–500) |
| `serialStart` | `integer` | No | `1` | Starting serial number |
| `serialFormat` | `string` | No | `"###"` | Padding format: `#`, `##`, `###`, `####`, `#####` |

### Supported Barcode Types

| Type | Description |
|------|-------------|
| `CODE128` | High-density alphanumeric (most common) |
| `CODE39` | Alphanumeric + symbols |
| `CODE93` | Compact alphanumeric |
| `EAN8` | 8-digit retail (Europe) |
| `EAN13` | 13-digit retail (Europe) |
| `UPCA` | 12-digit retail (North America) |
| `UPCE` | Compressed UPC |
| `CODABAR` | Numeric with start/stop characters |
| `PDF417` | 2D stacked barcode |
| `QRCODE` | 2D QR code (use `qrcode` element type instead) |
| `DATAMATRIX` | 2D Data Matrix |

### Coordinate System

All positions (`x`, `y`) are in **dots** at 203 DPI. The origin (0,0) is the top-left corner of the label.

| Conversion | Formula |
|-----------|---------|
| Inches → dots | `inches × 203` |
| mm → dots | `mm ÷ 25.4 × 203` |

For a **2×1" label**: max X = 406, max Y = 203.  
For a **4×6" label**: max X = 812, max Y = 1218.

## Printers and Label Sizes

Label stock, DPI, and media tracking belong to a **printer**, not to the server. Set up as many
printers as you like and each keeps its own configuration, so switching between a 2×1" printer and a
4×6" one doesn't mean re-entering dimensions and hoping the hardware agrees.

Add printers under **Settings → Printer**. Two kinds show up in the same list:

| Kind | Reached by | Configuration stored | Visible to |
|------|-----------|----------------------|------------|
| **Server** | the host process, via CUPS | the server's database | everyone using the server |
| **Local** | your browser, over WebUSB | your browser | just you, on that machine |

Server printers are adopted from CUPS automatically at startup, so an existing install comes up
already configured. Local printers are for when the person printing isn't sitting at the machine
running the server: plug a printer into your own computer, click **Connect USB printer**, and print
to it without a second server install. Jobs are recorded in print history either way.

Local USB printing needs a Chromium-based browser (Chrome or Edge) on HTTPS or localhost, and the
printer must not be held exclusively by the OS — on Windows switch it to the WinUSB driver (Zadig);
on macOS and Linux, remove it from CUPS if the connection is refused.

Prints from the API go to the printer named by `printerId`, or to the default printer if none is
named. `POST /api/printers/:id/default` sets that default, which is also what raw TCP (port 9100)
prints use.

### Standard sizes

These are offered when configuring a printer, alongside custom dimensions in inches:

| Name | Size (inches) | Dots (203 DPI) |
|------|---------------|-----------------|
| 2×1" (small) | 2 × 1 | 406 × 203 |
| 3×1" (narrow) | 3 × 1 | 609 × 203 |
| 3×2" (standard) | 3 × 2 | 609 × 406 |
| 3×5" (large) | 3 × 5 | 609 × 1015 |
| 4×6" (shipping) | 4 × 6 | 812 × 1218 |

Saving a size also sends it to the printer as `^PW` / `^ML` / `^MN`. That step matters: the printer
keeps its own stored print width and gap settings, so changing the size in software alone can still
produce clipped, drifting, or blank-fed labels. Use **Apply & calibrate** after swapping stock so the
gap sensor re-measures the new labels.

Each job records the geometry it was rendered for, so print history shows what actually came out of
the printer rather than redrawing old jobs at whatever size is configured now.

## Use as a Library

```ts
import { Printer, ZPLBuilder, PrintQueue } from 'zebra-label-printer';

// Auto-connect to any Zebra printer
const printer = await Printer.auto();

// Build a label
const zpl = new ZPLBuilder()
  .text('Hello World!', { x: 50, y: 50, height: 40, font: 'D' })
  .barcode('ABC-12345', { x: 50, y: 120, type: 'CODE128', height: 80 })
  .qrcode('https://example.com', { x: 50, y: 250, magnification: 5 })
  .build();

// Print with queue (persists to SQLite, auto-retries)
const queue = new PrintQueue(printer);
queue.start();
const result = await queue.submit('text', { lines: ['Hello'] }, () => zpl);
```

## Network Setup

1. Start the server on the machine connected to the printer:
   ```bash
   npx tsx src/server/index.ts
   ```
2. Any device on the same network can print:
   ```bash
   curl -X POST http://printer-host:3420/api/print/text \
     -H "Content-Type: application/json" \
     -d '{"lines": ["Hello from my laptop!"]}'
   ```
3. For PM2 (auto-start on boot):
   ```bash
   pm2 start npx --name zebra-label -- tsx src/server/index.ts
   pm2 save
   ```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ZEBRA_PRINTER` | auto-detect | CUPS printer name |
| `ZEBRA_API_KEY` | none | API key for Bearer auth |
| `PORT` | 3420 | Server port |
| `ZEBRA_DB_PATH` | `./data/zebra-label-printer.db` | SQLite database path |
| `NUXT_PUBLIC_API_BASE` | `http://localhost:3420` | API URL for web UI |

## Project Structure

```
src/              → TypeScript library + API server
  server/         → Modular HTTP server
  db/             → SQLite persistence (printers, jobs, logs, settings)
  printer-registry.ts → Resolves a printer id to a connection and its label geometry
  queue.ts        → Persistent job queue with background processor
web/              → Nuxt 4 web dashboard
Dockerfile        → Docker image
docker-compose.yml→ Docker orchestration
install.sh        → One-command install script
AI-MAP.md         → Agent quick-reference
```

## Printer Setup

The GK420d should be auto-detected by CUPS when plugged in via USB. On this NUC it appears as `ZTC-GK420d`. If CUPS doesn't pick it up:

```bash
# Check USB detection
lsusb | grep -i zebra  # Should show "Zebra Technologies GK420d"

# Configure CUPS
sudo lpadmin -p ZTC-GK420d -E -v "usb://Zebra%20Technologies/ZTC%20GK420d?serial=YOURSERIAL" -m raw
```

Once CUPS can see it, the server registers it on startup and it appears under **Settings → Printer**.
Set the label size it's loaded with there; each printer remembers its own.

Labels used: thermal direct labels (no ink needed). A newly registered printer defaults to 3" × 5".

The server starts fine with no printer attached — useful if everyone prints to their own USB printer
from the browser instead.
