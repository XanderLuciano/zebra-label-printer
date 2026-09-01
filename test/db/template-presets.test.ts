/**
 * Tests for read-only presets and the migration off the old seeded-rows model.
 *
 * The behaviour that matters: presets are always available without being stored,
 * they can't be edited or deleted, and an install upgrading from the version that
 * seeded them as ordinary rows neither ends up with duplicates nor loses work
 * someone had customised.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'fs'

// Set the test DB path before importing the database module.
const TEST_DB = '/tmp/zebra-test-presets.db'
process.env.ZEBRA_DB_PATH = TEST_DB

import { getDb, getSqlite, closeDb } from '../../src/db/database'
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listAllTemplates,
  findTemplate,
  migrateSeededPresetRows
} from '../../src/db/template-repo'
import {
  TEMPLATE_PRESETS,
  PRESET_ID_PREFIX,
  isPresetId,
  presetTemplate,
  listPresetTemplates
} from '../../src/db/template-presets'
import { labelTemplates } from '../../src/db/schema'
import type { TemplateDefinition } from '../../src/schemas'

function resetDb() {
  getDb()
  const sqlite = getSqlite()
  sqlite.exec('DELETE FROM label_templates')
  sqlite.exec('DELETE FROM settings')
}

/** Insert a row the way the old seeding code did: preset id, definition as-is. */
function seedRowTheOldWay(id: string, def: TemplateDefinition) {
  getDb().insert(labelTemplates).values({
    id,
    name: def.name,
    description: def.description ?? null,
    data: JSON.stringify(def)
  }).run()
}

const FIRST_PRESET = TEMPLATE_PRESETS[0]!

describe('presets', () => {
  beforeEach(resetDb)

  afterAll(() => {
    closeDb()
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(TEST_DB + suffix)
      } catch { /* empty */ }
    }
  })

  it('are available on an empty database without being stored', () => {
    // The whole point: nothing to seed, nothing to lose.
    expect(listTemplates()).toHaveLength(0)
    expect(listAllTemplates()).toHaveLength(TEMPLATE_PRESETS.length)
    expect(getSqlite().prepare('SELECT COUNT(*) AS n FROM label_templates').get())
      .toEqual({ n: 0 })
  })

  it('survive a wiped database, unlike stored templates', () => {
    createTemplate({ ...FIRST_PRESET.build(), name: 'Mine' })
    expect(listAllTemplates()).toHaveLength(TEMPLATE_PRESETS.length + 1)

    resetDb()
    const names = listAllTemplates().map(t => t.name)
    expect(names).not.toContain('Mine')
    expect(names).toHaveLength(TEMPLATE_PRESETS.length)
  })

  it('are marked read-only, and user templates are not', () => {
    const mine = createTemplate({ ...FIRST_PRESET.build(), name: 'Mine' })
    expect(mine.readOnly).toBe(false)
    for (const preset of listPresetTemplates()) {
      expect(preset.readOnly, preset.id).toBe(true)
    }
  })

  it('resolve by id through findTemplate, alongside user templates', () => {
    const mine = createTemplate({ ...FIRST_PRESET.build(), name: 'Mine' })

    expect(findTemplate(FIRST_PRESET.id)?.readOnly).toBe(true)
    expect(findTemplate(mine.id)?.readOnly).toBe(false)
    expect(findTemplate('tpl_does_not_exist')).toBeNull()
  })

  it('are not returned by getTemplate, which only sees stored rows', () => {
    // findTemplate is the one that resolves both; keeping getTemplate row-only is
    // what lets the write paths use it as an existence check.
    expect(getTemplate(FIRST_PRESET.id)).toBeNull()
  })

  it('list user templates before presets', () => {
    const mine = createTemplate({ ...FIRST_PRESET.build(), name: 'Mine' })
    const ids = listAllTemplates().map(t => t.id)
    expect(ids[0]).toBe(mine.id)
    expect(ids.slice(1)).toEqual(TEMPLATE_PRESETS.map(p => p.id))
  })

  it('carry no timestamps, having never been written', () => {
    const preset = presetTemplate(FIRST_PRESET.id)!
    expect(preset.createdAt).toBeUndefined()
    expect(preset.updatedAt).toBeUndefined()
  })

  it('identifies preset ids', () => {
    for (const { id } of TEMPLATE_PRESETS) expect(isPresetId(id), id).toBe(true)
    expect(isPresetId('tpl_abc123')).toBe(false)
    // Not a real preset, despite wearing the prefix.
    expect(isPresetId(`${PRESET_ID_PREFIX}not_a_real_one`)).toBe(false)
  })

  it('cannot be updated or deleted through the repo', () => {
    // Defence in depth behind the route guard: neither touches a row, because
    // there is no row.
    expect(updateTemplate(FIRST_PRESET.id, FIRST_PRESET.build())).toBeNull()
    expect(deleteTemplate(FIRST_PRESET.id)).toBe(false)
    expect(findTemplate(FIRST_PRESET.id)?.name).toBe(FIRST_PRESET.build().name)
  })
})

