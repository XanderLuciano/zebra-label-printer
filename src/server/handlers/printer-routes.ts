/**
 * Printer configuration handlers — media geometry and sensor calibration.
 *
 * Changing the label size in this app only affects the ZPL we generate. The
 * printer itself keeps its own stored print width, media type, and gap settings,
 * which is why a size change alone can still produce clipped labels, vertical
 * drift, or extra blank feeds. These routes push the configuration to the hardware
 * and run a sensor calibration so the printer agrees with us.
 *
 * Both routes act on one named printer. Omitted geometry falls back to that
 * printer's saved configuration rather than a global setting, so `{}` means "make
 * this printer match what it's configured for" — which is exactly what you want
 * after swapping label stock or plugging the printer into a different machine.
 *
 * `target: 'local'` returns the ZPL instead of printing it, for a browser to send
 * to a USB printer over WebUSB.
 */

import type { Handler } from '../router'
import { json, validate, checkAuth } from '../helpers'
import { mediaConfigZpl, calibrationZpl } from '../../zpl'
import { getLabelSize } from '../../db/settings-repo'
import { getPrinterProfile, isLocalPrinterId } from '../../db/printer-repo'
import { DEFAULT_DPI, DEFAULT_MEDIA_TRACKING } from '../../constants'
import { printerConfigSchema, printerCalibrateSchema } from '../../schemas'
import type { PrinterConfigRequest, PrinterCalibrateRequest } from '../../schemas'
import type { PrinterRegistry } from '../../printer-registry'
import { isUnresolved, unresolvedMessage } from '../../printer-registry'
import type { Printer } from '../../printer'
import type { PrinterProfile } from '../../types'

type GetRegistry = () => PrinterRegistry | null

/**
 * Find the printer a configuration request is aimed at.
 *
 * Returns the saved profile whenever there is one — even for a browser-owned
 * printer, where no connection is possible but the geometry still comes from the
 * request itself.
 */
async function targetPrinter(
  registry: PrinterRegistry | null,
  printerId: string | undefined,
  fallback: Printer | null
): Promise<{ profile: PrinterProfile | null; printer: Printer | null; error?: string }> {
  if (isLocalPrinterId(printerId)) {
    // The browser owns this device; it only needs the ZPL back.
    return { profile: null, printer: null }
  }

  if (!registry) {
    return { profile: printerId ? getPrinterProfile(printerId) : null, printer: fallback }
  }

  const resolved = await registry.resolve(printerId)
  if (isUnresolved(resolved)) {
    const profile = printerId ? getPrinterProfile(printerId) : registry.defaultProfile()
    return { profile, printer: null, error: unresolvedMessage(resolved.reason) }
  }
  return { profile: resolved.profile, printer: resolved.printer }
}

/**
 * POST /api/printer/configure — apply media geometry to a printer.
 *
 * Body fields are all optional; anything omitted falls back to the named
 * printer's saved configuration, so `{ printerId }` means "apply this printer's
 * own label size to it".
 */
export function printerConfigureHandler(apiKey: string, getRegistry: GetRegistry): Handler {
  return async (req, res, fallbackPrinter) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<PrinterConfigRequest>(req, res, printerConfigSchema)
    if (!data) return

    const registry = getRegistry()
    const { profile, printer, error } = await targetPrinter(registry, data.printerId, fallbackPrinter)

    // Precedence: what the request asked for, then the printer's own saved
    // configuration, then the legacy global size for installs with no printers.
    const saved = profile?.labelSize ?? getLabelSize()
    const widthDots = data.widthDots ?? saved.widthDots
    const heightDots = data.heightDots ?? saved.heightDots
    const dpi = data.dpi ?? profile?.dpi ?? DEFAULT_DPI
    const tracking = data.tracking ?? profile?.tracking ?? DEFAULT_MEDIA_TRACKING
    const markOffset = data.markOffset ?? profile?.markOffset

    const configZpl = mediaConfigZpl({
      widthDots,
      heightDots,
      dpi,
      tracking,
      markOffset,
      persist: data.persist
    })
    // Config first, then calibrate: the sensor sweep needs to know the media
    // type and the ^ML search window before it can measure anything useful.
    const commands = data.calibrate ? [configZpl, calibrationZpl()] : [configZpl]
    const applied = {
      printerId: profile?.id ?? data.printerId ?? null,
      widthDots,
      heightDots,
      dpi,
      tracking,
      calibrated: !!data.calibrate
    }

    if (data.target === 'local' || isLocalPrinterId(data.printerId)) {
      json(res, { success: true, target: 'local', zpl: commands.join('\n'), applied })
      return
    }

    if (!printer) {
      json(res, { error: error ?? 'No printer connected', applied }, 503)
      return
    }

    for (const zpl of commands) {
      const result = await printer.print(zpl)
      if (!result.success) {
        json(res, { success: false, error: result.error, applied }, 500)
        return
      }
    }

    json(res, { success: true, target: 'server', applied })
  }
}

/**
 * POST /api/printer/calibrate — run a media sensor calibration (`~JC`).
 *
 * The printer feeds a few labels while measuring gap thresholds and label
 * length. Expect 2–4 labels to come out; that is the calibration, not a fault.
 */
export function printerCalibrateHandler(apiKey: string, getRegistry: GetRegistry): Handler {
  return async (req, res, fallbackPrinter) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<PrinterCalibrateRequest>(req, res, printerCalibrateSchema)
    if (!data) return

    const zpl = calibrationZpl()

    if (data.target === 'local' || isLocalPrinterId(data.printerId)) {
      json(res, { success: true, target: 'local', zpl })
      return
    }

    const registry = getRegistry()
    const { printer, error } = await targetPrinter(registry, data.printerId, fallbackPrinter)

    if (!printer) {
      json(res, { error: error ?? 'No printer connected' }, 503)
      return
    }

    const result = await printer.print(zpl)
    json(res, {
      success: result.success,
      target: 'server',
      message: result.success
        ? 'Calibration started — the printer will feed a few labels while it measures the gap sensor'
        : undefined,
      ...(result.error ? { error: result.error } : {})
    }, result.success ? 200 : 500)
  }
}
