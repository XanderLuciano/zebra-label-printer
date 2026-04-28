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
    zpl.test.ts           → ZPLBuilder, convenience functions (29 tests)
    schemas.test.ts       → Zod validation schemas (40 tests)
    label.test.ts         → Label templates (11 tests)
    helpers.test.ts       → HTTP helpers (17 tests)
    router.test.ts        → Route dispatch (6 tests)
  db/
    database.test.ts      → SQLite layer — migrations, CRUD, job lifecycle, settings (14 tests)
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
