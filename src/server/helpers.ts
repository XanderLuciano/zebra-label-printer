/**
 * Server helpers — HTTP response utilities, body parsing, auth, and validation.
 *
 * Small, pure functions with no side effects beyond the response object.
 */

import { IncomingMessage, ServerResponse } from 'http';
import { ZodSchema } from 'zod';

/** Send a JSON response */
export function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

/** Send an HTML response */
export function html(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

/** Read the full request body as a UTF-8 string */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

/** Safely parse JSON, returning null on failure */
export function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Validate request body against a Zod schema.
 * Returns parsed data, or sends a 400 and returns null on failure.
 */
export async function validate<T>(
  req: IncomingMessage,
  res: ServerResponse,
  schema: ZodSchema<T>,
): Promise<T | null> {
  const raw = await readBody(req);

  const parsed = parseJson(raw);
  if (parsed === null) {
    json(res, { error: 'Invalid JSON body' }, 400);
    return null;
  }

  const result = schema.safeParse(parsed);
  if (result.success) {
    return result.data;
  }

  json(res, {
    error: 'Validation failed',
    details: result.error.issues.map(issue => ({
      field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
      message: issue.message,
    })),
  }, 400);
  return null;
}

/**
 * Check API key authentication.
 * Returns true if authorized, sends 401 and returns false otherwise.
 * If no apiKey is configured, all requests pass.
 */
export function checkAuth(
  req: IncomingMessage,
  res: ServerResponse,
  apiKey: string,
): boolean {
  if (!apiKey) return true;

  const authHeader = req.headers['authorization'];
  if (authHeader === `Bearer ${apiKey}`) return true;

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (url.searchParams.get('key') === apiKey) return true;

  json(res, {
    error: 'Unauthorized — provide a valid API key via Bearer auth or ?key= query param',
  }, 401);
  return false;
}
