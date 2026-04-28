# AI-MAP — Zebra Label Printer Quick Reference

> Master index for AI agents. Consult this FIRST before searching the codebase.

## Project Overview

`zebra-label-printer` is a TypeScript library and HTTP microservice for Zebra GK420d (and compatible ZPL) label printers. It handles printer discovery, label composition (text, 1D/2D barcodes, QR codes, lines, boxes), and exposes a REST webhook so any device on the network can print labels.

**Status**: All core features implemented. Zod validation on all endpoints. OpenAPI 3.1 docs with Swagger UI. Global CLI available.

## Tech Stack

| Layer | Tech |
|-------|------|
| Language | TypeScript 5.x (strict mode, CommonJS) |
| Runtime | Node.js ≥ 18 |
| HTTP Server | Node.js built-in `http` module (zero external HTTP deps) |
| Validation | Zod 4.x |
| API Docs | OpenAPI 3.1 spec + Swagger UI (CDN-hosted) |
| Printing | CUPS (`lp` command) via child_process |
| CLI | Node.js shebang script, npm global install |
| Testing | Vitest |

## Project Structure

```
src/
  index.ts              → Public API barrel export
  types.ts              → All TypeScript interfaces and types
  cli.ts                → CLI tool (shebang, npm bin target)
  printer.ts            → Printer class: connect, auto-discover, print ZPL via CUPS
  discovery.ts          → CUPS-based printer discovery with Zebra detection
  zpl.ts                → ZPLBuilder fluent API + convenience functions + unit helpers
  label.ts              → High-level label templates (shipping, asset, item, QR)
  schemas.ts            → Zod validation schemas for all API endpoints
  openapi.ts            → OpenAPI 3.1 spec object + Swagger UI HTML generator
  webhook.ts            → Thin re-export + standalone entry point
  server/               → Modular HTTP server (split from webhook.ts)
    index.ts            → WebhookServer class + startServer() + entry point
    helpers.ts          → json(), html(), readBody(), parseJson(), validate(), checkAuth()
    router.ts           → Route table types, findHandler(), sendNotFound(), printRoutes()
    handlers/
      get-routes.ts     → GET handlers: health, printers, OpenAPI spec, Swagger UI
      post-routes.ts    → POST handlers: text, barcode, QR, raw ZPL, composed label
dist/                   → Compiled output (gitignored, shipped in npm package)
package.json            → npm metadata, bin entry, scripts
tsconfig.json           → TypeScript config
README.md               → Human-readable docs
AI-MAP.md               → This file
```

## Run Commands

| Action | Command | Notes |
|--------|---------|-------|
| Build | `npm run build` | `tsc` |
| Dev server | `npm run dev` | `tsx watch src/webhook.ts` |
| Test | `npm run test` | `vitest run` |
| Test watch | `npm run test:watch` | `vitest` |
| CLI discover | `npm run discover` | Lists printers |
| CLI test print | `npm run print:test` | Prints a test label |
| Global CLI | `zebra-label <cmd>` | After `npm install -g .` |
| Webhook serve | `npx tsx src/cli.ts serve` | Start API server |
| Print text | `npx tsx src/cli.ts print-text "Hello"` | Quick text label |
| Print barcode | `npx tsx src/cli.ts print-bc "DATA" "Label"` | Quick barcode |
| Print QR | `npx tsx src/cli.ts print-qr "https://..." "Label"` | Quick QR code |

## Key Entry Points

| What | File |
|------|------|
| Library entry | `src/index.ts` |
| CLI entry (npm bin) | `src/cli.ts` → `dist/cli.js` |
| Webhook server | `src/server/index.ts` (WebhookServer class) |
| Printer connection | `src/printer.ts` (Printer class) |
| ZPL builder | `src/zpl.ts` (ZPLBuilder class) |
| Label templates | `src/label.ts` |
| API schemas | `src/schemas.ts` |
| API docs | `src/openapi.ts` |
| Discovery | `src/discovery.ts` |
| Type definitions | `src/types.ts` |

## Architecture

```
CLI (cli.ts) ──────────────────────────────────────────────┐
                                                            │
Webhook Clients ──→ HTTP (server/index.ts)                  │
                        │                                   │
                        ├── handlers/get-routes.ts          │
                        ├── handlers/post-routes.ts         │
                        ├── helpers.ts (json, validate)     │
                        └── router.ts (dispatch)            │
                              │                             │
                              ▼                             │
                        Printer (printer.ts) ←──────────────┘
                              │
                              ├── Discovery (discovery.ts) ── CUPS (lpstat)
                              ├── ZPL (zpl.ts) ── label composition
                              ├── Templates (label.ts) ── high-level layouts
                              └── Schemas (schemas.ts) ── Zod validation
                                     │
                                     ▼
                              CUPS `lp` command ──→ Printer USB
```

**Dependency flow**: HTTP handlers → Printer → CUPS. No circular dependencies. Each module has a single responsibility.

**Server internals** (`src/server/`):
- `helpers.ts` — Pure utility functions (no class state)
- `router.ts` — Route table types and dispatch logic
- `handlers/get-routes.ts` — Each GET endpoint is a Handler or factory function
- `handlers/post-routes.ts` — Each POST endpoint validates → formats → prints → responds
- `index.ts` — `WebhookServer` ties routes to HTTP server, manages lifecycle

## API Routes

| Method | Path | Handler | Schema |
|--------|------|---------|--------|
| GET | `/api/health` | `healthHandler` | — |
| GET | `/api/printers` | `printersHandler()` | — |
| GET | `/api/docs` | `docsHandler` | — |
| GET | `/api/docs/openapi.json` | `openApiHandler` | — |
| POST | `/api/print/text` | `printTextHandler()` | `textLabelSchema` |
| POST | `/api/print/barcode` | `printBarcodeHandler()` | `barcodeLabelSchema` |
| POST | `/api/print/qr` | `printQrHandler()` | `qrLabelSchema` |
| POST | `/api/print/zpl` | `printZplHandler()` | `zplSchema` (union) |
| POST | `/api/print/label` | `printLabelHandler()` | `labelSchema` |

## Adding a New Endpoint

1. Add a Zod schema in `src/schemas.ts` (if accepting a request body)
2. Create a handler function (or factory) in the appropriate `src/server/handlers/*.ts`
3. Register the handler in `src/server/index.ts` → `buildRoutes()`
4. Add the route to `src/openapi.ts` → `OPENAPI_SPEC.paths`
5. Export the schema type from `src/index.ts` if it's part of the public API

## Printer Notes

- **Connection**: USB, detected by CUPS as `ZTC-GK420d`
- **Label size**: 3" × 5" (609 × 1015 dots at 203 DPI)
- **ZPL**: Text labels print with the raw `-o raw` CUPS flag (bypasses CUPS filtering)
- **No ink needed**: Thermal direct printing — the labels have heat-sensitive coating
- **Discovery fallback**: If CUPS is unavailable, direct USB discovery can be added to `src/discovery.ts`
