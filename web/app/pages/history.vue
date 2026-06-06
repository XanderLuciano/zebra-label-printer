<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'

const api = useApi();

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')

const statusFilter = ref<string[]>([]);
const statusOptions = [
  { label: 'Pending', value: 'pending' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Cancelled', value: 'cancelled' },
];

// Fetch all jobs and label size for preview
const { data, refresh, status: fetchStatus } = useAsyncData('jobs', () => api.getJobs());
const { data: labelSize } = useAsyncData('label-size', () => api.getLabelSize());

const filteredJobs = computed(() => {
  const jobs = data.value?.jobs ?? [];
  if (statusFilter.value.length === 0) return jobs;
  return jobs.filter((j: any) => statusFilter.value.includes(j.status));
});

const statusColors: Record<string, string> = {
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

type PrintJob = {
  id: string;
  job_type: string;
  status: string;
  printer_name: string | null;
  request_data: string;
  zpl_commands: string | null;
  created_at: string;
};

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
        color: (statusColors[status] || 'neutral') as any,
        variant: 'subtle',
        size: 'xs'
      }, () => status);
    }
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
function getPreviewElements(job: PrintJob): Array<any> | null {
  if (job.job_type !== 'label') return null;
  try {
    const data = JSON.parse(job.request_data);
    return data.elements ?? null;
  } catch {
    return null;
  }
}

// For text/barcode/qr jobs, synthesize preview elements from request data
function synthesizeElements(job: PrintJob): Array<any> | null {
  try {
    const data = JSON.parse(job.request_data);
    switch (job.job_type) {
      case 'text': {
        const lines = data.lines as string[] ?? [];
        return lines.map((line: string, i: number) => ({
          type: 'text',
          content: line,
          options: { x: 20, y: 20 + i * 40, height: 30, width: 24 }
        }));
      }
      case 'qr':
        return [
          { type: 'qrcode', content: data.data, options: { x: 20, y: 20, magnification: data.magnification ?? 5 } },
          ...(data.text ? [{ type: 'text', content: data.text, options: { x: 20, y: 140, height: 20, width: 16 } }] : [])
        ];
      case 'barcode':
        return [
          { type: 'barcode', content: data.data, options: { x: 20, y: 20, type: data.type ?? 'CODE128', height: data.height ?? 80 } },
          ...(data.text ? [{ type: 'text', content: data.text, options: { x: 20, y: 120, height: 20, width: 16 } }] : [])
        ];
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function getElements(job: PrintJob): Array<any> | null {
  return getPreviewElements(job) ?? synthesizeElements(job);
}

// Reprint logic
const reprinting = ref<string | null>(null);
const reprintResult = ref<{ id: string; success: boolean; message: string } | null>(null);

async function reprint(job: PrintJob) {
  reprinting.value = job.id;
  reprintResult.value = null;

  try {
    const requestData = JSON.parse(job.request_data);

    let result: any;
    switch (job.job_type) {
      case 'text':
        result = await api.printText(requestData);
        break;
      case 'barcode':
        result = await api.printBarcode(requestData);
        break;
      case 'qr':
        result = await api.printQR(requestData);
        break;
      case 'zpl':
        result = await api.printZpl(requestData.zpl);
        break;
      case 'label':
        result = await api.printLabel(requestData);
        break;
      default:
        throw new Error(`Unknown job type: ${job.job_type}`);
    }

    reprintResult.value = { id: job.id, success: true, message: 'Reprinted successfully!' };
    refresh();
  } catch (err: any) {
    reprintResult.value = { id: job.id, success: false, message: err.message || 'Reprint failed' };
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
          <!-- Label Preview -->
          <div v-if="getElements(row.original)" class="shrink-0">
            <p class="text-xs text-gray-500 mb-1">Label Preview</p>
            <LabelPreview
              :elements="getElements(row.original)!"
              :width-dots="labelSize?.current?.widthDots ?? 406"
              :height-dots="labelSize?.current?.heightDots ?? 203"
              :dpi="labelSize?.dpi ?? 203"
              :max-width-px="300"
            />
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
