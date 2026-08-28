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

// Module-level: connections shared across every consumer, keyed by device id.
const connections = ref(new Map<string, LocalConnection>())
const isConnecting = ref(false)
const lastError = ref<string | null>(null)
const supported = ref(false)
let eventsRegistered = false

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
   * @returns the device id it was stored under.
   */
  async function openDevice(device: USBDevice): Promise<string> {
    const deviceId = deviceIdOf(device)

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

    await device.claimInterface(iface.interfaceNumber)

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

  /** Release the interface and close one device. */
  async function disconnect(deviceId: string): Promise<void> {
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
  }

  /**
   * Send raw ZPL to a specific connected printer.
   *
   * @param deviceId - Which paired device to print on.
   * @returns true on a successful transfer. On failure, read `lastError`.
   */
  async function printZpl(deviceId: string, zpl: string): Promise<boolean> {
    const current = connections.value.get(deviceId)
    if (!current?.device.opened) {
      lastError.value = 'That local printer is not connected'
      return false
    }

    lastError.value = null

    try {
      const data = new TextEncoder().encode(zpl.endsWith('\n') ? zpl : `${zpl}\n`)
      const result = await current.device.transferOut(current.endpointNumber, data)

      if (result.status !== 'ok') {
        throw new Error(`USB transfer failed (${result.status})`)
      }
      return true
    } catch (error: unknown) {
      lastError.value = errorMessage(error, 'Failed to send data to the printer')
      // The device vanished mid-transfer; drop our stale handle.
      if (error instanceof Error && (error.name === 'NotFoundError' || error.name === 'NetworkError')) {
        forget(deviceId)
      }
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
