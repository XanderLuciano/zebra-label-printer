/**
 * Request-body schemas for the OpenAPI spec, generated from the Zod schemas that
 * actually validate them.
 *
 * These used to be written by hand in openapi.ts, which meant every limit, enum and
 * default existed twice and the copy in the docs was free to go stale. Generating
 * them removes that class of bug outright: if `MAX_COPIES` changes, the documented
 * maximum changes with it, because it is the same value.
 *
 * `io: 'input'` is the important option — it describes what a caller **sends**,
 * before defaults are applied and transforms run. The output side of
 * `templatePrintSchema` cannot be represented in JSON Schema at all (it collapses
 * `copies` into `quantity`), and it would be the wrong thing to publish anyway.
 *
 * Field prose lives in `.describe()` on the schemas themselves rather than here, so
 * there is still exactly one source for it.
 *
 * Not generated: response schemas and the endpoint descriptions in openapi.ts.
 * Nothing validates a response, so Zod has no definition to generate from.
 * `openapi-drift.test.ts` covers what remains hand-written.
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import {
  textLabelSchema,
  barcodeLabelSchema,
  qrLabelSchema,
  zplSchema,
  labelSchema,
  renderZplSchema,
  templateSchema,
  templatePrintSchema,
  serialLabelSchema,
  clearJobsSchema,
  jobResultSchema,
  printerConfigSchema,
  printerCalibrateSchema,
  printerCreateSchema,
  printerUpdateSchema,
  settingsSchema,
  labelSizeSchema
} from './schemas'

/**
 * OpenAPI component name → the schema that validates that request body.
 *
 * Every schema reachable from a `validate()` call belongs here. A missing entry is
 * an endpoint whose body is undocumented, which `openapi-drift.test.ts` fails on.
 */
export const REQUEST_SCHEMAS: Readonly<Record<string, ZodType>> = {
  TextLabelRequest: textLabelSchema,
  BarcodeLabelRequest: barcodeLabelSchema,
  QRLabelRequest: qrLabelSchema,
  ZplRequest: zplSchema,
  LabelRequest: labelSchema,
  SerialLabelRequest: serialLabelSchema,
  RenderZplRequest: renderZplSchema,
  TemplateDefinition: templateSchema,
  TemplatePrintRequest: templatePrintSchema,
  ClearJobsRequest: clearJobsSchema,
  JobResultRequest: jobResultSchema,
  PrinterConfigRequest: printerConfigSchema,
  PrinterCalibrateRequest: printerCalibrateSchema,
  PrinterCreateRequest: printerCreateSchema,
  PrinterUpdateRequest: printerUpdateSchema,
  SettingsRequest: settingsSchema,
  LabelSizeRequest: labelSizeSchema
}

/**
 * Keys JSON Schema puts at the root of a document that are noise inside an
 * OpenAPI `components.schemas` entry.
 */
const DOCUMENT_KEYS = ['$schema', '$id'] as const

function stripDocumentKeys(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema
  const copy = { ...(schema as Record<string, unknown>) }
  for (const key of DOCUMENT_KEYS) delete copy[key]
  return copy
}

/**
 * Build the generated half of `components.schemas`.
 *
 * Uses the registry form so each schema is emitted under its component name in one
 * pass. Called once at module load in openapi.ts, not per request.
 */
export function generateRequestSchemas(): Record<string, unknown> {
  const registry = z.registry<{ id: string }>()
  for (const [name, schema] of Object.entries(REQUEST_SCHEMAS)) {
    registry.add(schema, { id: name })
  }

  const result = z.toJSONSchema(registry, {
    io: 'input',
    target: 'draft-2020-12',
    uri: id => `#/components/schemas/${id}`
  }) as { schemas: Record<string, unknown> }

  return Object.fromEntries(
    Object.entries(result.schemas).map(([name, schema]) => [name, stripDocumentKeys(schema)])
  )
}


