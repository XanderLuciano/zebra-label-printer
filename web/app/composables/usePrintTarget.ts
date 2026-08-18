/**
 * Print target preference — server (CUPS) vs local USB (WebUSB).
 *
 * The choice is per-browser, not per-server, so it lives in localStorage: two
 * people hitting the same server can each print to their own printer.
 *
 * `printVia()` wraps the round trip for local printing. The server still owns
 * job records and ZPL generation in both modes — for a local print it persists
 * the job, hands back the ZPL, and waits for us to report the outcome. That
 * keeps print history, label-size snapshots, and reprints identical regardless
 * of which printer the label came out of.
 */

export type PrintTarget = 'server' | 'local'

const STORAGE_KEY = 'zebra-print-target'

const target = ref<PrintTarget>('server')
let loaded = false

export interface PrintOutcome {
  success: boolean
  target: PrintTarget
  jobId?: string
  error?: string
}

/** A server print endpoint that accepts a `target` field. */
type PrintCall = (body: Record<string, unknown>) => Promise<{
  success: boolean
  jobId: string
  zpl?: string
  queued?: boolean
}>

export function usePrintTarget() {
  const api = useApi()
  const localPrinter = useLocalPrinter()

  /** Read the saved preference. Safe to call repeatedly. */
  function load(): void {
    if (loaded || import.meta.server || typeof localStorage === 'undefined') return
    loaded = true
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'server' || stored === 'local') target.value = stored
    } catch {
      // Private mode or blocked storage — stick with the default.
    }
  }

  function setTarget(next: PrintTarget): void {
    target.value = next
    if (import.meta.server || typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Quota or blocked storage; the in-memory value still applies this session.
    }
  }

  /**
   * Run a print through the currently selected target.
   *
   * For 'server' this is a plain API call. For 'local' it asks the server to
   * record the job and return ZPL, pushes that over USB, then reports back so
   * the job doesn't sit in 'printing' forever.
   *
   * @param call - The API method for this label type (e.g. `api.printLabel`).
   * @param body - Request body, without `target`.
   */
  async function printVia(call: PrintCall, body: Record<string, unknown>): Promise<PrintOutcome> {
    load()

    if (target.value === 'server') {
      try {
        const res = await call({ ...body, target: 'server' })
        return { success: res.success !== false, target: 'server', jobId: res.jobId }
      } catch (e) {
        return { success: false, target: 'server', error: (e as Error).message }
      }
    }

    if (!localPrinter.isConnected.value) {
      return {
        success: false,
        target: 'local',
        error: 'No local USB printer connected. Connect one in Settings, or switch to server printing.',
      }
    }

    let jobId: string | undefined
    try {
      const res = await call({ ...body, target: 'local' })
      jobId = res.jobId
      if (!res.zpl) throw new Error('Server did not return ZPL for local printing')

      const sent = await localPrinter.printZpl(res.zpl)
      const error = sent ? undefined : localPrinter.lastError.value || 'USB transfer failed'

      // Report either way so the job leaves the 'printing' state.
      if (jobId) {
        await api.reportJobResult(jobId, sent, error).catch(() => {})
      }

      return { success: sent, target: 'local', jobId, error }
    } catch (e) {
      const error = (e as Error).message
      if (jobId) await api.reportJobResult(jobId, false, error).catch(() => {})
      return { success: false, target: 'local', jobId, error }
    }
  }

  /**
   * Apply media configuration (and optionally calibrate) on the selected target.
   *
   * Sending this is what makes a label-size change take on the hardware — the
   * printer keeps its own print width and gap settings otherwise.
   */
  async function applyMediaConfig(options: {
    widthDots?: number
    heightDots?: number
    dpi?: number
    tracking?: 'gap' | 'mark' | 'continuous' | 'auto'
    calibrate?: boolean
  } = {}): Promise<PrintOutcome> {
    load()

    if (target.value === 'server') {
      try {
        const res = await api.configurePrinter({ ...options, target: 'server' })
        return { success: res.success, target: 'server', error: res.error }
      } catch (e) {
        return { success: false, target: 'server', error: (e as Error).message }
      }
    }

    if (!localPrinter.isConnected.value) {
      return { success: false, target: 'local', error: 'No local USB printer connected' }
    }

    try {
      const res = await api.configurePrinter({ ...options, target: 'local' })
      if (!res.zpl) throw new Error('Server did not return configuration ZPL')
      const sent = await localPrinter.printZpl(res.zpl)
      return {
        success: sent,
        target: 'local',
        error: sent ? undefined : localPrinter.lastError.value || 'USB transfer failed',
      }
    } catch (e) {
      return { success: false, target: 'local', error: (e as Error).message }
    }
  }

  /** Run a media sensor calibration on the selected target. */
  async function calibrate(): Promise<PrintOutcome> {
    load()

    if (target.value === 'server') {
      try {
        const res = await api.calibratePrinter('server')
        return { success: res.success, target: 'server', error: res.error }
      } catch (e) {
        return { success: false, target: 'server', error: (e as Error).message }
      }
    }

    if (!localPrinter.isConnected.value) {
      return { success: false, target: 'local', error: 'No local USB printer connected' }
    }

    try {
      const res = await api.calibratePrinter('local')
      if (!res.zpl) throw new Error('Server did not return calibration ZPL')
      const sent = await localPrinter.printZpl(res.zpl)
      return {
        success: sent,
        target: 'local',
        error: sent ? undefined : localPrinter.lastError.value || 'USB transfer failed',
      }
    } catch (e) {
      return { success: false, target: 'local', error: (e as Error).message }
    }
  }

  // Per-endpoint wrappers so call sites don't have to know about targets.
  // Each mirrors the matching useApi method, minus the `target` field.

  const printText = (body: { lines: string[]; copies?: number }) =>
    printVia(b => api.printText(b as typeof body), body)

  const printBarcode = (body: { data: string; type?: string; text?: string }) =>
    printVia(b => api.printBarcode(b as typeof body), body)

  const printQR = (body: { data: string; text?: string; magnification?: number }) =>
    printVia(b => api.printQR(b as typeof body), body)

  const printZpl = (zpl: string) =>
    printVia(b => api.printZpl(zpl, (b as { target?: PrintTarget }).target), { zpl })

  const printLabel = (body: { elements: Array<Record<string, unknown>>; copies?: number }) =>
    printVia(b => api.printLabel(b as typeof body), body)

  return {
    target: computed(() => target.value),
    load,
    setTarget,
    printVia,
    printText,
    printBarcode,
    printQR,
    printZpl,
    printLabel,
    applyMediaConfig,
    calibrate,
  }
}