describe('migrateSeededPresetRows', () => {
  beforeEach(resetDb)

  afterAll(closeDb)

  it('does nothing on an install that never seeded', () => {
    const { removed, preserved } = migrateSeededPresetRows()
    expect(removed).toEqual([])
    expect(preserved).toEqual([])
    expect(listAllTemplates()).toHaveLength(TEMPLATE_PRESETS.length)
  })

  it('drops untouched seeded rows, so they stop duplicating the preset', () => {
    for (const { id, build } of TEMPLATE_PRESETS) seedRowTheOldWay(id, build())
    // Before migration the leftover rows shadow their presets, so the list stays
    // at 4 — as rows, not presets.
    expect(listAllTemplates()).toHaveLength(TEMPLATE_PRESETS.length)
    expect(listAllTemplates().every(t => !t.readOnly)).toBe(true)

    const { removed, preserved } = migrateSeededPresetRows()
    expect(removed).toEqual(TEMPLATE_PRESETS.map(p => p.id))
    expect(preserved).toEqual([])
    expect(listTemplates()).toHaveLength(0)
    expect(listAllTemplates()).toHaveLength(TEMPLATE_PRESETS.length)
  })

  it('keeps a customised example as the user\'s own template', () => {
    // Their layout work is theirs; the upgrade must not throw it away.
    seedRowTheOldWay(FIRST_PRESET.id, FIRST_PRESET.build())
    const edited = { ...FIRST_PRESET.build(), name: 'Shop Floor Part Label' }
    updateTemplate(FIRST_PRESET.id, edited)

    const { removed, preserved } = migrateSeededPresetRows()
    expect(removed).toEqual([])
    expect(preserved).toEqual([FIRST_PRESET.id])

    const mine = listTemplates()
    expect(mine).toHaveLength(1)
    expect(mine[0]!.name).toBe('Shop Floor Part Label')
    expect(mine[0]!.readOnly).toBe(false)
    // Out of the preset id space, so it can be edited and deleted from now on.
    expect(mine[0]!.id).not.toBe(FIRST_PRESET.id)
    expect(isPresetId(mine[0]!.id)).toBe(false)
  })

  it('marks a preserved copy that still carries the preset name', () => {
    // Same name on two entries would be indistinguishable in the picker.
    seedRowTheOldWay(FIRST_PRESET.id, FIRST_PRESET.build())
    const def = FIRST_PRESET.build()
    updateTemplate(FIRST_PRESET.id, { ...def, baseWidthDots: def.baseWidthDots + 40 })

    migrateSeededPresetRows()
    expect(listTemplates()[0]!.name).toBe(`${def.name} (customised)`)
  })

  it('detects a layout edit, not just a rename', () => {
    seedRowTheOldWay(FIRST_PRESET.id, FIRST_PRESET.build())
    const def = FIRST_PRESET.build()
    const [first, ...rest] = def.elements
    updateTemplate(FIRST_PRESET.id, {
      ...def,
      elements: [{ ...first!, xPct: (first as { xPct: number }).xPct + 5 }, ...rest]
    })

    const { removed, preserved } = migrateSeededPresetRows()
    expect(removed).toEqual([])
    expect(preserved).toEqual([FIRST_PRESET.id])
  })

  it('treats a row for a preset this release no longer ships as the user\'s own', () => {
    // Otherwise dropping a preset from the catalogue would silently delete the
    // only remaining copy of it.
    const orphanId = `${PRESET_ID_PREFIX}retired_example`
    seedRowTheOldWay(orphanId, { ...FIRST_PRESET.build(), name: 'Retired Example' })

    const { removed, preserved } = migrateSeededPresetRows()
    expect(removed).toEqual([])
    expect(preserved).toEqual([orphanId])
    expect(listTemplates()[0]!.name).toBe('Retired Example')
  })

  it('leaves the user\'s own templates completely alone', () => {
    const mine = createTemplate({ ...FIRST_PRESET.build(), name: 'Mine' })
    seedRowTheOldWay(FIRST_PRESET.id, FIRST_PRESET.build())

    migrateSeededPresetRows()
    const still = getTemplate(mine.id)
    expect(still).not.toBeNull()
    expect(still!.name).toBe('Mine')
  })

  it('is idempotent', () => {
    for (const { id, build } of TEMPLATE_PRESETS) seedRowTheOldWay(id, build())
    migrateSeededPresetRows()

    const again = migrateSeededPresetRows()
    expect(again.removed).toEqual([])
    expect(again.preserved).toEqual([])
    expect(listAllTemplates()).toHaveLength(TEMPLATE_PRESETS.length)
  })

  it('does not re-migrate a copy it already preserved', () => {
    // The preserved copy gets a fresh non-preset id precisely so the next startup
    // doesn't pick it up again and fork it a second time.
    seedRowTheOldWay(FIRST_PRESET.id, FIRST_PRESET.build())
    updateTemplate(FIRST_PRESET.id, { ...FIRST_PRESET.build(), name: 'Customised' })
    migrateSeededPresetRows()

    migrateSeededPresetRows()
    expect(listTemplates()).toHaveLength(1)
  })
})

