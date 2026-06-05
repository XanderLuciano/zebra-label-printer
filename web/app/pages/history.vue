<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'

const api = useApi();

const UBadge = resolveComponent('UBadge')

const statusFilter = ref<string[]>([]);
const statusOptions = [
  { label: 'Pending', value: 'pending' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Cancelled', value: 'cancelled' },
];

// Fetch all jobs, then filter client-side for multi-select
const { data, refresh, status: fetchStatus } = useAsyncData('jobs', () => api.getJobs());

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
  return new Date(d + 'Z').toLocaleString();
}

type PrintJob = {
  id: string;
  job_type: string;
  status: string;
  printer_name: string | null;
  request_data: string;
  created_at: string;
};

const columns: TableColumn<PrintJob>[] = [
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
    accessorKey: 'printer_name',
    header: 'Printer',
    cell: ({ row }) => row.getValue('printer_name') || '—'
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
      :data="filteredJobs"
      :columns="columns"
      :loading="fetchStatus === 'pending'"
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
