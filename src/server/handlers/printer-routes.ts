/**
 * Printer configuration handlers — media geometry and sensor calibration.
 *
 * Changing the label size in this app used to only affect the ZPL we generate.
 * The printer itself kept its own stored print width, media type, and gap
 * settings, which is why a size change could still produce clipped labels,
 * vertical drift, or extra blank feeds. These routes push the configuration to
 * the hardware and run a sensor calibration so the printer agrees with us.
 *
 * Both routes support `target: 'local'`, which returns the ZPL instead of
 * printing it — the browser then sends it to a USB printer over WebUSB.
 */

import type { Handler } from '../router'
import { json, validate, checkAuth } from '../helpers'
import { mediaConfigZpl, calibrationZpl } from '../../zpl'
import { getLabelSize } from '../../db/settings-repo'
import { DEFAULT_DPI, DEFAULT_MEDIA_TRACKING } from '../../constants'
import { printerConfigSchema, printerCalibrateSchema } from '../../schemas'
import type { PrinterConfigRequest, PrinterCalibrateRequest } from '../../schemas'

/**
 * POST /api/printer/configure — apply media geometry to the printer.
 *
 * Body fields are all optional; anything omitted falls back to the configured
 * label size, so `{}` means "apply whatever label size is currently set".
 */
export function printerConfigureHandler(apiKey: string): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<PrinterConfigRequest>(req, res, printerConfigSchema)
    if (!data) return

    const size = getLabelSize()
    const widthDots = data.widthDots ?? size.widthDots
    const heightDots = data.heightDots ?? size.heightDots
    const dpi = data.dpi ?? DEFAULT_DPI
    const tracking = data.tracking ?? DEFAULT_MEDIA_TRACKING

    const configZpl = mediaConfigZpl({
      widthDots,
      heightDots,
      dpi,
      tracking,
      markOffset: data.markOffset,
      persist: data.persist
    })
    // Config first, then calibrate: the sensor sweep needs to know the media
    // type and the ^ML search window before it can measure anything useful.
    const commands = data.calibrate ? [configZpl, calibrationZpl()] : [configZpl]
    const applied = { widthDots, heightDots, dpi, tracking, calibrated: !!data.calibrate }

    if (data.target === 'local') {
      json(res, { success: true, target: 'local', zpl: commands.join('\n'), applied })
      return
    }

    if (!printer) {
      json(res, { error: 'No printer connected' }, 503)
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
export function printerCalibrateHandler(apiKey: string): Handler {
  return async (req, res, printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<PrinterCalibrateRequest>(req, res, printerCalibrateSchema)
    if (!data) return

    const zpl = calibrationZpl()

    if (data.target === 'local') {
      json(res, { success: true, target: 'local', zpl })
      return
    }

    if (!printer) {
      json(res, { error: 'No printer connected' }, 503)
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