describe('a leftover seeded row (failed migration)', () => {
  // If migrateSeededPresetRows ever fails, rows under preset ids remain. The
  // API must degrade so the user's customisation stays reachable and editable,
  // not lock it behind the preset's 403.
  beforeEach(() => {
    resetDb()
    seedRowTheOldWay(FIRST_PRESET.id, {
      ...FIRST_PRESET.build(),
      name: 'Customised, migration failed'
    })
  })

  it('wins over the preset in findTemplate', () => {
    const found = findTemplate(FIRST_PRESET.id)
    expect(found?.name).toBe('Customised, migration failed')
    expect(found?.readOnly).toBe(false)
  })

  it('replaces the preset in the list instead of duplicating its id', () => {
    const all = listAllTemplates()
    const ids = all.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(all.find(t => t.id === FIRST_PRESET.id)?.readOnly).toBe(false)
    // The other presets still show.
    expect(all.filter(t => t.readOnly)).toHaveLength(TEMPLATE_PRESETS.length - 1)
  })

  it('stays editable and deletable through the repo', () => {
    const updated = updateTemplate(FIRST_PRESET.id, {
      ...FIRST_PRESET.build(),
      name: 'Edited again'
    })
    expect(updated?.name).toBe('Edited again')
    expect(deleteTemplate(FIRST_PRESET.id)).toBe(true)
    // With the row gone, the preset shows through again.
    expect(findTemplate(FIRST_PRESET.id)?.readOnly).toBe(true)
  })
})

describe('migration cleanup', () => {
  beforeEach(resetDb)

  it('removes the orphaned seeded-ids setting once rows are migrated', () => {
    getSqlite().prepare(
      "INSERT INTO settings (key, value) VALUES ('builtin_templates_seeded', '[]')"
    ).run()
    for (const { id, build } of TEMPLATE_PRESETS) seedRowTheOldWay(id, build())

    migrateSeededPresetRows()

    const row = getSqlite().prepare(
      "SELECT value FROM settings WHERE key = 'builtin_templates_seeded'"
    ).get()
    expect(row).toBeUndefined()
  })
})
