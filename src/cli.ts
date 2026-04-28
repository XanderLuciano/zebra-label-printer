#!/usr/bin/env node
/**
 * CLI for the Zebra Label Printer library.
 *
 * Commands:
 *   discover          List available printers
 *   print-test        Print a test label
 *   print-text <...>  Print a text label
 *   print-bc <...>    Print a barcode label
 *   print-qr <...>    Print a QR code label
 *   serve             Start the webhook server
 */

import { discoverPrinters, Printer } from './printer';
import { ZPLBuilder, textLabel, barcodeLabel, qrLabel } from './zpl';
import { startServer } from './webhook';

const cmd = process.argv[2];
const args = process.argv.slice(3);

async function main(): Promise<void> {
  switch (cmd) {
    case 'discover':
    case 'list': {
      console.log('Discovering printers...\n');
      const printers = await discoverPrinters();
      if (printers.length === 0) {
        console.log('No printers found.');
      } else {
        for (const p of printers) {
          const icon = p.isZebra ? '🦓' : '🖨️';
          console.log(`${icon}  ${p.name}`);
          console.log(`   URI:      ${p.uri}`);
          console.log(`   Model:    ${p.model}`);
          console.log(`   Status:   ${p.status}`);
          console.log(`   Accepting: ${p.accepting ? 'yes' : 'no'}`);
          if (p.serial) console.log(`   Serial:   ${p.serial}`);
          console.log();
        }
      }
      break;
    }

    case 'print-test':
    case 'test': {
      const printer = await Printer.connectOrAuto(args[0]);
      console.log(`Printing test label to ${printer.name}...`);

      const builder = new ZPLBuilder();
      builder
        .text('ZEBRA GK420d', { x: 50, y: 30, height: 45, width: 27, font: 'D' })
        .text('Test Print ✓', { x: 50, y: 85, height: 35, font: '0' })
        .text(new Date().toLocaleString(), { x: 50, y: 135, height: 25, font: '0' })
        .line(40, 175, 520, 3)
        .text('Library: zebra-label-printer', { x: 50, y: 195, height: 22, font: '0' })
        .barcode('TEST-12345', { x: 50, y: 240, type: 'CODE128', height: 70, humanReadable: true })
        .qrcode('https://github.com', { x: 380, y: 50, magnification: 4 });

      const result = await printer.print(builder.build());
      if (result.success) {
        console.log(`✅ Label printed! Job ID: ${result.jobId}`);
      } else {
        console.error(`❌ Print failed: ${result.error}`);
      }
      break;
    }

    case 'print-text': {
      const printerName = args[0]?.startsWith('-') ? undefined : args[0];
      const textArgs = printerName ? args.slice(1) : args;
      const text = textArgs.join(' ');

      if (!text) {
        console.error('Usage: zebra-label print-text [printer] "Hello World"');
        process.exit(1);
      }

      const printer = await Printer.connectOrAuto(printerName);
      const zpl = textLabel([text], {});
      const result = await printer.print(zpl);
      console.log(result.success ? `✅ Printed: "${text}" (Job: ${result.jobId})` : `❌ Failed: ${result.error}`);
      break;
    }

    case 'print-bc': {
      const printerName = args[0]?.startsWith('-') ? undefined : args[0];
      const bcArgs = printerName ? args.slice(1) : args;
      const data = bcArgs[0];
      const labelText = bcArgs.slice(1).join(' ') || undefined;

      if (!data) {
        console.error('Usage: zebra-label print-bc [printer] BARCODE_DATA [label text]');
        process.exit(1);
      }

      const printer = await Printer.connectOrAuto(printerName);
      const zpl = barcodeLabel(data, 'CODE128', labelText);
      const result = await printer.print(zpl);
      console.log(result.success ? `✅ Printed barcode: ${data} (Job: ${result.jobId})` : `❌ Failed: ${result.error}`);
      break;
    }

    case 'print-qr': {
      const printerName = args[0]?.startsWith('-') ? undefined : args[0];
      const qrArgs = printerName ? args.slice(1) : args;
      const data = qrArgs[0];
      const labelText = qrArgs.slice(1).join(' ') || undefined;

      if (!data) {
        console.error('Usage: zebra-label print-qr [printer] DATA [label text]');
        process.exit(1);
      }

      const printer = await Printer.connectOrAuto(printerName);
      const zpl = qrLabel(data, labelText);
      const result = await printer.print(zpl);
      console.log(result.success ? `✅ Printed QR: ${data} (Job: ${result.jobId})` : `❌ Failed: ${result.error}`);
      break;
    }

    case 'serve':
    case 'start': {
      const port = parseInt(process.env.PORT || '3420', 10);
      const printerName = args[0] || process.env.ZEBRA_PRINTER || undefined;
      const apiKey = process.env.ZEBRA_API_KEY || '';

      const server = await startServer({ port, defaultPrinter: printerName, apiKey });

      // Graceful shutdown
      const shutdown = async () => {
        console.log('\nShutting down...');
        await server.stop();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      break;
    }

    default: {
      console.log(`
🦓 Zebra Label Printer CLI

Commands:
  discover                  List available printers
  print-test [printer]      Print a test label with text, barcode, and QR
  print-text [printer] <text>      Print a simple text label
  print-bc [printer] <data> [text] Print a barcode label
  print-qr [printer] <data> [text] Print a QR code label
  serve [printer]           Start the webhook server

Environment:
  ZEBRA_PRINTER             Default printer name
  ZEBRA_API_KEY             API key for webhook auth
  PORT                      Webhook server port (default: 3420)
`);
      break;
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
