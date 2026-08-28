<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { PrintLabelElement } from '../composables/useTemplateEngine'
import type { Job } from '../composables/useApi'

const api = useApi();
const { printText, printBarcode, printQR, printZpl, printLabel, load: loadPrinters } = usePrintTarget();
const printers = usePrinters();

onMounted(loadPrinters);

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')

const statusFilter = ref<string[]>([]);
const statusOptions = [
  { label: 'Pending', value: 'pending' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Cancelled', value: 'cancelled' },
];

const { data, refresh, status: fetchStatus } = useAsyncData('jobs', () => api.getJobs());

const filteredJobs = computed(() => {
  const jobs = data.value?.jobs ?? [];
  if (statusFilter.value.length === 0) return jobs;
  return jobs.filter(j => statusFilter.value.includes(j.status));
});

type BadgeColor = 'warning' | 'info' | 'success' | 'error' | 'neutral';
const statusColors: Record<string, BadgeColor> = {
  pending: 'warning',
  printing: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral',
};

const jobTypeLabels: Record<string, string> = {
  text: 'Text',
  barcode: 'Barcode',
  qr: 'QR Code',
  zpl: 'Raw ZPL',
  label: 'Composed',
};

function formatDate(d: string) {
  if (!d) return '—';
  // SQLite datetime format: "YYYY-MM-DD HH:MM:SS" — needs T separator for Date parsing
  const normalized = d.includes('T') ? d : d.replace(' ', 'T');
  const date = new Date(normalized + (normalized.endsWith('Z') ? '' : 'Z'));
  if (isNaN(date.getTime())) return d; // Fallback to raw string if still invalid
  return date.toLocaleString();
}

/**
 * The job shape this table renders.
 *
 * Aliased to the API's `Job` rather than redeclared: the local copy had already
 * drifted once (it was missing `printer_id`), and every field this page reads
 * comes off the wire anyway.
 */
type PrintJob = Job;

const columns: TableColumn<PrintJob>[] = [
  {
    id: 'expand',
    cell: ({ row }) =>
      h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        icon: 'i-lucide-chevron-down',
        size: 'xs',
        square: true,
        'aria-label': 'Expand',
        ui: {
          leadingIcon: [
            'transition-transform',
            row.getIsExpanded() ? 'duration-200 rotate-180' : ''
          ]
        },
        onClick: () => row.toggleExpanded()
      })
  },
  {
    accessorKey: 'id',
    header: 'Job ID',
    cell: ({ row }) => {
      const id = row.getValue('id') as string;
      return id.slice(0, 16) + '...';
    },
    meta: { class: { td: 'font-mono text-xs text-gray-500' } }
  },
  {
    accessorKey: 'job_type',
    header: 'Type',
    cell: ({ row }) => {
      const type = row.getValue('job_type') as string;
      return h(UBadge, { variant: 'soft', size: 'xs' }, () => jobTypeLabels[type] ?? type);
    }
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = row.getValue('status') as string;
      return h(UBadge, {
        color: statusColors[status] || 'neutral',
        variant: 'subtle',
        size: 'xs'
      }, () => status);
    }
  },
  {
    id: 'printer',
    header: 'Printer',
    cell: ({ row }) => jobPrinterName(row.original),
    meta: { class: { td: 'text-sm text-gray-500 whitespace-nowrap max-w-[14rem] truncate' } }
  },
  {
    id: 'label_size',
    header: 'Label',
    cell: ({ row }) => {
      const job = row.original;
      if (!job.label_width_dots || !job.label_height_dots) {
        return h('span', { class: 'text-gray-400' }, '—');
      }
      return formatLabelSize(job);
    },
    meta: { class: { td: 'text-sm text-gray-500 font-mono whitespace-nowrap' } }
  },
  {
    accessorKey: 'created_at',
    header: 'Created',
    cell: ({ row }) => {
      const d = row.getValue('created_at') as string;
      return d ? formatDate(d) : '—';
    },
    meta: { class: { td: 'text-sm text-gray-500' } }
  },
  {
    id: 'actions',
    header: '',
  }
];

