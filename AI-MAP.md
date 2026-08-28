# AI-MAP — Zebra Label Printer Quick Reference

> Master index for AI agents. Consult this FIRST before searching the codebase.  
> Backend: TypeScript + SQLite. Frontend: Nuxt 4 + NuxtUI 4.

> Master index for AI agents. Consult this FIRST before searching the codebase.

## Project Overview

`zebra-label-printer` is a TypeScript library and HTTP microservice for Zebra GK420d (and compatible ZPL) label printers. It handles printer discovery, label composition (text, 1D/2D barcodes, QR codes, lines, boxes), and exposes a REST webhook so any device on the network can print labels.

**Status**: All core features implemented. Multiple printers, each with its own label stock and
media configuration — server-side (CUPS) and browser-attached (WebUSB) in one list. Zod validation
on all endpoints. OpenAPI 3.1 docs with Swagger UI. Global CLI available.

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
    printer-repo.ts     → CRUD for configured printers + their per-printer media config
    settings-repo.ts    → Key/value settings store + printer events
    template-repo.ts    → CRUD for label_templates (JSON blob + mirrored columns)
    template-seed.ts    → Built-in example templates + one-time idempotent seeding
  printer-registry.ts   → PrinterRegistry: printer id → live connection, geometry resolution
  queue.ts              → PrintQueue: persistent job queue with background processor
  webhook.ts            → Thin re-export + standalone entry point
  server/               → Modular HTTP server (split from webhook.ts)
    index.ts            → WebhookServer class + startServer() + entry point
    helpers.ts          → json(), html(), readBody(), parseJson(), validate(), checkAuth()
    router.ts           → Route table types, findHandler(), sendNotFound(), printRoutes()
    handlers/
      get-routes.ts     → GET handlers: health, discovery, OpenAPI spec, Swagger UI, label size
      post-routes.ts    → POST handlers: text, barcode, QR, raw ZPL, composed label, job result
      printer-registry-routes.ts → Printer CRUD: configure printers and their label stock
      printer-routes.ts → POST handlers: media configuration (^PW/^ML/^MN) + calibration (~JC)
      template-routes.ts→ Template CRUD + /api/render/zpl (build ZPL without printing)
dist/                   → Compiled output (gitignored, shipped in npm package)
web/                    → Nuxt 4 Web UI (separate package)
  nuxt.config.ts        → Nuxt config (modules: @nuxt/ui, @nuxt/eslint)
  app/
    app.config.ts       → NuxtUI color theme (primary: blue)
    app.vue             → Root layout: UApp + UDashboardGroup + sidebar
    assets/css/main.css → Tailwind v4 + NuxtUI imports
    pages/
      index.vue         → Dashboard: status cards, quick print, system info
      part-label.vue    → Part/bag label form
      print.vue         → Print from a saved template: pick one, fill its variables, print
      designer.vue      → Template designer: canvas, per-size overrides, Labelary preview
      history.vue       → Print history: filterable job table + per-job label previews
      queue.vue         → Queue: job list + detail panel + event log
      debug.vue         → Debug: printer, queue, DB, server diagnostics
      settings.vue      → Settings: printers (via PrinterManager), queue, security, updates
    components/
      TemplateCanvas.vue→ Interactive designer surface (SVG, drag, rotation-aware)
      LabelPreview.vue  → Read-only SVG label preview (history, dashboard)
      PrinterManager.vue→ Pick a printer, then configure that printer's label stock and media
    composables/
      useApi.ts         → API client wrapping $fetch with typed methods
      useTemplateEngine.ts → Template model, resolveTemplate(), ZPL rotation geometry
      useZplFonts.ts       → Measured ZPL font metrics (advance widths, cap heights, magnification)
      useLocalPrinter.ts   → WebUSB connections to directly attached printers, keyed by device
      usePrinters.ts       → The printer list: server printers + this browser's USB printers
      usePrintTarget.ts    → Print dispatch to the selected printer (+ config/calibrate)
    types/
      webusb.d.ts       → Ambient WebUSB declarations (not in the TS DOM lib)
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
      │                      │
      │                      ├── PrintQueue (queue.ts)
      │                      │     ├── Immediate print attempt
      │                      │     ├── Fallback: persist to SQLite
      │                      │     └── Background processor (scans per printer)
      │                      │
      │                      ├── PrinterRegistry (printer-registry.ts)
      │                      │     ├── printer id → Printer connection (cached)
      │                      │     └── resolveJobLabelSize(): which geometry to render for
      │                      │
      │                      ├── Handlers (server/handlers/)
      │                      │     ├── GET:  health, printers, jobs, debug, settings
      │                      │     └── POST: printer CRUD, print operations → queue
      │                      │
      │                      ├── Printer (printer.ts)
      │                      │     └── CUPS lp command → USB printer
      │                      │
      │                      └── Database (db/)
      │                            ├── printers  ← per-printer media config
      │                            ├── print_jobs (+ printer_id) + job_logs
      │                            ├── settings (key/value)
      │                            └── printer_events
      │
      └── WebUSB ──→ USB printer attached to the browser's own machine
            (config in localStorage; ZPL still generated and recorded server-side)
