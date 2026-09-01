/**
 * API client composable — wraps $fetch with the webhook API base URL.
 *
 * Usage:
 *   const api = useApi()
 *   const { data } = await api.getHealth()
 *   await api.printText({ lines: ['Hello'] })
 */

import type { LabelTemplate } from './useTemplateEngine';

export type JobStatus = 'pending' | 'printing' | 'completed' | 'failed' | 'cancelled';
export type JobType = 'text' | 'barcode' | 'qr' | 'zpl' | 'label';

/**
 * A template as the API returns it: the definition plus server metadata.
 *
 * Mirrors StoredTemplate in src/db/template-repo.ts. Previously these endpoints
 * were typed as `{ id, name, [k: string]: unknown }`, which meant callers had to
 * cast to LabelTemplate and lost any guarantee the layout fields were present.
 *
 * Covers both kinds the API serves: the user's own templates, and the read-only
 * presets built from server code. Presets carry no timestamps because they were
 * never written anywhere.
 */
export interface StoredTemplate extends LabelTemplate {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  /** A preset ships in the server's code: it can't be edited or deleted, only copied. */
  readOnly: boolean;
}

/** Where a label is printed: via the server's CUPS queue, or the browser's USB printer */
export type PrintTargetName = 'server' | 'local';

/** How the printer detects the top of each label (ZPL ^MN) */
export type MediaTracking = 'gap' | 'mark' | 'continuous' | 'auto';

/** How the bytes reach a printer. `webusb` printers are driven by the browser. */
export type PrinterTransport = 'cups' | 'usb' | 'tcp' | 'webusb';

export interface LabelSize {
  widthInches: number;
  heightInches: number;
  widthDots: number;
  heightDots: number;
  name: string;
}

/**
 * A configured printer and the label stock it's loaded with.
 *
 * Mirrors PrinterProfile in src/types.ts. Deliberately the same shape for server
 * printers and browser-attached ones, so the UI and the print path don't have to
 * branch on which kind they're holding — only the storage location and the final
 * transport differ.
 */
export interface PrinterProfile {
  id: string;
  name: string;
  /** Who drives this printer: the server, or the browser that owns the USB device */
  connection: 'server' | 'local';
  transport: PrinterTransport;
  cupsName?: string | null;
  deviceUri?: string | null;
  /** WebUSB device key, for browser-attached printers */
  usbDeviceId?: string | null;
  labelSize: LabelSize;
  dpi: number;
  tracking: MediaTracking;
  markOffset?: number;
  /** Used for print requests that don't name a printer */
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Whether a printer's device is physically attached.
 *
 * Separate from the queue status on purpose: CUPS doesn't watch USB, so a queue
 * can report `idle` and `accepting` with the cable unplugged. `unknown` means the
 * question can't be answered (a networked printer, or a host where CUPS can't
 * enumerate devices) and must never be shown as unplugged.
 */
export type DevicePresence = 'present' | 'absent' | 'unknown';

/**
 * The single verdict to render for a printer.
 *
 * `unplugged` and `offline` are deliberately distinct: one means go and check the
 * cable, the other means CUPS has stopped a printer that is still attached.
 */
export type PrinterHealth = 'ready' | 'unplugged' | 'offline' | 'missing' | 'unknown';

/** A server printer with the live state the server reported alongside it. */
export interface PrinterStatusView extends PrinterProfile {
  status: 'idle' | 'printing' | 'unavailable' | 'unknown';
  accepting: boolean;
  presence: DevicePresence;
  health: PrinterHealth;
  /** Human-readable explanation of `health`, written by the server. */
  healthMessage: string;
}

/** A printer CUPS can see that hasn't been configured yet. */
export interface DiscoveredPrinter {
  name: string;
  uri: string;
  model: string;
  status: 'idle' | 'printing' | 'unavailable' | 'unknown';
  accepting: boolean;
  serial?: string;
  isZebra: boolean;
}

/** Label geometry as the API accepts it — dots only; inches are derived server-side. */
export interface LabelGeometryInput {
  widthDots: number;
  heightDots: number;
  dpi?: number;
  name?: string;
}

