/**
 * Printer registry — turns configured printer profiles into live connections.
 *
 * Three things in this codebase are called "printer", and keeping them apart
 * matters:
 *
 *   • `PrinterInfo`    — a printer *discovered* from CUPS. Transient.
 *   • `PrinterProfile` — a printer *configured* by the user, with its own media
 *                        settings. Persisted in the `printers` table.
 *   • `Printer`        — an open *connection* used to send ZPL.
 *
 * The registry owns the mapping from the middle one to the last: given a printer
 * id (or a job that names one) it hands back the connection to use, along with
 * the profile whose label geometry that job should be rendered for.
 *
 * Connections are cached per profile id and rebuilt when the profile changes,
 * because a `Printer` carries its label dimensions and DPI at construction time.
 *
 * Browser-attached printers (`local_…` ids) are never resolvable here by design:
 * only the browser holding the WebUSB handle can print to them, so the registry
 * reports them as unresolvable and the caller returns the ZPL to the client
 * instead.
 */

import { Printer } from './printer'
import { discoverPrinters } from './discovery'
import {
  adoptDiscoveredPrinters,
  getDefaultPrinterProfile,
  getPrinterProfile,
  getPrinterProfileByCupsName,
  isLocalPrinterId,
  jobLabelSizeFor,
  listPrinterProfiles
} from './db/printer-repo'
import { getLabelSize } from './db/settings-repo'
import type { JobLabelSize, PrintJob } from './db/print-job-repo'
import type { PrinterProfile } from './types'
import { DEFAULT_DPI } from './constants'

/** A printer profile paired with the connection that can print to it. */
export interface ResolvedPrinter {
  profile: PrinterProfile
  printer: Printer
}

/**
 * Anything that can report a printer's configured label geometry.
 *
 * Narrower than the whole registry so the queue and the print handlers can share
 * one geometry-resolution rule without depending on connection management.
 */
export interface LabelSizeSource {
  labelSizeFor(id?: string | null): JobLabelSize | null
}

/** Why a printer could not be resolved to a connection. */
export type UnresolvedReason =
  | 'no-printers'        // nothing configured on the server
  | 'unknown-printer'    // the id doesn't match a configured printer
  | 'browser-owned'      // a `local_…` printer; only its browser can print to it
  | 'unsupported'        // transport this process can't drive yet
  | 'unavailable'        // configured, but the connection couldn't be opened

export class PrinterRegistry {
  /** profile id → open connection */
  private connections = new Map<string, Printer>()
  /** profile id → the updatedAt the cached connection was built from */
  private cachedAt = new Map<string, string>()

  /**
   * Register any CUPS printers that aren't configured yet.
   *
   * Called at startup so an existing install comes up with its printer already
   * in the list. Printers already registered keep their saved media config.
   */
  async sync(): Promise<{ discovered: number; adopted: PrinterProfile[] }> {
    let discovered: Awaited<ReturnType<typeof discoverPrinters>>
    try {
      discovered = await discoverPrinters()
    } catch {
      // No CUPS on this box. A browser-only setup is perfectly valid.
      return { discovered: 0, adopted: [] }
    }
    const adopted = adoptDiscoveredPrinters(discovered)
    if (adopted.length) this.connections.clear()
    return { discovered: discovered.length, adopted }
  }

  /** All configured server printers. */
  profiles(): PrinterProfile[] {
    return listPrinterProfiles()
  }

  /** One configured printer by id. */
  profile(id: string): PrinterProfile | null {
    return getPrinterProfile(id)
  }

  /** The printer to use when a request doesn't name one. */
  defaultProfile(): PrinterProfile | null {
    return getDefaultPrinterProfile()
  }

  /** Drop the cached connection for a profile, or all of them. */
  invalidate(id?: string): void {
    if (id) {
      this.connections.delete(id)
      this.cachedAt.delete(id)
    } else {
      this.connections.clear()
      this.cachedAt.clear()
    }
  }

  /**
   * Open (or reuse) a connection for a profile.
   *
   * The connection is rebuilt whenever the profile has been edited since it was
   * cached — a `Printer` bakes in its label dimensions and DPI, so a stale one
   * would keep printing at the old geometry.
   */
  async connect(profile: PrinterProfile): Promise<Printer | null> {
    const stamp = profile.updatedAt ?? ''
    const cached = this.connections.get(profile.id)
    if (cached && this.cachedAt.get(profile.id) === stamp) return cached

    const printer = await this.open(profile)
    if (!printer) {
      this.invalidate(profile.id)
      return null
    }

    this.connections.set(profile.id, printer)
    this.cachedAt.set(profile.id, stamp)
    return printer
  }

  private async open(profile: PrinterProfile): Promise<Printer | null> {
    // 'usb' and 'tcp' are reserved for server-side transports that don't go
    // through CUPS. They're in the schema so profiles created for them round
    // trip, but nothing can drive them yet.
    if (profile.transport !== 'cups') return null
    if (!profile.cupsName) return null

    try {
      return await Printer.connect(
        profile.cupsName,
        profile.labelSize.widthDots,
        profile.labelSize.heightDots,
        profile.dpi
      )
    } catch {
      // Queue removed from CUPS, or CUPS is down.
      return null
    }
  }

