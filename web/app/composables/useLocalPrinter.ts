/**
 * Local USB printers over WebUSB.
 *
 * Lets the browser talk straight to Zebra printers plugged into *this* machine,
 * bypassing the server and CUPS entirely. Useful when the person printing isn't
 * sitting at the box running the server — they get their own printer without a
 * second server install.
 *
 * Several devices can be paired at once, each identified by a stable
 * `usb-{vendor}-{product}-{serial}` key. That key is what per-printer settings
 * hang off, so the 2×1" printer at one desk and the 4×6" printer at another keep
 * their own label configuration instead of sharing one global setting.
 *
 * Pairings are remembered by the browser, so `reconnectSaved()` can reattach on
 * later visits without prompting. State is module-level so every component shares
 * the same connections; claiming the same interface twice fails.
 *
 * Requirements and caveats:
 *   - Chromium-based browsers only (Chrome, Edge). Firefox and Safari have not
 *     implemented WebUSB.
 *   - A secure context: HTTPS, or localhost.
 *   - The OS must not be holding the device exclusively. On Windows that means
 *     swapping the printer to the WinUSB driver (Zadig); on macOS and Linux,
 *     CUPS can hold the interface, so the printer may need removing from CUPS.
 */

/** Zebra Technologies USB vendor ID */
const ZEBRA_VENDOR_ID = 0x0a5f

/** USB printer device class — lets non-Zebra ZPL-compatible printers be picked */
const USB_PRINTER_CLASS = 0x07

/**
 * Placeholder for printers that don't report a serial number.
 *
 * Two identical models with no serial are indistinguishable to WebUSB, so they
 * collapse onto one id. That's a limitation of the hardware, not something to
 * paper over: better one shared profile than two that swap places between visits.
 */
const NO_SERIAL = 'nos'

interface LocalConnection {
  device: USBDevice
  interfaceNumber: number
  endpointNumber: number
}

/** A paired device and what we know about it, whether or not it's open. */
export interface LocalDeviceInfo {
  /** Stable device key, e.g. `usb-0a5f-0080-38J154200130` */
  deviceId: string
  name: string
  vendorId: number
  productId: number
  serialNumber?: string
  connected: boolean
}

/**
 * Bytes per bulk transfer.
 *
 * Windows drives WebUSB through WinUSB, which cancels a transfer that outlives its
 * patience; macOS's IOKit backend buffers the whole thing instead. Handing over the
 * data in bounded pieces keeps each individual transfer short enough to complete.
 * 8 KiB is a multiple of every bulk packet size a Zebra reports (64 and 512).
 */
const USB_CHUNK_BYTES = 8192

/** How long to wait before the one retry of a cancelled transfer. */
const TRANSFER_RETRY_DELAY_MS = 150

// Module-level: connections shared across every consumer, keyed by device id.
const connections = ref(new Map<string, LocalConnection>())
const isConnecting = ref(false)
const lastError = ref<string | null>(null)
const supported = ref(false)
let eventsRegistered = false

/**
 * In-flight `openDevice` calls, keyed by device id.
 *
 * Two callers opening the same printer at once used to each run the full
 * open/claim sequence; the second one's `claimInterface` reset an endpoint the
 * first was already writing to.
 */
const opening = new Map<string, Promise<string>>()

/**
 * One write at a time per device.
 *
 * A bulk endpoint has no notion of interleaved messages — two overlapping
 * `transferOut` calls produce spliced ZPL at best and a cancelled transfer at
 * worst. Writes queue behind each other instead.
 */
const writeChains = new Map<string, Promise<unknown>>()

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Run `work` after any write already queued for this device has settled. */
function queueWrite<T>(deviceId: string, work: () => Promise<T>): Promise<T> {
  // A queued write must not inherit its predecessor's failure, hence the catch.
  const previous = writeChains.get(deviceId) ?? Promise.resolve()
  const run = previous.catch(() => {}).then(work)
  // Store a settled-either-way handle so one failure doesn't poison the chain.
  writeChains.set(deviceId, run.catch(() => {}))
  return run
}

