/**
 * WebhookServer — HTTP server that exposes the label printer over the network.
 *
 * Routes: see handlers/get-routes.ts and handlers/post-routes.ts
 * Validation: Zod schemas from ../schemas.ts
 * Docs: OpenAPI 3.1 spec served at /api/docs (Swagger UI)
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Printer } from '../printer';
import { json } from './helpers';
import type { RouteTable, Handler } from './router';
import { findHandler, sendNotFound, printRoutes } from './router';
import {
  healthHandler,
  printersHandler,
  openApiHandler,
  docsHandler,
} from './handlers/get-routes';
import {
  printTextHandler,
  printBarcodeHandler,
  printQrHandler,
  printZplHandler,
  printLabelHandler,
} from './handlers/post-routes';
import type { WebhookConfig } from '../types';

// ─── Server ──────────────────────────────────────────────────────────────────

export class WebhookServer {
  private httpServer: ReturnType<typeof createServer> | null = null;
  private printer: Printer | null = null;
  private config: Required<WebhookConfig>;
  private routes: RouteTable;

  constructor(config: WebhookConfig = {}) {
    this.config = {
      port: config.port ?? 3420,
      host: config.host ?? '0.0.0.0',
      apiKey: config.apiKey ?? '',
      defaultPrinter: config.defaultPrinter ?? '',
    };
    this.routes = this.buildRoutes();
  }

  private buildRoutes(): RouteTable {
    const { apiKey } = this.config;
    const table: RouteTable = new Map();

    // GET routes
    const get = new Map<string, Handler>();
    get.set('/api/health', healthHandler);
    get.set('/api/printers', printersHandler(apiKey));
    get.set('/api/docs/openapi.json', openApiHandler);
    get.set('/api/docs', docsHandler);
    table.set('GET', get);

    // POST routes
    const post = new Map<string, Handler>();
    post.set('/api/print/text', printTextHandler(apiKey));
    post.set('/api/print/barcode', printBarcodeHandler(apiKey));
    post.set('/api/print/qr', printQrHandler(apiKey));
    post.set('/api/print/zpl', printZplHandler(apiKey));
    post.set('/api/print/label', printLabelHandler(apiKey));
    table.set('POST', post);

    return table;
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
    const handler = findHandler(this.routes, method, url.pathname);

    if (!handler) {
      sendNotFound(
        res, method, url.pathname, this.routes,
        req.headers.host ?? 'localhost', this.config.port,
      );
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
   * Connect to a printer and start the HTTP server.
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
      this.httpServer = createServer((req, res) => {
        this.handleRequest(req, res).catch(err => {
          console.error('Request error:', err);
          if (!res.headersSent) {
            json(res, { error: 'Internal server error' }, 500);
          }
        });
      });

      this.httpServer.listen(this.config.port, this.config.host, () => {
        const addr = this.config.host === '0.0.0.0' ? 'localhost' : this.config.host;
        console.log(`\n🦓  Zebra Label Printer API`);
        console.log(`   Server:  http://${addr}:${this.config.port}`);
        console.log(`   Printer: ${this.printer!.name}`);
        console.log(`   Docs:    http://${addr}:${this.config.port}/api/docs\n`);
        printRoutes(this.routes);
        console.log();
        resolve(this.printer!);
      });

      this.httpServer.on('error', reject);
    });
  }

  /** Stop the HTTP server. */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          console.log('Server stopped');
          this.httpServer = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

/**
 * Quick-start helper: creates and starts a WebhookServer with auto-discovery.
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
