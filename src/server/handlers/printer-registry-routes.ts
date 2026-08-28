/**
 * Printer registry handlers — configure the printers this server can drive.
 *
 * These endpoints replaced a single global label size. That setting could only
 * ever describe one printer, so running a 2×1" printer and a 4×6" printer at the
 * same time meant re-entering the geometry on every switch, with nothing checking
 * that the printer about to print was loaded with that stock. Each printer now
 * carries its own configuration.
 *
 * Browser-attached printers are not managed here. Their WebUSB pairing belongs to
 * one browser on one machine and can't be shared, so the client stores those
 * profiles itself — under the same shape, so the two lists merge in the UI.
 */

import type { Handler } from '../router'
import { json, validate, checkAuth } from '../helpers'
import {
  createPrinterProfile,
  deletePrinterProfile,
  getPrinterProfile,
  labelSizeFromDots,
  listPrinterProfiles,
  setDefaultPrinterProfile,
  updatePrinterProfile
} from '../../db/printer-repo'
import { printerCreateSchema, printerUpdateSchema } from '../../schemas'
import type { PrinterCreateRequest, PrinterUpdateRequest } from '../../schemas'
import type { PrinterRegistry } from '../../printer-registry'
import type { LabelSize, PrinterInfo, PrinterProfile } from '../../types'
import { DEFAULT_DPI } from '../../constants'

type GetRegistry = () => PrinterRegistry | null

/** A configured printer plus whatever discovery currently says about it. */
interface PrinterStatusView extends PrinterProfile {
  /** CUPS status for this queue, or 'unknown' when discovery can't see it */
  status: PrinterInfo['status']
  /** Whether CUPS is accepting jobs for it */
  accepting: boolean
}

/**
 * Turn a request's label geometry into a full `LabelSize`.
 *
 * Inches are derived from the printer's DPI here rather than trusted from the
 * client, so a profile can't end up claiming 3" at a width of dots that isn't 3".
 */
function toLabelSize(
  geometry: { widthDots: number; heightDots: number; name?: string } | undefined,
  dpi: number
): LabelSize | undefined {
  if (!geometry) return undefined
  return labelSizeFromDots(geometry.widthDots, geometry.heightDots, dpi, geometry.name)
}

/**
 * GET /api/printers — configured printers, plus what else is out there.
 *
 * `printers` are the configured ones with their saved media config and current
 * CUPS status. `discovered` lists queues CUPS can see that aren't configured yet,
 * which is what the "add a printer" picker offers.
 */
export function printersListHandler(apiKey: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const profiles = listPrinterProfiles()

    let found: PrinterInfo[] = []
    try {
      const { discoverPrinters } = await import('../../discovery')
      found = await discoverPrinters()
    } catch {
      // No CUPS on this machine. Configured printers are still listed; they just
      // report an unknown status.
    }

    const byName = new Map(found.map(info => [info.name, info]))
    const printers: PrinterStatusView[] = profiles.map(profile => {
      const info = profile.cupsName ? byName.get(profile.cupsName) : undefined
      return {
        ...profile,
        status: info?.status ?? 'unknown',
        accepting: info?.accepting ?? false
      }
    })

    const configuredNames = new Set(profiles.map(p => p.cupsName).filter(Boolean))
    const discovered = found.filter(info => !configuredNames.has(info.name))

    json(res, { printers, discovered })
  }
}

/** GET /api/printers/:id — one configured printer */
export function printerGetHandler(apiKey: string, id: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const printer = getPrinterProfile(id)
    if (!printer) {
      json(res, { error: 'Printer not found' }, 404)
      return
    }
    json(res, { printer })
  }
}

/**
 * POST /api/printers — register a server printer.
 *
 * Media configuration is optional: anything omitted is seeded from the current
 * defaults, so adopting a discovered printer is a one-field request.
 */
export function printerCreateHandler(apiKey: string, getRegistry: GetRegistry): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const data = await validate<PrinterCreateRequest>(req, res, printerCreateSchema)
    if (!data) return

    try {
      const dpi = data.dpi ?? DEFAULT_DPI
      const printer = createPrinterProfile({
        name: data.name,
        transport: data.transport,
        cupsName: data.cupsName ?? null,
        deviceUri: data.deviceUri ?? null,
        usbDeviceId: data.usbDeviceId ?? null,
        labelSize: toLabelSize(data.labelSize, dpi),
        dpi,
        tracking: data.tracking,
        markOffset: data.markOffset ?? null,
        isDefault: data.isDefault
      })
      getRegistry()?.invalidate()
      json(res, { printer }, 201)
    } catch (err) {
      // Almost always the unique-index clash on cups_name, which is a client
      // mistake rather than a server fault.
      json(res, { error: (err as Error).message }, 409)
    }
  }
}

/**
 * PUT /api/printers/:id — update a printer's identity or media configuration.
 *
 * The registry's cached connection is dropped afterwards: a connection carries
 * its label dimensions and DPI, so a stale one would keep printing at the old
 * geometry.
 */
export function printerUpdateHandler(apiKey: string, id: string, getRegistry: GetRegistry): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    const existing = getPrinterProfile(id)
    if (!existing) {
      json(res, { error: 'Printer not found' }, 404)
      return
    }

    const data = await validate<PrinterUpdateRequest>(req, res, printerUpdateSchema)
    if (!data) return

    // Geometry is stored in dots but displayed in inches, and the conversion needs
    // the DPI that will be in effect *after* this update, not before it.
    const dpi = data.dpi ?? existing.dpi

    try {
      const printer = updatePrinterProfile(id, {
        name: data.name,
        transport: data.transport,
        cupsName: data.cupsName,
        deviceUri: data.deviceUri,
        usbDeviceId: data.usbDeviceId,
        labelSize: toLabelSize(data.labelSize, dpi)
          // Re-derive inches when only the DPI changed: the same dots at 300 DPI
          // are a different physical label.
          ?? (data.dpi && data.dpi !== existing.dpi
            ? labelSizeFromDots(
              existing.labelSize.widthDots,
              existing.labelSize.heightDots,
              data.dpi,
              existing.labelSize.name
            )
            : undefined),
        dpi: data.dpi,
        tracking: data.tracking,
        markOffset: data.markOffset,
        isDefault: data.isDefault
      })
      getRegistry()?.invalidate(id)
      json(res, { printer })
    } catch (err) {
      json(res, { error: (err as Error).message }, 409)
    }
  }
}

/**
 * DELETE /api/printers/:id — stop managing a printer.
 *
 * Its print history stays: jobs record the printer id as a plain string so
 * removing a printer never deletes what it printed.
 */
export function printerDeleteHandler(apiKey: string, id: string, getRegistry: GetRegistry): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    if (!deletePrinterProfile(id)) {
      json(res, { error: 'Printer not found' }, 404)
      return
    }
    getRegistry()?.invalidate(id)
    json(res, { success: true })
  }
}

/** POST /api/printers/:id/default — use this printer when a request names none */
export function printerSetDefaultHandler(apiKey: string, id: string): Handler {
  return async (req, res, _printer) => {
    if (!checkAuth(req, res, apiKey)) return

    if (!setDefaultPrinterProfile(id)) {
      json(res, { error: 'Printer not found' }, 404)
      return
    }
    json(res, { success: true, printer: getPrinterProfile(id) })
  }
}
