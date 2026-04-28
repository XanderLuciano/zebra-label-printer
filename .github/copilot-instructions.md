# AI Code Review Instructions

## Scope

Review the actual diff. Focus on correctness, conventions, and regressions.

## What to Review

### Code Quality & Project Conventions

- **Layer boundaries**: `src/server/` handles HTTP; `src/db/` handles persistence; `src/zpl.ts` handles ZPL generation; `src/printer.ts` handles CUPS communication. Flag cross-layer leakage.
- **Route pattern**: All routes use handlers in `src/server/handlers/`. Routes registered in `src/server/index.ts` → `buildRoutes()`. Flag raw HTTP logic outside the handler files.
- **Request validation**: All POST/PUT endpoints must use Zod validation via the `validate()` helper in `src/server/helpers.ts`. Flag any unvalidated `readBody()`.
- **ZPL generation**: All ZPL must go through `ZPLBuilder` in `src/zpl.ts`. Flag raw string concatenation of ZPL commands.
- **Database access**: Always go through repository functions in `src/db/`, never call `getDb()` directly outside `src/db/`.
- **TypeScript**: `strict: true`. No `any` outside `test/` without explicit justification. Return types on exported functions.
- **Style**: No semicolons, single quotes, trailing commas on multiline, `const` over `let`.

### Bugs & Edge Cases

- Status tracking: `updateJobStatus` param order — WHERE clause param MUST be last (we had a bug here once: `unshift` → `push`).
- ZPL escaping: special characters `^` and `~` must be escaped in `^FD` field data.
- SQLite: WAL mode, FK constraints enabled, busy timeout set.
- Queue: jobs must bubble up from `pending` → `printing` → `completed`/`failed`/`cancelled`.
- CUPS recovery: printer can be disabled by CUPS on USB disconnect; `isReady()` must auto-recover.

### Anti-Patterns

- Positional SQL params out of order with SQL `?` placeholders
- Mutable module-level state that survives between tests
- Hardcoded paths that break in distributed vs dev environments
- Duplicate API calls where data could be fetched once

### Testing

- New features must include tests. No exceptions.
- Database tests: table-level cleanup in `beforeEach`, never assume clean state.
- Run `npm test && npm run build` before pushing. All tests must pass, zero type errors.
