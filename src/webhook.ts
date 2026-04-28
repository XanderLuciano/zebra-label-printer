/**
 * Webhook server — expose the label printer over HTTP.
 *
 * POST /api/print/text  — print a text label
 * POST /api/print/barcode — print a barcode label
 * POST /api/print/qr     — print a QR code label
 * POST /api/print/zpl    — print raw ZPL
 * GET  /api/printers     — list available printers
 * GET  /api/health       — health check
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Printer } from './printer';
import { ZPLBuilder, textLabel, barcodeLabel, qrLabel } from './zpl';
import type { WebhookConfig, PrintResult, BarcodeType } from './types';

interface Route {
  method: string;
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse, body?: unknown) => Promise<void> | void;
}

export class WebhookServer {
  private server: ReturnType<typeof createServer> | null = null;
  private printer: Printer | null = null;
  private config: Required<WebhookConfig>;
  private routes: Route[] = [];

  constructor(config: WebhookConfig = {}) {
    this.config = {
      port: config.port ?? 3420,
      host: config.host ?? '0.0.0.0',
      apiKey: config.apiKey ?? '',
      defaultPrinter: config.defaultPrinter ?? '',
    };

    this.registerRoutes();
  }

  private auth(req: IncomingMessage, res: ServerResponse): boolean {
    if (!this.config.apiKey) return true; // No auth configured

    const authHeader = req.headers['authorization'];
    if (authHeader === `Bearer ${this.config.apiKey}`) return true;

    // Also accept ?key= in query
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.searchParams.get('key') === this.config.apiKey) return true;

    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
  }

  private json(res: ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private async readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve(raw || null);
        }
      });
    });
  }

  private registerRoutes(): void {
    // Health check
    this.routes.push({
      method: 'GET',
      path: '/api/health',
      handler: (_, res) => {
        this.json(res, { status: 'ok', printer: this.printer?.name ?? null });
      },
    });

    // List printers
    this.routes.push({
      method: 'GET',
      path: '/api/printers',
      handler: async (req, res) => {
        if (!this.auth(req, res)) return;
        const { discoverPrinters } = await import('./discovery');
        const printers = await discoverPrinters();
        this.json(res, { printers });
      },
    });

    // Print text label
    this.routes.push({
      method: 'POST',
      path: '/api/print/text',
      handler: async (req, res, body) => {
        if (!this.auth(req, res)) return;
        if (!this.printer) {
          this.json(res, { success: false, error: 'No printer connected' }, 503);
          return;
        }

        const data = body as { title?: string; lines: string[]; copies?: number } | null;
        if (!data?.lines?.length) {
          this.json(res, { error: 'Missing "lines" array' }, 400);
          return;
        }

        const zpl = textLabel(data.lines, {});
        const result = await this.printer.print(zpl);
        this.json(res, result, result.success ? 200 : 500);
      },
    });

    // Print barcode label
    this.routes.push({
      method: 'POST',
      path: '/api/print/barcode',
      handler: async (req, res, body) => {
        if (!this.auth(req, res)) return;
        if (!this.printer) {
          this.json(res, { success: false, error: 'No printer connected' }, 503);
          return;
        }

        const data = body as {
          data: string;
          type?: BarcodeType;
          text?: string;
          height?: number;
        } | null;

        if (!data?.data) {
          this.json(res, { error: 'Missing "data" field' }, 400);
          return;
        }

        const zpl = barcodeLabel(data.data, data.type ?? 'CODE128', data.text, {
          barcodeHeight: data.height,
        });

        const result = await this.printer.print(zpl);
        this.json(res, result, result.success ? 200 : 500);
      },
    });

    // Print QR code label
    this.routes.push({
      method: 'POST',
      path: '/api/print/qr',
      handler: async (req, res, body) => {
        if (!this.auth(req, res)) return;
        if (!this.printer) {
          this.json(res, { success: false, error: 'No printer connected' }, 503);
          return;
        }

        const data = body as { data: string; text?: string; magnification?: number } | null;

        if (!data?.data) {
          this.json(res, { error: 'Missing "data" field' }, 400);
          return;
        }

        const zpl = qrLabel(data.data, data.text, {
          magnification: data.magnification,
        });

        const result = await this.printer.print(zpl);
        this.json(res, result, result.success ? 200 : 500);
      },
    });

    // Print raw ZPL
    this.routes.push({
      method: 'POST',
      path: '/api/print/zpl',
      handler: async (req, res, body) => {
        if (!this.auth(req, res)) return;
        if (!this.printer) {
          this.json(res, { success: false, error: 'No printer connected' }, 503);
          return;
        }

        let zpl: string;
        if (typeof body === 'string') {
          zpl = body;
        } else if (body && typeof body === 'object' && 'zpl' in body) {
          zpl = (body as { zpl: string }).zpl;
        } else {
          this.json(res, { error: 'Missing ZPL data. Send raw ZPL string or {"zpl": "..."}' }, 400);
          return;
        }

        const result = await this.printer.print(zpl);
        this.json(res, result, result.success ? 200 : 500);
      },
    });

    // Print with ZPLBuilder from JSON definition
    this.routes.push({
      method: 'POST',
      path: '/api/print/label',
      handler: async (req, res, body) => {
        if (!this.auth(req, res)) return;
        if (!this.printer) {
          this.json(res, { success: false, error: 'No printer connected' }, 503);
          return;
        }

        const data = body as {
          elements: Array<Record<string, unknown>>;
        } | null;

        if (!data?.elements?.length) {
          this.json(res, { error: 'Missing "elements" array' }, 400);
          return;
        }

        try {
          const builder = new ZPLBuilder();
          for (const el of data.elements) {
            builder.element(el as Parameters<ZPLBuilder['element']>[0]);
          }
          const zpl = builder.build();
          const result = await this.printer.print(zpl);
          this.json(res, result, result.success ? 200 : 500);
        } catch (err) {
          this.json(res, { error: (err as Error).message }, 400);
        }
      },
    });
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

    // Find matching route
    for (const route of this.routes) {
      if (route.method === req.method && route.path === url.pathname) {
        const body = req.method === 'POST' ? await this.readBody(req) : undefined;
        await route.handler(req, res, body);
        return;
      }
    }

    // 404
    this.json(res, { error: 'Not found', endpoints: this.routes.map(r => `${r.method} ${r.path}`) }, 404);
  }

  /**
   * Connect to a printer and start the webhook server.
   */
  async start(printer?: Printer, printerName?: string): Promise<Printer> {
    // Connect to printer
    if (printer) {
      this.printer = printer;
    } else {
      this.printer = await Printer.connectOrAuto(printerName || this.config.defaultPrinter || undefined);
    }

    // Start HTTP server
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch(err => {
          console.error('Request error:', err);
          if (!res.headersSent) {
            this.json(res, { error: 'Internal server error' }, 500);
          }
        });
      });

      this.server.listen(this.config.port, this.config.host, () => {
        console.log(`🏷️  Zebra Label Printer API running on http://${this.config.host}:${this.config.port}`);
        console.log(`   Printer: ${this.printer!.name}`);
        console.log(`   Endpoints:`);
        for (const r of this.routes) {
          console.log(`   ${r.method} ${r.path}`);
        }
        resolve(this.printer!);
      });

      this.server.on('error', reject);
    });
  }

  /**
   * Stop the webhook server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Webhook server stopped');
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
 *
 * @example
 * ```ts
 * import { startServer } from 'zebra-label-printer';
 * await startServer({ port: 3420 });
 * ```
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
