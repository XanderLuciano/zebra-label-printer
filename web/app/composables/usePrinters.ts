/**
 * The printer list — server printers and this browser's USB printers, together.
 *
 * Printer configuration used to be global: one label size, one tracking mode, one
 * DPI, shared by every printer. With a local 2×1" printer and a server 4×6"
 * printer that never worked — switching printers meant re-entering the geometry,
 * and nothing verified that the printer you were about to print on was loaded with
 * that stock. Every printer now carries its own configuration.
 *
 * Where a printer's configuration lives depends on who can reach it:
 *
 *   • **Server printers** are stored on the server and visible to everyone. They
 *     come from `GET /api/printers`.
 *   • **Local printers** are USB devices plugged into *this* machine and reached
 *     over WebUSB. The pairing is granted to one browser profile and can't be
 *     shared, so their configuration is stored in `localStorage`, keyed by the
 *     device's stable `usb-vendor-product-serial` id.
 *
 * Both use the same `PrinterProfile` shape, so the rest of the app picks a printer
 * and prints without caring which kind it got. The only difference is at the wire:
 * a server printer prints through the queue, a local one gets its ZPL handed back
 * for the browser to push over USB.
 */

import type {
  DiscoveredPrinter,
  MediaTracking,
  PrinterHealth,
  PrinterProfile,
  PrinterStatusView,
} from './useApi'

/** Local printer profiles, keyed by device id. */
const PRINTERS_KEY = 'zebra-printers'
/** Which printer this browser prints to. */
const SELECTED_KEY = 'zebra-selected-printer'
/** The pre-registry preference this replaces: 'server' | 'local'. */
const LEGACY_TARGET_KEY = 'zebra-print-target'

/** Printer ids owned by a browser carry this prefix; the server can't resolve them. */
export const LOCAL_PRINTER_ID_PREFIX = 'local_'

const DEFAULT_DPI = 203

/** Label sizes offered when configuring a printer. */
export const STANDARD_LABEL_SIZES = [
  { widthInches: 2, heightInches: 1, widthDots: 406, heightDots: 203, name: '2×1" (small)' },
  { widthInches: 3, heightInches: 1, widthDots: 609, heightDots: 203, name: '3×1" (narrow)' },
  { widthInches: 3, heightInches: 2, widthDots: 609, heightDots: 406, name: '3×2" (standard)' },
  { widthInches: 3, heightInches: 5, widthDots: 609, heightDots: 1015, name: '3×5" (large)' },
  { widthInches: 4, heightInches: 2, widthDots: 812, heightDots: 406, name: '4×2" (wide)' },
  { widthInches: 4, heightInches: 6, widthDots: 812, heightDots: 1218, name: '4×6" (shipping)' },
] as const

/** A printer profile plus live connection state, however it's reached. */
export interface PrinterEntry extends PrinterProfile {
  /** For local printers: the WebUSB device key this profile is bound to. */
  deviceId?: string
  /** Whether this printer can be printed to right now. */
  ready: boolean
  /** Why it isn't ready, when it isn't. */
  readyHint?: string
  /**
   * The single verdict to render.
   *
   * Server printers get this from the server, which can tell an unplugged cable
   * from a stopped queue. Local printers are derived from the WebUSB connection:
   * losing the device is the same situation, so it reports 'unplugged' too.
   */
  health: PrinterHealth
}

/** How long a printer list stays fresh before an open page refetches it. */
const POLL_INTERVAL_MS = 15000

// Module-level so every component sees one list and one selection.
const localProfiles = ref<PrinterProfile[]>([])
const serverProfiles = ref<PrinterStatusView[]>([])
/** CUPS queues the server can see but that aren't configured — candidates to add. */
const discovered = ref<DiscoveredPrinter[]>([])
const selectedId = ref<string | null>(null)
const loadingServer = ref(false)
let hydrated = false

/** The profile id for a WebUSB device. */
export function localPrinterId(deviceId: string): string {
  return `${LOCAL_PRINTER_ID_PREFIX}${deviceId}`
}

/** Is this a browser-owned printer? */
export function isLocalPrinterId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(LOCAL_PRINTER_ID_PREFIX)
}

