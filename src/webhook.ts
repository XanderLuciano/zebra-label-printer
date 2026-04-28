/**
 * Webhook server — backward-compatible re-export.
 *
 * The implementation has been split into focused modules under src/server/.
 * This file exists so existing imports and the CLI `serve` command continue to work.
 */

export { WebhookServer, startServer } from './server/index';

// Standalone entry point: when run directly, start the server
import { startServer } from './server/index';

if (require.main === module) {
  const port = parseInt(process.env.PORT || '3420', 10);
  const printerName = process.env.ZEBRA_PRINTER || undefined;
  const apiKey = process.env.ZEBRA_API_KEY || '';

  startServer({ port, defaultPrinter: printerName, apiKey }).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
