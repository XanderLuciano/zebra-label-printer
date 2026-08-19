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
 * A template as the API returns it: the stored definition plus server metadata.
 *
 * Mirrors StoredTemplate in src/db/template-repo.ts. Previously these endpoints
 * were typed as `{ id, name, [k: string]: unknown }`, which meant callers had to
 * cast to LabelTemplate and lost any guarantee the layout fields were present.
 */
export interface StoredTemplate extends LabelTemplate {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** Where a label is printed: via the server's CUPS queue, or the browser's USB printer */
export type PrintTargetName = 'server' | 'local';

/** How the printer detects the top of each label (ZPL ^MN) */
export type MediaTracking = 'gap' | 'mark' | 'continuous' | 'auto';

export interface Job {
  id: string;
  status: JobStatus;
  job_type: JobType;
  request_data: string;
  zpl_commands: string | null;
  printer_name: string | null;
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
  printer: { name: string; isReady: boolean };
  queue: { pending: number; processorRunning: boolean };
  database: { path: string; sizeBytes: number; sizeFormatted: string; stats: JobStats };
  server: { uptime: number; memory: ProcessMemoryUsage; nodeVersion: string };
  printerEvents: PrinterEvent[];
}

export function useApi() {
  const config = useRuntimeConfig();
  // In production, apiBase is empty → use same-origin (relative paths).
  // In dev, set NUXT_PUBLIC_API_BASE=http://localhost:3420 to point at the backend.
  const base = config.public.apiBase as string || '';

  async function get<T>(path: string): Promise<T> {
    return $fetch<T>(`${base}${path}`);
  }

  async function post<T>(path: string, body?: unknown): Promise<T> {
    return $fetch<T>(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  return {
    // Health
    getHealth: () => get<{ status: string; printer: string | null }>('/api/health'),

    // Printers
    getPrinters: () => get<{ printers: Array<{ name: string; isZebra: boolean; status: string }> }>('/api/printers'),

    // Print — pass `target: 'local'` to get ZPL back for WebUSB instead of printing
    printText: (data: { lines: string[]; copies?: number; target?: PrintTargetName }) =>
      post<PrintResponse>('/api/print/text', data),

    printBarcode: (data: { data: string; type?: string; text?: string; target?: PrintTargetName }) =>
      post<PrintResponse>('/api/print/barcode', data),

    printQR: (data: { data: string; text?: string; magnification?: number; target?: PrintTargetName }) =>
      post<PrintResponse>('/api/print/qr', data),

    printZpl: (zpl: string, target?: PrintTargetName) =>
      post<PrintResponse>('/api/print/zpl', { zpl, ...(target ? { target } : {}) }),

    printLabel: (data: { elements: Array<Record<string, unknown>>; copies?: number; target?: PrintTargetName }) =>
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
        applied: { widthDots: number; heightDots: number; dpi: number; tracking: string; calibrated: boolean };
      }>('/api/printer/configure', data),

    /** Run a media sensor calibration (~JC). The printer feeds 2–4 labels. */
    calibratePrinter: (target?: PrintTargetName) =>
      post<{ success: boolean; target: PrintTargetName; zpl?: string; message?: string; error?: string }>(
        '/api/printer/calibrate',
        { ...(target ? { target } : {}) },
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
