/**
 * Template short names.
 *
 * The awkward part is that the slug namespace spans two stores: user templates in
 * `label_templates`, presets built from code and never written anywhere. The unique
 * index sees only the first, so uniqueness is enforced twice. Most of what follows
 * is about that seam.
 */

import { describe, it, expect, beforeEach } from 'vitest'
// A dedicated database file, like every other suite in test/db.
//
// Two reasons, both learned the hard way. Vitest runs test files in parallel, and
// this suite and template-print-render.test.ts both clear `label_templates` in
// beforeEach — sharing one file makes them clobber each other intermittently.
// And without this the default path is `data/zebra-label-printer.db`, the real
// development database, whose saved templates a test run would delete.
//
// `getDbPath()` reads the env var at call time, so this takes effect despite ESM
// hoisting the import below.
process.env.ZEBRA_DB_PATH = '/tmp/zebra-test-short-name.db'
import { getDb, getSqlite } from '../../src/db/database'
import { labelTemplates } from '../../src/db/schema'
import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getTemplateByShortName,
  findTemplateByShortName,
  shortNameConflict,
  listAllTemplates,
  migrateSeededPresetRows
} from '../../src/db/template-repo'
import {
  presetTemplateByShortName,
  presetShortNames,
  listPresetTemplates,
  TEMPLATE_PRESETS
} from '../../src/db/template-presets'
import { templateShortNameSchema } from '../../src/schemas'
import type { TemplateDefinition } from '../../src/schemas'

/** A minimal valid template definition. */
function definition(overrides: Partial<TemplateDefinition> = {}): TemplateDefinition {
  return {
    name: 'Test Template',
    baseWidthDots: 406,
    baseHeightDots: 203,
    variables: [],
    elements: [],
    overrides: {},
    ...overrides
  } as TemplateDefinition
}

beforeEach(() => {
  // Table-level cleanup, per the project's DB test convention — never assume a
  // clean database.
  getDb().delete(labelTemplates).run()
})