/**
 * Which printer a print request is for.
 *
 * `printerId` is the real choice. `labelSize` accompanies it for browser-attached
 * printers, whose configuration lives in the browser rather than on the server.
 */
export interface PrinterSelection {
  target?: PrintTargetName;
  printerId?: string | null;
  printerName?: string | null;
  labelSize?: LabelGeometryInput | null;
}

export interface Job {
  id: string;
  status: JobStatus;
  job_type: JobType;
  request_data: string;
  zpl_commands: string | null;
  printer_name: string | null;
  /**
   * The configured printer this job went to. Null on jobs predating the registry.
   * A `local_` prefix means a browser-attached printer.
   */
  printer_id: string | null;
  cups_job_id: string | null;
  error_message: string | null;
  /** Label width the job was rendered for. Null on jobs predating the snapshot. */
  label_width_dots: number | null;
  /** Label height the job was rendered for. Null on jobs predating the snapshot. */
  label_height_dots: number | null;
  /** Printer resolution the job was rendered for. Null on jobs predating the snapshot. */
  label_dpi: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  priority: number;
}

/**
 * Response from a print endpoint.
 *
 * `zpl` is only populated when `target: 'local'` was requested — the server
 * records the job but leaves transmission to the browser over WebUSB.
 */
export interface PrintResponse {
  success: boolean;
  jobId: string;
  queued?: boolean;
  target?: PrintTargetName;
  zpl?: string;
  error?: string;
  labelSize?: { widthDots: number; heightDots: number; dpi: number };
  /** The printer the server routed this job to. */
  printerId?: string | null;
}

export interface JobLog {
  id: number;
  job_id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  created_at: string;
}

