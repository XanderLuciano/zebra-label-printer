/**
 * Template route handlers — CRUD for label templates + a ZPL render endpoint.
 *
 * Templates are opaque layout definitions authored by the web designer. The
 * frontend resolves a template (relative positions + variables + per-size
 * overrides) into a plain `elements[]` array before printing via
 * /api/print/label, so these routes only persist/serve the definitions.
 *
 * /api/render/zpl builds ZPL from an already-resolved `elements[]` array
 * *without printing*, so the UI can show an accurate (e.g. Labelary) preview.
 */

import type { Handler } from '../router'
import { json, validate, checkAuth } from '../helpers'
import { ZPLBuilder } from '../../zpl'
import { getLabelSize } from '../../db/settings-repo'
import {
  listAllTemplates,
  findTemplate,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate
} from '../../db/template-repo'
import { isPresetId } from '../../db/template-presets'
import { templateSchema, renderZplSchema } from '../../schemas'
import type { TemplateDefinition, RenderZplRequest } from '../../schemas'

/**
 * The response for an attempt to modify a preset.
 *
 * A preset ships in this release's code, so there is nothing to write to. Saving a
 * copy is the supported way to customise one, and the message says so rather than
 * leaving a caller to guess why a valid-looking request was refused.
 */
const PRESET_IMMUTABLE = {
  error: 'This template is a built-in preset and cannot be changed or removed. '
    + 'Save a copy to customise it — the copy is yours to edit.'
}

/**
 * Should a write to this id be refused as a preset?
 *
 * A row under a preset id can only mean the startup migration failed and left the
 * user's customisation behind. That row is theirs, so writes to it stay allowed —
 * refusing would lock their own work behind a 403.
 */
function isProtectedPreset(id: string): boolean {
  return isPresetId(id) && !getTemplate(id)
}

/** GET /api/templates — list the user's templates plus the built-in presets */
export function templatesListHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
    json(res, { templates: listAllTemplates() })
  }
}

/** GET /api/templates/:id — fetch a single template, preset or user-owned */
export function templateGetHandler(apiKey: string, id: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
    const tpl = findTemplate(id)
    if (!tpl) {
      json(res, { error: 'Template not found' }, 404)
      return
    }
    json(res, { template: tpl })
  }
}

/** POST /api/templates — create a template */
export function templateCreateHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
    const data = await validate<TemplateDefinition>(req, res, templateSchema)
    if (!data) return
    const tpl = createTemplate(data)
    json(res, { template: tpl }, 201)
  }
}

/** PUT /api/templates/:id — update a user's template. Presets are immutable. */
export function templateUpdateHandler(apiKey: string, id: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
    // Checked before validating the body: the answer is the same either way, and
    // a schema complaint would be a confusing thing to get back.
    if (isProtectedPreset(id)) {
      json(res, PRESET_IMMUTABLE, 403)
      return
    }
    const data = await validate<TemplateDefinition>(req, res, templateSchema)
    if (!data) return
    const tpl = updateTemplate(id, data)
    if (!tpl) {
      json(res, { error: 'Template not found' }, 404)
      return
    }
    json(res, { template: tpl })
  }
}

/** DELETE /api/templates/:id — delete a user's template. Presets are immutable. */
export function templateDeleteHandler(apiKey: string, id: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
    if (isProtectedPreset(id)) {
      json(res, PRESET_IMMUTABLE, 403)
      return
    }
    const removed = deleteTemplate(id)
    if (!removed) {
      json(res, { error: 'Template not found' }, 404)
      return
    }
    json(res, { success: true })
  }
}

/** POST /api/render/zpl — build ZPL from resolved elements without printing */
export function renderZplHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
    const data = await validate<RenderZplRequest>(req, res, renderZplSchema)
    if (!data) return

    const size = getLabelSize()
    const width = data.widthDots ?? size.widthDots
    const height = data.heightDots ?? size.heightDots

    try {
      const builder = new ZPLBuilder({ width, height, copies: data.copies ?? 1 })
      builder.labelSize(width, height)
      for (const el of data.elements) {
        builder.element(el as Parameters<ZPLBuilder['element']>[0])
      }
      json(res, { zpl: builder.build(), widthDots: width, heightDots: height })
    } catch (err) {
      json(res, { error: (err as Error).message }, 400)
    }
  }
}
