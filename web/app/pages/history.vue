<script setup lang="ts">
const api = useApi();

const statusFilter = ref('');
const { data, refresh } = useAsyncData('jobs', () => api.getJobs(statusFilter.value || undefined));

watch(statusFilter, () => refresh());

const statusColors: Record<string, string> = {
  pending: 'amber',
  printing: 'blue',
  completed: 'green',
  failed: 'red',
  cancelled: 'gray',
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

const columns = [
  { key: 'id', label: 'Job ID' },
  { key: 'job_type', label: 'Type' },
  { key: 'status', label: 'Status' },
  { key: 'printer_name', label: 'Printer' },
  { key: 'created_at', label: 'Created' },
  { key: 'actions', label: '' },
];
</script>

<template>
  <div class="p-6 space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Print History</h1>
      <div class="flex items-center gap-3">
        <USelect
          v-model="statusFilter"
          :items="[
            { label: 'All', value: '' },
            { label: 'Pending', value: 'pending' },
            { label: 'Completed', value: 'completed' },
            { label: 'Failed', value: 'failed' },
            { label: 'Cancelled', value: 'cancelled' },
          ]"
          placeholder="Filter by status"
          size="sm"
        />
        <UButton icon="i-lucide-refresh-cw" variant="ghost" size="sm" @click="refresh()" />
      </div>
    </div>

    <UTable
      :rows="data?.jobs ?? []"
      :columns="columns"
    >
      <template #id-data="{ row }">
        <span class="text-xs font-mono text-gray-500">{{ row.id.slice(0, 12) }}...</span>
      </template>

      <template #job_type-data="{ row }">
        <UBadge variant="soft" size="xs">{{ jobTypeLabels[row.job_type] ?? row.job_type }}</UBadge>
      </template>

      <template #status-data="{ row }">
        <UBadge :color="statusColors[row.status] as any" variant="subtle" size="xs">
          {{ row.status }}
        </UBadge>
      </template>

      <template #created_at-data="{ row }">
        <span class="text-sm text-gray-500">{{ formatDate(row.created_at) }}</span>
      </template>

      <template #actions-data="{ row }">
        <NuxtLink :to="`/queue?job=${row.id}`">
          <UButton icon="i-lucide-eye" variant="ghost" size="xs" />
        </NuxtLink>
      </template>
    </UTable>

    <div v-if="data?.stats" class="flex gap-6 text-sm text-gray-500">
      <span>Total: <strong>{{ data.stats.total }}</strong></span>
      <span>Pending: <strong class="text-amber-500">{{ data.stats.pending }}</strong></span>
      <span>Completed: <strong class="text-green-500">{{ data.stats.completed }}</strong></span>
      <span>Failed: <strong class="text-red-500">{{ data.stats.failed }}</strong></span>
    </div>
  </div>
</template>
