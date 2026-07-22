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
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate
} from '../../db/template-repo'
import { templateSchema, renderZplSchema } from '../../schemas'
import type { TemplateDefinition, RenderZplRequest } from '../../schemas'

/** GET /api/templates — list all templates */
export function templatesListHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
    json(res, { templates: listTemplates() })
  }
}

/** GET /api/templates/:id — fetch a single template */
export function templateGetHandler(apiKey: string, id: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
    const tpl = getTemplate(id)
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

/** PUT /api/templates/:id — update a template */
export function templateUpdateHandler(apiKey: string, id: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
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

/** DELETE /api/templates/:id — delete a template */
export function templateDeleteHandler(apiKey: string, id: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return
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
