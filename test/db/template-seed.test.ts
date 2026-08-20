/**
 * Tests for seeding the built-in example templates.
 *
 * The behaviour that matters: a fresh install gets the examples, restarts don't
 * duplicate them, and deleting or editing one is respected rather than undone on
 * the next boot.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import fs from 'fs'

// Set the test DB path before importing the database module.
const TEST_DB = '/tmp/zebra-test-seed.db'
process.env.ZEBRA_DB_PATH = TEST_DB

import { getDb, getSqlite, closeDb } from '../../src/db/database'
import { listTemplates, getTemplate, deleteTemplate, updateTemplate } from '../../src/db/template-repo'
import { seedBuiltinTemplates, BUILTIN_TEMPLATES } from '../../src/db/template-seed'

function resetDb() {
  getDb()
  const sqlite = getSqlite()
  sqlite.exec('DELETE FROM label_templates')
  sqlite.exec('DELETE FROM settings')
}

describe('seedBuiltinTemplates', () => {
  beforeEach(() => {
    resetDb()
  })

  afterAll(() => {
    closeDb()
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(TEST_DB + suffix)
      } catch { /* empty */ }
    }
  })

  it('inserts every example on a fresh database', () => {
    const { seeded } = seedBuiltinTemplates()
    expect(seeded).toEqual(BUILTIN_TEMPLATES.map(t => t.id))
    expect(listTemplates()).toHaveLength(BUILTIN_TEMPLATES.length)
  })

  it('stores them under their stable ids and readable names', () => {
    seedBuiltinTemplates()
    for (const { id, build } of BUILTIN_TEMPLATES) {
      const stored = getTemplate(id)
      expect(stored, id).not.toBeNull()
      expect(stored!.name).toBe(build().name)
      expect(stored!.elements.length).toBe(build().elements.length)
      expect(stored!.variables.length).toBe(build().variables.length)
    }
  })

  it('does nothing on a second run', () => {
    seedBuiltinTemplates()
    const again = seedBuiltinTemplates()
    expect(again.seeded).toEqual([])
    expect(listTemplates()).toHaveLength(BUILTIN_TEMPLATES.length)
  })

  it('leaves a deleted example deleted', () => {
    // Otherwise every restart resurrects examples someone deliberately removed.
    seedBuiltinTemplates()
    const victim = BUILTIN_TEMPLATES[0]!.id
    expect(deleteTemplate(victim)).toBe(true)

    seedBuiltinTemplates()
    expect(getTemplate(victim)).toBeNull()
    expect(listTemplates()).toHaveLength(BUILTIN_TEMPLATES.length - 1)
  })

  it('never overwrites an edited example', () => {
    seedBuiltinTemplates()
    const target = BUILTIN_TEMPLATES[0]!.id
    const edited = { ...getTemplate(target)!, name: 'My Custom Part Label' }
    updateTemplate(target, edited)

    seedBuiltinTemplates()
    expect(getTemplate(target)!.name).toBe('My Custom Part Label')
  })

  it('re-inserts a row that vanished without its marker', () => {
    // Guards a half-finished first run: the marker is only written after the
    // inserts, so a crash between them must not leave an example permanently
    // missing.
    getSqlite().exec('DELETE FROM settings')
    seedBuiltinTemplates()
    expect(listTemplates()).toHaveLength(BUILTIN_TEMPLATES.length)
  })

  it('produces templates the designer can load straight back', () => {
    seedBuiltinTemplates()
    for (const { id } of BUILTIN_TEMPLATES) {
      const stored = getTemplate(id)!
      expect(stored.baseWidthDots).toBeGreaterThan(0)
      expect(stored.baseHeightDots).toBeGreaterThan(0)
      expect(stored.overrides).toEqual({})
      expect(stored.createdAt).toBeTruthy()
    }
  })
})