/**
 * Did this transfer fail without moving any data?
 *
 * Windows surfaces a re-claimed or reset interface as "The transfer was cancelled".
 * Nothing reached the printer, so the same bytes can be sent again — which is only
 * true before any chunk has landed, hence the caller's `sent === 0` guard.
 */
function isCancelledTransfer(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError') return true
  return /transfer was cancel/i.test(error.message)
}

/** Does this error mean our handle is dead rather than our data bad? */
function isStaleHandle(error: unknown): boolean {
  return error instanceof Error
    && (error.name === 'NotFoundError' || error.name === 'NetworkError')
}

function hex(n: number): string {
  return n.toString(16).padStart(4, '0')
}

/**
 * Stable identity for a USB device.
 *
 * Has to survive unplugging, rebooting, and a different USB port, because it's the
 * key a printer's saved configuration is stored under. Vendor and product ids
 * alone aren't enough — two of the same model would collide — so the serial number
 * is included when the device reports one.
 */
export function deviceIdOf(device: USBDevice): string {
  return `usb-${hex(device.vendorId)}-${hex(device.productId)}-${device.serialNumber || NO_SERIAL}`
}

/** A human-readable name for a device, falling back to its USB ids. */
export function deviceNameOf(device: USBDevice): string {
  return device.productName
    || device.manufacturerName
    || `USB device ${hex(device.vendorId)}:${hex(device.productId)}`
}

/** Pull a readable message out of an unknown thrown value. */
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

