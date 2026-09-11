# Template print API — decision record

Why `POST /api/print/template/{shortName}` is shaped the way it is. Decisions only; the code is
the specification.

| Question | Answer lives in |
|---|---|
| What fields does the request take? | `templatePrintSchema` in `src/schemas.ts`, published at `/api/docs` |
| What are the error codes and their statuses? | `API_ERROR_CODES` / `STATUS_BY_CODE` in `src/server/errors.ts` |
| What does a short name look like? | `TEMPLATE_SHORT_NAME_PATTERN`, `RESERVED_TEMPLATE_SHORT_NAMES` in `src/constants.ts` |
| What does a response look like? | `src/openapi.ts`, rendered at `/api/docs` |

The request half of `/api/docs` is generated from the Zod schema, so it cannot contradict what the
server enforces. `test/unit/openapi-drift.test.ts` guards the hand-written remainder.

## Goal

Let another service print a saved template by name, passing its variables as JSON. The caller
knows a short name and some variable names — not the layout, the label geometry, or which printer
is default. That is what lets a template be redesigned without breaking any integration.

## Short names are public API

A new identifier, separate from `id`, because `id` is unusable as a contract: random hex is
unmemorable, and a preset's id is not portable to the copy a user makes when customising it.

Once external services hardcode a slug into a URL it is permanent, so the format is deliberately
narrow (no case, no punctuation beyond single hyphens) — a format admitting invisible variations
produces two templates nobody can tell apart in a webhook address. **Renaming a preset's slug is
a breaking change.**

Uniqueness is enforced twice on purpose. The unique index closes the race between two concurrent
creates; `shortNameConflict()` additionally checks the presets, which are built from code and
never stored, so SQLite cannot see them.

A slug is never generated automatically. A guessed one would become a public name the author
never chose.

## Why not `POST /api/print/{shortName}`

The shortest path is a trap. `/api/print/` already holds six verbs, and exact routes match before
parameterised ones — so a template short-named `text` would silently become unreachable, and
every future `/api/print/<verb>` would break whoever had used that word. Reserving the words helps
only until the next verb ships. A dedicated segment settles it permanently.

**Everything callable lives under `/api/`.** A bare `/print/{shortName}` alias was built and then
removed: automation gains nothing from a shorter path, the `/api/` prefix tells anyone pointing a
system here that it is an API, and the alias collided in spirit with the web UI's own `/print`
page — GET rendering the app while POST printed was an asymmetry not worth the convenience.

## Flat payloads are accepted alongside nested

Plenty of services emit a fixed, flat payload and cannot be persuaded to nest anything, so any
top-level key that is not a control field is read as a variable.

The cost: a variable colliding with a control field name can only be sent nested. Accepted, and
the reason `variables` is the canonical form. Adding a control field is therefore a mild
compatibility event for flat callers — nested ones are immune.

A body that already has `variables` is passed through untouched, so a stray sibling key is
reported rather than silently becoming a variable. Mixing the two forms is far likelier to be a
mistake than an intention.

## Strictness about variables, because the output is physical

**Unknown names are rejected, not ignored.** Ignoring them turns `partNumbr` into a blank field on
a real label — invisible to the caller, undiagnosable by the operator. This check is also what
makes the flat form safe to offer at all.

**Missing names are rejected by default**, for referenced variables only. `allowMissingVariables`
opts out.

**A variable's sample value is never substituted on a print.** The designer falls back to samples
so an unfilled template still previews plausibly; doing it here would put the sample part number
on real stock, producing a label that looks correct and is wrong. `dryRun` follows the same rule —
a preview you would then trust must show what would actually print.

## The error envelope is additive

The old convention was a bare `{ error: "some string" }`: fine for a UI, unusable for an
integration, because there is nothing stable to branch on and callers end up matching English
prose.

`code` was added *alongside* `error` rather than replacing it, so the web UI and every existing
caller keep working. `code` is the contract; `error` and `message` are for humans and may be
reworded freely.

`sendError()` owns the status for each code, so one code cannot be sent with two different
statuses from two handlers — which is how a caller ends up trusting neither field.

## Rendering is not reimplemented

The template engine was a Nuxt composable, because only the designer needed it: the browser
resolved a template and posted flat `elements[]` to `/api/print/label`. A second server-side copy
would mean the same template printing differently depending on whether a person or a webhook
asked, with the designer's preview agreeing with only one of them. So it moved to
`src/template-engine.ts` and the composable re-exports it.

