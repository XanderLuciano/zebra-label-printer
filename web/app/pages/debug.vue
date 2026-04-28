<script setup lang="ts">
const api = useApi();

const { data: debug, refresh } = useAsyncData('debug-page', () => api.getDebug());

// Auto-refresh
useIntervalFn(() => refresh(), 5000);

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

    <!-- Printer -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-printer" />
          <span class="font-medium">Printer</span>
        </div>
      </template>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm" v-if="debug?.printer">
        <div>
          <span class="text-gray-500">Name</span>
          <p class="font-medium">{{ debug.printer.name }}</p>
        </div>
        <div>
          <span class="text-gray-500">Status</span>
          <p>
            <span
              class="inline-block w-2 h-2 rounded-full mr-1"
              :class="debug.printer.isReady ? 'bg-green-500' : 'bg-red-500'"
            />
            {{ debug.printer.isReady ? 'Ready' : 'Not Ready' }}
          </p>
        </div>
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
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm" v-if="debug?.queue">
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
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm" v-if="debug?.database">
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
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm" v-if="debug?.server">
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
            :color="event.event_type === 'disconnected' ? 'red' : event.event_type === 'recovered' ? 'green' : 'gray'"
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
