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

// ─── Print target + local USB printer ──────────────────────────────────────
const toast = useToast();
const { target: printTarget, load: loadPrintTarget, setTarget, applyMediaConfig, calibrate } = usePrintTarget();
const {
  isSupported: usbSupported,
  isConnected: usbConnected,
  isConnecting: usbConnecting,
  connectedPrinterName: usbPrinterName,
  lastError: usbError,
  listenForUsbEvents,
  connect: connectUsb,
  reconnect: reconnectUsb,
  disconnect: disconnectUsb,
  printZpl: sendZplOverUsb,
} = useLocalPrinter();

const targetItems = [
  { label: 'Server printer (CUPS)', value: 'server' as const },
  { label: 'Local USB printer (WebUSB)', value: 'local' as const },
];

onMounted(() => {
  loadPrintTarget();
  listenForUsbEvents();
  // Reattach to a printer this browser has already been paired with.
  reconnectUsb();
});

async function handleConnectUsb() {
  const ok = await connectUsb();
  if (ok) {
    toast.add({ title: 'Local printer connected', description: usbPrinterName.value ?? undefined, color: 'success' });
  } else if (usbError.value) {
    toast.add({ title: 'Connection failed', description: usbError.value, color: 'error' });
  }
}

async function handleDisconnectUsb() {
  await disconnectUsb();
  toast.add({ title: 'Local printer disconnected', color: 'neutral' });
}

const usbTesting = ref(false);

/** Send a small self-contained label straight over USB, bypassing the queue. */
async function testPrintUsb() {
  usbTesting.value = true;
  try {
    const w = labelSize.value?.current?.widthDots ?? 406;
    const h = labelSize.value?.current?.heightDots ?? 203;
    const res = await api.printLabel({
      target: 'local',
      elements: [
        { type: 'text', content: 'WebUSB test', options: { x: 20, y: 20, height: Math.round(h * 0.16) } },
        { type: 'text', content: `${w}x${h} dots`, options: { x: 20, y: 20 + Math.round(h * 0.24), height: Math.round(h * 0.11) } },
      ],
    });
    if (!res.zpl) throw new Error('Server did not return ZPL');
    const sent = await sendZplOverUsb(res.zpl);
    await api.reportJobResult(res.jobId, sent, sent ? undefined : usbError.value ?? undefined).catch(() => {});
    toast.add(sent
      ? { title: 'Test label sent over USB', color: 'success' }
      : { title: 'Test print failed', description: usbError.value ?? undefined, color: 'error' });
  } catch (e) {
    toast.add({ title: 'Test print failed', description: (e as Error).message, color: 'error' });
  } finally {
    usbTesting.value = false;
  }
}

// ─── Label size + printer media configuration ──────────────────────────────
const selectedSize = ref<string>('');
const customWidth = ref('');
const customHeight = ref('');
const sizeSaving = ref(false);
const mediaApplying = ref(false);
const calibrating = ref(false);

/** Media tracking mode — how the printer finds the top of each label (ZPL ^MN) */
const trackingMode = ref<'gap' | 'mark' | 'continuous' | 'auto'>('gap');
const trackingItems = [
  { label: 'Gap / die-cut labels', value: 'gap' as const },
  { label: 'Black mark', value: 'mark' as const },
  { label: 'Continuous roll', value: 'continuous' as const },
  { label: 'Auto-detect', value: 'auto' as const },
];

/** Print head resolution */
const dpi = ref(203);
const dpiItems = [
  { label: '203 DPI (standard)', value: 203 },
  { label: '300 DPI (high-res)', value: 300 },
  { label: '600 DPI (ultra-high)', value: 600 },
];

watchEffect(() => {
  if (labelSize.value?.current) {
    selectedSize.value = `${labelSize.value.current.widthDots}x${labelSize.value.current.heightDots}`;
  }
  if (labelSize.value?.dpi) dpi.value = labelSize.value.dpi;
});

async function setSize(size: { widthDots: number; heightDots: number; name: string }) {
  sizeSaving.value = true;
  try {
    // When printing locally the browser owns the USB connection, so the server
    // can't push config to the device — we do it over WebUSB right after.
    const printLocally = printTarget.value === 'local';
    const res = await api.setLabelSize({
      ...size,
      applyToPrinter: !printLocally,
      tracking: trackingMode.value,
    });

    if (printLocally && usbConnected.value) {
      const local = await applyMediaConfig({ ...size, dpi: dpi.value, tracking: trackingMode.value });
      toast.add(local.success
        ? { title: 'Label size saved and applied to USB printer', color: 'success' }
        : { title: 'Label size saved, but the printer was not updated', description: local.error, color: 'warning' });
    } else if (res.printerConfig?.applied) {
      toast.add({ title: 'Label size saved and applied to the printer', color: 'success' });
    } else if (res.printerConfig?.error) {
      toast.add({ title: 'Label size saved, but the printer was not updated', description: res.printerConfig.error, color: 'warning' });
    } else {
      toast.add({ title: 'Label size saved', color: 'success' });
    }

    refreshLabelSize();
  } catch (e) {
    toast.add({ title: 'Failed to save label size', description: (e as Error).message, color: 'error' });
  } finally {
    sizeSaving.value = false;
  }
}