Everything after rendering delegates to the existing `dispatchPrint()`, so printer selection, the
browser/WebUSB handoff, label-size snapshots, and queueing cannot diverge from the other print
endpoints.

Jobs are recorded as `jobType: 'label'` carrying resolved `elements`, because that is what
`PrintQueue.rebuildZpl()` can reconstruct. Storing `{ shortName, variables }` instead would
require re-resolving a template that may have been edited since. The template reference and
variables ride along for provenance.

## Label size comes from the printer, not the template

Rendering targets the printer's configured stock and scales the layout, which is the point of
storing positions as percentages. It is also the most common way to get a surprising label, so a
mismatch against the template's design size returns a `LABEL_SIZE_MISMATCH` warning rather than an
error. A template carrying an override for the target size has been considered at that size and
stays quiet.

**So the printer is chosen to fit the template**, when the caller expressed no preference. The
failure that forced this was invisible until the label came out: a 3×5 template with no `printerId`
went to the default printer holding 2×1 stock and printed cropped and unreadable, with nothing in
the response flagging it as wrong. The server already knows what stock each printer holds, so it
may as well use that.

Explicit beats clever: naming a `printerId` or pinning a `labelSize` disables routing entirely.
Routing is also skipped when the template has a per-size override for the default printer's stock,
because that means the author laid it out for that size on purpose. When nothing matches, the print
still happens on the default with the warning — refusing would be worse than printing scaled.

`printerSelection` reports the outcome as a `reason` code, a `printerName` for display, and a
`message` in plain language. The message is not decoration: the first integrator to see the old
`pinned-label-size` code had to ask what it meant, and the answer — that their own request had
suppressed routing — was something the response could simply have said. The codes were renamed to
`explicit-printer` / `explicit-label-size` at the same time, so the set reads as parallel.

`PRINTER_STOCK_MISMATCH` closes the remaining hole. Pinning a `labelSize` was how the cropping bug
got worked around, and pinning one that disagrees with the target printer's stock reintroduces it
from the other side — rendering 609×1015 for a printer loaded with 406×203 crops just as badly.
That case is only reachable via a pin, because otherwise the geometry comes *from* the printer.

Readiness is deliberately not probed before routing. An unreachable but correctly-loaded printer
queues the job and prints on the right stock when it returns, which beats printing immediately on
the wrong stock; and probing would add a discovery round-trip to every print.

## Serialization is opt-in

`serialize` advances one variable across the copies. It is not inferred from `quantity > 1` plus a
variable that happens to be named `serial`, because that would change what existing callers print —
five identical labels for a kit would silently become five different serial numbers. A
`SERIAL_NOT_INCREMENTED` warning makes the feature discoverable without taking that risk.

The first value printed is the one the caller sent, and its prefix and zero-padding are derived from
it, so there is no separate format or width option. Padding **widens** rather than wrapping:
`NRG-999` becomes `NRG-1000`, never `NRG-000`, because reissuing a serial puts two different parts
into the world under one identifier.

Each label is its own job, matching `POST /api/print/serial`. Serialized parts carry an identifier,
so a run that fails halfway has to report exactly which serials physically came out — a single job
covering fifty labels cannot. For the same reason the run stops at the first failure instead of
spending more stock on a sequence with a gap in it.

## Security posture

With no `ZEBRA_API_KEY` — the default — this endpoint lets any page the operator visits print up
to `MAX_COPIES` labels with no interaction. Not a new hole (every print endpoint is like this) but
newly convenient, and it spends a physical consumable.

`ZEBRA_CORS_ORIGINS` narrows the origins and `ZEBRA_PRINT_RATE_LIMIT` bounds a runaway loop.
Neither is a substitute for setting an API key on anything reachable from an untrusted network.
The rate limiter keys on the socket address and ignores `X-Forwarded-For`, which is spoofable —
behind a proxy the limit becomes global rather than per-client, which is the wrong shape but the
safe direction to be wrong in.

## Deliberately out of scope

**Batching.** An array of variable sets is the obvious next request and needs partial-failure
semantics — nine printed, one rejected, what status? Designing that badly now would be worse than
not having it. The current single-label shape is a strict subset of any future batch endpoint.

**Idempotency keys.** The natural home is an `Idempotency-Key` header plus a lookup on the job
table, which needs a column and a retention policy. Noted here so it lands as a header rather than
a body field when it does.

**No `/v1/` prefix.** Adding one implies a versioning discipline the rest of this API does not have
and could not honour. Additive responses and stable error codes are the actual compatibility
mechanism, and they are cheaper to keep.