/**
 * The USB serial number CUPS recorded for a server printer.
 *
 * CUPS spells it into the device URI as a query parameter, e.g.
 * `usb://Zebra%20Technologies/ZTC%20GK420d?serial=38J154200130`. Networked printers
 * have no serial in their URI, so this returns null for them.
 */
export function serialFromDeviceUri(uri: string | null | undefined): string | null {
  const match = uri?.match(/[?&]serial=([^&\s]+)/)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    // Malformed escape sequence; the raw value still beats showing nothing.
    return match[1]
  }
}

/** Derive inches from dots so the two can never disagree. */
export function labelSizeFromDots(
  widthDots: number,
  heightDots: number,
  dpi: number,
  name?: string,
): PrinterProfile['labelSize'] {
  const widthInches = Number((widthDots / dpi).toFixed(2))
  const heightInches = Number((heightDots / dpi).toFixed(2))
  return {
    widthInches,
    heightInches,
    widthDots,
    heightDots,
    name: name || `${widthInches}×${heightInches}"`,
  }
}

function readStorage<T>(key: string, fallback: T): T {
  if (import.meta.server || typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    // Private mode, blocked storage, or corrupt JSON.
    return fallback
  }
}

function writeStorage(key: string, value: unknown): void {
  if (import.meta.server || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota or blocked storage; the in-memory value still applies this session.
  }
}