  /**
   * Resolve a printer id to a connection.
   *
   * @param id - Printer id. Omit to use the default printer.
   */
  async resolve(id?: string | null): Promise<ResolvedPrinter | { reason: UnresolvedReason }> {
    if (isLocalPrinterId(id)) return { reason: 'browser-owned' }

    const profile = id ? getPrinterProfile(id) : getDefaultPrinterProfile()
    if (!profile) {
      if (id) return { reason: 'unknown-printer' }
      return { reason: 'no-printers' }
    }
    if (profile.transport !== 'cups') return { reason: 'unsupported' }

    const printer = await this.connect(profile)
    if (!printer) return { reason: 'unavailable' }

    return { profile, printer }
  }

  /**
   * Resolve the printer a queued job belongs to.
   *
   * Jobs created before the registry existed only recorded `printer_name`, so
   * that's matched against CUPS names as a fallback. A job whose printer has
   * been deleted resolves to nothing and is left alone rather than reassigned —
   * silently printing it somewhere else could put it on the wrong label stock.
   */
  async resolveForJob(job: Pick<PrintJob, 'printer_id' | 'printer_name'>): Promise<ResolvedPrinter | { reason: UnresolvedReason }> {
    if (job.printer_id) return this.resolve(job.printer_id)

    if (job.printer_name) {
      if (isLocalPrinterId(job.printer_name)) return { reason: 'browser-owned' }
      const byName = getPrinterProfileByCupsName(job.printer_name)
      if (byName) return this.resolve(byName.id)
    }

    return this.resolve()
  }

  /** Label geometry to render for on a given printer, or null if unknown. */
  labelSizeFor(id?: string | null): JobLabelSize | null {
    const profile = id ? getPrinterProfile(id) : getDefaultPrinterProfile()
    return profile ? jobLabelSizeFor(profile) : null
  }

  /**
   * Every configured printer paired with its connection, where one can be made.
   *
   * Used by the queue processor: pending work is scanned per printer so a single
   * offline printer no longer stalls jobs bound for the others.
   */
  async connectable(): Promise<ResolvedPrinter[]> {
    const resolved: ResolvedPrinter[] = []
    for (const profile of this.profiles()) {
      const printer = await this.connect(profile)
      if (printer) resolved.push({ profile, printer })
    }
    return resolved
  }
}

/**
 * Decide which label geometry a job should be rendered for.
 *
 * Precedence, most specific first:
 *
 *   1. An explicit `labelSize` on the request. This is how a browser-attached
 *      printer gets its geometry across — its config lives in that browser, so
 *      the server has nothing to look up.
 *   2. The named printer's saved configuration.
 *   3. The default printer's saved configuration.
 *   4. The legacy global label size, for installs with no printers configured
 *      yet and for library/CLI callers with no registry at all.
 *
 * Whatever comes out is frozen onto the job, so the ZPL, the history preview, and
 * the physical label can't disagree — even if the printer is reconfigured before
 * a queued job goes out.
 */
export function resolveJobLabelSize(
  source: LabelSizeSource | null,
  opts: {
    printerId?: string | null
    labelSize?: { widthDots: number; heightDots: number; dpi?: number } | null
  } = {}
): JobLabelSize {
  const profile = opts.printerId && !isLocalPrinterId(opts.printerId)
    ? getPrinterProfile(opts.printerId)
    : null

  if (opts.labelSize) {
    return {
      widthDots: opts.labelSize.widthDots,
      heightDots: opts.labelSize.heightDots,
      dpi: opts.labelSize.dpi ?? profile?.dpi ?? DEFAULT_DPI
    }
  }

  if (profile) return jobLabelSizeFor(profile)

  const fallback = source?.labelSizeFor() ?? null
  if (fallback) return fallback

  const global = getLabelSize()
  return { widthDots: global.widthDots, heightDots: global.heightDots, dpi: DEFAULT_DPI }
}

/** True when a resolution attempt failed. */
export function isUnresolved(
  result: ResolvedPrinter | { reason: UnresolvedReason }
): result is { reason: UnresolvedReason } {
  return 'reason' in result
}

/** A message suitable for an API error body. */
export function unresolvedMessage(reason: UnresolvedReason): string {
  switch (reason) {
    case 'no-printers':
      return 'No printer is configured on the server. Add one in Settings, or print to a local USB printer.'
    case 'unknown-printer':
      return 'That printer is not configured on this server'
    case 'browser-owned':
      return 'That printer is attached to a browser, so only that browser can print to it'
    case 'unsupported':
      return 'That printer uses a transport this server cannot drive yet'
    case 'unavailable':
      return 'The printer is configured but could not be reached'
  }
}
