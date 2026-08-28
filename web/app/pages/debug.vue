<script setup lang="ts">
const api = useApi();

const { data: debug, refresh } = useAsyncData('debug-page', () => api.getDebug());

// Poll while the page is open. Plain setInterval rather than VueUse's
// useIntervalFn: VueUse is only present as a transitive dependency of @nuxt/ui
// and @vueuse/nuxt isn't registered, so useIntervalFn was never auto-imported
// and threw a ReferenceError here, taking the whole page down with it.
let pollInterval: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  pollInterval = setInterval(() => refresh(), 5000);
});
onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval);
});

const formatBytes = (b: number) => b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`;
const formatUptime = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
};
</script>

<template>
  <div class="p-6 space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Debug</h1>
      <UButton icon="i-lucide-refresh-cw" variant="ghost" size="sm" @click="refresh()" />
    </div>

    <!-- Printers configured on the server, with each one's own media config -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-printer" />
          <span class="font-medium">Server Printers</span>
          <UBadge variant="subtle" size="xs" color="neutral">
            {{ debug?.printers?.length ?? 0 }}
          </UBadge>
        </div>
      </template>

      <div v-if="debug?.printers?.length" class="space-y-3">
        <div
          v-for="printer in debug.printers"
          :key="printer.id"
          class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm border-b last:border-0 pb-3 last:pb-0"
        >
          <div>
            <span class="text-gray-500">Name</span>
            <p class="font-medium flex items-center gap-1.5">
              {{ printer.name }}
              <UBadge v-if="printer.isDefault" variant="subtle" size="xs" color="primary">default</UBadge>
            </p>
            <p class="text-xs text-gray-500 font-mono truncate">{{ printer.cupsName ?? printer.transport }}</p>
          </div>
          <div>
            <span class="text-gray-500">Label</span>
            <p>{{ printer.labelSize.name }}</p>
            <p class="text-xs text-gray-500 font-mono">
              {{ printer.labelSize.widthDots }}×{{ printer.labelSize.heightDots }} @ {{ printer.dpi }}
            </p>
          </div>
          <div>
            <span class="text-gray-500">Tracking</span>
            <p>{{ printer.tracking }}</p>
          </div>
          <div>
            <span class="text-gray-500">Pending</span>
            <p class="font-medium">{{ printer.pending }}</p>
          </div>
        </div>
      </div>

      <p v-else class="text-sm text-gray-500">
        No printers configured on the server. Browser-attached USB printers are configured
        per browser and don't appear here.
      </p>

      <div v-if="debug?.printer" class="text-sm mt-4 pt-3 border-t">
        <span class="text-gray-500">Default printer connection</span>
        <p>
          <span
            class="inline-block w-2 h-2 rounded-full mr-1"
            :class="debug.printer.isReady ? 'bg-green-500' : 'bg-red-500'"
          />
          {{ debug.printer.name ?? 'None' }} &middot; {{ debug.printer.isReady ? 'Ready' : 'Not ready' }}
        </p>
      </div>
    </UCard>

    <!-- Queue -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-list-ordered" />
          <span class="font-medium">Queue</span>
        </div>
      </template>
      <div v-if="debug?.queue" class="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
        <div>
          <span class="text-gray-500">Pending</span>
          <p class="font-medium">{{ debug.queue.pending }}</p>
        </div>
        <div>
          <span class="text-gray-500">Processor</span>
          <p>
            <span
              class="inline-block w-2 h-2 rounded-full mr-1"
              :class="debug.queue.processorRunning ? 'bg-green-500' : 'bg-gray-400'"
            />
            {{ debug.queue.processorRunning ? 'Running' : 'Stopped' }}
          </p>
        </div>
      </div>
    </UCard>

    <!-- Database -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-database" />
          <span class="font-medium">Database</span>
        </div>
      </template>
      <div v-if="debug?.database" class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div>
          <span class="text-gray-500">Size</span>
          <p class="font-medium">{{ debug.database.sizeFormatted }}</p>
        </div>
        <div>
          <span class="text-gray-500">Total Jobs</span>
          <p class="font-medium">{{ debug.database.stats.total }}</p>
        </div>
        <div>
          <span class="text-gray-500">Completed</span>
          <p class="font-medium text-green-500">{{ debug.database.stats.completed }}</p>
        </div>
        <div>
          <span class="text-gray-500">Failed</span>
          <p class="font-medium text-red-500">{{ debug.database.stats.failed }}</p>
        </div>
      </div>
    </UCard>

    <!-- Server -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-server" />
          <span class="font-medium">Server</span>
        </div>
      </template>
      <div v-if="debug?.server" class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div>
          <span class="text-gray-500">Uptime</span>
          <p class="font-medium">{{ formatUptime(debug.server.uptime) }}</p>
        </div>
        <div>
          <span class="text-gray-500">Memory (RSS)</span>
          <p class="font-medium">{{ formatBytes(debug.server.memory.rss) }}</p>
        </div>
        <div>
          <span class="text-gray-500">Heap Used</span>
          <p class="font-medium">{{ formatBytes(debug.server.memory.heapUsed) }}</p>
        </div>
        <div>
          <span class="text-gray-500">Node.js</span>
          <p class="font-medium font-mono">{{ debug.server.nodeVersion }}</p>
        </div>
      </div>
    </UCard>

    <!-- Printer Events -->
    <UCard v-if="debug?.printerEvents?.length">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-activity" />
          <span class="font-medium">Printer Events</span>
        </div>
      </template>
      <div class="space-y-1 max-h-60 overflow-y-auto">
        <div
          v-for="event in debug.printerEvents"
          :key="event.id"
          class="flex gap-3 text-xs py-1"
        >
          <span class="text-gray-400 font-mono w-20 shrink-0">{{ new Date(event.created_at + 'Z').toLocaleTimeString() }}</span>
          <UBadge
            :color="event.event_type === 'disconnected' ? 'error' : event.event_type === 'recovered' ? 'success' : 'neutral'"
            variant="subtle"
            size="xs"
          >
            {{ event.event_type }}
          </UBadge>
          <span class="text-gray-500">{{ event.message || '' }}</span>
        </div>
      </div>
    </UCard>
  </div>
</template>