describe('migration 0005 — the DDL that actually runs against a real database', () => {
  // Asserted against sqlite_master rather than schema.ts, per the project's
  // migration-testing convention: a correct schema.ts with a bad migration file
  // passes every behavioural test and then fails on a real upgrade.

  it('added the short_name column', () => {
    const ddl = getSqlite()
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='label_templates'")
      .get() as { sql: string }
    expect(ddl.sql).toMatch(/short_name/)
  })

  it('left the column nullable, so existing templates survive the upgrade', () => {
    // A NOT NULL column added to a populated table would need a default, and any
    // default would invent a public slug for every template already stored.
    const columns = getSqlite()
      .prepare('PRAGMA table_info(label_templates)')
      .all() as Array<{ name: string; notnull: number }>
    const shortName = columns.find(c => c.name === 'short_name')
    expect(shortName).toBeDefined()
    expect(shortName!.notnull).toBe(0)
  })

  it('created a unique index on it', () => {
    const index = getSqlite()
      .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_label_templates_short_name'")
      .get() as { sql: string } | undefined
    expect(index).toBeDefined()
    expect(index!.sql).toMatch(/UNIQUE/i)
    expect(index!.sql).toMatch(/short_name/)
  })

  it('kept the pre-existing name index', () => {
    // A migration that rebuilt the table would silently drop it.
    const index = getSqlite()
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_label_templates_name'")
      .get()
    expect(index).toBeDefined()
  })

  it('leaves the database internally consistent', () => {
    // A plain ADD COLUMN shouldn't rebuild anything — and specifically must not
    // have disturbed job_logs' cascade, which is the hazard documented in AI-MAP
    // for any migration that touches print_jobs.
    expect(getSqlite().prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    expect(getSqlite().prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})

describe('storing a short name', () => {
  it('round-trips through create', () => {
    const tpl = createTemplate(definition({ shortName: 'my-label' }))
    expect(tpl.shortName).toBe('my-label')
    expect(getTemplateByShortName('my-label')?.id).toBe(tpl.id)
  })

  it('stores nothing when no short name is given', () => {
    const tpl = createTemplate(definition())
    expect(tpl.shortName).toBeUndefined()
  })

  it('lets many templates have no short name', () => {
    // The unique index would otherwise make a second slugless template impossible.
    // SQLite treats NULLs as distinct, which is what makes this work.
    createTemplate(definition({ name: 'A' }))
    createTemplate(definition({ name: 'B' }))
    createTemplate(definition({ name: 'C' }))
    expect(getDb().select().from(labelTemplates).all()).toHaveLength(3)
  })

  it('lowercases on the way in, even bypassing the HTTP schema', () => {
    // Library and CLI callers reach the repo directly. A slug stored with capitals
    // would be permanently unreachable, because lookup lowercases first.
    const tpl = createTemplate(definition({ shortName: '  MY-Label ' } as Partial<TemplateDefinition>))
    expect(tpl.shortName).toBe('my-label')
  })

  it('adds a short name through update', () => {
    const tpl = createTemplate(definition())
    const updated = updateTemplate(tpl.id, definition({ shortName: 'later-slug' }))
    expect(updated?.shortName).toBe('later-slug')
    expect(getTemplateByShortName('later-slug')?.id).toBe(tpl.id)
  })

  it('clears a short name through update, freeing it for reuse', () => {
    const tpl = createTemplate(definition({ shortName: 'temporary' }))
    updateTemplate(tpl.id, definition())
    expect(getTemplateByShortName('temporary')).toBeNull()
    expect(shortNameConflict('temporary')).toBeNull()
  })

  it('frees the short name when the template is deleted', () => {
    const tpl = createTemplate(definition({ shortName: 'doomed' }))
    deleteTemplate(tpl.id)
    expect(getTemplateByShortName('doomed')).toBeNull()
  })
})

describe('looking up by short name', () => {
  it('is case-insensitive, so a URL need not match capitalisation', () => {
    const tpl = createTemplate(definition({ shortName: 'part-2x1-custom' }))
    for (const query of ['PART-2X1-CUSTOM', 'Part-2x1-Custom', '  part-2x1-custom  ']) {
      expect(getTemplateByShortName(query)?.id).toBe(tpl.id)
    }
  })

  it('returns null for an unknown or blank slug', () => {
    expect(getTemplateByShortName('nope')).toBeNull()
    expect(getTemplateByShortName('')).toBeNull()
    expect(getTemplateByShortName('   ')).toBeNull()
  })

  it('resolves presets, which have no database row at all', () => {
    const preset = findTemplateByShortName('part-2x1')
    expect(preset).not.toBeNull()
    expect(preset?.id).toBe('tpl_builtin_part_2x1')
    // Nothing was written; the preset is served from code.
    expect(getDb().select().from(labelTemplates).all()).toHaveLength(0)
  })

  it('resolves a preset case-insensitively too', () => {
    expect(findTemplateByShortName('PART-2X1')?.id).toBe('tpl_builtin_part_2x1')
  })

  it('prefers a user template over a same-slug preset', () => {
    // Only reachable if something skipped the conflict check. When it happens, the
    // user's own template is the more useful thing to serve.
    getDb().insert(labelTemplates).values({
      id: 'tpl_shadow',
      name: 'Shadowing',
      shortName: 'part-2x1',
      data: JSON.stringify(definition({ name: 'Shadowing', shortName: 'part-2x1' }))
    }).run()
    expect(findTemplateByShortName('part-2x1')?.id).toBe('tpl_shadow')
  })
})

describe('short name uniqueness', () => {
  it('reports the owner of a taken slug', () => {
    const tpl = createTemplate(definition({ shortName: 'taken' }))
    expect(shortNameConflict('taken')).toBe(tpl.id)
  })

  it('reports nothing for a free slug', () => {
    expect(shortNameConflict('free-slug')).toBeNull()
  })

  it('does not report a template conflicting with itself', () => {
    // A template keeping its slug through an update must not collide with itself.
    const tpl = createTemplate(definition({ shortName: 'mine' }))
    expect(shortNameConflict('mine', tpl.id)).toBeNull()
  })

  it('detects a conflict with a preset, which the database cannot see', () => {
    // The whole reason this check exists rather than relying on the index.
    expect(shortNameConflict('part-2x1')).toBe('tpl_builtin_part_2x1')
    expect(shortNameConflict('bag-2x1')).toBe('tpl_builtin_bag_2x1')
  })

  it('is case-insensitive about conflicts', () => {
    createTemplate(definition({ shortName: 'taken' }))
    expect(shortNameConflict('TAKEN')).not.toBeNull()
  })

  it('is enforced by the database index as well, closing the create race', () => {
    createTemplate(definition({ shortName: 'racy' }))
    expect(() => createTemplate(definition({ shortName: 'racy' })))
      .toThrow(/UNIQUE constraint failed/)
  })
})

describe('preset short names', () => {
  it('gives every preset a slug', () => {
    for (const preset of listPresetTemplates()) {
      expect(preset.shortName, `preset ${preset.id} needs a short name`).toBeTruthy()
    }
    expect(presetShortNames()).toHaveLength(TEMPLATE_PRESETS.length)
  })

  it('uses slugs that pass the public format rules', () => {
    // A preset shipping an invalid slug would be unreachable and unfixable by the
    // user, since presets can't be edited.
    for (const slug of presetShortNames()) {
      expect(templateShortNameSchema.safeParse(slug), `'${slug}' must be a valid slug`)
        .toMatchObject({ success: true })
    }
  })

  it('keeps preset slugs distinct from each other', () => {
    const slugs = presetShortNames()
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('exposes the documented slugs, which are public API', () => {
    // These appear in webhook URLs external services hardcode. Renaming one is a
    // breaking change; this test is here to make that deliberate.
    expect(presetShortNames().sort()).toEqual([
      'asset-3x5-landscape',
      'bag-2x1',
      'part-2x1',
      'part-3x5-landscape'
    ])
  })

  it('resolves each slug back to its preset', () => {
    for (const preset of listPresetTemplates()) {
      expect(presetTemplateByShortName(preset.shortName!)?.id).toBe(preset.id)
    }
  })

  it('returns null for a blank or unknown slug', () => {
    expect(presetTemplateByShortName('')).toBeNull()
    expect(presetTemplateByShortName('not-a-preset')).toBeNull()
  })
})

describe('listing', () => {
  it('carries short names through the combined list', () => {
    createTemplate(definition({ name: 'Mine', shortName: 'mine' }))
    const all = listAllTemplates()
    expect(all.find(t => t.id.startsWith('tpl_builtin_part_2x1'))?.shortName).toBe('part-2x1')
    expect(all.find(t => t.name === 'Mine')?.shortName).toBe('mine')
  })
})

describe('the seeded-preset migration, with slugs in play', () => {
  /** Seed a row that looks exactly like an old seeded preset. */
  function seedPresetRow(id: string, def: TemplateDefinition) {
    getDb().insert(labelTemplates).values({
      id,
      name: def.name,
      description: def.description ?? null,
      // Old rows predate the column; this is what an upgraded install looks like.
      shortName: null,
      data: JSON.stringify(def)
    }).run()
  }

  it('still retires an untouched seeded row now that presets carry a slug', () => {
    // The comparison must ignore `shortName`, which is metadata added after these
    // rows were written. Otherwise every seeded row looks edited and gets
    // "preserved" as a customisation the user never made.
    const preset = listPresetTemplates()[0]!
    const { id, readOnly, shortName, ...def } = preset
    seedPresetRow(id, def as TemplateDefinition)

    const { removed, preserved } = migrateSeededPresetRows()
    expect(removed).toContain(id)
    expect(preserved).toHaveLength(0)
    expect(shortName).toBeTruthy()
  })

  it('does not give a preserved copy the preset\'s slug', () => {
    // The preset still answers on that slug. Two templates behind one webhook URL
    // is ambiguous, and the unique index would refuse the insert outright.
    const preset = listPresetTemplates()[0]!
    const { id, readOnly, ...def } = preset
    seedPresetRow(id, { ...def, name: 'My Edited Version' } as TemplateDefinition)

    const { preserved } = migrateSeededPresetRows()
    expect(preserved).toContain(id)

    const copy = listAllTemplates().find(t => t.name === 'My Edited Version')
    expect(copy).toBeDefined()
    expect(copy!.readOnly).toBe(false)
    expect(copy!.shortName).toBeUndefined()

    // And the preset is still reachable on its own slug.
    expect(findTemplateByShortName(preset.shortName!)?.id).toBe(preset.id)
  })

  it('keeps a slug the user chose themselves on a preserved copy', () => {
    // Their own slug is their work, unlike the preset's, so it survives.
    const preset = listPresetTemplates()[0]!
    const { id, readOnly, ...def } = preset
    seedPresetRow(id, { ...def, name: 'Renamed', shortName: 'my-own-slug' } as TemplateDefinition)
    getDb().update(labelTemplates).set({ shortName: 'my-own-slug' }).run()

    migrateSeededPresetRows()
    const copy = listAllTemplates().find(t => t.name === 'Renamed')
    expect(copy?.shortName).toBe('my-own-slug')
  })
})
