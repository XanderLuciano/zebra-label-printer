/**
 * Printer discovery — finds available Zebra label printers.
 *
 * Currently CUPS-based but designed to be extended with raw USB discovery
 * and network (mDNS/Bonjour) scanning.
 */

import { exec as execCb } from 'child_process'
import { promisify } from 'util'
import type { DevicePresence, DiscoveryResult, PrinterInfo, DiscoveryOptions } from './types'
import {
  CUPS_COMMAND_TIMEOUT_MS,
  DEVICE_SCAN_SCHEMES,
  DEVICE_SCAN_TIMEOUT_MS,
  LOCAL_DEVICE_URI_SCHEMES
} from './constants'

const exec = promisify(execCb)

/** The USB vendor ID for Zebra Technologies */
const ZEBRA_VENDOR_ID = '0a5f'

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
  /gx\d+/i
]

/**
 * Check if a printer appears to be a Zebra printer based on its properties.
 */
function isZebraPrinter(info: { name: string; uri: string; model: string }): boolean {
  const check = `${info.name} ${info.uri} ${info.model}`.toLowerCase()

  // Check vendor ID in USB URI
  if (check.includes(`vid:${ZEBRA_VENDOR_ID}`) || check.includes(`vendor=${ZEBRA_VENDOR_ID}`)) {
    return true
  }

  // Check against known model patterns
  return ZEBRA_MODEL_PATTERNS.some(pattern => pattern.test(info.name) || pattern.test(info.model))
}

/**
 * Parse the output of `lpstat -l -p` into PrinterInfo objects.
 */
function parseLpstat(output: string): PrinterInfo[] {
  const printers: PrinterInfo[] = []
  let current: Partial<PrinterInfo> = {}

  for (const line of output.split('\n')) {
    const trimmed = line.trim()

    if (trimmed.startsWith('printer ')) {
      // Save previous
      if (current.name) {
        printers.push(normalizePrinterInfo(current))
      }
      current = { name: trimmed.replace('printer ', '').split(' ')[0] }
    }

    if (trimmed.startsWith('Description:')) {
      current.model = trimmed.replace('Description:', '').trim()
    }

    if (trimmed.startsWith('Interface:') || trimmed.startsWith('Device:')) {
      const iface = trimmed.replace(/^(Interface|Device):\s*/, '').trim()
      if (iface && iface !== 'unknown') {
        current.uri = iface
      }
    }

    if (trimmed.startsWith('PrinterIdle') || trimmed.includes('is idle')) {
      current.status = 'idle'
    } else if (trimmed.startsWith('PrinterPrinting') || trimmed.includes('now printing')) {
      current.status = 'printing'
    } else if (trimmed.startsWith('PrinterStopped') || trimmed.includes('disabled')) {
      current.status = 'unavailable'
    }

    if (trimmed.includes('accepting requests') || trimmed.includes('accepting jobs')) {
      current.accepting = true
    } else if (trimmed.includes('rejecting')) {
      current.accepting = false
    }
  }

  // Don't forget the last one
  if (current.name) {
    printers.push(normalizePrinterInfo(current))
  }

  return printers
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
      model: partial.model ?? ''
    }),
    // Only a presence check can answer this; assume nothing until then.
    presence: partial.presence ?? 'unknown'
  }
}

function extractSerial(uri: string): string | undefined {
  const match = uri.match(/serial=([^&\s]+)/)
  return match?.[1]
}

// ─── Device presence (hot-plug detection) ────────────────────────────────────

/**
 * Parse `lpstat -v` into printer name → device URI.
 *
 * Needed because `lpstat -l -p`'s `Interface:` line is a PPD path on macOS, not a
 * device URI, and a PPD path can't be matched against the attached-device list.
 *
 * Lines look like:
 *   `device for ZTC-GK420d: usb://Zebra%20Technologies/ZTC%20GK420d?serial=38J15`
 */
function parseDeviceUris(output: string): Map<string, string> {
  const uris = new Map<string, string>()
  for (const line of output.split('\n')) {
    const match = line.match(/^device for ([^:]+):\s*(\S+)/)
    if (match?.[1] && match[2]) uris.set(match[1], match[2])
  }
  return uris
}

