/**
 * Printer health — is each configured printer actually able to print?
 *
 * Two separate questions get combined here, because answering only one of them is
 * misleading:
 *
 *   1. **What does the CUPS queue say?** Cheap, but CUPS does not watch USB. It
 *      discovers a missing device when it next tries to print, so a queue can sit
 *      `idle` and `accepting` with the cable unplugged.
 *   2. **Is the device physically attached?** Answered by enumerating devices
 *      (`lpinfo`), which is the only signal that catches a pulled cable before a
 *      print is attempted.
 *
 * `printerHealth()` is the single rule that folds them into one verdict, shared by
 * the API (live, per request) and the monitor (polled, for transition events) so
 * the two can't disagree.
 *
 * The monitor exists because nothing else was watching: the queue processor only
 * calls `isReady()` when there is work to do, so an idle server never noticed a
 * disconnect, and `printer_events` was really a print-failure log rather than a
 * connectivity history.
 */

import { discoverPrintersDetailed } from './discovery'
import { listPrinterProfiles } from './db/printer-repo'
import { recordPrinterEvent } from './db/settings-repo'
import { PRINTER_HEALTH_INTERVAL_MS } from './constants'
import type { PrinterHealth } from './constants'
import type { PrinterInfo, PrinterProfile, DevicePresence } from './types'

/** What the monitor knows about one printer right now. */
export interface PrinterHealthState {
  printerId: string
  name: string
  cupsName: string | null
  health: PrinterHealth
  presence: DevicePresence
  status: PrinterInfo['status']
  accepting: boolean
  /** When this printer last changed health, if it has changed while running. */
  changedAt?: string
}

/**
 * Decide a printer's health from its profile and what discovery found.
 *
 * @param info - The matching discovery result, or undefined if CUPS has no such
 *   queue.
 * @param cupsAvailable - Whether discovery worked at all. Without it, everything
 *   is 'unknown' rather than 'missing' — a CUPS outage is not the same as someone
 *   deleting a queue.
 */
export function printerHealth(
  info: PrinterInfo | undefined,
  cupsAvailable: boolean
): PrinterHealth {
  if (!cupsAvailable) return 'unknown'
  if (!info) return 'missing'

  // Presence outranks queue state: an absent device cannot print, whatever CUPS
  // currently believes about the queue.
  if (info.presence === 'absent') return 'unplugged'

  if ((info.status === 'idle' || info.status === 'printing') && info.accepting) return 'ready'
  if (info.status === 'unknown') return 'unknown'

  return 'offline'
}

/** A short explanation of a health verdict, for the UI and the event log. */
export function healthMessage(health: PrinterHealth, info?: PrinterInfo): string {
  switch (health) {
    case 'ready':
      return 'Ready'
    case 'unplugged':
      return 'The printer is not attached — check the USB cable and that it is powered on'
    case 'offline':
      return info?.status === 'unavailable'
        ? 'CUPS has stopped this printer'
        : `Printer is ${info?.accepting === false ? 'rejecting jobs' : info?.status ?? 'offline'}`
    case 'missing':
      return 'No CUPS queue with this name — it may have been removed'
    case 'unknown':
      return 'Could not determine the printer state'
  }
}

/** Build the health view for every configured printer from one discovery pass. */
export function healthFor(
  profiles: PrinterProfile[],
  discovered: PrinterInfo[] | null
): PrinterHealthState[] {
  const cupsAvailable = discovered !== null
  const byName = new Map((discovered ?? []).map(info => [info.name, info]))

  return profiles.map(profile => {
    const info = profile.cupsName ? byName.get(profile.cupsName) : undefined
    return {
      printerId: profile.id,
      name: profile.name,
      cupsName: profile.cupsName ?? null,
      health: printerHealth(info, cupsAvailable),
      presence: info?.presence ?? 'unknown',
      status: info?.status ?? 'unknown',
      accepting: info?.accepting ?? false
    }
  })
}

/**
 * Which printer event a health transition should be recorded as.
 *
 * Returns null when the change isn't worth logging, so the event log stays a
 * record of things that actually happened rather than one row per poll.
 */