export function useLocalPrinter() {
  const isSupported = computed(() => supported.value)

  /** Device ids currently open and ready to print. */
  const connectedIds = computed(() =>
    [...connections.value.entries()]
      .filter(([, c]) => c.device.opened)
      .map(([id]) => id))

  /** Is this specific device connected? Omit the id to ask "any at all?". */
  function isConnected(deviceId?: string | null): boolean {
    if (!deviceId) return connectedIds.value.length > 0
    return connections.value.get(deviceId)?.device.opened ?? false
  }

  /** Display name for a connected device, or null if it isn't connected. */
  function nameOf(deviceId: string): string | null {
    const device = connections.value.get(deviceId)?.device
    return device ? deviceNameOf(device) : null
  }

  /**
   * Open and claim a device for bulk output.
   *
   * Zebra printers expose ZPL as a plain bulk OUT endpoint, so finding the first
   * interface with one is enough — no vendor-specific setup.
   *
   * Idempotent, and safe to call from two places at once. That matters because
   * several things reach for a device around the same moment — `connect()`, the
   * `connect` USB event that fires just after permission is granted, and
   * `reconnectSaved()` from `usePrinters.load()`. Re-running `claimInterface()` on a
   * device that is already claimed resets the endpoint, and Windows reports any
   * transfer in flight at that moment as cancelled. macOS's driver tolerates it,
   * which is why the failure only ever showed up on Windows.
   *
   * @returns the device id it was stored under.
   */
  async function openDevice(device: USBDevice): Promise<string> {
    const deviceId = deviceIdOf(device)

    // Already ours and live — nothing to do, and re-claiming would break writes.
    if (connections.value.get(deviceId)?.device.opened) return deviceId

    // Someone else is already opening this one; share their attempt.
    const inFlight = opening.get(deviceId)
    if (inFlight) return inFlight

    const attempt = claimDevice(device, deviceId)
    opening.set(deviceId, attempt)
    try {
      return await attempt
    } finally {
      opening.delete(deviceId)
    }
  }

  /** The actual open/claim sequence. Only ever called via `openDevice`. */
  async function claimDevice(device: USBDevice, deviceId: string): Promise<string> {
    if (!device.opened) await device.open()

    if (device.configuration === null) {
      await device.selectConfiguration(1)
    }

    const iface = device.configuration?.interfaces.find(i =>
      i.alternate.endpoints.some(ep => ep.direction === 'out' && ep.type === 'bulk'),
    )
    const endpoint = iface?.alternate.endpoints.find(
      ep => ep.direction === 'out' && ep.type === 'bulk',
    )

    if (!iface || !endpoint) {
      await device.close()
      throw new Error('No bulk OUT endpoint found — this device does not look like a USB printer')
    }

    if (!iface.claimed) {
      await device.claimInterface(iface.interfaceNumber)
    }

    // Reassigning the Map is what makes the computed refs re-evaluate; mutating
    // it in place would not.
    connections.value = new Map(connections.value).set(deviceId, {
      device,
      interfaceNumber: iface.interfaceNumber,
      endpointNumber: endpoint.endpointNumber,
    })
    lastError.value = null
    return deviceId
  }

  function forget(deviceId: string): void {
    const next = new Map(connections.value)
    next.delete(deviceId)
    connections.value = next
    writeChains.delete(deviceId)
  }

  /**
   * Detect WebUSB support and start tracking plug/unplug events.
   *
   * Call once on mount. Support detection has to happen client-side, so it cannot
   * run during SSR/prerender.
   */
  function listenForUsbEvents(): void {
    if (import.meta.server) return

    supported.value = typeof navigator !== 'undefined' && 'usb' in navigator
    if (!supported.value || eventsRegistered) return
    eventsRegistered = true

    navigator.usb.addEventListener('disconnect', (event: USBConnectionEvent) => {
      const deviceId = deviceIdOf(event.device)
      if (connections.value.has(deviceId)) {
        forget(deviceId)
        lastError.value = `${deviceNameOf(event.device)} was disconnected`
      }
    })

    navigator.usb.addEventListener('connect', async (event: USBConnectionEvent) => {
      // A device we're paired with came back — reattach just that one. The old
      // behaviour reattached whichever device happened to be first, which with two
      // printers paired meant reconnecting to the wrong one.
      const deviceId = deviceIdOf(event.device)
      if (connections.value.has(deviceId)) return
      try {
        await openDevice(event.device)
      } catch {
        // Leave it to the user to connect manually.
      }
    })
  }

  /**
   * Show the browser's device picker and connect to the chosen printer.
   *
   * Must be called from a user gesture — the browser rejects `requestDevice`
   * otherwise.
   *
   * @returns the connected device's id and name, or null if nothing was chosen.
   */
  async function connect(): Promise<{ deviceId: string; name: string } | null> {
    if (!isSupported.value) {
      lastError.value = 'WebUSB is not supported in this browser. Use Chrome or Edge.'
      return null
    }

    isConnecting.value = true
    lastError.value = null

    try {
      const device = await navigator.usb.requestDevice({
        filters: [
          { vendorId: ZEBRA_VENDOR_ID },
          { classCode: USB_PRINTER_CLASS },
        ],
      })
      const deviceId = await openDevice(device)
      return { deviceId, name: deviceNameOf(device) }
    } catch (error: unknown) {
      // NotFoundError means the picker was dismissed — not worth reporting.
      if (error instanceof Error && error.name === 'NotFoundError') {
        lastError.value = null
        return null
      }
      lastError.value = errorMessage(error, 'Failed to connect to the printer')
      return null
    } finally {
      isConnecting.value = false
    }
  }

  /**
   * Reattach to already-paired devices without showing the picker.
   *
   * @param deviceIds - Only reattach these. Omit to reattach everything this
   *   browser has been granted access to.
   * @returns the device ids that were successfully reattached.
   */
  async function reconnectSaved(deviceIds?: string[]): Promise<string[]> {
    if (!isSupported.value) return []

    const wanted = deviceIds ? new Set(deviceIds) : null
    const reattached: string[] = []

    try {
      for (const device of await navigator.usb.getDevices()) {
        const deviceId = deviceIdOf(device)
        if (wanted && !wanted.has(deviceId)) continue
        if (connections.value.get(deviceId)?.device.opened) {
          reattached.push(deviceId)
          continue
        }
        try {
          await openDevice(device)
          reattached.push(deviceId)
        } catch {
          // Held by the OS, or not a printer. Skip it and try the rest.
        }
      }
    } catch {
      // getDevices() rejected outright; nothing to reattach.
    }

    return reattached
  }

  /**
   * Every device this browser has been granted access to, paired or not.
   *
   * Used by Settings to show devices that were authorised previously but aren't
   * saved as printers yet.
   */
  async function listGrantedDevices(): Promise<LocalDeviceInfo[]> {
    if (!isSupported.value) return []
    try {
      return (await navigator.usb.getDevices()).map(device => ({
        deviceId: deviceIdOf(device),
        name: deviceNameOf(device),
        vendorId: device.vendorId,
        productId: device.productId,
        serialNumber: device.serialNumber,
        connected: device.opened,
      }))
    } catch {
      return []
    }
  }

  /**
   * Release the interface and close one device.
   *
   * Queued behind any write in progress: releasing the interface mid-transfer is
   * another way to get a cancelled transfer, and the label would come out truncated.
   */
  async function disconnect(deviceId: string): Promise<void> {
    if (!connections.value.has(deviceId)) return

    await queueWrite(deviceId, async () => {
      const current = connections.value.get(deviceId)
      if (!current) return
      try {
        await current.device.releaseInterface(current.interfaceNumber)
        await current.device.close()
      } catch {
        // Already gone; nothing to release.
      } finally {
        forget(deviceId)
      }
    }).catch(() => {
      // A failed predecessor shouldn't leave a stale handle behind.
      forget(deviceId)
    })
  }

  /**
   * Push bytes to a device's bulk OUT endpoint, in chunks.
   *
   * The one retry only applies before anything has been transferred. Resending
   * after a partial write would leave the printer with the tail of one payload
   * followed by a whole second copy, so a mid-stream failure is reported as-is.
   */
  async function transfer(deviceId: string, data: Uint8Array<ArrayBuffer>): Promise<void> {
    let sent = 0

    while (sent < data.length) {
      const chunk = data.subarray(sent, Math.min(sent + USB_CHUNK_BYTES, data.length))
      const connection = connections.value.get(deviceId)
      if (!connection?.device.opened) {
        throw new Error('The printer was disconnected mid-transfer')
      }

      try {
        const result = await connection.device.transferOut(connection.endpointNumber, chunk)
        if (result.status !== 'ok') {
          throw new Error(`USB transfer failed (${result.status})`)
        }
      } catch (error: unknown) {
        // Nothing has landed yet, so one retry is safe. This covers the Windows case
        // where the endpoint was momentarily reset while the device was being
        // re-opened by something else.
        if (sent === 0 && isCancelledTransfer(error)) {
          await delay(TRANSFER_RETRY_DELAY_MS)
          const retryOn = connections.value.get(deviceId)
          if (!retryOn?.device.opened) throw error
          const retry = await retryOn.device.transferOut(retryOn.endpointNumber, chunk)
          if (retry.status !== 'ok') {
            throw new Error(`USB transfer failed (${retry.status})`, { cause: error })
          }
        } else {
          throw error
        }
      }

      sent += chunk.length
    }
  }

  /**
   * Send raw ZPL to a specific connected printer.
   *
   * Waits for any open/claim in progress on the device before writing: a transfer
   * that overlaps a `claimInterface()` is the exact race Windows reports as "the
   * transfer was cancelled". Writes to the same device are also serialised, so two
   * callers can't interleave on one endpoint.
   *
   * @param deviceId - Which paired device to print on.
   * @returns true on a successful transfer. On failure, read `lastError`.
   */
  async function printZpl(deviceId: string, zpl: string): Promise<boolean> {
    // Don't start writing into an endpoint that's being re-claimed.
    await opening.get(deviceId)?.catch(() => {})

    if (!connections.value.get(deviceId)?.device.opened) {
      lastError.value = 'That local printer is not connected'
      return false
    }

    lastError.value = null
    const data = new TextEncoder().encode(zpl.endsWith('\n') ? zpl : `${zpl}\n`)

    try {
      await queueWrite(deviceId, () => transfer(deviceId, data))
      return true
    } catch (error: unknown) {
      lastError.value = errorMessage(error, 'Failed to send data to the printer')
      // The device vanished mid-transfer; drop our stale handle.
      if (isStaleHandle(error)) forget(deviceId)
      return false
    }
  }

  return {
    isSupported,
    isConnecting: computed(() => isConnecting.value),
    connectedIds,
    lastError: computed(() => lastError.value),
    isConnected,
    nameOf,
    listenForUsbEvents,
    connect,
    reconnectSaved,
    listGrantedDevices,
    disconnect,
    printZpl,
  }
}