```

**Dependency flow**: Nuxt UI → HTTP API → PrintQueue → PrinterRegistry → Printer → CUPS → Device.  
**Persistence**: All printers, jobs, logs, settings, and events stored in SQLite (WAL mode).  
**Reliability**: Jobs queue automatically if their printer is offline; the processor retries on
reconnect, and a job waiting on one printer doesn't block jobs bound for another.

### Per-printer configuration

Label size, DPI, and media tracking belong to a **printer**, not to the server. They used to be
one global setting, which could only ever describe one printer: with a local 2×1" printer and a
server 4×6" printer set up at once, configuring either silently redefined the geometry for both,
and nothing checked that the printer you were about to print on was loaded with that stock.

Three distinct things are all called "printer". Keeping them apart matters:

| Type | Meaning | Lives in |
|------|---------|----------|
| `PrinterInfo` | A printer *discovered* from CUPS. Transient. | `discovery.ts` |
| `PrinterProfile` | A printer *configured* by a user, with its own media config. | `printers` table, or browser localStorage |
| `Printer` | An open *connection* used to send ZPL. | `printer.ts`, cached by `PrinterRegistry` |

Where a profile is stored depends on who can reach the printer:

- **Server printers** live in the `printers` table and are visible to every client.
  `PrinterRegistry.sync()` adopts discovered CUPS queues at startup, so an existing install comes
  up already configured. Re-adoption is idempotent and never overwrites saved config.
- **Local printers** are USB devices reached over WebUSB. That pairing is granted to one browser
  profile on one machine and can't be shared, so those profiles live in `localStorage` keyed by a
  stable `usb-{vendor}-{product}-{serial}` device id, with profile ids prefixed `local_`.

Both use the same `PrinterProfile` shape, so the UI and the print path don't branch on kind. Only
the storage location and the final transport differ.

**Starting with no printer is valid.** Someone printing only to a browser-attached USB printer has
no CUPS queue on the host, so `WebhookServer.start()` returns `Printer | null` and `Handler`
receives `Printer | null`. Handlers that need one answer 503.

### Which label size a job is rendered for

`resolveJobLabelSize()` in `printer-registry.ts` is the single rule. Most specific first:

1. An explicit `labelSize` on the request — how a browser-attached printer supplies its geometry,
   since the server has nothing to look up for it.
2. The named printer's saved configuration.
3. The default printer's saved configuration.
4. The legacy global `label_size` setting, for installs with no printers configured and for
   library/CLI callers with no registry.

Whatever it returns is frozen onto the job (`print_jobs.label_*`), so a queued job still prints at
the size it was composed for even if its printer is reconfigured first. Don't add a second copy of
this logic.

### Per-printer queueing

`print_jobs.printer_id` records the printer a job is bound for. It's deliberately **not** a foreign
key: browser-owned printers have no server row, and deleting a printer must not delete its history.

`PrintQueue.processNext()` walks a window of pending jobs (`PENDING_SCAN_LIMIT`) rather than only
the head, resolving each job's printer through the registry. Jobs whose printer can't be resolved
are **skipped, never reassigned** — printing a job on a printer it wasn't rendered for would put it
on the wrong label stock.

## API Routes

| Method | Path | Handler | Schema |
|--------|------|---------|--------|
| GET | `/api/health` | `healthHandler` | — |
| GET | `/api/printers` | `printersListHandler()` | — |
| POST | `/api/printers` | `printerCreateHandler()` | `printerCreateSchema` |
| GET | `/api/printers/discovered` | `printersDiscoveredHandler()` | — |
| GET | `/api/printers/:id` | `printerGetHandler()` | — |
| PUT | `/api/printers/:id` | `printerUpdateHandler()` | `printerUpdateSchema` |
| DELETE | `/api/printers/:id` | `printerDeleteHandler()` | — |
| POST | `/api/printers/:id/default` | `printerSetDefaultHandler()` | — |
| GET | `/api/docs` | `docsHandler` | — |
| GET | `/api/docs/openapi.json` | `openApiHandler` | — |
| GET | `/api/jobs` | `jobsListHandler()` | — |
| GET | `/api/jobs/stats` | `jobsStatsHandler()` | — |
| GET | `/api/jobs/:id` | `jobDetailHandler()` | — |
| POST | `/api/jobs/:id/cancel` | `jobCancelHandler()` | — |
| GET | `/api/debug` | `debugHandler()` | — |
| POST | `/api/jobs/:id/result` | `jobResultHandler()` | `jobResultSchema` |
| GET | `/api/settings` | `settingsGetHandler()` | — |
| PUT | `/api/settings` | `settingsPutHandler()` | — |
| GET | `/api/label-size` | `labelSizeGetHandler()` | — |
| PUT | `/api/label-size` | `labelSizePutHandler()` | — |
| POST | `/api/printer/configure` | `printerConfigureHandler()` | `printerConfigSchema` |
| POST | `/api/printer/calibrate` | `printerCalibrateHandler()` | `printerCalibrateSchema` |
| POST | `/api/print/text` | `printTextHandler()` | `textLabelSchema` |
| POST | `/api/print/barcode` | `printBarcodeHandler()` | `barcodeLabelSchema` |
| POST | `/api/print/qr` | `printQrHandler()` | `qrLabelSchema` |
| POST | `/api/print/zpl` | `printZplHandler()` | `zplSchema` (union) |
| POST | `/api/print/label` | `printLabelHandler()` | `labelSchema` |
| POST | `/api/print/serial` | `printSerialHandler()` | `serialLabelSchema` |
| POST | `/api/render/zpl` | `renderZplHandler()` | `renderZplSchema` |

### Choosing a printer on a print request

Every print endpoint accepts:

| Field | Meaning |
|-------|---------|
| `printerId` | Which printer to use. Omit for the default. **Prefer this.** |
| `labelSize` | `{widthDots, heightDots, dpi?}` overriding the printer's saved geometry |
| `printerName` | Name to record on the job, for printers the server can't name itself |
| `target` | `server` \| `local` — the older, coarser choice; still honoured |

A `printerId` beginning `local_` is decisive on its own: only the browser holding that WebUSB handle
can print to it, so the ZPL comes back to the caller whatever `target` says. Those requests must
include `labelSize`, because the server has no stored config for a browser's printer.

- **Server printer** — the job goes through `PrintQueue` to CUPS on the host, rendered at that
  printer's saved geometry.
- **Browser printer** — the job is persisted with its label-size snapshot and the generated ZPL is
  returned instead of printed. The browser sends it over WebUSB, then finalizes the job with
  `POST /api/jobs/:id/result`.

Both paths produce identical job records, so print history and reprints don't care which printer the
label came out of. A `printerId` that doesn't match a configured printer is a **404** rather than a
silent fallback — the point of naming a printer is that the label lands on the right stock.

### Timestamp defaults: use `sql`, never a plain string

Declare current-time defaults as:

```ts
createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
```

**Not** `.default("(datetime('now'))")`. The plain string form is a trap that bit every
timestamp column in this schema. It produces two separate faults:

1. drizzle-kit emits `DEFAULT '(datetime(''now''))'` — a quoted SQL *literal*, so SQLite
   stores the text `(datetime('now'))` rather than a date.
2. Drizzle also inlines that string into the `INSERT` it generates, so a correct DDL alone
   doesn't save you.

The effect was silent: `datetime(created_at)` returned null, so print-history dates rendered
as a non-date and ordering by `created_at` was ordering by a constant. Migration
`0004_fix_timestamp_defaults` corrects the DDL and repairs existing rows —
`print_jobs.created_at` exactly, since `print_jobs.id` embeds `Date.now()`; `job_logs` from
their parent job; anything else to the epoch, which reads as "unknown" instead of inventing a
plausible date. `test/db/timestamps.test.ts` guards both faults.

That migration is **hand-written, not generated**. drizzle-kit's version rebuilds `job_logs`
with its `ON DELETE CASCADE` foreign key intact and then drops `print_jobs`, which with
`foreign_keys=ON` (set in `database.ts`) cascade-deletes every log row. Its
`PRAGMA foreign_keys=OFF` header does not help — SQLite ignores that pragma inside a
transaction, and the migrator runs in one. **Any future migration that rebuilds `print_jobs`
must drop the `job_logs` foreign key first and restore it afterwards.**

## Adding a New Endpoint

1. Add a Zod schema in `src/schemas.ts` (if accepting a request body)
2. Create a handler function (or factory) in the appropriate `src/server/handlers/*.ts`
3. Register the handler in `src/server/index.ts` → `buildRoutes()`
4. Add the route to `src/openapi.ts` → `OPENAPI_SPEC.paths`
5. Export the schema type from `src/index.ts` if it's part of the public API

## Printer Notes

- **Connection**: USB, detected by CUPS as `ZTC-GK420d`. Browsers can also reach a
  directly attached printer over WebUSB (`useLocalPrinter`), bypassing CUPS.
- **Label size**: per printer, defaulting to 3" × 5" (609 × 1015 dots at 203 DPI)
  for a newly registered printer. See "Per-printer configuration" above.
- **ZPL**: Text labels print with the raw `-o raw` CUPS flag (bypasses CUPS filtering)
- **No ink needed**: Thermal direct printing — the labels have heat-sensitive coating
- **Discovery fallback**: If CUPS is unavailable, direct USB discovery can be added to `src/discovery.ts`

### Media configuration (`^PW` / `^ML` / `^MN`)

Changing a printer's label size in this app is not enough on its own — the printer
keeps its own stored print width and media settings, which is how a size change ends
up producing clipped, offset, or blank-fed labels. `mediaConfigZpl()` in `src/zpl.ts`
generates the commands that fix that. Saving a size in Settings sends them to that
printer automatically; `POST /api/printer/configure` with a `printerId` does it on
demand, and an otherwise-empty body means "apply this printer's own saved config",
which is what you want after swapping stock or moving the printer to another machine.

- `^PW` print width, `^ML` maximum label length (set 1" past the label so the gap
  search can reach the next gap), `^LH0,0` origin reset, `^MN` media tracking,
  `^JUS` to persist.
- `^LL` is only emitted for **continuous** media. Zebra documents it as ignored on
  non-continuous gap/mark stock, where the length comes from the gap sensor.
- **`^MN` letters are counterintuitive**: `N` means *continuous*, `Y`/`W` mean
  non-continuous web sensing, `M` is mark sensing, `A` is auto-detect. See
  `MEDIA_TRACKING_CODES` in `src/zpl.ts`; getting these backwards stops the printer
  looking for gaps.
- `~JC` (`calibrationZpl()`) runs a sensor calibration and feeds 2–4 labels. Always
  send the media config first so calibration knows the media type and search window.

### Fonts and text metrics

`web/app/composables/useZplFonts.ts` holds measured metrics for the built-in `^A`
fonts, so the designer canvas sizes and spaces text the way the printer does.
Font `0` is CG Triumvirate Bold Condensed and *proportional* — `iiii` and `WWWW`
are not the same width — while `A`–`H` are fixed-width bitmaps that only render at
whole magnifications of their cell, so requested sizes snap. `^FO` anchors the
character **cell**, not the ink, which is what makes rotation land correctly.

The preview faces in `web/public/fonts` are metric-matched substitutes; the
printer's own fonts are licensed firmware typefaces that can't be shipped. See
that folder's README for the licences and why.

### `^BY` and barcode module width

Module width is printer **state**, and `^BQ` leaves its QR magnification behind in
it. A QR followed by a 1D barcode therefore used to stretch the barcode (a
magnification-8 QR turned a 422-dot CODE128 into 1688 dots, clipped off the
label). `ZPLBuilder.barcode()` now emits `^BY{narrow},{ratio}` per barcode, which
also makes `narrowBarWidth` take effect at all — it was previously appended to the
barcode command, where `^BC` reads that slot as "print interpretation line above".
Note `^B3` (CODE39) and `^BK` (CODABAR) take a check-digit flag *before* the
height, unlike the others.

### ZPL rotation geometry

`^FO x,y` is the top-left corner of a field's **rotated** bounding box, and quarter
turns (`R`, `B`) swap width and height. Verified by measuring Labelary renders; see
the table in `web/app/composables/useTemplateEngine.ts`. `rotationTransform()` and
`rotatedBounds()` encode this so the designer canvas and history preview match the
printed output. `^GB` has no rotation parameter, so box rotation is baked into its
dimensions instead.

### Print history and label size

`print_jobs` carries `label_width_dots`, `label_height_dots`, and `label_dpi`,
frozen when the job is created, plus `printer_id` for which printer it went to.
History renders each job at its recorded size rather than the current setting —
otherwise switching label stock silently redraws every past job at the new
dimensions. Rows created before migration `0002_print_job_label_size` have nulls
and fall back to the configuration of the printer the job went to, flagged in the UI.

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
| unreleased | — | Per-printer configuration: `printers` table, `PrinterRegistry`, printer CRUD API, `printerId` on print requests, per-printer queueing, multi-device WebUSB, unified printer list in Settings. Fixed timestamp defaults storing a string literal instead of a date (migration `0004`) |
| v0.1.0 | 2026-04-27 | Initial release: ZPL builder, job queue, Nuxt 4 web UI, serial printing, label size management, Docker, one-command install |
