# Testing Strategy — Zebra Label Printer

> Unit tests, integration tests, and property-based tests.

## Test Stack

- Vitest 2.x (test runner)
- `better-sqlite3` (in-memory for unit tests, temp files for integration)
- `fast-check` (property-based testing, planned)

## Commands

| Command | What it does |
|---------|-------------|
| `npm test` | `vitest run` — single pass, all tests |
| `npm run test:watch` | `vitest` — watch mode |
| `npx vitest run test/unit` | Unit tests only |
| `npx vitest run test/db` | Database tests only |

## Verification Order

After making changes, always verify in this order:
1. `npm test` — all tests must pass first
2. `npm run build` — zero TypeScript errors required before committing

## Test File Organization

```
test/
  unit/
    zpl.test.ts           → ZPLBuilder, convenience functions
    schemas.test.ts       → Zod validation schemas, incl. printer selection
    label.test.ts         → Label templates
    helpers.test.ts       → HTTP helpers
    router.test.ts        → Route dispatch
  db/
    database.test.ts      → SQLite layer — migrations, CRUD, job lifecycle, settings
    job-label-size.test.ts→ Per-job label geometry snapshot
    printer-repo.test.ts  → Per-printer config, the default printer, adopting discovery
    printer-routing.test.ts → Geometry resolution + the multi-printer queue
  integration/            → (planned: full API endpoints, queue processing)
  properties/            → (planned: ZPL generation round-trip, serial number formatting)
```

## Integration Test Isolation

Database tests use table-level cleanup between tests — `DELETE FROM` all tables rather than deleting/recreating the file. This is fast and avoids module caching issues with the singleton DB connection.

When adding integration tests that exercise the full HTTP server or queue processor, use a dedicated temp database file per describe block.

## Determinism

- No `Math.random()` in test bodies — use Vitest's built-in randomization or fast-check generators
- Tests must not depend on test ordering — each test sets up its own state
- Database cleanup runs in `beforeEach`, never assume clean state

## What's Not Covered (Hardware-Dependent)

- Printer discovery (`discovery.ts`) — requires CUPS/lpstat
- Physical printing (`printer.ts`) — requires connected Zebra printer
- These are verified via manual smoke tests (`npx tsx src/cli.ts print-test`)
