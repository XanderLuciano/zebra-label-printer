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
import { labelTemplates } from './schema'
import type { TemplateDefinition } from '../schemas'

/** A stored template: metadata columns + parsed definition */
export interface StoredTemplate extends TemplateDefinition {
  id: string;
  createdAt: string;
  updatedAt: string;
}

function parseRow(row: typeof labelTemplates.$inferSelect): StoredTemplate {
  const def = JSON.parse(row.data) as TemplateDefinition
  return {
    ...def,
    id: row.id,
    name: row.name,
    description: row.description ?? def.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

/** List all templates, newest first */
export function listTemplates(): StoredTemplate[] {
  const db = getDb()
  const rows = db.select().from(labelTemplates).orderBy(desc(labelTemplates.updatedAt)).all()
  return rows.map(parseRow)
}

/** Get a single template by id */
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
