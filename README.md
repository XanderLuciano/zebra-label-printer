# 🦓 Zebra Label Printer

TypeScript library + web UI for Zebra GK420d label printers (and compatible ZPL printers). Print text, barcodes, QR codes, and custom labels — programmatically, via CLI, through a REST API, or from a web dashboard.

## Features

- **Zero-config discovery** — auto-finds Zebra printers via CUPS
- **Fluent ZPL builder** — type-safe label composition with text, 1D barcodes, QR codes, lines, and boxes
- **Label templates** — shipping labels, asset tags, item labels, QR code labels
- **Persistent job queue** — SQLite-backed, survives reboots, auto-retries when printer reconnects
- **Web dashboard** — Nuxt 4 UI with printer status, print history, queue management, debug info
- **Label size management** — API + UI to get/set label dimensions, tracks recent sizes for hot-swapping
- **CLI tool** — quick printing from the terminal
- **REST API** — 18 endpoints with Zod validation and Swagger docs
- **OpenAPI docs** — interactive Swagger UI at `/api/docs`
- **Full TypeScript** — strict mode, types included

## Quick Start

### One-command install (Linux/macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/XanderLuciano/zebra-label-printer/main/install.sh | bash
```

This installs Node.js (if needed), installs the package globally, configures auto-start on boot, and starts the server on port 3420.

### Manual install

```bash
git clone https://github.com/XanderLuciano/zebra-label-printer.git
cd zebra-label-printer
npm install
npm run build
```

### Docker

```bash
docker-compose up -d
# API: http://localhost:3420
# Docs: http://localhost:3420/api/docs
```

The Docker image uses the host's CUPS socket for printer access. For USB passthrough, uncomment the `devices` section in `docker-compose.yml`.

## Running

### API Server

```bash
# Direct
npx tsx src/server/index.ts

# Or via global CLI
zebra-label serve

# With env vars
ZEBRA_PRINTER=ZTC-GK420d PORT=3420 ZEBRA_API_KEY=secret npx tsx src/server/index.ts
```

### Web UI

```bash
cd web
npm install
npm run dev          # → http://localhost:3000
```

The web UI connects to the API server at `http://localhost:3420` (configurable via `NUXT_PUBLIC_API_BASE`).

### CLI

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

## API Reference

All endpoints accept JSON. All POST bodies are validated with Zod — invalid requests get structured 400s with field-level error details.

For full interactive docs, start the server and open **http://localhost:3420/api/docs** (Swagger UI).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/printers` | List available printers |
| GET | `/api/docs` | Swagger UI |
| GET | `/api/docs/openapi.json` | OpenAPI 3.1 spec |
| GET | `/api/jobs` | List print jobs (filterable by status) |
| GET | `/api/jobs/stats` | Job counts by status |
| GET | `/api/jobs/:id` | Job detail with event log |
| POST | `/api/jobs/:id/cancel` | Cancel a pending job |
| GET | `/api/debug` | System diagnostics (printer, queue, DB, server) |
| GET | `/api/settings` | Get all settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/label-size` | Current label size + recent sizes + standard sizes |
| PUT | `/api/label-size` | Set label dimensions |
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

# Get/set label size
curl http://localhost:3420/api/label-size
curl -X PUT http://localhost:3420/api/label-size \
  -H "Content-Type: application/json" \
  -d '{"widthDots": 609, "heightDots": 406, "name": "3×2\" Shipping"}'

# Validation errors return structured details:
curl -X POST http://localhost:3420/api/print/text \
  -H "Content-Type: application/json" \
  -d '{"lines": []}'
# → { "error": "Validation failed", "details": [{ "field": "lines", "message": "At least one line required" }] }
```

## Label Sizes

The API tracks the current label size and recently used sizes. Standard sizes are pre-loaded:

| Name | Size (inches) | Dots (203 DPI) |
|------|---------------|-----------------|
| 2×1" (small) | 2 × 1 | 406 × 203 |
| 3×1" (narrow) | 3 × 1 | 609 × 203 |
| 3×2" (standard) | 3 × 2 | 609 × 406 |
| 3×5" (large) | 3 × 5 | 609 × 1015 |
| 4×6" (shipping) | 4 × 6 | 812 × 1218 |

Set a custom size with `PUT /api/label-size`. It'll be saved to the recent list for quick hot-swapping from the web UI.

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
  db/             → SQLite persistence (jobs, logs, settings)
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

Labels used: thermal direct labels (no ink needed). Default size: 3" × 5".
