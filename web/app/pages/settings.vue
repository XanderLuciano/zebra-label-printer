<script setup lang="ts">
const api = useApi();

const { data: settings, refresh: refreshSettings } = useAsyncData('settings', () => api.getSettings());
const { data: labelSize, refresh: refreshLabelSize } = useAsyncData('label-size', () =>
  $fetch<{
    current: { widthInches: number; heightInches: number; widthDots: number; heightDots: number; name: string };
    recents: Array<{ widthInches: number; heightInches: number; widthDots: number; heightDots: number; name: string }>;
    standards: Array<{ widthInches: number; heightInches: number; widthDots: number; heightDots: number; name: string }>;
    dpi: number;
  }>(`${useRuntimeConfig().public.apiBase}/api/label-size`),
);

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

// Label size
const selectedSize = ref<string>('');
const customWidth = ref('');
const customHeight = ref('');
const sizeSaving = ref(false);

watchEffect(() => {
  if (labelSize.value?.current) {
    selectedSize.value = `${labelSize.value.current.widthDots}x${labelSize.value.current.heightDots}`;
  }
});

async function setSize(size: { widthDots: number; heightDots: number; name: string }) {
  sizeSaving.value = true;
  try {
    await $fetch(`${useRuntimeConfig().public.apiBase}/api/label-size`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(size),
    });
    refreshLabelSize();
  } finally {
    sizeSaving.value = false;
  }
}

async function setCustomSize() {
  const w = parseInt(customWidth.value);
  const h = parseInt(customHeight.value);
  if (!w || !h || w < 1 || h < 1) return;

  await setSize({
    widthDots: Math.round(w * (labelSize.value?.dpi ?? 203)),
    heightDots: Math.round(h * (labelSize.value?.dpi ?? 203)),
    name: `${w}×${h}" (custom)`,
  });

  customWidth.value = '';
  customHeight.value = '';
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

    <!-- Label Size -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-ruler" />
          <span class="font-medium">Label Size</span>
          <UBadge v-if="labelSize?.current" variant="subtle" color="primary" size="xs">
            {{ labelSize.current.name }}
          </UBadge>
        </div>
      </template>

      <div class="space-y-4 max-w-lg">
        <p class="text-sm text-gray-500">Select a standard size or enter custom dimensions.</p>

        <!-- Recent & Standard sizes -->
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="size in labelSize?.recents ?? []"
            :key="`${size.widthDots}x${size.heightDots}`"
            :label="size.name"
            :variant="selectedSize === `${size.widthDots}x${size.heightDots}` ? 'solid' : 'outline'"
            :color="selectedSize === `${size.widthDots}x${size.heightDots}` ? 'primary' : 'gray'"
            size="sm"
            :loading="sizeSaving && selectedSize === `${size.widthDots}x${size.heightDots}`"
            @click="setSize(size)"
          />
        </div>

        <!-- Custom size -->
        <div class="flex items-end gap-3 pt-2 border-t">
          <UFormGroup label="Width (inches)">
            <UInput v-model="customWidth" type="number" placeholder="3" size="sm" class="w-24" min="1" max="12" />
          </UFormGroup>
          <span class="text-xl text-gray-400 pb-1">×</span>
          <UFormGroup label="Height (inches)">
            <UInput v-model="customHeight" type="number" placeholder="5" size="sm" class="w-24" min="1" max="12" />
          </UFormGroup>
          <UButton
            label="Apply"
            icon="i-lucide-check"
            size="sm"
            color="primary"
            :disabled="!customWidth || !customHeight"
            @click="setCustomSize"
          />
        </div>
      </div>
    </UCard>

    <!-- Queue -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-timer" />
          <span class="font-medium">Queue</span>
        </div>
      </template>
      <div class="max-w-lg">
        <UFormGroup label="Check Interval (ms)">
          <UInput v-model="form.queueCheckIntervalMs" type="number" />
          <template #help>
            How often the queue processor polls for printer availability and pending jobs.
          </template>
        </UFormGroup>
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
        <UFormGroup label="API Key">
          <UInput v-model="form.apiKey" type="password" placeholder="Leave empty for no auth" />
        </UFormGroup>
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

    <!-- Toast -->
    <div v-if="saved" class="fixed bottom-6 right-6 z-50">
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