/**
 * Parse `lpinfo -v` output into device URIs.
 *
 * Lines are `<class> <uri>`, e.g. `direct usb://Zebra/ZTC%20GK420d?serial=X`.
 * Bare backend names with no URI (`network socket`) are skipped.
 */
function parseAvailableDevices(output: string): string[] {
  const uris: string[] = []
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^\S+\s+(\S+:\/\/\S*)/)
    if (match?.[1]) uris.push(match[1])
  }
  return uris
}

/** Percent-decode and lowercase a URI so two spellings of one device compare equal. */
function normalizeUri(uri: string): string {
  let decoded = uri
  try {
    decoded = decodeURIComponent(uri)
  } catch {
    // Malformed escape; compare the raw form instead.
  }
  return decoded.toLowerCase().replace(/\/+$/, '')
}

/**
 * The scheme of a device URI, lowercased, or '' if it has none.
 *
 * Matches on the colon alone rather than `://`, because CUPS spells local
 * non-USB devices with a single slash — `serial:/dev/ttyS0?baud=9600`,
 * `parallel:/dev/lp0` — and requiring the double slash would silently exclude
 * them from presence detection.
 */
function schemeOf(uri: string): string {
  return uri.match(/^([a-z0-9+.-]+):/i)?.[1]?.toLowerCase() ?? ''
}

/**
 * Ask CUPS which directly attached devices exist right now.
 *
 * This is the hot-plug signal. `lpstat -v` reports the URI a queue was
 * *configured* with, which survives unplugging the cable; `lpinfo` enumerates
 * what is *actually there*.
 *
 * @returns the attached device URIs, or null if the question couldn't be
 *   answered — no `lpinfo`, or the backend refused to enumerate. Null must be
 *   treated as "don't know", never as "nothing attached", or every printer would
 *   be reported unplugged on a machine where `lpinfo` needs elevated privileges.
 */
export async function listAttachedDevices(): Promise<string[] | null> {
  try {
    const { stdout } = await exec(
      `lpinfo --include-schemes ${DEVICE_SCAN_SCHEMES} -v`,
      { timeout: DEVICE_SCAN_TIMEOUT_MS }
    )
    return parseAvailableDevices(stdout)
  } catch {
    return null
  }
}

/**
 * Decide whether a queue's device is attached.
 *
 * @param deviceUri - The queue's configured device URI.
 * @param attached - Result of `listAttachedDevices()`; null means unavailable.
 */
export function devicePresence(
  deviceUri: string | undefined,
  attached: string[] | null
): DevicePresence {
  if (!attached || !deviceUri) return 'unknown'

  // Only locally attached devices can be enumerated. A networked printer missing
  // from the list proves nothing.
  const scheme = schemeOf(deviceUri)
  if (!LOCAL_DEVICE_URI_SCHEMES.includes(scheme as typeof LOCAL_DEVICE_URI_SCHEMES[number])) {
    return 'unknown'
  }

  const wanted = normalizeUri(deviceUri)
  for (const candidate of attached) {
    const found = normalizeUri(candidate)
    // Exact match, or one is a prefix of the other: CUPS sometimes stores a
    // queue's URI with extra query parameters that enumeration doesn't report
    // (or vice versa), and the serial number is what actually identifies it.
    if (found === wanted || found.startsWith(wanted) || wanted.startsWith(found)) {
      return 'present'
    }
  }

  return 'absent'
}

/**
 * Extract shorter status from `lpstat -p` output.
 */
function parseSimpleLpstat(output: string): Map<string, { status: string; accepting: boolean }> {
  const map = new Map<string, { status: string; accepting: boolean }>()

  for (const line of output.split('\n')) {
    const match = line.match(/^printer\s+(\S+)/)
    if (!match) continue

    const name = match[1]
    const status = line.includes('disabled') || line.includes('unavailable')
      ? 'unavailable'
      : line.includes('printing')
        ? 'printing'
        : line.includes('idle')
          ? 'idle'
          : 'unknown'
    const accepting = !line.includes('rejecting')

    map.set(name, { status, accepting })
  }

  return map
}

