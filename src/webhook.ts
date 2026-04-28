/**
 * Webhook server — expose the label printer over HTTP.
 *
 * Routes:
 *   GET  /api/health         — health check
 *   GET  /api/printers       — list available printers
 *   GET  /api/docs           — Swagger UI
 *   GET  /api/docs/openapi.json — OpenAPI spec
 *   POST /api/print/text     — print a text label
 *   POST /api/print/barcode  — print a barcode label
 *   POST /api/print/qr       — print a QR code label
 *   POST /api/print/zpl      — print raw ZPL
 *   POST /api/print/label    — print a composed label
 *
 * All POST endpoints validate with Zod — bad requests get structured 400s.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { ZodSchema } from 'zod';
import { Printer } from './printer';
import { ZPLBuilder, textLabel, barcodeLabel, qrLabel } from './zpl';
import {
  textLabelSchema,
  barcodeLabelSchema,
  qrLabelSchema,
  zplSchema,
  labelSchema,
} from './schemas';
import { OPENAPI_SPEC, swaggerUiHtml } from './openapi';
import type { WebhookConfig } from './types';
import type { TextLabelRequest, BarcodeLabelRequest, QRLabelRequest, LabelRequest } from './schemas';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function html(res: ServerResponse, body: string, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Validate request body against a Zod schema. Returns parsed data or a 400 error response.
 */
async function validate<T>(
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

// ─── Auth ────────────────────────────────────────────────────────────────────

function checkAuth(req: IncomingMessage, res: ServerResponse, apiKey: string): boolean {
  if (!apiKey) return true;

  const authHeader = req.headers['authorization'];
  if (authHeader === `Bearer ${apiKey}`) return true;

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (url.searchParams.get('key') === apiKey) return true;

  json(res, { error: 'Unauthorized — provide a valid API key via Bearer auth or ?key= query param' }, 401);
  return false;
}

// ─── Route handler type ─────────────────────────────────────────────────────

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  printer: Printer,
) => Promise<void>;

// ─── Server ──────────────────────────────────────────────────────────────────

export class WebhookServer {
  private server: ReturnType<typeof createServer> | null = null;
  private printer: Printer | null = null;
  private config: Required<WebhookConfig>;
  private routes: Map<string, Map<string, Handler>>;

  constructor(config: WebhookConfig = {}) {
    this.config = {
      port: config.port ?? 3420,
      host: config.host ?? '0.0.0.0',
      apiKey: config.apiKey ?? '',
      defaultPrinter: config.defaultPrinter ?? '',
    };
    this.routes = this.buildRoutes();
  }

