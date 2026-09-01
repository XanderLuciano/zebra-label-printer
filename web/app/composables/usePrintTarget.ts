/**
 * Print dispatch — sends a label to whichever printer is selected.
 *
 * This used to be a binary switch: "server" or "local USB", with a single global
 * label size that both were assumed to be loaded with. That fell apart with two
 * printers on different label stock, so the choice is now a specific printer from
 * `usePrinters()`, and its own configuration travels with every request.
 *
 * The server still owns job records and ZPL generation in both cases. For a
 * browser-attached printer it persists the job, hands back the ZPL, and waits for
 * us to report the outcome — so print history, label-size snapshots, and reprints
 * are identical regardless of which printer the label came out of.
 *
 * Callers don't branch on printer type. `printText(...)` and friends work the same
 * whether the selected printer is on the server or plugged into this laptop.
 */

import type { PrinterSelection, PrintResponse } from './useApi'
import type { PrinterEntry } from './usePrinters'

/** Kept for callers that still think in terms of server-vs-local. */
export type PrintTarget = 'server' | 'local'

/**
 * Most copies a single print request may ask for.
 *
 * Mirrors `MAX_COPIES` in `src/constants.ts`. Kept in step by hand because the web
 * app builds independently of the server sources.
 */
export const MAX_COPIES = 500

/** Above this the UI confirms the quantity first — a typo guard, not a limit. */
export const COPIES_CONFIRM_THRESHOLD = 30

export interface PrintOutcome {
  success: boolean
  target: PrintTarget
  jobId?: string
  error?: string
  /** The printer this went to, if one was selected. */
  printerId?: string | null
  printerName?: string
}

/** A server print endpoint that accepts a printer selection. */
type PrintCall = (body: Record<string, unknown>) => Promise<PrintResponse>

