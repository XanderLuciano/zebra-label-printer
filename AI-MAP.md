# AI-MAP — Zebra Label Printer Quick Reference

> Master index for AI agents. Consult this FIRST before searching the codebase.  
> Backend: TypeScript + SQLite. Frontend: Nuxt 4 + NuxtUI 4.

> Master index for AI agents. Consult this FIRST before searching the codebase.

## Project Overview

`zebra-label-printer` is a TypeScript library and HTTP microservice for Zebra GK420d (and compatible ZPL) label printers. It handles printer discovery, label composition (text, 1D/2D barcodes, QR codes, lines, boxes), and exposes a REST webhook so any device on the network can print labels.

**Status**: All core features implemented. Zod validation on all endpoints. OpenAPI 3.1 docs with Swagger UI. Global CLI available.

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend Runtime | Node.js ≥ 18 (raw http module) |
| Language | TypeScript 5.x (strict mode, CommonJS) |
| Database | SQLite via better-sqlite3 (WAL mode) |
| Validation | Zod 4.x |
| API Docs | OpenAPI 3.1 spec + Swagger UI (CDN-hosted) |
| Printing | CUPS (`lp` command) via child_process |
| CLI | Node.js shebang script, npm global install |
| Web UI | Nuxt 4 + NuxtUI 4 (Vue 3, Tailwind CSS v4) |
| UI Icons | @iconify-json/lucide |
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
  db/                   → SQLite persistence layer
    database.ts         → getDb() singleton, WAL mode, auto-migrations
    print-job-repo.ts   → CRUD for print_jobs and job_logs tables
    settings-repo.ts    → Key/value settings store + printer events
  queue.ts              → PrintQueue: persistent job queue with background processor
  webhook.ts            → Thin re-export + standalone entry point
  server/               → Modular HTTP server (split from webhook.ts)
    index.ts            → WebhookServer class + startServer() + entry point
    helpers.ts          → json(), html(), readBody(), parseJson(), validate(), checkAuth()
    router.ts           → Route table types, findHandler(), sendNotFound(), printRoutes()
    handlers/
      get-routes.ts     → GET handlers: health, printers, OpenAPI spec, Swagger UI
      post-routes.ts    → POST handlers: text, barcode, QR, raw ZPL, composed label
dist/                   → Compiled output (gitignored, shipped in npm package)
web/                    → Nuxt 4 Web UI (separate package)
  nuxt.config.ts        → Nuxt config (modules: @nuxt/ui, @nuxt/eslint)
  app/
    app.config.ts       → NuxtUI color theme (primary: blue)
    app.vue             → Root layout: UApp + UDashboardGroup + sidebar
    assets/css/main.css → Tailwind v4 + NuxtUI imports
    pages/
      index.vue         → Dashboard: status cards, quick print, system info
      history.vue       → Print history: filterable job table
      queue.vue         → Queue: job list + detail panel + event log
      debug.vue         → Debug: printer, queue, DB, server diagnostics
      settings.vue      → Settings: label size, API key, queue interval
    composables/
      useApi.ts         → API client wrapping $fetch with typed methods
package.json            → npm metadata, bin entry, scripts
tsconfig.json           → TypeScript config
README.md               → Human-readable docs
AI-MAP.md               → This file
```

## Run Commands

| Action | Command | Notes |
|--------|---------|-------|
| Build backend | `npm run build` | `tsc` |
| Webhook server | `npx tsx src/server/index.ts` | API on :3420 |
| Nuxt dev | `cd web && npm run dev` | UI on :3000 |
| Nuxt build | `cd web && npm run build` | Output to web/.output/ |
| Nuxt preview | `cd web && npm run preview` | Preview production build |
| Test | `npm run test` | `vitest run` |
| Global CLI | `zebra-label <cmd>` | After `npm install -g .` |
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
| Queue system | `src/queue.ts` (PrintQueue class) |
| Database | `src/db/database.ts` (getDb singleton) |
| Job repository | `src/db/print-job-repo.ts` |
| Settings repository | `src/db/settings-repo.ts` |
| ZPL builder | `src/zpl.ts` (ZPLBuilder class) |
| Label templates | `src/label.ts` |
| API schemas | `src/schemas.ts` |
| API docs | `src/openapi.ts` |
| Discovery | `src/discovery.ts` |
| Type definitions | `src/types.ts` |
| Web UI app | `web/app/app.vue` |
| API client | `web/app/composables/useApi.ts` |
| Nuxt config | `web/nuxt.config.ts` |

## Architecture

```
Nuxt Web UI (web/) ──→ HTTP API (server/index.ts)
                             │
                             ├── PrintQueue (queue.ts)
                             │     ├── Immediate print attempt
                             │     ├── Fallback: persist to SQLite
                             │     └── Background processor
                             │
                             ├── Handlers (server/handlers/)
                             │     ├── GET: health, jobs, debug, settings
                             │     └── POST: print operations → queue
                             │
                             ├── Printer (printer.ts)
                             │     └── CUPS lp command → USB printer
                             │
                             └── Database (db/)
                                   ├── print_jobs + job_logs
                                   ├── settings (key/value)
                                   └── printer_events
```

**Dependency flow**: Nuxt UI → HTTP API → PrintQueue → Printer → CUPS → Device.  
**Persistence**: All jobs, logs, settings, and events stored in SQLite (WAL mode).  
**Reliability**: Jobs queue automatically if printer offline; processor retries on reconnect.

## API Routes

| Method | Path | Handler | Schema |
|--------|------|---------|--------|
| GET | `/api/health` | `healthHandler` | — |
| GET | `/api/printers` | `printersHandler()` | — |
| GET | `/api/docs` | `docsHandler` | — |
| GET | `/api/docs/openapi.json` | `openApiHandler` | — |
| GET | `/api/jobs` | `jobsListHandler()` | — |
| GET | `/api/jobs/stats` | `jobsStatsHandler()` | — |
| GET | `/api/jobs/:id` | `jobDetailHandler()` | — |
| POST | `/api/jobs/:id/cancel` | `jobCancelHandler()` | — |
| GET | `/api/debug` | `debugHandler()` | — |
| GET | `/api/settings` | `settingsGetHandler()` | — |
| PUT | `/api/settings` | `settingsPutHandler()` | — |
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

## Release Checklist

When tagging a new release:

1. **Update version** in `package.json` and `web/package.json`
2. **Run the build** — `bash build.sh` — verify it completes clean
3. **Tag and push:**
   ```bash
   VER=v0.2.0
   git tag -a $VER -m "$VER — <one-line summary>"
   git push --tags
   ```
4. **Verify** the release at https://github.com/XanderLuciano/zebra-label-printer/releases
5. **No README changes needed** — install URLs use `main` branch, always current

### Changelog

| Version | Date | Changes |
|---------|------|---------|
| v0.1.0 | 2026-04-27 | Initial release: ZPL builder, job queue, Nuxt 4 web UI, serial printing, label size management, Docker, one-command install |
