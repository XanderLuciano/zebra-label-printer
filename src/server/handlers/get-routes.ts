/**
 * GET route handlers — health, printer discovery, API documentation.
 */

import type { Handler } from '../router';
import { json, html, checkAuth } from '../helpers';
import { OPENAPI_SPEC, swaggerUiHtml } from '../../openapi';

/** GET /api/health — server and printer status */
export const healthHandler: Handler = async (_req, res, printer) => {
  json(res, { status: 'ok', printer: printer?.name ?? null });
};

/** GET /api/printers — list available printers */
export function printersHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return;
    const { discoverPrinters } = await import('../../discovery');
    const printers = await discoverPrinters();
    json(res, { printers });
  };
}

/** GET /api/docs/openapi.json — OpenAPI 3.1 specification */
export const openApiHandler: Handler = async (_req, res, _printer) => {
  json(res, OPENAPI_SPEC);
};

/** GET /api/docs — Swagger UI (interactive API documentation) */
export const docsHandler: Handler = async (_req, res, _printer) => {
  html(res, swaggerUiHtml('/api/docs/openapi.json'));
};