  private buildRoutes(): Map<string, Map<string, Handler>> {
    const map = new Map<string, Map<string, Handler>>();

    // GET routes
    const get = new Map<string, Handler>();

    get.set('/api/health', async (_req, res, printer) => {
      json(res, { status: 'ok', printer: printer?.name ?? null });
    });

    get.set('/api/printers', async (req, res, _printer) => {
      if (!checkAuth(req, res, this.config.apiKey)) return;
      const { discoverPrinters } = await import('./discovery');
      const printers = await discoverPrinters();
      json(res, { printers });
    });

    get.set('/api/docs/openapi.json', async (_req, res, _printer) => {
      json(res, OPENAPI_SPEC);
    });

    get.set('/api/docs', async (_req, res, _printer) => {
      html(res, swaggerUiHtml('/api/docs/openapi.json'));
    });

    map.set('GET', get);

    // POST routes
    const post = new Map<string, Handler>();

    post.set('/api/print/text', async (req, res, printer) => {
      if (!checkAuth(req, res, this.config.apiKey)) return;

      const data = await validate<TextLabelRequest>(req, res, textLabelSchema);
      if (!data) return;

      const zpl = textLabel(data.lines, {});
      const result = await printer.print(zpl);
      json(res, result, result.success ? 200 : 500);
    });

    post.set('/api/print/barcode', async (req, res, printer) => {
      if (!checkAuth(req, res, this.config.apiKey)) return;

      const data = await validate<BarcodeLabelRequest>(req, res, barcodeLabelSchema);
      if (!data) return;

      const zpl = barcodeLabel(data.data, data.type, data.text, {
        barcodeHeight: data.height,
      });
      const result = await printer.print(zpl);
      json(res, result, result.success ? 200 : 500);
    });

    post.set('/api/print/qr', async (req, res, printer) => {
      if (!checkAuth(req, res, this.config.apiKey)) return;

      const data = await validate<QRLabelRequest>(req, res, qrLabelSchema);
      if (!data) return;

      const zpl = qrLabel(data.data, data.text, {
        magnification: data.magnification,
      });
      const result = await printer.print(zpl);
      json(res, result, result.success ? 200 : 500);
    });

    post.set('/api/print/zpl', async (req, res, printer) => {
      if (!checkAuth(req, res, this.config.apiKey)) return;

      const raw = await readBody(req);

      // Try as raw ZPL string first (text/plain), then as JSON
      let zpl: string;
      if (raw && !raw.trim().startsWith('{') && !raw.trim().startsWith('[')) {
        zpl = raw.trim();
      } else {
        const data = await validate<{ zpl: string }>(
          req, res,
          zplSchema as unknown as ZodSchema<{ zpl: string }>,
        );
        if (!data) return;
        zpl = (data as unknown as { zpl: string }).zpl;
      }

      if (!zpl || zpl.length === 0) {
        json(res, { error: 'ZPL commands required' }, 400);
        return;
      }

      const result = await printer.print(zpl);
      json(res, result, result.success ? 200 : 500);
    });

    post.set('/api/print/label', async (req, res, printer) => {
      if (!checkAuth(req, res, this.config.apiKey)) return;

      const data = await validate<LabelRequest>(req, res, labelSchema);
      if (!data) return;

      try {
        const builder = new ZPLBuilder();
        for (const el of data.elements) {
          builder.element(el as Parameters<ZPLBuilder['element']>[0]);
        }
        const zpl = builder.build();
        const result = await printer.print(zpl);
        json(res, result, result.success ? 200 : 500);
      } catch (err) {
        json(res, { error: (err as Error).message }, 400);
      }
    });

    map.set('POST', post);

    return map;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const method = req.method?.toUpperCase() ?? 'GET';
    const methodRoutes = this.routes.get(method);

    if (!methodRoutes) {
      json(res, { error: `Method ${method} not allowed` }, 405);
      return;
    }

    const handler = methodRoutes.get(url.pathname);
    if (!handler) {
      // List available endpoints on 404
      const endpoints: string[] = [];
      for (const [m, routes] of this.routes) {
        for (const path of routes.keys()) {
          endpoints.push(`${m} ${path}`);
        }
      }
      json(res, {
        error: `No route for ${method} ${url.pathname}`,
        endpoints: endpoints.sort(),
        docs: `http://${req.headers.host ?? 'localhost'}:${this.config.port}/api/docs`,
      }, 404);
      return;
    }

    if (!this.printer && method === 'POST') {
      json(res, { success: false, error: 'No printer connected' }, 503);
      return;
    }

    try {
      await handler(req, res, this.printer!);
    } catch (err) {
      console.error('Handler error:', err);
      if (!res.headersSent) {
        json(res, { error: 'Internal server error' }, 500);
      }
    }
  }

  /**
   * Connect to a printer and start the webhook server.
   */
  async start(printer?: Printer, printerName?: string): Promise<Printer> {
    if (printer) {
      this.printer = printer;
    } else {
      this.printer = await Printer.connectOrAuto(
        printerName || this.config.defaultPrinter || undefined,
      );
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch(err => {
          console.error('Request error:', err);
          if (!res.headersSent) {
            json(res, { error: 'Internal server error' }, 500);
          }
        });
      });

      this.server.listen(this.config.port, this.config.host, () => {
        const addr = this.config.host === '0.0.0.0' ? 'localhost' : this.config.host;
        console.log(`\n🦓  Zebra Label Printer API`);
        console.log(`   Server:  http://${addr}:${this.config.port}`);
        console.log(`   Printer: ${this.printer!.name}`);
        console.log(`   Docs:    http://${addr}:${this.config.port}/api/docs`);
        console.log(`\n   Endpoints:`);
        for (const [method, routes] of this.routes) {
          for (const [path] of routes) {
            console.log(`   ${method.padEnd(5)} ${path}`);
          }
        }
        console.log();
        resolve(this.printer!);
      });

      this.server.on('error', reject);
    });
  }

  /** Stop the webhook server. */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Server stopped');
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

/**
 * Quick-start helper: starts the webhook server with auto-discovery.
 */
export async function startServer(config: WebhookConfig = {}): Promise<WebhookServer> {
  const server = new WebhookServer(config);
  await server.start();
  return server;
}

// Run directly if executed as main module
if (require.main === module) {
  const port = parseInt(process.env.PORT || '3420', 10);
  const printerName = process.env.ZEBRA_PRINTER || undefined;
  const apiKey = process.env.ZEBRA_API_KEY || '';

  startServer({ port, defaultPrinter: printerName, apiKey }).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
