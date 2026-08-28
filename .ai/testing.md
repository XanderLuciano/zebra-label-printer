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
    timestamps.test.ts    → Timestamp columns store dates, not string literals
  integration/            → (planned: full API endpoints, queue processing)
  properties/            → (planned: ZPL generation round-trip, serial number formatting)
```

## Schema and Migration Tests

Two classes of defect need separate coverage, because they fail independently:

- **Migration correctness** — assert against the DDL that actually landed
  (`SELECT sql FROM sqlite_master`). This catches a bad migration file.
- **Runtime behaviour** — insert a row through the repo and assert what came back. This catches
  a bad `schema.ts`, since Drizzle can inline a client-side default into the `INSERT` and
  bypass the DDL entirely.

`timestamps.test.ts` does both. A fix verified on only one side is not verified: reverting a
single column's default made the behavioural test fail while the DDL test still passed.

When a migration rebuilds a table (SQLite can't `ALTER COLUMN`), test it against a database
staged at the *previous* migration and filled with data, then assert row counts, recovered
values, `foreign_key_check`, and `integrity_check`. Re-running the migrator must be a no-op.

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
