<script setup lang="ts">
const api = useApi();

const { data: settings, refresh: refreshSettings } = useAsyncData('settings', () => api.getSettings());

// Printer selection and per-printer configuration live in <PrinterManager>. They
// used to be four cards here driving a single global label size, which could only
// ever describe one printer.

// Version / updates
const { data: version, refresh: refreshVersion } = useAsyncData("version", () => api.getVersion());
const checking = ref(false);
const updateError = ref("");

const autoUpdate = computed(() => {
  return (settings.value?.["auto_update_check"] ?? "true") === "true";
});

async function manualCheck() {
  checking.value = true;
  updateError.value = "";
  try {
    await api.checkForUpdates();
    await refreshVersion();
  } catch (err) {
    updateError.value = (err as Error).message || "Check failed";
  } finally {
    checking.value = false;
  }
}
// Settings form
const form = reactive({
  apiKey: '',
  queueCheckIntervalMs: '5000',
});

watchEffect(() => {
  if (settings.value) {
    form.apiKey = settings.value['api_key'] || '';
    form.queueCheckIntervalMs = settings.value['queue_check_interval_ms'] || '5000';
  }
});

const saving = ref(false);
const saved = ref(false);

async function save() {
  saving.value = true;
  saved.value = false;
  try {
    await api.updateSettings({
      api_key: form.apiKey,
      queue_check_interval_ms: form.queueCheckIntervalMs,
    });
    saved.value = true;
    refreshSettings();
    setTimeout(() => { saved.value = false; }, 2000);
  } finally {
    saving.value = false;
  }
}

</script>

<template>
  <div class="p-6 space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Settings</h1>
      <UButton
        label="Save"
        icon="i-lucide-save"
        color="primary"
        :loading="saving"
        @click="save"
      />
    </div>

    <!-- Printers: selection plus per-printer label stock and media config -->
    <PrinterManager />

    <!-- Queue -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-timer" />
          <span class="font-medium">Queue</span>
        </div>
      </template>
      <div class="max-w-lg">
        <UFormField label="Check Interval (ms)">
          <UInput v-model="form.queueCheckIntervalMs" type="number" />
          <template #help>
            How often the queue processor polls for printer availability and pending jobs.
          </template>
        </UFormField>
      </div>
    </UCard>

    <!-- Security -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-shield" />
          <span class="font-medium">Security</span>
        </div>
      </template>
      <div class="max-w-lg">
        <UFormField label="API Key">
          <UInput v-model="form.apiKey" type="password" placeholder="Leave empty for no auth" />
        </UFormField>
      </div>
    </UCard>

    <!-- API Docs -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-book-open" />
          <span class="font-medium">API Documentation</span>
        </div>
      </template>
      <p class="text-sm text-gray-500 mb-3">
        Interactive OpenAPI docs with request/response examples for every endpoint.
      </p>
      <UButton
        label="Open API Docs"
        icon="i-lucide-external-link"
        variant="outline"
        :to="`${useRuntimeConfig().public.apiBase}/api/docs`"
        target="_blank"
      />
    </UCard>

    <!-- Updates -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-refresh-cw" />
          <span class="font-medium">Updates</span>
          <UBadge v-if="version?.updateAvailable" variant="subtle" color="warning" size="xs">
            v{{ version.latest }} available
          </UBadge>
          <UBadge v-else-if="version?.latest" variant="subtle" color="success" size="xs">
            Up to date
          </UBadge>
        </div>
      </template>

      <div class="space-y-3 max-w-lg">
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span class="text-gray-500">Current</span>
            <p class="font-medium">v{{ version?.current || '...' }}</p>
          </div>
          <div>
            <span class="text-gray-500">Latest</span>
            <p class="font-medium">{{ version?.latest ? `v${version.latest}` : '...' }}</p>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <UButton
            label="Check for Updates"
            icon="i-lucide-search"
            variant="outline"
            size="sm"
            :loading="checking"
            @click="manualCheck"
          />
          <UButton
            v-if="version?.updateAvailable && version?.releaseUrl"
            label="View Release"
            icon="i-lucide-external-link"
            variant="outline"
            size="sm"
            :to="version.releaseUrl"
            target="_blank"
          />
        </div>

        <p class="text-xs text-gray-500">
          Auto-check: {{ autoUpdate ? 'Daily' : 'Disabled' }} &middot;
          Last checked: {{ version?.checkedAt ? new Date(version.checkedAt).toLocaleString() : 'Never' }}
        </p>

        <div v-if="updateError" class="text-sm text-red-500">{{ updateError }}</div>
      </div>
    </UCard>

    <!-- Toast -->
    <div v-if="saved" class="fixed bottom-6 right-6 z-50">
      <UAlert
        title="Settings saved"
        color="success"
        variant="soft"
        icon="i-lucide-check-circle"
        :close-button="{ onClick: () => { saved = false } }"
      />
    </div>
  </div>
</template>
