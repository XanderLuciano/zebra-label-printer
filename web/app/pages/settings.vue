<script setup lang="ts">
const api = useApi();

const { data: settings, refresh } = useAsyncData('settings', () => api.getSettings());

const form = reactive({
  apiKey: settings.value?.['api_key'] || '',
  defaultLabelWidth: settings.value?.['default_label_width'] || '3',
  defaultLabelHeight: settings.value?.['default_label_height'] || '5',
  queueCheckIntervalMs: settings.value?.['queue_check_interval_ms'] || '5000',
});

watchEffect(() => {
  if (settings.value) {
    form.apiKey = settings.value['api_key'] || '';
    form.defaultLabelWidth = settings.value['default_label_width'] || '3';
    form.defaultLabelHeight = settings.value['default_label_height'] || '5';
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
      default_label_width: form.defaultLabelWidth,
      default_label_height: form.defaultLabelHeight,
      queue_check_interval_ms: form.queueCheckIntervalMs,
    });
    saved.value = true;
    refresh();
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

    <UCard>
      <template #header>
        <span class="font-medium">Printer Configuration</span>
      </template>
      <div class="space-y-4 max-w-lg">
        <UFormGroup label="Default Label Width (inches)">
          <USelect
            v-model="form.defaultLabelWidth"
            :items="[
              { label: '2 inch', value: '2' },
              { label: '3 inch', value: '3' },
              { label: '4 inch', value: '4' },
            ]"
          />
        </UFormGroup>

        <UFormGroup label="Default Label Height (inches)">
          <USelect
            v-model="form.defaultLabelHeight"
            :items="[
              { label: '1 inch', value: '1' },
              { label: '2 inch', value: '2' },
              { label: '3 inch', value: '3' },
              { label: '5 inch', value: '5' },
            ]"
          />
        </UFormGroup>

        <UFormGroup label="Queue Check Interval (ms)">
          <UInput v-model="form.queueCheckIntervalMs" type="number" />
          <template #help>
            How often the queue processor checks for new jobs and printer availability.
          </template>
        </UFormGroup>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <span class="font-medium">Security</span>
      </template>
      <div class="max-w-lg space-y-4">
        <UFormGroup label="API Key">
          <UInput v-model="form.apiKey" type="password" placeholder="Leave empty for no auth" />
        </UFormGroup>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <span class="font-medium">API Documentation</span>
      </template>
      <p class="text-sm text-gray-500 mb-3">
        Interactive API docs with request/response examples for every endpoint.
      </p>
      <UButton
        label="Open API Docs"
        icon="i-lucide-external-link"
        variant="outline"
        @click="window.open('http://localhost:3420/api/docs', '_blank')"
      />
    </UCard>

    <div v-if="saved" class="fixed bottom-6 right-6">
      <UAlert
        title="Settings saved"
        color="green"
        variant="soft"
        icon="i-lucide-check-circle"
        :close-button="{ onClick: () => { saved = false } }"
      />
    </div>
  </div>
</template>
