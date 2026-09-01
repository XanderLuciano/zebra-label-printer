/**
 * Label template repository — CRUD for reusable label templates.
 *
 * A template stores its layout with *relative* positioning (percent of the
 * label dimensions), `{{variable}}` tokens for dynamic data, and per-size
 * overrides. The full definition is persisted as a JSON blob in the `data`
 * column; `name`/`description` are mirrored into columns for listing/search.
 */

import { eq, desc } from 'drizzle-orm'
import crypto from 'crypto'
import { getDb } from './database'
import { labelTemplates, settings } from './schema'
import { templateSchema } from '../schemas'
import type { TemplateDefinition } from '../schemas'
import {
  PRESET_ID_PREFIX,
  listPresetTemplates,
  presetTemplate
} from './template-presets'
import type { PresetTemplate } from './template-presets'

/**
 * A template as the API serves it.
 *
 * Covers both kinds: a user-owned row from this table, and a read-only preset
 * built from code. The timestamps are optional because a preset was never
 * written anywhere and so has neither.
 */
export interface StoredTemplate extends TemplateDefinition {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  /** Presets can't be edited or deleted; a user's own templates can. */
  readOnly: boolean;
}

function parseRow(row: typeof labelTemplates.$inferSelect): StoredTemplate {
  const def = JSON.parse(row.data) as TemplateDefinition
  return {
    ...def,
    id: row.id,
    name: row.name,
    description: row.description ?? def.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    readOnly: false
  }
}

/** List the user's own templates, newest first. Presets are not included. */
export function listTemplates(): StoredTemplate[] {
  const db = getDb()
  const rows = db.select().from(labelTemplates).orderBy(desc(labelTemplates.updatedAt)).all()
  return rows.map(parseRow)
}

/** Get one of the user's own templates by id. Does not resolve presets. */
export function getTemplate(id: string): StoredTemplate | null {
  const db = getDb()
  const row = db.select().from(labelTemplates).where(eq(labelTemplates.id, id)).get()
  return row ? parseRow(row) : null
}

/** Create a new template. Returns the stored template. */
export function createTemplate(def: TemplateDefinition): StoredTemplate {
  const db = getDb()
  const id = `tpl_${crypto.randomBytes(8).toString('hex')}`
  db.insert(labelTemplates).values({
    id,
    name: def.name,
    description: def.description ?? null,
    data: JSON.stringify(def)
  }).run()
  return getTemplate(id)!
}

/** Update an existing template. Returns the stored template, or null if not found. */
export function updateTemplate(id: string, def: TemplateDefinition): StoredTemplate | null {
  const db = getDb()
  const existing = db.select({ id: labelTemplates.id }).from(labelTemplates).where(eq(labelTemplates.id, id)).get()
  if (!existing) return null

  db.update(labelTemplates)
    .set({
      name: def.name,
      description: def.description ?? null,
      data: JSON.stringify(def),
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
    })
    .where(eq(labelTemplates.id, id))
    .run()
  return getTemplate(id)
}

/** Delete a template. Returns true if a row was removed. */
export function deleteTemplate(id: string): boolean {
  const db = getDb()
  const existing = db.select({ id: labelTemplates.id }).from(labelTemplates).where(eq(labelTemplates.id, id)).get()
  if (!existing) return false
  db.delete(labelTemplates).where(eq(labelTemplates.id, id)).run()
  return true
}

// ─── Presets combined with user templates ────────────────────────────────────

/**
 * Everything the user can pick from: their own templates first, then the presets.
 *
 * Their own come first because once someone has built templates, those are what
 * they reach for; on a fresh install the list is presets alone.
 *
 * A preset whose id is somehow still occupied by a row is omitted in favour of
 * that row. That only happens when the startup migration failed, and the row is
 * the user's customisation — hiding *it* behind the preset would lock their work
 * away, and listing both under one id would confuse every picker.
 */
export function listAllTemplates(): StoredTemplate[] {
  const stored = listTemplates()
  const occupied = new Set(stored.map(t => t.id))
  return [...stored, ...listPresetTemplates().filter(p => !occupied.has(p.id))]
}

/**
 * Resolve any template id, preset or user-owned.
 *
 * The stored row wins over a same-id preset for the reason above: it only exists
 * when migration failed, and it holds the user's work.
 */
export function findTemplate(id: string): StoredTemplate | null {
  return getTemplate(id) ?? presetTemplate(id)
}

// ─── Migration off the old seeded-rows model ─────────────────────────────────

/** The definition fields only, with the serving metadata stripped back off. */
function definitionOf(template: StoredTemplate | PresetTemplate): TemplateDefinition {
  const def: Record<string, unknown> = { ...template }
  for (const key of ['id', 'createdAt', 'updatedAt', 'readOnly']) delete def[key]
  return def as unknown as TemplateDefinition
}

/**
 * JSON with object keys sorted, so two equivalent definitions compare equal.
 *
 * Key order isn't meaningful here but does differ between a definition built in
 * code and one that has been through a JSON round-trip, so a plain
 * `JSON.stringify` comparison would report differences that aren't there.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/**
 * Comparable form of a definition, with schema defaults filled in.
 *
 * Both sides go through the schema so optional fields that default on write
 * (a variable's empty `label`, say) don't make an untouched row look edited.
 * Returns null when the definition doesn't parse, which is treated as "differs".
 */
function comparableDefinition(def: TemplateDefinition): string | null {
  const parsed = templateSchema.safeParse(def)
  return parsed.success ? stableStringify(parsed.data) : null
}

/**
 * Retire the preset rows that older versions seeded into the database.
 *
 * Presets are served from code now, so a leftover row would show up as a
 * duplicate of the preset it was copied from. Rows still matching what this
 * release ships are simply dropped. Anything the user changed is *their* work, so
 * it's kept — re-created as an ordinary user-owned template under a fresh id, out
 * of the preset id space.
 *
 * Idempotent: once the rows are gone there is nothing left to match.
 */
export function migrateSeededPresetRows(): { removed: string[]; preserved: string[] } {
  const removed: string[] = []
  const preserved: string[] = []

  for (const row of listTemplates()) {
    if (!row.id.startsWith(PRESET_ID_PREFIX)) continue

    const preset = presetTemplate(row.id)
    const stored = comparableDefinition(definitionOf(row))
    // A preset this release no longer ships leaves the row as the only copy in
    // existence, so it's preserved rather than dropped.
    const unchanged = !!preset
      && stored !== null
      && stored === comparableDefinition(definitionOf(preset))

    if (unchanged) {
      deleteTemplate(row.id)
      removed.push(row.id)
      continue
    }

    // Only rename when the name would collide with the preset it diverged from;
    // if they already renamed it, that name is the informative one.
    const def = definitionOf(row)
    const name = preset && def.name === preset.name ? `${def.name} (customised)` : def.name
    // One transaction, so a crash can't land between the copy appearing and the
    // old row going — which would fork a duplicate copy on the next startup.
    getDb().transaction(() => {
      createTemplate({ ...def, name })
      deleteTemplate(row.id)
    })
    preserved.push(row.id)
  }

  // The old seeding model tracked what it had inserted in a settings key. Nothing
  // reads it anymore; leaving it would just be a fossil in every migrated install.
  if (removed.length > 0 || preserved.length > 0) {
    getDb().delete(settings).where(eq(settings.key, 'builtin_templates_seeded')).run()
  }

  return { removed, preserved }
}
