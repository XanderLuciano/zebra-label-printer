/**
 * Printer discovery — finds available Zebra label printers.
 *
 * Currently CUPS-based but designed to be extended with raw USB discovery
 * and network (mDNS/Bonjour) scanning.
 */

import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import type { PrinterInfo, DiscoveryOptions } from './types';

const exec = promisify(execCb);

/** The USB vendor ID for Zebra Technologies */
const ZEBRA_VENDOR_ID = '0a5f';

/** Known Zebra printer models (case-insensitive matching) */
const ZEBRA_MODEL_PATTERNS = [
  /zebra/i,
  /ztc/i,
  /gk420/i,
  /gk\d+/i,
  /zt\d+/i,
  /zd\d+/i,
  /zq\d+/i,
  /lp\s*2844/i,
  /gc\d+/i,
  /gt\d+/i,
  /gx\d+/i,
];

/**
 * Check if a printer appears to be a Zebra printer based on its properties.
 */
function isZebraPrinter(info: { name: string; uri: string; model: string }): boolean {
  const check = `${info.name} ${info.uri} ${info.model}`.toLowerCase();

  // Check vendor ID in USB URI
  if (check.includes(`vid:${ZEBRA_VENDOR_ID}`) || check.includes(`vendor=${ZEBRA_VENDOR_ID}`)) {
    return true;
  }

  // Check against known model patterns
  return ZEBRA_MODEL_PATTERNS.some(pattern => pattern.test(info.name) || pattern.test(info.model));
}

/**
 * Parse the output of `lpstat -l -p` into PrinterInfo objects.
 */
function parseLpstat(output: string): PrinterInfo[] {
  const printers: PrinterInfo[] = [];
  let current: Partial<PrinterInfo> = {};

  for (const line of output.split('\n')) {
    const trimmed = line.trim();

    if (trimmed.startsWith('printer ')) {
      // Save previous
      if (current.name) {
        printers.push(normalizePrinterInfo(current));
      }
      current = { name: trimmed.replace('printer ', '').split(' ')[0] };
    }

    if (trimmed.startsWith('Description:')) {
      current.model = trimmed.replace('Description:', '').trim();
    }

    if (trimmed.startsWith('Interface:') || trimmed.startsWith('Device:')) {
      const iface = trimmed.replace(/^(Interface|Device):\s*/, '').trim();
      if (iface && iface !== 'unknown') {
        current.uri = iface;
      }
    }

    if (trimmed.startsWith('PrinterIdle') || trimmed.includes('is idle')) {
      current.status = 'idle';
    } else if (trimmed.startsWith('PrinterPrinting') || trimmed.includes('now printing')) {
      current.status = 'printing';
    } else if (trimmed.startsWith('PrinterStopped') || trimmed.includes('disabled')) {
      current.status = 'unavailable';
    }

    if (trimmed.includes('accepting requests') || trimmed.includes('accepting jobs')) {
      current.accepting = true;
    } else if (trimmed.includes('rejecting')) {
      current.accepting = false;
    }
  }

  // Don't forget the last one
  if (current.name) {
    printers.push(normalizePrinterInfo(current));
  }

  return printers;
}

function normalizePrinterInfo(partial: Partial<PrinterInfo>): PrinterInfo {
  return {
    name: partial.name ?? 'unknown',
    uri: partial.uri ?? '',
    model: partial.model ?? '',
    status: partial.status ?? 'unknown',
    accepting: partial.accepting ?? true,
    serial: extractSerial(partial.uri ?? ''),
    isZebra: isZebraPrinter({
      name: partial.name ?? '',
      uri: partial.uri ?? '',
      model: partial.model ?? '',
    }),
  };
}

function extractSerial(uri: string): string | undefined {
  const match = uri.match(/serial=([^&\s]+)/);
  return match?.[1];
}

/**
 * Extract shorter status from `lpstat -p` output.
 */
function parseSimpleLpstat(output: string): Map<string, { status: string; accepting: boolean }> {
  const map = new Map<string, { status: string; accepting: boolean }>();

  for (const line of output.split('\n')) {
    const match = line.match(/^printer\s+(\S+)/);
    if (!match) continue;

    const name = match[1];
    const status = line.includes('disabled') || line.includes('unavailable')
      ? 'unavailable'
      : line.includes('printing')
        ? 'printing'
        : line.includes('idle')
          ? 'idle'
          : 'unknown';
    const accepting = !line.includes('rejecting');

    map.set(name, { status, accepting });
  }

  return map;
}

/**
 * Discover available printers.
 *
 * Uses CUPS backend (`lpstat`) to find printers, with smart Zebra detection.
 *
 * @example
 * ```ts
 * const printers = await discoverPrinters({ zebraOnly: true });
 * console.log(printers);
 * ```
 */
export async function discoverPrinters(options: DiscoveryOptions = {}): Promise<PrinterInfo[]> {
  try {
    // Get detailed printer info
    const { stdout: detailOut } = await exec('lpstat -l -p', { timeout: 5000 });
    const printers = parseLpstat(detailOut);

    // Enrich with current status
    try {
      const { stdout: simpleOut } = await exec('lpstat -p', { timeout: 3000 });
      const statusMap = parseSimpleLpstat(simpleOut);

      for (const printer of printers) {
        const s = statusMap.get(printer.name);
        if (s) {
          printer.status = s.status as PrinterInfo['status'];
          printer.accepting = s.accepting;
        }
      }
    } catch {
      // Non-fatal — use whatever status we parsed from the detailed output
    }

    if (options.zebraOnly) {
      return printers.filter(p => p.isZebra);
    }

    return printers;
  } catch (err) {
    // lpstat not available — fall through to USB-only discovery
    if (process.env.NODE_ENV !== 'test') {
      console.warn('lpstat failed, trying USB discovery:', (err as Error).message);
    }
  }

  return [];
}

/**
 * Get a specific printer by name.
 */
export async function getPrinter(name: string): Promise<PrinterInfo | null> {
  const printers = await discoverPrinters();
  return printers.find(p => p.name === name) ?? null;
}

/**
 * Find the first available Zebra printer.
 */
export async function findFirstZebra(): Promise<PrinterInfo | null> {
  const printers = await discoverPrinters({ zebraOnly: true });
  return printers.find(p => p.status !== 'unavailable') ?? null;
}