async function setCustomSize() {
  const w = parseFloat(customWidth.value);
  const h = parseFloat(customHeight.value);
  if (!w || !h || w <= 0 || h <= 0) return;

  await setSize({
    widthDots: Math.round(w * dpi.value),
    heightDots: Math.round(h * dpi.value),
    name: `${w}×${h}" (custom)`,
  });

  customWidth.value = '';
  customHeight.value = '';
}

/** Re-send the current geometry to the printer without changing the setting. */
async function reapplyMediaConfig(withCalibration = false) {
  mediaApplying.value = true;
  try {
    const res = await applyMediaConfig({
      widthDots: labelSize.value?.current?.widthDots,
      heightDots: labelSize.value?.current?.heightDots,
      dpi: dpi.value,
      tracking: trackingMode.value,
      calibrate: withCalibration,
    });
    toast.add(res.success
      ? {
          title: withCalibration ? 'Configuration applied, calibrating' : 'Configuration applied',
          description: withCalibration ? 'The printer will feed a few labels while it measures the gap sensor.' : undefined,
          color: 'success',
        }
      : { title: 'Failed to configure the printer', description: res.error, color: 'error' });
  } finally {
    mediaApplying.value = false;
  }
}

/** Run a sensor calibration on its own. */
async function runCalibration() {
  calibrating.value = true;
  try {
    const res = await calibrate();
    toast.add(res.success
      ? { title: 'Calibration started', description: 'The printer will feed 2–4 labels while it measures the gap sensor.', color: 'success' }
      : { title: 'Calibration failed', description: res.error, color: 'error' });
  } finally {
    calibrating.value = false;
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

    <!-- Print Target -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-printer" />
          <span class="font-medium">Print Target</span>
          <UBadge variant="subtle" :color="printTarget === 'local' ? 'info' : 'primary'" size="xs">
            {{ printTarget === 'local' ? 'Local USB' : 'Server' }}
          </UBadge>
        </div>
      </template>

      <div class="space-y-3 max-w-lg">
        <p class="text-sm text-gray-500">
          Where labels are sent from this browser. Server printing goes through the queue on the host
          machine. Local printing talks straight to a USB printer plugged into <em>this</em> computer.
          Either way the job is recorded in print history.
        </p>
        <USelectMenu
          :model-value="printTarget"
          :items="targetItems"
          value-key="value"
          :searchable="false"
          @update:model-value="setTarget"
        />
        <UAlert
          v-if="printTarget === 'local' && !usbSupported"
          color="warning"
          variant="soft"
          icon="i-lucide-triangle-alert"
          title="WebUSB not available"
          description="Local printing needs a Chromium-based browser (Chrome or Edge) on HTTPS or localhost."
        />
        <UAlert
          v-else-if="printTarget === 'local' && !usbConnected"
          color="warning"
          variant="soft"
          icon="i-lucide-unplug"
          title="No printer connected"
          description="Connect a USB printer below before printing."
        />
      </div>
    </UCard>

    <!-- Local USB Printer -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-usb" />
          <span class="font-medium">Local USB Printer</span>
          <UBadge :color="usbConnected ? 'success' : 'neutral'" variant="subtle" size="xs">
            {{ usbConnected ? 'Connected' : usbSupported ? 'Not connected' : 'Unsupported' }}
          </UBadge>
        </div>
      </template>

      <div class="space-y-4 max-w-lg">
        <p class="text-sm text-gray-500">
          Connect a Zebra printer over WebUSB to print without going through the server.
          The browser remembers the pairing, so it reconnects on your next visit.
        </p>

        <div class="flex items-center gap-2 text-sm">
          <span
            class="w-2.5 h-2.5 rounded-full shrink-0"
            :class="usbConnected ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'"
          />
          <span class="font-medium">{{ usbConnected ? usbPrinterName : 'No device' }}</span>
        </div>

        <UAlert v-if="usbError" color="error" variant="soft" :description="usbError" />

        <div class="text-xs text-gray-500 space-y-1 border-t pt-3">
          <p class="font-medium text-gray-600 dark:text-gray-400">Setup notes</p>
          <ul class="list-disc list-inside space-y-0.5">
            <li>Requires Chrome or Edge, over HTTPS or localhost.</li>
            <li>The printer must not be claimed by the OS. On Windows switch it to the WinUSB driver (Zadig); on macOS and Linux, remove it from CUPS if the connection is refused.</li>
            <li>The device picker only opens from a click, so use the button below.</li>
          </ul>
        </div>

        <div class="flex flex-wrap gap-2 pt-1">
          <UButton
            v-if="usbConnected"
            label="Disconnect"
            icon="i-lucide-unplug"
            color="error"
            variant="soft"
            size="sm"
            @click="handleDisconnectUsb"
          />
          <UButton
            v-else
            label="Connect printer"
            icon="i-lucide-plug"
            color="primary"
            size="sm"
            :loading="usbConnecting"
            :disabled="!usbSupported"
            @click="handleConnectUsb"
          />
          <UButton
            label="Print test label"
            icon="i-lucide-file-check"
            variant="outline"
            size="sm"
            :loading="usbTesting"
            :disabled="!usbConnected"
            @click="testPrintUsb"
          />
        </div>
      </div>
    </UCard>

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
        <p class="text-sm text-gray-500">
          Select a standard size or enter custom dimensions. Saving also sends the geometry to the
          printer, so it stops using its own stored width and gap settings.
        </p>

        <!-- Recent & Standard sizes -->
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="size in labelSize?.recents ?? []"
            :key="`${size.widthDots}x${size.heightDots}`"
            :label="size.name"
            :variant="selectedSize === `${size.widthDots}x${size.heightDots}` ? 'solid' : 'outline'"
            :color="selectedSize === `${size.widthDots}x${size.heightDots}` ? 'primary' : 'neutral'"
            size="sm"
            :loading="sizeSaving && selectedSize === `${size.widthDots}x${size.heightDots}`"
            @click="setSize(size)"
          />
        </div>

        <!-- Custom size -->
        <div class="flex items-end gap-3 pt-2 border-t">
          <UFormField label="Width (inches)">
            <UInput v-model="customWidth" type="number" placeholder="3" size="sm" class="w-24" min="0.25" max="12" step="0.25" />
          </UFormField>
          <span class="text-xl text-gray-400 pb-1">×</span>
          <UFormField label="Height (inches)">
            <UInput v-model="customHeight" type="number" placeholder="5" size="sm" class="w-24" min="0.25" max="12" step="0.25" />
          </UFormField>
          <UButton
            label="Apply"
            icon="i-lucide-check"
            size="sm"
            color="primary"
            :loading="sizeSaving"
            :disabled="!customWidth || !customHeight"
            @click="setCustomSize"
          />
        </div>
      </div>
    </UCard>

    <!-- Printer Media Configuration -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-sliders-horizontal" />
          <span class="font-medium">Printer Media</span>
        </div>
      </template>

      <div class="space-y-4 max-w-lg">
        <p class="text-sm text-gray-500">
          Tell the printer what stock is loaded and how to find the top of each label.
          Sent as <code class="text-xs">^PW</code>, <code class="text-xs">^ML</code> and
          <code class="text-xs">^MN</code>, saved to the printer's memory.
        </p>

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Media tracking">
            <USelectMenu v-model="trackingMode" :items="trackingItems" value-key="value" :searchable="false" size="sm" />
          </UFormField>
          <UFormField label="Print head density">
            <USelectMenu v-model="dpi" :items="dpiItems" value-key="value" :searchable="false" size="sm" />
          </UFormField>
        </div>

        <p class="text-xs text-gray-500">
          Continuous stock uses <code>^LL</code> for the label length. Gap and mark media get their
          length from the sensor instead, which is what calibration measures.
        </p>

        <div class="flex flex-wrap gap-2 border-t pt-3">
          <UButton
            label="Apply to printer"
            icon="i-lucide-upload"
            color="primary"
            variant="soft"
            size="sm"
            :loading="mediaApplying"
            @click="reapplyMediaConfig(false)"
          />
          <UButton
            label="Apply & calibrate"
            icon="i-lucide-crosshair"
            variant="outline"
            size="sm"
            :loading="mediaApplying"
            @click="reapplyMediaConfig(true)"
          />
          <UButton
            label="Calibrate only"
            icon="i-lucide-ruler-dimension-line"
            variant="ghost"
            size="sm"
            :loading="calibrating"
            @click="runCalibration"
          />
        </div>
        <p class="text-xs text-amber-600 dark:text-amber-400">
          Calibration feeds 2–4 blank labels while the sensor measures the gap. That's expected, not a fault.
        </p>
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
