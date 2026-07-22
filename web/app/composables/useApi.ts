/**
 * API client composable — wraps $fetch with the webhook API base URL.
 *
 * Usage:
 *   const api = useApi()
 *   const { data } = await api.getHealth()
 *   await api.printText({ lines: ['Hello'] })
 */

export type JobStatus = 'pending' | 'printing' | 'completed' | 'failed' | 'cancelled';
export type JobType = 'text' | 'barcode' | 'qr' | 'zpl' | 'label';

export interface Job {
  id: string;
  status: JobStatus;
  job_type: JobType;
  request_data: string;
  zpl_commands: string | null;
  printer_name: string | null;
  cups_job_id: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  priority: number;
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

export interface DebugInfo {
  printer: { name: string; isReady: boolean };
  queue: { pending: number; processorRunning: boolean };
  database: { path: string; sizeBytes: number; sizeFormatted: string; stats: JobStats };
  server: { uptime: number; memory: Record<string, number>; nodeVersion: string };
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

    // Print
    printText: (data: { lines: string[]; copies?: number }) =>
      post<{ success: boolean; jobId: string; queued: boolean }>('/api/print/text', data),

    printBarcode: (data: { data: string; type?: string; text?: string }) =>
      post<{ success: boolean; jobId: string; queued: boolean }>('/api/print/barcode', data),

    printQR: (data: { data: string; text?: string; magnification?: number }) =>
      post<{ success: boolean; jobId: string; queued: boolean }>('/api/print/qr', data),

    printZpl: (zpl: string) =>
      post<{ success: boolean; jobId: string; queued: boolean }>('/api/print/zpl', { zpl }),

    printLabel: (data: { elements: Array<Record<string, unknown>>; copies?: number }) =>
      post<{ success: boolean; jobId: string; queued: boolean }>('/api/print/label', data),

    // Render (build ZPL without printing — for accurate previews)
    renderZpl: (data: { elements: Array<Record<string, unknown>>; copies?: number; widthDots?: number; heightDots?: number }) =>
      post<{ zpl: string; widthDots: number; heightDots: number }>('/api/render/zpl', data),

    // Templates
    listTemplates: () =>
      get<{ templates: Array<{ id: string; name: string; [k: string]: unknown }> }>('/api/templates'),
    getTemplate: (id: string) =>
      get<{ template: { id: string; name: string; [k: string]: unknown } }>(`/api/templates/${id}`),
    createTemplate: (data: Record<string, unknown>) =>
      post<{ template: { id: string; name: string; [k: string]: unknown } }>('/api/templates', data),
    updateTemplate: (id: string, data: Record<string, unknown>) =>
      $fetch<{ template: { id: string; name: string; [k: string]: unknown } }>(`${base}/api/templates/${id}`, {
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
    setLabelSize: (size: { widthDots: number; heightDots: number; name: string }) =>
      $fetch(`${base}/api/label-size`, {
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