export interface JobStats {
  total: number;
  pending: number;
  printing: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface PrinterEvent {
  id: number;
  printer_name: string;
  event_type: string;
  message: string | null;
  created_at: string;
}

/**
 * Node's process.memoryUsage() shape.
 *
 * Spelled out rather than Record<string, number> so indexing it doesn't yield
 * `number | undefined` under noUncheckedIndexedAccess — these keys are always
 * present, and the weak type just forced callers to guard against nothing.
 */
export interface ProcessMemoryUsage {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface DebugInfo {
  /** The default printer. `name` is null when none is configured. */
  printer: { name: string | null; isReady: boolean };
  /** Every configured printer with its media config and pending job count. */
  printers: Array<{
    id: string;
    name: string;
    transport: PrinterTransport;
    cupsName: string | null;
    isDefault: boolean;
    labelSize: LabelSize;
    dpi: number;
    tracking: MediaTracking;
    pending: number;
    health: PrinterHealth;
    presence: DevicePresence;
    /** When the health monitor last saw this printer change state. */
    healthChangedAt: string | null;
  }>;
  queue: { pending: number; processorRunning: boolean };
  database: { path: string; sizeBytes: number; sizeFormatted: string; stats: JobStats };
  server: { uptime: number; memory: ProcessMemoryUsage; nodeVersion: string };
  printerEvents: PrinterEvent[];
}

/** The error body every endpoint returns on failure. */
interface ApiErrorBody {
  error?: string;
  details?: Array<{ field?: string; message?: string }>;
}

/**
 * Turn a `$fetch` rejection into an error a human can act on.
 *
 * `$fetch` throws a `FetchError` whose message is just `[POST] "/api/print/label": 400
 * Bad Request` — the server's actual explanation sits unread on `error.data`. That's
 * what made a rejected copy count look like an unexplained 400. The field-level
 * `details` from Zod are folded in so the message names the offending field and its
 * limit.
 */
function apiError(error: unknown): Error {
  const body = (error as { data?: ApiErrorBody } | null)?.data;
  const status = (error as { status?: number; statusCode?: number } | null);
  const code = status?.status ?? status?.statusCode;

  const fields = (body?.details ?? [])
    .map(d => {
      const message = d.message?.trim();
      if (!message) return null;
      // '(root)' is the server's marker for a whole-body problem; naming it helps nobody.
      return d.field && d.field !== '(root)' ? `${d.field}: ${message}` : message;
    })
    .filter((s): s is string => !!s);

  if (fields.length > 0) return new Error(fields.join('; '));
  if (body?.error) return new Error(body.error);
  if (error instanceof Error && error.message) return error;
  return new Error(code ? `Request failed (HTTP ${code})` : 'Request failed');
}

export function useApi() {
  const config = useRuntimeConfig();
  // In production, apiBase is empty → use same-origin (relative paths).
  // In dev, set NUXT_PUBLIC_API_BASE=http://localhost:3420 to point at the backend.
  const base = config.public.apiBase as string || '';

  async function get<T>(path: string): Promise<T> {
    try {
      return await $fetch<T>(`${base}${path}`);
    } catch (error) {
      throw apiError(error);
    }
  }

  async function post<T>(path: string, body?: unknown): Promise<T> {
    try {
      return await $fetch<T>(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw apiError(error);
    }
  }

  return {
    // Health
    getHealth: () => get<{ status: string; printer: string | null }>('/api/health'),

    // ── Printers ────────────────────────────────────────────────────────────
    // Configured printers, each with its own media config, plus the CUPS queues
    // that are visible but not set up yet. Browser-attached printers are not here:
    // that pairing belongs to one browser, so those live in localStorage.

    getPrinters: () =>
      get<{ printers: PrinterStatusView[]; discovered: DiscoveredPrinter[] }>('/api/printers'),

    getPrinter: (id: string) =>
      get<{ printer: PrinterProfile }>(`/api/printers/${encodeURIComponent(id)}`),

    createPrinter: (data: {
      name?: string;
      transport?: PrinterTransport;
      cupsName?: string | null;
      deviceUri?: string | null;
      labelSize?: LabelGeometryInput;
      dpi?: number;
      tracking?: MediaTracking;
      markOffset?: number | null;
      isDefault?: boolean;
    }) => post<{ printer: PrinterProfile }>('/api/printers', data),

    updatePrinter: (id: string, data: {
      name?: string;
      cupsName?: string | null;
      deviceUri?: string | null;
      labelSize?: LabelGeometryInput;
      dpi?: number;
      tracking?: MediaTracking;
      markOffset?: number | null;
      isDefault?: boolean;
    }) =>
      $fetch<{ printer: PrinterProfile }>(`${base}/api/printers/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),

    deletePrinter: (id: string) =>
      $fetch<{ success: boolean }>(`${base}/api/printers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),

    setDefaultPrinter: (id: string) =>
      post<{ success: boolean; printer: PrinterProfile }>(
        `/api/printers/${encodeURIComponent(id)}/default`,
      ),

    /** Raw CUPS discovery, configured or not. */
    getDiscoveredPrinters: () =>
      get<{ printers: DiscoveredPrinter[]; error?: string }>('/api/printers/discovered'),

    // ── Print ───────────────────────────────────────────────────────────────
    // Pass `printerId` to choose a printer. A `local_` id (or `target: 'local'`)
    // returns the ZPL for the browser to push over WebUSB instead of printing it,
    // and `labelSize` is how such a printer's geometry reaches the server.

    printText: (data: { lines: string[]; copies?: number } & PrinterSelection) =>
      post<PrintResponse>('/api/print/text', data),

    printBarcode: (data: { data: string; type?: string; text?: string } & PrinterSelection) =>
      post<PrintResponse>('/api/print/barcode', data),

    printQR: (data: { data: string; text?: string; magnification?: number } & PrinterSelection) =>
      post<PrintResponse>('/api/print/qr', data),

    printZpl: (zpl: string, selection: PrinterSelection = {}) =>
      post<PrintResponse>('/api/print/zpl', { zpl, ...selection }),

    printLabel: (data: { elements: Array<Record<string, unknown>>; copies?: number } & PrinterSelection) =>
      post<PrintResponse>('/api/print/label', data),

    // Render (build ZPL without printing — for accurate previews)
    renderZpl: (data: { elements: Array<Record<string, unknown>>; copies?: number; widthDots?: number; heightDots?: number }) =>
      post<{ zpl: string; widthDots: number; heightDots: number }>('/api/render/zpl', data),

    // Templates
    listTemplates: () =>
      get<{ templates: StoredTemplate[] }>('/api/templates'),
    getTemplate: (id: string) =>
      get<{ template: StoredTemplate }>(`/api/templates/${id}`),
    createTemplate: (data: Record<string, unknown>) =>
      post<{ template: StoredTemplate }>('/api/templates', data),
    updateTemplate: (id: string, data: Record<string, unknown>) =>
      $fetch<{ template: StoredTemplate }>(`${base}/api/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    deleteTemplate: (id: string) =>
      $fetch<{ success: boolean }>(`${base}/api/templates/${id}`, { method: 'DELETE' }),

    // Jobs
    getJobs: (status?: string) =>
      get<{ jobs: Job[]; stats: JobStats }>(`/api/jobs${status ? `?status=${status}` : ''}`),

    getJobDetail: (id: string) =>
      get<{ job: Job; logs: JobLog[] }>(`/api/jobs/${id}`),

    getJobStats: () =>
      get<JobStats>('/api/jobs/stats'),

    cancelJob: (id: string) =>
      post<{ success: boolean }>(`/api/jobs/${id}/cancel`),

    /**
     * Report the outcome of a job printed over local USB.
     * Without this the job stays in 'printing' forever.
     */
    reportJobResult: (id: string, success: boolean, error?: string) =>
      post<{ success: boolean; jobId: string; status: string }>(`/api/jobs/${id}/result`, {
        success,
        ...(error ? { error: error.slice(0, 500) } : {}),
      }),

    // Printer media configuration
    /**
     * Push media geometry to the printer (^PW / ^ML / ^MN, plus ^LL on
     * continuous stock). Omitted dimensions default to the configured label
     * size. With `target: 'local'` the ZPL is returned instead of printed.
     */
    configurePrinter: (data: {
      printerId?: string | null;
      widthDots?: number;
      heightDots?: number;
      dpi?: number;
      tracking?: MediaTracking;
      markOffset?: number;
      persist?: boolean;
      calibrate?: boolean;
      target?: PrintTargetName;
    }) =>
      post<{
        success: boolean;
        target: PrintTargetName;
        zpl?: string;
        error?: string;
        applied: {
          printerId: string | null;
          widthDots: number;
          heightDots: number;
          dpi: number;
          tracking: string;
          calibrated: boolean;
        };
      }>('/api/printer/configure', data),

    /** Run a media sensor calibration (~JC). The printer feeds 2–4 labels. */
    calibratePrinter: (options: { printerId?: string | null; target?: PrintTargetName } = {}) =>
      post<{ success: boolean; target: PrintTargetName; zpl?: string; message?: string; error?: string }>(
        '/api/printer/calibrate',
        options,
      ),

    // Debug
    getDebug: () =>
      get<DebugInfo>('/api/debug'),

    // Settings
    getSettings: () => get<Record<string, string>>('/api/settings'),
    updateSettings: (data: Record<string, string>) => $fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

    // Label size
    getLabelSize: () => get<{
      current: { widthInches: number; heightInches: number; widthDots: number; heightDots: number; name: string };
      recents: Array<{ widthInches: number; heightInches: number; widthDots: number; heightDots: number; name: string }>;
      standards: Array<{ widthInches: number; heightInches: number; widthDots: number; heightDots: number; name: string }>;
      dpi: number;
    }>('/api/label-size'),
    /**
     * Set the label size. The server also pushes the geometry to the connected
     * printer unless `applyToPrinter: false` — pass that when printing locally,
     * since the browser owns the USB connection in that case.
     */
    setLabelSize: (size: {
      widthDots: number;
      heightDots: number;
      name: string;
      applyToPrinter?: boolean;
      tracking?: MediaTracking;
    }) =>
      $fetch<{
        success: boolean;
        size: { widthInches: number; heightInches: number; widthDots: number; heightDots: number; name: string };
        printerConfig: { applied: boolean; error?: string };
      }>(`${base}/api/label-size`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(size),
      }),

    // Updates
    getVersion: () => get<{
      current: string;
      latest: string | null;
      updateAvailable: boolean;
      checkedAt: string | null;
      error: string | null;
      releaseUrl: string | null;
    }>("/api/version"),
    checkForUpdates: () =>
      post<{ current: string; latest: string | null; updateAvailable: boolean; releaseUrl: string | null }>("/api/update/check"),
    installUpdate: () =>
      post<{ success: boolean; message: string }>("/api/update/install"),
  };
}