/**
 * Discover available printers, reporting whether CUPS could be reached at all.
 *
 * Uses the CUPS backend (`lpstat`) to find printers, with smart Zebra detection,
 * optionally checking whether each device is physically attached.
 *
 * The `cupsAvailable` flag is the point of this variant. An empty printer list is
 * ambiguous on its own — it means both "CUPS knows of no printers" and "CUPS did
 * not answer" — and conflating the two makes a `cupsd` restart indistinguishable
 * from someone deleting every queue.
 */
export async function discoverPrintersDetailed(
  options: DiscoveryOptions = {}
): Promise<DiscoveryResult> {
  try {
    // Get detailed printer info
    const { stdout: detailOut } = await exec('lpstat -l -p', { timeout: CUPS_COMMAND_TIMEOUT_MS })
    const printers = parseLpstat(detailOut)

    // Enrich with current status
    try {
      const { stdout: simpleOut } = await exec('lpstat -p', { timeout: 3000 })
      const statusMap = parseSimpleLpstat(simpleOut)

      for (const printer of printers) {
        const s = statusMap.get(printer.name)
        if (s) {
          printer.status = s.status as PrinterInfo['status']
          printer.accepting = s.accepting
        }
      }
    } catch {
      // Non-fatal — use whatever status we parsed from the detailed output
    }

    // Replace the PPD path from `Interface:` with the real device URI, which is
    // what identifies the hardware and carries the USB serial number.
    try {
      const { stdout: deviceOut } = await exec('lpstat -v', { timeout: 3000 })
      const uris = parseDeviceUris(deviceOut)

      for (const printer of printers) {
        const uri = uris.get(printer.name)
        if (uri) {
          printer.uri = uri
          printer.serial = extractSerial(uri) ?? printer.serial
          // Re-run detection now that the vendor id in the URI is visible.
          printer.isZebra = printer.isZebra || isZebraPrinter({
            name: printer.name,
            uri,
            model: printer.model
          })
        }
      }
    } catch {
      // Non-fatal — keep whatever the detailed output gave us.
    }

    // Hot-plug check, opt-in because it costs an extra command.
    if (options.checkPresence) {
      const attached = await listAttachedDevices()
      for (const printer of printers) {
        printer.presence = devicePresence(printer.uri, attached)
      }
    }

    return {
      printers: options.zebraOnly ? printers.filter(p => p.isZebra) : printers,
      cupsAvailable: true
    }
  } catch (err) {
    // lpstat not available — fall through to USB-only discovery
    if (process.env.NODE_ENV !== 'test') {
      console.warn('lpstat failed, trying USB discovery:', (err as Error).message)
    }
  }

  return { printers: [], cupsAvailable: false }
}

/**
 * Discover available printers.
 *
 * Returns an empty array both when CUPS reports no printers and when CUPS could
 * not be reached. Callers that need to tell those apart — anything deciding a
 * printer has *gone away* — must use `discoverPrintersDetailed()`, or a CUPS
 * restart looks identical to every queue being deleted.
 *
 * @example
 * ```ts
 * const printers = await discoverPrinters({ zebraOnly: true });
 * console.log(printers);
 * ```
 */
export async function discoverPrinters(options: DiscoveryOptions = {}): Promise<PrinterInfo[]> {
  return (await discoverPrintersDetailed(options)).printers
}

/**
 * Get a specific printer by name.
 *
 * @param options - Pass `{ checkPresence: true }` to also learn whether the
 *   device is physically attached.
 */
export async function getPrinter(
  name: string,
  options: DiscoveryOptions = {}
): Promise<PrinterInfo | null> {
  const printers = await discoverPrinters(options)
  return printers.find(p => p.name === name) ?? null
}

/**
 * Find the first available Zebra printer.
 */
export async function findFirstZebra(): Promise<PrinterInfo | null> {
  const printers = await discoverPrinters({ zebraOnly: true })
  return printers.find(p => p.status !== 'unavailable') ?? null
}
