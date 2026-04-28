/**
 * API client composable — wraps $fetch with the webhook API base URL.
 *
 * Usage:
 *   const api = useApi()
 *   const { data } = await api.getHealth()
 *   await api.printText({ lines: ['Hello'] })
 */

const API_BASE = 'http://localhost:3420';

export function useApi() {
  const config = useRuntimeConfig();
  const base = config.public.apiBase as string || API_BASE;

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

    // Jobs
    getJobs: (status?: string) =>
      get<{ jobs: any[]; stats: any }>(`/api/jobs${status ? `?status=${status}` : ''}`),

    getJobDetail: (id: string) =>
      get<{ job: any; logs: any[] }>(`/api/jobs/${id}`),

    getJobStats: () =>
      get<{ total: number; pending: number; completed: number; failed: number; cancelled: number }>('/api/jobs/stats'),

    cancelJob: (id: string) =>
      post<{ success: boolean }>(`/api/jobs/${id}/cancel`),

    // Debug
    getDebug: () =>
      get<{ printer: any; queue: any; database: any; server: any; printerEvents: any[] }>('/api/debug'),

    // Settings
    getSettings: () => get<Record<string, string>>('/api/settings'),
    updateSettings: (data: Record<string, string>) => $fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  };
}
