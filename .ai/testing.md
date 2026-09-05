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
    template-print-schema.test.ts → templatePrintSchema: flat/nested folding, slugs, quantity
    errors.test.ts        → The API error envelope: codes, statuses, Zod flattening
    rate-limit.test.ts    → RateLimiter windows, keying, sweeping
    label.test.ts         → Label templates
    helpers.test.ts       → HTTP helpers
    router.test.ts        → Route dispatch + template-print path matching
  db/
    database.test.ts      → SQLite layer — migrations, CRUD, job lifecycle, settings
    job-label-size.test.ts→ Per-job label geometry snapshot
    printer-repo.test.ts  → Per-printer config, the default printer, adopting discovery
    printer-routing.test.ts → Geometry resolution + the multi-printer queue
    template-short-name.test.ts → Slug storage, lookup, uniqueness across rows *and* presets
    template-print-render.test.ts → Server-side template rendering, ^PQ, queued-job rebuild
    timestamps.test.ts    → Timestamp columns store dates, not string literals
  integration/            → (planned: full API endpoints, queue processing)
  properties/            → (planned: ZPL generation round-trip, serial number formatting)
```

## Verifying Print Endpoints Without Printing

`dryRun: true` on `POST /api/print/template/{shortName}` renders and returns the ZPL without
touching the printer or recording a job, which makes the whole path safe to exercise by hand
against a real server. `target: 'local'` goes one step further: it records a job and returns the
ZPL for a browser to transmit, so the job-recording path is covered without anything physically
printing.

Use them. A smoke test that actually prints costs labels and, on a shared machine, prints them
somewhere you are not standing.

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

## Tests That Import From `web/`

One suite (`label-size-match`) imports a util from `web/app/utils/`. Vite resolves the nearest
tsconfig for every file it transforms, so that import depends on `web/app/tsconfig.json` existing.

The four suites that used to import the template engine and font metrics from
`web/app/composables/` (`zpl-fonts`, `template-text`, `rotation-geometry`, `template-presets`) now
import them from `src/`, because those modules moved there when the server gained the ability to
render templates. The trap below still applies to anything importing from `web/`.

Do not delete that file. Without it the nearest config is `web/tsconfig.json`, which
`references` configs Nuxt generates into `web/.nuxt/` on dev or build. Those are not committed,
so on a clean checkout the references fail to resolve and the affected suites fail to transform —
while passing locally, because `web/.nuxt/` is left over from the last dev run. That divergence
hid the failure: CI ran 172 tests and reported green on a suite of 437.

**When a test failure reproduces in CI but not locally, try a fresh clone rather than trusting
the working tree.** `git worktree add` is not enough on its own — it also lacks generated files,
which is a different flavour of the same trap.

## Integration Test Isolation

**Every suite in `test/db/` must set its own `process.env.ZEBRA_DB_PATH` at module scope.** This
is not optional, and not merely tidiness:

- Without it the path defaults to `data/zebra-label-printer.db` — the **real development
  database** — so a suite that clears a table in `beforeEach` deletes your saved templates on the
  next `npm test`.
- Vitest runs test files **in parallel**. Two suites sharing one file while both clearing the same
  table fail intermittently, in whichever one loses the race. Adding
  `template-short-name.test.ts` and `template-print-render.test.ts` without their own paths
  produced exactly that: one or two failures per run, different ones each time, on correct code.

`getDbPath()` reads the variable at call time, so the assignment takes effect despite ESM hoisting
the `src/db/database` import above it.

**A flaky database test is usually a shared-file problem, not a real race in the code.** Check the
`ZEBRA_DB_PATH` of every suite touching the same table before investigating anything else.

Within a suite, use table-level cleanup — `DELETE FROM` in `beforeEach` rather than
deleting/recreating the file. That is fast and avoids module caching issues with the singleton DB
connection.

When adding integration tests that exercise the full HTTP server or queue processor, use a dedicated temp database file per describe block.

## Determinism

- No `Math.random()` in test bodies — use Vitest's built-in randomization or fast-check generators
- Tests must not depend on test ordering — each test sets up its own state
- Database cleanup runs in `beforeEach`, never assume clean state

## What's Not Covered (Hardware-Dependent)

- Printer discovery (`discovery.ts`) — requires CUPS/lpstat
- Physical printing (`printer.ts`) — requires connected Zebra printer
- These are verified via manual smoke tests (`npx tsx src/cli.ts print-test`)