export function usePrinters() {
  const api = useApi()
  const localPrinter = useLocalPrinter()

  /**
   * Every configured printer, local ones first.
   *
   * Local printers lead because they're the ones physically next to whoever is
   * looking at the screen.
   */
  const printers = computed<PrinterEntry[]>(() => {
    const local: PrinterEntry[] = localProfiles.value.map(profile => {
      const deviceId = profile.usbDeviceId ?? profile.id.slice(LOCAL_PRINTER_ID_PREFIX.length)
      const connected = localPrinter.isConnected(deviceId)
      const supported = localPrinter.isSupported.value
      return {
        ...profile,
        deviceId,
        ready: connected,
        health: connected ? 'ready' : supported ? 'unplugged' : 'unknown',
        readyHint: connected
          ? undefined
          : supported
            ? 'Not connected — plug it in and reconnect from Settings'
            : 'Local printing needs Chrome or Edge on HTTPS or localhost',
      }
    })

    // Server printers arrive with a health verdict already computed, because only
    // the server can tell an unplugged cable from a queue CUPS has stopped.
    const server: PrinterEntry[] = serverProfiles.value.map(profile => ({
      ...profile,
      ready: profile.health === 'ready',
      health: profile.health,
      readyHint: profile.health === 'ready' ? undefined : profile.healthMessage,
    }))

    return [...local, ...server]
  })

  /** The printer prints go to. */
  const selected = computed<PrinterEntry | null>(() => {
    const list = printers.value
    if (selectedId.value) {
      const match = list.find(p => p.id === selectedId.value)
      if (match) return match
    }
    // The saved selection is gone (printer deleted, or a different browser).
    // Fall back to the server default, then to anything at all, so printing still
    // works instead of silently failing.
    return list.find(p => p.isDefault) ?? list[0] ?? null
  })

  const hasPrinters = computed(() => printers.value.length > 0)

  /** Geometry to render for on the selected printer. */
  const labelSize = computed(() => selected.value?.labelSize ?? null)

  // ── Loading ───────────────────────────────────────────────────────────────

  /** Fetch the server's printer list. */
  async function refreshServer(): Promise<void> {
    loadingServer.value = true
    try {
      const res = await api.getPrinters()
      serverProfiles.value = res.printers
      discovered.value = res.discovered ?? []
    } catch {
      // Server unreachable, or no API. Local printers still work.
      serverProfiles.value = []
      discovered.value = []
    } finally {
      loadingServer.value = false
    }
  }

  /** Read saved local printers and the selected printer out of localStorage. */
  function loadLocal(): void {
    localProfiles.value = readStorage<PrinterProfile[]>(PRINTERS_KEY, [])

    const saved = readStorage<string | null>(SELECTED_KEY, null)
    if (typeof saved === 'string') {
      selectedId.value = saved
      return
    }

    // Carry over the old binary preference. Someone who last chose "local USB"
    // should still land on their USB printer rather than the server's default.
    if (!import.meta.server && typeof localStorage !== 'undefined') {
      try {
        if (localStorage.getItem(LEGACY_TARGET_KEY) === 'local') {
          selectedId.value = localProfiles.value[0]?.id ?? null
        }
      } catch {
        // Blocked storage; nothing to migrate.
      }
    }
  }

  /**
   * Load everything and reattach saved USB devices. Safe to call repeatedly.
   *
   * @param force - Refetch the server list even if already hydrated.
   */
  async function load(force = false): Promise<void> {
    if (import.meta.server) return
    if (hydrated && !force) return
    hydrated = true

    loadLocal()
    localPrinter.listenForUsbEvents()

    await Promise.all([
      refreshServer(),
      // Reattach only the devices saved as printers, so a browser that has been
      // granted access to something else doesn't get claimed unexpectedly.
      localPrinter.reconnectSaved(
        localProfiles.value.map(p => p.usbDeviceId).filter((id): id is string => !!id),
      ),
    ])
  }

  /**
   * Keep the server printer list fresh while a component is mounted.
   *
   * Without this, a printer unplugged on the server stays green until the page is
   * reloaded — the state is correct on the server, nothing was asking for it.
   * Automatically stops on unmount.
   */
  function watchWhileMounted(intervalMs = POLL_INTERVAL_MS): void {
    if (import.meta.server) return

    let timer: ReturnType<typeof setInterval> | null = null

    onMounted(async () => {
      await load()
      timer = setInterval(() => { refreshServer() }, intervalMs)
    })

    onUnmounted(() => {
      if (timer) clearInterval(timer)
      timer = null
    })
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  function select(id: string): void {
    selectedId.value = id
    writeStorage(SELECTED_KEY, id)
  }

  // ── Local printers ────────────────────────────────────────────────────────

  function persistLocal(): void {
    writeStorage(PRINTERS_KEY, localProfiles.value)
  }

  /** Build the default profile for a newly paired USB device. */
  function newLocalProfile(deviceId: string, name: string): PrinterProfile {
    const size = STANDARD_LABEL_SIZES[3]
    return {
      id: localPrinterId(deviceId),
      name,
      connection: 'local',
      transport: 'webusb',
      usbDeviceId: deviceId,
      cupsName: null,
      deviceUri: null,
      labelSize: { ...size },
      dpi: DEFAULT_DPI,
      tracking: 'gap',
      isDefault: false,
    }
  }

  /**
   * Pair a USB printer with this browser and save it.
   *
   * Must be called from a user gesture; the browser only opens its device picker
   * in response to one.
   *
   * @returns the saved profile, or null if the picker was dismissed.
   */
  async function addLocalPrinter(): Promise<PrinterProfile | null> {
    const paired = await localPrinter.connect()
    if (!paired) return null

    const id = localPrinterId(paired.deviceId)
    const existing = localProfiles.value.find(p => p.id === id)
    if (existing) {
      // Already saved — re-pairing shouldn't wipe its label configuration.
      select(existing.id)
      return existing
    }

    const profile = newLocalProfile(paired.deviceId, paired.name)
    localProfiles.value = [...localProfiles.value, profile]
    persistLocal()
    select(profile.id)
    return profile
  }

  /** Save an already-granted device as a printer, without opening the picker. */
  async function adoptLocalDevice(deviceId: string, name: string): Promise<PrinterProfile | null> {
    const id = localPrinterId(deviceId)
    const existing = localProfiles.value.find(p => p.id === id)
    if (existing) return existing

    const profile = newLocalProfile(deviceId, name)
    localProfiles.value = [...localProfiles.value, profile]
    persistLocal()
    await localPrinter.reconnectSaved([deviceId])
    return profile
  }

  function updateLocalPrinter(id: string, patch: Partial<PrinterProfile>): void {
    localProfiles.value = localProfiles.value.map(p => (p.id === id ? { ...p, ...patch } : p))
    persistLocal()
  }

  async function removeLocalPrinter(id: string): Promise<void> {
    const profile = localProfiles.value.find(p => p.id === id)
    if (profile?.usbDeviceId) await localPrinter.disconnect(profile.usbDeviceId)

    localProfiles.value = localProfiles.value.filter(p => p.id !== id)
    persistLocal()

    if (selectedId.value === id) {
      const next = printers.value.find(p => p.id !== id)
      if (next) select(next.id)
      else {
        selectedId.value = null
        writeStorage(SELECTED_KEY, null)
      }
    }
  }

  /** Reconnect a saved local printer whose device has come back. */
  async function reconnectLocalPrinter(id: string): Promise<boolean> {
    const profile = localProfiles.value.find(p => p.id === id)
    if (!profile?.usbDeviceId) return false
    const reattached = await localPrinter.reconnectSaved([profile.usbDeviceId])
    return reattached.includes(profile.usbDeviceId)
  }

  // ── Server printers ───────────────────────────────────────────────────────

  /** Register a CUPS printer the server has discovered. */
  async function addServerPrinter(input: {
    name: string
    cupsName: string
    deviceUri?: string | null
  }): Promise<PrinterProfile> {
    const res = await api.createPrinter(input)
    await refreshServer()
    select(res.printer.id)
    return res.printer
  }

  async function updateServerPrinter(
    id: string,
    patch: Parameters<ReturnType<typeof useApi>['updatePrinter']>[1],
  ): Promise<void> {
    await api.updatePrinter(id, patch)
    await refreshServer()
  }

  async function removeServerPrinter(id: string): Promise<void> {
    await api.deletePrinter(id)
    await refreshServer()
    if (selectedId.value === id) {
      const next = printers.value.find(p => p.id !== id)
      if (next) select(next.id)
    }
  }

  async function makeDefault(id: string): Promise<void> {
    await api.setDefaultPrinter(id)
    await refreshServer()
  }

  // ── Configuration, uniform across both kinds ──────────────────────────────

  /**
   * Change a printer's media configuration.
   *
   * Routed by printer kind rather than by a global "am I printing locally" flag:
   * a local printer's config is written to this browser's storage, a server
   * printer's to the server. Callers just say which printer and what to change.
   */
  async function configure(id: string, patch: {
    labelSize?: PrinterProfile['labelSize']
    dpi?: number
    tracking?: MediaTracking
    markOffset?: number | null
    name?: string
  }): Promise<void> {
    if (isLocalPrinterId(id)) {
      // The API models "clear this field" as null; a stored profile just omits it.
      const { markOffset, ...rest } = patch
      updateLocalPrinter(id, { ...rest, markOffset: markOffset ?? undefined })
      return
    }
    await updateServerPrinter(id, {
      ...patch,
      labelSize: patch.labelSize
        ? {
            widthDots: patch.labelSize.widthDots,
            heightDots: patch.labelSize.heightDots,
            name: patch.labelSize.name,
          }
        : undefined,
    })
  }

  /** Look up one printer by id. */
  function get(id: string | null | undefined): PrinterEntry | null {
    if (!id) return null
    return printers.value.find(p => p.id === id) ?? null
  }

  /**
   * The device serial number for a printer, whichever kind it is.
   *
   * The two kinds record it in different places — a browser-paired device is asked
   * directly, while a server printer's serial only exists in the URI CUPS assigned
   * it — so callers get one accessor rather than that branch.
   */
  function serialOf(printer: PrinterEntry | null): string | null {
    if (!printer) return null
    if (printer.connection === 'local') {
      return printer.deviceId ? localPrinter.serialOf(printer.deviceId) : null
    }
    return serialFromDeviceUri(printer.deviceUri)
  }

  return {
    printers,
    selected,
    selectedId: computed(() => selected.value?.id ?? null),
    discovered: computed(() => discovered.value),
    labelSize,
    hasPrinters,
    loadingServer: computed(() => loadingServer.value),
    localUsbSupported: localPrinter.isSupported,
    localUsbError: localPrinter.lastError,
    load,
    refreshServer,
    watchWhileMounted,
    select,
    get,
    serialOf,
    configure,
    addLocalPrinter,
    adoptLocalDevice,
    updateLocalPrinter,
    removeLocalPrinter,
    reconnectLocalPrinter,
    listGrantedDevices: localPrinter.listGrantedDevices,
    addServerPrinter,
    updateServerPrinter,
    removeServerPrinter,
    makeDefault,
  }
}