export function usePrintTarget() {
  const api = useApi()
  const printers = usePrinters()
  const localPrinter = useLocalPrinter()

  const selected = printers.selected
  const target = computed<PrintTarget>(() =>
    selected.value?.connection === 'local' ? 'local' : 'server')

  /**
   * The printer fields to send with a request.
   *
   * A browser-attached printer's configuration lives in this browser, so its
   * geometry has to be sent explicitly — the server has nothing to look up. For a
   * server printer the id alone is enough and the server uses its saved config.
   */
  function selectionFor(printer: PrinterEntry | null): PrinterSelection {
    if (!printer) return {}
    if (printer.connection === 'local') {
      return {
        target: 'local',
        printerId: printer.id,
        printerName: printer.name,
        labelSize: {
          widthDots: printer.labelSize.widthDots,
          heightDots: printer.labelSize.heightDots,
          dpi: printer.dpi,
          name: printer.labelSize.name,
        },
      }
    }
    return { target: 'server', printerId: printer.id }
  }

  /** Why the selected printer can't be printed to right now, or null if it can. */
  function blockedReason(printer: PrinterEntry | null): string | null {
    if (!printer) {
      return 'No printer selected. Add one in Settings.'
    }
    if (printer.connection === 'local' && !printer.ready) {
      return printer.readyHint
        ?? `'${printer.name}' is not connected. Reconnect it in Settings, or pick another printer.`
    }
    return null
  }

  /** Load printers and reattach saved USB devices. Safe to call repeatedly. */
  async function load(): Promise<void> {
    await printers.load()
  }

  /**
   * Run a print on the selected printer.
   *
   * For a server printer this is a plain API call. For a browser-attached one it
   * asks the server to record the job and return ZPL, pushes that over USB, then
   * reports back so the job doesn't sit in 'printing' forever.
   *
   * @param call - The API method for this label type (e.g. `api.printLabel`).
   * @param body - Request body, without the printer fields.
   * @param printerId - Print on this printer instead of the selected one.
   */
  async function printVia(
    call: PrintCall,
    body: Record<string, unknown>,
    printerId?: string,
  ): Promise<PrintOutcome> {
    await load()

    const printer = printerId ? printers.get(printerId) : selected.value
    const selection = selectionFor(printer)
    const base = {
      printerId: printer?.id ?? null,
      printerName: printer?.name,
    }

    const blocked = blockedReason(printer)
    if (blocked) {
      return { success: false, target: target.value, error: blocked, ...base }
    }

    if (!printer || printer.connection === 'server') {
      try {
        const res = await call({ ...body, ...selection })
        return {
          success: res.success !== false,
          target: 'server',
          jobId: res.jobId,
          error: res.error,
          ...base,
        }
      } catch (e) {
        return { success: false, target: 'server', error: (e as Error).message, ...base }
      }
    }

    // Browser-attached printer: the server records the job, we do the transfer.
    let jobId: string | undefined
    try {
      const res = await call({ ...body, ...selection })
      jobId = res.jobId
      if (!res.zpl) throw new Error('Server did not return ZPL for local printing')

      const deviceId = printer.deviceId
      if (!deviceId) throw new Error('This local printer has no USB device attached')

      const sent = await localPrinter.printZpl(deviceId, res.zpl)
      const error = sent ? undefined : localPrinter.lastError.value || 'USB transfer failed'

      // Report either way so the job leaves the 'printing' state.
      if (jobId) {
        await api.reportJobResult(jobId, sent, error).catch(() => {})
      }

      return { success: sent, target: 'local', jobId, error, ...base }
    } catch (e) {
      const error = (e as Error).message
      if (jobId) await api.reportJobResult(jobId, false, error).catch(() => {})
      return { success: false, target: 'local', jobId, error, ...base }
    }
  }

  /**
   * Push media configuration to a printer, and optionally calibrate it.
   *
   * Sending this is what makes a label-size change take effect on the hardware —
   * the printer keeps its own print width and gap settings otherwise. Defaults to
   * the selected printer's own saved geometry, which is the usual intent.
   */
  async function applyMediaConfig(options: {
    printerId?: string
    widthDots?: number
    heightDots?: number
    dpi?: number
    tracking?: 'gap' | 'mark' | 'continuous' | 'auto'
    calibrate?: boolean
  } = {}): Promise<PrintOutcome> {
    await load()

    const printer = options.printerId ? printers.get(options.printerId) : selected.value
    if (!printer) {
      return { success: false, target: target.value, error: 'No printer selected' }
    }

    const base = { printerId: printer.id, printerName: printer.name }
    const body = {
      printerId: printer.id,
      widthDots: options.widthDots ?? printer.labelSize.widthDots,
      heightDots: options.heightDots ?? printer.labelSize.heightDots,
      dpi: options.dpi ?? printer.dpi,
      tracking: options.tracking ?? printer.tracking,
      calibrate: options.calibrate,
    }

    if (printer.connection === 'server') {
      try {
        const res = await api.configurePrinter({ ...body, target: 'server' })
        return { success: res.success, target: 'server', error: res.error, ...base }
      } catch (e) {
        return { success: false, target: 'server', error: (e as Error).message, ...base }
      }
    }

    if (!printer.ready || !printer.deviceId) {
      return { success: false, target: 'local', error: blockedReason(printer) ?? undefined, ...base }
    }

    try {
      const res = await api.configurePrinter({ ...body, target: 'local' })
      if (!res.zpl) throw new Error('Server did not return configuration ZPL')
      const sent = await localPrinter.printZpl(printer.deviceId, res.zpl)
      return {
        success: sent,
        target: 'local',
        error: sent ? undefined : localPrinter.lastError.value || 'USB transfer failed',
        ...base,
      }
    } catch (e) {
      return { success: false, target: 'local', error: (e as Error).message, ...base }
    }
  }

  /** Run a media sensor calibration on a printer. */
  async function calibrate(printerId?: string): Promise<PrintOutcome> {
    await load()

    const printer = printerId ? printers.get(printerId) : selected.value
    if (!printer) {
      return { success: false, target: target.value, error: 'No printer selected' }
    }

    const base = { printerId: printer.id, printerName: printer.name }

    if (printer.connection === 'server') {
      try {
        const res = await api.calibratePrinter({ printerId: printer.id, target: 'server' })
        return { success: res.success, target: 'server', error: res.error, ...base }
      } catch (e) {
        return { success: false, target: 'server', error: (e as Error).message, ...base }
      }
    }

    if (!printer.ready || !printer.deviceId) {
      return { success: false, target: 'local', error: blockedReason(printer) ?? undefined, ...base }
    }

    try {
      const res = await api.calibratePrinter({ printerId: printer.id, target: 'local' })
      if (!res.zpl) throw new Error('Server did not return calibration ZPL')
      const sent = await localPrinter.printZpl(printer.deviceId, res.zpl)
      return {
        success: sent,
        target: 'local',
        error: sent ? undefined : localPrinter.lastError.value || 'USB transfer failed',
        ...base,
      }
    } catch (e) {
      return { success: false, target: 'local', error: (e as Error).message, ...base }
    }
  }

  // Per-endpoint wrappers so call sites don't have to know about printers at all.
  // Each mirrors the matching useApi method, minus the printer fields.

  const printText = (body: { lines: string[]; copies?: number }, printerId?: string) =>
    printVia(b => api.printText(b as typeof body), body, printerId)

  const printBarcode = (body: { data: string; type?: string; text?: string }, printerId?: string) =>
    printVia(b => api.printBarcode(b as typeof body), body, printerId)

  const printQR = (body: { data: string; text?: string; magnification?: number }, printerId?: string) =>
    printVia(b => api.printQR(b as typeof body), body, printerId)

  // printZpl takes the ZPL as a positional argument, so the printer fields
  // printVia mixes into the body have to be split back out here.
  const printZpl = (zpl: string, printerId?: string) =>
    printVia(b => {
      const { zpl: _body, ...selection } = b
      return api.printZpl(zpl, selection as PrinterSelection)
    }, { zpl }, printerId)

  const printLabel = (
    body: { elements: Array<Record<string, unknown>>; copies?: number },
    printerId?: string,
  ) => printVia(b => api.printLabel(b as typeof body), body, printerId)

  return {
    /** The printer prints currently go to. */
    printer: selected,
    /** Coarse server-vs-local view of the selected printer. */
    target,
    /** Label geometry of the selected printer. */
    labelSize: printers.labelSize,
    load,
    printVia,
    printText,
    printBarcode,
    printQR,
    printZpl,
    printLabel,
    applyMediaConfig,
    calibrate,
    blockedReason,
  }
}
