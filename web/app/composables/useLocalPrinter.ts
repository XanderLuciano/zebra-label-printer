/**
 * Local USB printer over WebUSB.
 *
 * Lets the browser talk straight to a Zebra printer plugged into *this*
 * machine, bypassing the server and CUPS entirely. Useful when the person
 * printing isn't sitting at the box running the server — they get their own
 * printer without a second server install.
 *
 * The pairing is remembered by the browser, so `reconnect()` can reattach on
 * later visits without prompting. State is module-level so every component
 * shares one connection; claiming the same interface twice fails.
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

interface LocalPrinterState {
  device: USBDevice
  interfaceNumber: number
  endpointNumber: number
}

// Module-level: one shared USB connection across all consumers.
const state = ref<LocalPrinterState | null>(null)
const isConnecting = ref(false)
const lastError = ref<string | null>(null)
const supported = ref(false)
let eventsRegistered = false

/** Pull a readable message out of an unknown thrown value. */
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

export function useLocalPrinter() {
  const isSupported = computed(() => supported.value)
  const isConnected = computed(() => state.value?.device?.opened ?? false)

  const connectedPrinterName = computed(() => {
    const d = state.value?.device
    if (!d) return null
    return d.productName
      || d.manufacturerName
      || `USB device ${d.vendorId.toString(16).padStart(4, '0')}:${d.productId.toString(16).padStart(4, '0')}`
  })

  /**
   * Open and claim a device for bulk output.
   *
   * Zebra printers expose ZPL as a plain bulk OUT endpoint, so finding the
   * first interface with one is enough — no vendor-specific setup.
   */
  async function openDevice(device: USBDevice): Promise<void> {
    await device.open()

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

    state.value = {
      device,
      interfaceNumber: iface.interfaceNumber,
      endpointNumber: endpoint.endpointNumber,
    }
    lastError.value = null
  }

  /**
   * Detect WebUSB support and start tracking plug/unplug events.
   *
   * Call once on mount. Support detection has to happen client-side, so it
   * cannot run during SSR/prerender.
   */
  function listenForUsbEvents(): void {
    if (import.meta.server) return

    supported.value = typeof navigator !== 'undefined' && 'usb' in navigator
    if (!supported.value || eventsRegistered) return
    eventsRegistered = true

    navigator.usb.addEventListener('disconnect', (event: USBConnectionEvent) => {
      if (state.value?.device === event.device) {
        state.value = null
        lastError.value = 'Printer was disconnected'
      }
    })

    navigator.usb.addEventListener('connect', async () => {
      // Something we're already paired with just came back — reattach quietly.
      if (state.value) return
      try {
        const devices = await navigator.usb.getDevices()
        if (devices[0]) await openDevice(devices[0])
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
   */
  async function connect(): Promise<boolean> {
    if (!isSupported.value) {
      lastError.value = 'WebUSB is not supported in this browser. Use Chrome or Edge.'
      return false
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
      await openDevice(device)
      return true
    } catch (error: unknown) {
      // NotFoundError means the picker was dismissed — not worth reporting.
      if (error instanceof Error && error.name === 'NotFoundError') {
        lastError.value = null
        return false
      }
      lastError.value = errorMessage(error, 'Failed to connect to the printer')
      return false
    } finally {
      isConnecting.value = false
    }
  }

  /** Reattach to a previously paired device without showing the picker. */
  async function reconnect(): Promise<boolean> {
    if (!isSupported.value || state.value) return false
    try {
      const devices = await navigator.usb.getDevices()
      if (!devices[0]) return false
      await openDevice(devices[0])
      return true
    } catch {
      return false
    }
  }

  /** Release the interface and close the device. */
  async function disconnect(): Promise<void> {
    const current = state.value
    if (!current) return
    try {
      await current.device.releaseInterface(current.interfaceNumber)
      await current.device.close()
    } catch {
      // Already gone; nothing to release.
    } finally {
      state.value = null
    }
  }

  /**
   * Send raw ZPL to the connected printer.
   *
   * @returns true on a successful transfer. On failure, read `lastError`.
   */
  async function printZpl(zpl: string): Promise<boolean> {
    const current = state.value
    if (!current?.device.opened) {
      lastError.value = 'Local printer is not connected'
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
        state.value = null
      }
      return false
    }
  }

  return {
    isSupported,
    isConnected,
    isConnecting: computed(() => isConnecting.value),
    connectedPrinterName,
    lastError: computed(() => lastError.value),
    listenForUsbEvents,
    connect,
    reconnect,
    disconnect,
    printZpl,
  }
}