// Parse elements from request_data for label preview
function getPreviewElements(job: PrintJob): PrintLabelElement[] | null {
  if (job.job_type !== 'label') return null;
  try {
    const data = JSON.parse(job.request_data);
    return (data.elements as PrintLabelElement[] | undefined) ?? null;
  } catch {
    return null;
  }
}

// For text/barcode/qr jobs, synthesize preview elements from request data.
// These layouts mirror the convenience builders in src/zpl.ts, so they're an
// approximation of the print, not a faithful reproduction.
function synthesizeElements(job: PrintJob): PrintLabelElement[] | null {
  try {
    const data = JSON.parse(job.request_data);
    switch (job.job_type) {
      case 'text': {
        const lines = (data.lines as string[] | undefined) ?? [];
        return lines.map((line: string, i: number) => ({
          type: 'text',
          content: line,
          options: { x: 20, y: 20 + i * 40, height: 30, width: 24 },
        }));
      }
      case 'qr':
        return [
          { type: 'qrcode', content: data.data, options: { x: 20, y: 20, magnification: data.magnification ?? 5 } },
          ...(data.text ? [{ type: 'text' as const, content: data.text, options: { x: 20, y: 140, height: 20, width: 16 } }] : []),
        ];
      case 'barcode':
        return [
          { type: 'barcode', content: data.data, options: { x: 20, y: 20, type: data.type ?? 'CODE128', height: data.height ?? 80 } },
          ...(data.text ? [{ type: 'text' as const, content: data.text, options: { x: 20, y: 120, height: 20, width: 16 } }] : []),
        ];
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function getElements(job: PrintJob): PrintLabelElement[] | null {
  return getPreviewElements(job) ?? synthesizeElements(job);
}

/**
 * Label geometry to preview a job at.
 *
 * Uses the size recorded on the job, not the current setting. Print history is
 * a record of what came out of the printer — if you switch to 4×6" stock, a job
 * printed last week on 2×1" labels was still printed on 2×1" labels, and
 * redrawing it at the new size misrepresents it.
 *
 * Jobs created before the snapshot columns existed have no recorded size. Those
 * fall back to the configuration of the printer the job went to — a better guess
 * than a single global size, which with several printers set up would be wrong for
 * most of them — and are flagged in the UI so it's clear the dimensions are
 * inferred.
 */
function jobLabelSize(job: PrintJob) {
  const printer = printers.get(job.printer_id);

  if (job.label_width_dots && job.label_height_dots) {
    return {
      widthDots: job.label_width_dots,
      heightDots: job.label_height_dots,
      dpi: job.label_dpi ?? printer?.dpi ?? 203,
      recorded: true,
    };
  }

  return {
    widthDots: printer?.labelSize.widthDots ?? 609,
    heightDots: printer?.labelSize.heightDots ?? 1015,
    dpi: printer?.dpi ?? 203,
    recorded: false,
  };
}

/** The printer a job went to, for display. Falls back to the recorded name. */
function jobPrinterName(job: PrintJob): string {
  return printers.get(job.printer_id)?.name ?? job.printer_name ?? '—';
}

/** Human-readable label size for the history row, e.g. `2 × 1" (406×203)` */
function formatLabelSize(job: PrintJob): string {
  const { widthDots, heightDots, dpi, recorded } = jobLabelSize(job);
  const w = (widthDots / dpi).toFixed(2).replace(/\.?0+$/, '');
  const h = (heightDots / dpi).toFixed(2).replace(/\.?0+$/, '');
  return `${w} × ${h}"${recorded ? '' : ' (not recorded)'}`;
}

// Reprint logic
const reprinting = ref<string | null>(null);
const reprintResult = ref<{ id: string; success: boolean; message: string } | null>(null);

async function reprint(job: PrintJob) {
  reprinting.value = job.id;
  reprintResult.value = null;

  try {
    const requestData = JSON.parse(job.request_data);
    // Strip the original target: a reprint goes wherever this browser is
    // currently pointed, not wherever the original job went.
    delete requestData.target;

    let result;
    switch (job.job_type) {
      case 'text':
        result = await printText(requestData);
        break;
      case 'barcode':
        result = await printBarcode(requestData);
        break;
      case 'qr':
        result = await printQR(requestData);
        break;
      case 'zpl':
        result = await printZpl(requestData.zpl);
        break;
      case 'label':
        result = await printLabel(requestData);
        break;
      default:
        throw new Error(`Unknown job type: ${job.job_type}`);
    }

    reprintResult.value = result.success
      ? { id: job.id, success: true, message: result.target === 'local' ? 'Sent to local USB printer' : 'Reprint queued' }
      : { id: job.id, success: false, message: result.error || 'Reprint failed' };
    refresh();
  } catch (err) {
    reprintResult.value = { id: job.id, success: false, message: (err as Error).message || 'Reprint failed' };
  } finally {
    reprinting.value = null;
  }
}

const expanded = ref<Record<string, boolean>>({});
</script>

<template>
  <div class="p-6 space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Print History</h1>
      <div class="flex items-center gap-3">
        <USelectMenu
          v-model="statusFilter"
          :items="statusOptions"
          value-key="value"
          multiple
          placeholder="Filter by status"
          size="sm"
          class="w-56"
        />
        <UButton icon="i-lucide-refresh-cw" variant="ghost" size="sm" @click="refresh()" />
      </div>
    </div>

    <UTable
      v-model:expanded="expanded"
      :data="filteredJobs"
      :columns="columns"
      :loading="fetchStatus === 'pending'"
      :ui="{ tr: 'data-[expanded=true]:bg-elevated/50' }"
    >
      <template #actions-cell="{ row }">
        <div class="flex items-center gap-2">
          <UButton
            icon="i-lucide-printer"
            label="Reprint"
            size="xs"
            variant="soft"
            color="primary"
            :loading="reprinting === row.original.id"
            @click="reprint(row.original)"
          />
        </div>
      </template>

      <template #expanded="{ row }">
        <div class="p-4 flex gap-6 items-start">
          <!-- Label Preview — rendered at the size recorded on the job -->
          <div v-if="getElements(row.original)" class="shrink-0">
            <p class="text-xs text-gray-500 mb-1">
              Label Preview
              <span class="ml-1 font-mono">{{ formatLabelSize(row.original) }}</span>
            </p>
            <LabelPreview
              :elements="getElements(row.original)!"
              :width-dots="jobLabelSize(row.original).widthDots"
              :height-dots="jobLabelSize(row.original).heightDots"
              :dpi="jobLabelSize(row.original).dpi"
              :max-width-px="300"
            />
            <p v-if="!jobLabelSize(row.original).recorded" class="text-xs text-amber-600 dark:text-amber-400 mt-1 max-w-[300px]">
              This job has no recorded label size, so the preview uses its printer's current configuration.
            </p>
          </div>
          <div v-else class="text-sm text-gray-500 italic">
            No preview available for raw ZPL jobs.
          </div>

          <!-- Request data -->
          <div class="flex-1 min-w-0">
            <p class="text-xs text-gray-500 mb-1">Request Data</p>
            <pre class="text-xs bg-gray-50 dark:bg-gray-900 p-3 rounded overflow-x-auto max-h-48">{{ JSON.stringify(JSON.parse(row.original.request_data), null, 2) }}</pre>
          </div>
        </div>
      </template>
    </UTable>

    <!-- Reprint toast -->
    <div v-if="reprintResult" class="fixed bottom-6 right-6 z-50">
      <UAlert
        :title="reprintResult.success ? 'Reprint Queued' : 'Reprint Failed'"
        :description="reprintResult.message"
        :color="reprintResult.success ? 'success' : 'error'"
        :icon="reprintResult.success ? 'i-lucide-check-circle' : 'i-lucide-x-circle'"
        :close-button="{ onClick: () => { reprintResult = null } }"
      />
    </div>

    <div v-if="data?.stats" class="flex gap-6 text-sm text-gray-500">
      <span>Total: <strong>{{ data.stats.total }}</strong></span>
      <span>Pending: <strong class="text-amber-500">{{ data.stats.pending }}</strong></span>
      <span>Completed: <strong class="text-green-500">{{ data.stats.completed }}</strong></span>
      <span>Failed: <strong class="text-red-500">{{ data.stats.failed }}</strong></span>
    </div>
  </div>
</template>