function eventForTransition(
  from: PrinterHealth | undefined,
  to: PrinterHealth
): { type: 'connected' | 'disconnected' | 'error' | 'recovered'; message: string } | null {
  if (from === to) return null

  // First sighting: stay quiet unless something is already wrong, so a healthy
  // restart doesn't write an event every time the process starts.
  if (from === undefined) {
    if (to === 'ready' || to === 'unknown') return null
    return { type: to === 'unplugged' || to === 'missing' ? 'disconnected' : 'error', message: `Printer is ${to} at startup` }
  }

  switch (to) {
    case 'ready':
      return from === 'unplugged' || from === 'missing'
        ? { type: 'connected', message: 'Printer reattached and ready' }
        : { type: 'recovered', message: 'Printer is ready again' }
    case 'unplugged':
      return { type: 'disconnected', message: 'Device detached — the printer is no longer attached' }
    case 'missing':
      return { type: 'disconnected', message: 'CUPS queue disappeared' }
    case 'offline':
      return { type: 'error', message: 'CUPS stopped the printer or is rejecting jobs' }
    case 'unknown':
      // Usually a transient CUPS hiccup. Not worth an event either way.
      return null
  }
}

export class PrinterHealthMonitor {
  private states = new Map<string, PrinterHealthState>()
  /**
   * The last health we could actually determine, per printer.
   *
   * Kept separately from `states` because 'unknown' is an absence of information,
   * not a state to compare against. Overwriting the baseline with it made a
   * momentary CUPS hiccup read as ready → unknown → ready, and log a 'recovered'
   * event for a printer that never went wrong. Carrying the last known value
   * forward means a blip logs nothing, while a printer that really does go bad
   * during one is still caught.
   */
  private lastKnown = new Map<string, PrinterHealth>()
  private timer: ReturnType<typeof setInterval> | null = null
  private intervalMs: number
  private running = false

  constructor(intervalMs = PRINTER_HEALTH_INTERVAL_MS) {
    this.intervalMs = intervalMs
  }

  /** The most recent observation, without polling. */
  snapshot(): PrinterHealthState[] {
    return [...this.states.values()]
  }

  /** Health of one printer as last observed, or null if never seen. */
  get(printerId: string): PrinterHealthState | null {
    return this.states.get(printerId) ?? null
  }

  /**
   * Poll every configured printer once and record any health transitions.
   *
   * One discovery pass covers all printers rather than one call each.
   *
   * @returns the current health of every configured printer.
   */
  async check(): Promise<PrinterHealthState[]> {
    // Overlapping polls would double-record transitions.
    if (this.running) return this.snapshot()
    this.running = true

    try {
      // Null when CUPS didn't answer, which must not be read as "every queue was
      // deleted" — that would log a disconnect for every printer on each hiccup.
      let discovered: PrinterInfo[] | null = null
      try {
        const result = await discoverPrintersDetailed({ checkPresence: true })
        discovered = result.cupsAvailable ? result.printers : null
      } catch {
        // Unexpected failure; treat as no information.
      }

      const observed = healthFor(listPrinterProfiles(), discovered)
      const next = new Map<string, PrinterHealthState>()
      const nextKnown = new Map<string, PrinterHealth>()

      for (const state of observed) {
        const previous = this.lastKnown.get(state.printerId)
        const event = eventForTransition(previous, state.health)

        if (event) {
          recordPrinterEvent(state.cupsName ?? state.name, event.type, event.message)
          state.changedAt = new Date().toISOString().replace('T', ' ').slice(0, 19)
          console.log(`[health] ${state.name}: ${previous ?? 'unseen'} → ${state.health}`)
        } else {
          state.changedAt = this.states.get(state.printerId)?.changedAt
        }

        next.set(state.printerId, state)
        // Only a determinate reading updates the baseline.
        const known = state.health === 'unknown' ? previous : state.health
        if (known) nextKnown.set(state.printerId, known)
      }

      // Forget printers that are no longer configured, so re-adding one is
      // treated as a first sighting rather than compared against a stale state.
      this.states = next
      this.lastKnown = nextKnown
      return observed
    } finally {
      this.running = false
    }
  }

  /** Begin polling. Runs one check immediately. */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.check().catch(err => console.error('[health] check failed:', err))
    }, this.intervalMs)
    this.check().catch(() => { /* startup check is best-effort */ })
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
