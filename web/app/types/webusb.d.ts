/**
 * Ambient type declarations for the WebUSB API (`navigator.usb`).
 *
 * WebUSB is not part of the standard TypeScript DOM lib. These declarations
 * mirror the relevant parts of the W3C spec and are scoped to the members
 * `useLocalPrinter` actually uses. All usage is behind a feature-detection
 * guard, since only Chromium-based browsers implement it.
 *
 * @see https://wicg.github.io/webusb/
 */

export {};

declare global {
  interface USBEndpoint {
    readonly endpointNumber: number;
    readonly direction: 'in' | 'out';
    readonly type: 'bulk' | 'interrupt' | 'isochronous';
  }

  interface USBAlternateInterface {
    readonly endpoints: USBEndpoint[];
  }

  interface USBInterface {
    readonly interfaceNumber: number;
    readonly alternate: USBAlternateInterface;
    /** True once this page has claimed the interface. Re-claiming resets its endpoints. */
    readonly claimed: boolean;
  }

  interface USBConfiguration {
    readonly interfaces: USBInterface[];
  }

  interface USBOutTransferResult {
    readonly bytesWritten: number;
    readonly status: 'ok' | 'stall' | 'babble';
  }

  interface USBDevice {
    readonly opened: boolean;
    readonly configuration: USBConfiguration | null;
    readonly vendorId: number;
    readonly productId: number;
    readonly productName?: string;
    readonly manufacturerName?: string;
    readonly serialNumber?: string;
    open(): Promise<void>;
    close(): Promise<void>;
    selectConfiguration(configurationValue: number): Promise<void>;
    claimInterface(interfaceNumber: number): Promise<void>;
    releaseInterface(interfaceNumber: number): Promise<void>;
    transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>;
  }

  interface USBConnectionEvent extends Event {
    readonly device: USBDevice;
  }

  interface USBDeviceFilter {
    vendorId?: number;
    productId?: number;
    classCode?: number;
  }

  interface USBDeviceRequestOptions {
    filters: USBDeviceFilter[];
  }

  interface USB extends EventTarget {
    getDevices(): Promise<USBDevice[]>;
    requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>;
    addEventListener(
      type: 'connect' | 'disconnect',
      listener: (event: USBConnectionEvent) => void
    ): void;
    removeEventListener(
      type: 'connect' | 'disconnect',
      listener: (event: USBConnectionEvent) => void
    ): void;
  }

  interface Navigator {
    readonly usb: USB;
  }
}
