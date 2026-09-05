---
name: tighten-code
description: Strip restatement, bloat and duplicated documentation from a branch so the code stays the single source of truth. Use before opening a PR, after a large feature lands, or when asked to clean up, tighten, de-bloat, remove redundant comments, or stop docs from drifting.
metadata:
  scope: Run against a branch diff, not the whole repo
---

# Tighten code

Remove what the code already says. Keep what the code cannot say.

Comments and docs that restate code are worse than no comments: they cost reading time and go stale
silently, and a stale comment is believed. Everything below is about deleting that class of text
while protecting the reasoning that is genuinely not recoverable from the code.

## Scope

Work on **the current branch's diff against its base**, not the whole repo. Cleaning untouched files
inflates the diff and buries the real change.

```bash
git merge-base HEAD main            # or the actual base branch
git diff --stat $(git merge-base HEAD main)
```

If the user asks for a specific file or directory, do that instead and skip the diff scoping.

## Step 1 — Measure, so the pass has a target

```bash
for f in $(git diff --name-only $(git merge-base HEAD main) | grep -E '\.(ts|js|tsx|vue|py|go|rs)$'); do
  total=$(grep -c . "$f"); cmt=$(grep -cE '^\s*(\*|//|/\*|#)' "$f")
  [ "$total" -gt 0 ] && printf '%-60s %4s lines %4s comment (%s%%)\n' "$f" "$total" "$cmt" "$((cmt*100/total))"
done | sort -t'(' -k2 -rn
```

Above ~35% in a file that isn't a measurement table or a decision record is a signal, not a verdict.
Read before cutting.

## Step 2 — Delete restatement

Cut a comment when the line below it says the same thing:

- Headers that narrate the signature: `/** Send a JSON response */` on `function json(...)`.
- `@param` lines that only repeat the parameter name and type.
- Field docs that restate the field: `/** The user's name */` on `name: string`.
- Step-by-step narration of obvious control flow.
- Type restatements the type system already carries.

Cut duplicated documentation:

- A prose table of request fields that a schema (Zod, JSON Schema, OpenAPI) already defines.
- A status-code table that a lookup map in code already defines.
- A list of valid values that an enum or constant already defines.
- The same rationale written in three files.

**Replace duplication with a pointer, not a summary.** A pointer stays correct:

```markdown
| Question | Answer lives in |
|---|---|
| What fields does the request take? | `fooSchema` in `src/schemas.ts` |
| What are the error codes? | `STATUS_BY_CODE` in `src/server/errors.ts` |
```

## Step 3 — Keep what the code cannot say

Do not cut these. If anything, they are what the pass is protecting:

- **Why this way and not the obvious way.** Decisions, rejected alternatives, one-way doors.
- **Non-local constraints.** "Keep this free of Node built-ins, it is also bundled by Vite."
- **Bug archaeology.** Why a line looks odd, what broke before, what a regression test guards.
- **Measured facts.** Numbers from real observation, with how they were obtained.
- **Counterintuitive external behaviour.** Vendor quirks, protocol gotchas, spec violations.
- **Safety and ordering requirements.** Why A must precede B; what happens if it doesn't.
- **Deliberate trade-offs**, especially ones that look like bugs.

Two useful tests before deleting:

1. Could a competent reader recover this from the code in under a minute? If yes, cut it.
2. Would deleting this let someone "simplify" the code and reintroduce a bug? If yes, keep it.

## Step 4 — Tighten what survives

- One idea per comment. Drop the wind-up sentence and the recap sentence.
- Prefer a sentence over a paragraph, a clause over a sentence.
- Put the point first. `// Ignored deliberately: trusting it lets callers bypass the limit.`
- Delete hedging and filler: "Note that", "It is worth mentioning", "Basically", "Essentially".
- Never mention "recently", "new", "now", or a version number in a comment. Those rot.

## Step 5 — Make duplication impossible where you can

The strongest version of this pass replaces a comment with a mechanism. Before hand-syncing two
copies of a fact, check whether one can be derived from the other:

- Generate docs from the schema that validates (e.g. `z.toJSONSchema`) instead of writing both.
- Derive a constant instead of repeating a literal.
- Add a test asserting the two copies agree, when they genuinely cannot be merged. Prove such a
  test fails by perturbing one side, or it may be asserting nothing.

Prefer, in order: **delete the duplicate → derive it → test that it agrees → comment that it must.**

## Step 6 — Verify

Comment-only edits still break builds: a deleted `eslint-disable` starts reporting, a removed import
used only in a doc example, an unreferenced schema left behind.

Run the project's real checks, discovered from `package.json` / `Makefile` / `pyproject.toml` —
typically lint, typecheck, build, and tests. Include a second package if the repo has one.

Then confirm the diff is **only** what you intended:

```bash
git diff -w --stat        # ignore whitespace; expect deletions to dominate
git diff -w | grep '^+' | grep -vE '^\+\s*(\*|//|#)' | head -40
```

That last command lists added lines that are *not* comments. On a pure trimming pass it should be
close to empty. Anything there is a behaviour change — justify it or revert it.

## Report

State: files touched, comment-ratio before/after, what was removed by category, what was
deliberately kept and why, any mechanism added to prevent future drift, and the verification result.

Flag anything found but not fixed, and any judgement call the user may want to reverse.

## Anti-goals

- Do not reformat, rename, or refactor. This pass changes prose, not behaviour.
- Do not strip a file to zero comments to hit a number. Some files are mostly reasoning and should
  stay that way.
- Do not delete a comment you do not understand. Investigate, then decide.
- Do not touch licence headers, generated files, or vendored code.
