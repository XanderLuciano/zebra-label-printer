<script setup lang="ts">
const api = useApi();

const statusFilter = ref('pending');
const { data, refresh } = useAsyncData('queue-jobs', () =>
  api.getJobs(statusFilter.value || undefined),
);

watch(statusFilter, () => refresh());

// Auto-refresh
const { pause, resume } = useIntervalFn(() => {
  refresh();
}, 5000);

onUnmounted(pause);

// Job detail
const selectedJobId = ref(useRoute().query.job as string || '');
const { data: jobDetail } = useAsyncData(
  () => `job-detail-${selectedJobId.value}`,
  () => selectedJobId.value ? api.getJobDetail(selectedJobId.value) : Promise.resolve(null),
  { watch: [selectedJobId] },
);

async function cancelJob(id: string) {
  await api.cancelJob(id);
  refresh();
}

const statusColors: Record<string, string> = {
  pending: 'amber',
  printing: 'blue',
  completed: 'green',
  failed: 'red',
  cancelled: 'gray',
};

function formatDate(d: string) {
  return new Date(d + 'Z').toLocaleString();
}
</script>

<template>
  <div class="p-6 space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Print Queue</h1>
      <div class="flex items-center gap-3">
        <USelect
          v-model="statusFilter"
          :items="[
            { label: 'Pending', value: 'pending' },
            { label: 'Printing', value: 'printing' },
            { label: 'All', value: '' },
          ]"
          size="sm"
        />
        <UButton icon="i-lucide-refresh-cw" variant="ghost" size="sm" @click="refresh()" />
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Job list -->
      <UCard>
        <template #header>
          <span class="font-medium">Jobs</span>
        </template>

        <div v-if="!data?.jobs?.length" class="text-center py-8 text-gray-500">
          <UIcon name="i-lucide-inbox" class="text-4xl mb-2" />
          <p>No {{ statusFilter || 'pending' }} jobs</p>
        </div>

        <div v-else class="space-y-2 max-h-[60vh] overflow-y-auto">
          <div
            v-for="job in data.jobs"
            :key="job.id"
            class="p-3 rounded-lg border cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            :class="selectedJobId === job.id ? 'border-primary-500 bg-primary-50 dark:bg-primary-950' : 'border-gray-200 dark:border-gray-700'"
            @click="selectedJobId = job.id"
          >
            <div class="flex items-center justify-between">
              <div>
                <UBadge :color="statusColors[job.status] as any" variant="subtle" size="xs" class="mb-1">
                  {{ job.status }}
                </UBadge>
                <p class="text-sm font-mono text-gray-400">{{ job.id.slice(-8) }}</p>
              </div>
              <div class="text-right text-sm text-gray-500">
                <p>{{ job.job_type }}</p>
                <p>{{ formatDate(job.created_at) }}</p>
              </div>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Job detail -->
      <UCard v-if="jobDetail?.job">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-medium">Job Detail</span>
            <UButton
              v-if="jobDetail.job.status === 'pending'"
              label="Cancel"
              color="red"
              variant="outline"
              size="xs"
              @click="cancelJob(jobDetail.job.id)"
            />
          </div>
        </template>

        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span class="text-gray-500">Status</span>
              <p><UBadge :color="statusColors[jobDetail.job.status] as any" variant="subtle" size="xs">{{ jobDetail.job.status }}</UBadge></p>
            </div>
            <div>
              <span class="text-gray-500">Type</span>
              <p class="font-medium">{{ jobDetail.job.job_type }}</p>
            </div>
            <div>
              <span class="text-gray-500">Printer</span>
              <p class="font-medium">{{ jobDetail.job.printer_name || '—' }}</p>
            </div>
            <div>
              <span class="text-gray-500">CUPS Job</span>
              <p class="font-medium font-mono text-xs">{{ jobDetail.job.cups_job_id || '—' }}</p>
            </div>
            <div>
              <span class="text-gray-500">Created</span>
              <p class="font-medium">{{ formatDate(jobDetail.job.created_at) }}</p>
            </div>
            <div>
              <span class="text-gray-500">Completed</span>
              <p class="font-medium">{{ jobDetail.job.completed_at ? formatDate(jobDetail.job.completed_at) : '—' }}</p>
            </div>
          </div>

          <div v-if="jobDetail.job.error_message" class="p-3 rounded bg-red-50 dark:bg-red-950 text-red-600 text-sm">
            {{ jobDetail.job.error_message }}
          </div>

          <div v-if="jobDetail.job.zpl_commands">
            <span class="text-sm text-gray-500">ZPL Commands</span>
            <pre class="mt-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-x-auto max-h-40">{{ jobDetail.job.zpl_commands }}</pre>
          </div>

          <!-- Log entries -->
          <div v-if="jobDetail.logs?.length">
            <span class="text-sm text-gray-500">Event Log</span>
            <div class="mt-1 space-y-1 max-h-40 overflow-y-auto">
              <div
                v-for="log in jobDetail.logs"
                :key="log.id"
                class="flex gap-2 text-xs"
                :class="{
                  'text-red-600': log.level === 'error',
                  'text-amber-600': log.level === 'warn',
                }"
              >
                <span class="text-gray-400 font-mono">{{ formatDate(log.created_at) }}</span>
                <span>[{{ log.level }}]</span>
                <span>{{ log.message }}</span>
              </div>
            </div>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
