<script setup lang="ts">
const api = useApi();

const { data: health, refresh: refreshHealth } = useAsyncData('health', () => api.getHealth());
const { data: debug } = useAsyncData('debug', () => api.getDebug());
const { data: stats, refresh: refreshStats } = useAsyncData('stats', () => api.getJobStats());

// Poll health + stats every 5 seconds
let pollInterval: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  pollInterval = setInterval(() => {
    refreshHealth();
    refreshStats();
  }, 5000);
});
onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval);
});

// Quick print form
const printLines = ref('');
const printing = ref(false);
const printResult = ref<string | null>(null);

async function quickPrint() {
  if (!printLines.value.trim()) return;
  printing.value = true;
  printResult.value = null;

  try {
    const result = await api.printText({ lines: [printLines.value] });
    printResult.value = result.success
      ? `✅ Printed! ${result.queued ? '(Queued)' : ''}`
      : `❌ Failed: ${result.error || 'Unknown error'}`;
    printLines.value = '';
    refreshStats();
  } catch (err: any) {
    printResult.value = `❌ Error: ${err.message}`;
  } finally {
    printing.value = false;
  }
}

// Part label quick print
const partForm = reactive({
  partName: '',
  partNumber: '',
  rev: '',
  vendor: 'NRG',
  ticket: '',
  quantity: 1,
  printPerPart: true,
  serialize: true,
  serialStart: 1,
});
const partPrinting = ref(false);
const partResult = ref<string | null>(null);

// Persist printPerPart and serialize settings
const { data: savedSettings } = useAsyncData('part-settings', () => api.getSettings());
watch(savedSettings, (settings) => {
  if (settings) {
    if (settings.print_per_part !== undefined) partForm.printPerPart = settings.print_per_part !== 'false';
    if (settings.serialize_labels !== undefined) partForm.serialize = settings.serialize_labels !== 'false';
  }
}, { immediate: true });

watch(() => partForm.printPerPart, (val) => {
  api.updateSettings({ print_per_part: String(val) });
});
watch(() => partForm.serialize, (val) => {
  api.updateSettings({ serialize_labels: String(val) });
});

// Auto-generate barcode from partNumber-rev-vendor
const partBarcode = computed(() => {
  const parts: string[] = [];
  if (partForm.partNumber.trim()) parts.push(partForm.partNumber.trim());
  if (partForm.rev.trim()) parts.push(partForm.rev.trim());
  if (partForm.vendor.trim()) parts.push(partForm.vendor.trim());
  return parts.join('-');
});

// When serialize is on, force printPerPart
watch(() => partForm.serialize, (val) => {
  if (val) partForm.printPerPart = true;
});

// Format serial number: VENDOR-001
function formatSerial(index: number): string {
  const sn = String(partForm.serialStart + index).padStart(3, '0');
  return `${partForm.vendor.trim() || 'NRG'}-${sn}`;
}

// Layout constants for 2x1" label (406 x 203 dots at 203 DPI)
const qrMag = 5;
const qrSize = 21 * qrMag; // 105 dots
const qrX = 8;
const qrY = Math.round((203 - qrSize) / 2); // 49
const textX = qrX + qrSize + 12; // 125
const textStartY = 22;
const lineSpacing = 42;

// Compose a single part label (optionally with serial number)
function composeSingleLabel(serial?: string): Array<Record<string, unknown>> {
  // Barcode is always the same: partNumber-rev-vendor (identifies the item+vendor)
  const barcodeContent = partBarcode.value;

  const elements: Array<Record<string, unknown>> = [
    {
      type: 'qrcode',
      content: barcodeContent,
      options: { x: qrX, y: qrY, magnification: qrMag },
    },
    {
      type: 'text',
      content: partForm.partName,
      options: { x: textX, y: textStartY, height: 30, width: 24 },
    },
    {
      type: 'text',
      content: partForm.partNumber,
      options: { x: textX, y: textStartY + lineSpacing, height: 26, width: 22 },
    },
  ];

  // Line 3: Rev | Serial or Vendor
  const line3Parts: string[] = [];
  if (partForm.rev.trim()) line3Parts.push(`Rev ${partForm.rev.trim()}`);
  if (serial) {
    line3Parts.push(serial);
  } else if (partForm.vendor.trim()) {
    line3Parts.push(partForm.vendor.trim());
  }
  if (line3Parts.length > 0) {
    elements.push({
      type: 'text',
      content: line3Parts.join(' | '),
      options: { x: textX, y: textStartY + lineSpacing * 2, height: 24, width: 20 },
    });
  }

  // Line 4: Ticket (no qty on individual serialized labels)
  const line4Parts: string[] = [];
  if (partForm.ticket.trim()) line4Parts.push(partForm.ticket.trim());
  if (!serial && !partForm.printPerPart && partForm.quantity > 1) {
    line4Parts.push(`Qty: ${partForm.quantity}`);
  }
  if (line4Parts.length > 0) {
    elements.push({
      type: 'text',
      content: line4Parts.join(' | '),
      options: { x: textX, y: textStartY + lineSpacing * 3, height: 24, width: 20 },
    });
  }

  return elements;
}

// Compose a bag label (summary label with full quantity)
// Layout: Part name full-width at top, horizontal separator,
// then QR on left + remaining info on right, bottom separator
function composeBagLabel(): Array<Record<string, unknown>> {
  const labelWidth = 406;
  const margin = 8;
  const lineWidth = labelWidth - margin * 2; // 390

  // Part name at top, full width
  const elements: Array<Record<string, unknown>> = [
    {
      type: 'text',
      content: partForm.partName,
      options: { x: margin, y: 14, height: 30, width: 24 },
    },
    // Top horizontal separator after part name
    {
      type: 'raw',
      zpl: `^FO${margin},48^GB${lineWidth},2,2,B^FS`,
    },
  ];

  // QR code on left below separator (smaller for bag label to fit more text)
  const bagQrMag = 4;
  const bagQrSize = 21 * bagQrMag; // 84 dots
  const bagQrX = margin;
  const bagQrY = 56;
  elements.push({
    type: 'qrcode',
    content: partBarcode.value,
    options: { x: bagQrX, y: bagQrY, magnification: bagQrMag },
  });

  // Text lines to the right of QR
  const bagTextX = bagQrX + bagQrSize + 10; // 102
  const bagTextStartY = 58;
  const bagLineSpacing = 36;

  // Line 1: Part Number
  elements.push({
    type: 'text',
    content: partForm.partNumber,
    options: { x: bagTextX, y: bagTextStartY, height: 26, width: 22 },
  });

  // Line 2: Rev | Vendor
  const line2Parts: string[] = [];
  if (partForm.rev.trim()) line2Parts.push(`Rev ${partForm.rev.trim()}`);
  if (partForm.vendor.trim()) line2Parts.push(partForm.vendor.trim());
  if (line2Parts.length > 0) {
    elements.push({
      type: 'text',
      content: line2Parts.join(' | '),
      options: { x: bagTextX, y: bagTextStartY + bagLineSpacing, height: 22, width: 18 },
    });
  }

  // Line 3: Ticket | Qty
  const line3Parts: string[] = [];
  if (partForm.ticket.trim()) line3Parts.push(partForm.ticket.trim());
  line3Parts.push(`Qty: ${partForm.quantity}`);
  elements.push({
    type: 'text',
    content: line3Parts.join(' | '),
    options: { x: bagTextX, y: bagTextStartY + bagLineSpacing * 2, height: 22, width: 18 },
  });

  // Bottom horizontal separator
  elements.push({
    type: 'raw',
    zpl: `^FO${margin},185^GB${lineWidth},2,2,B^FS`,
  });

  return elements;
}

async function printPartLabel() {
  if (!partForm.partName.trim() || !partForm.partNumber.trim() || !partBarcode.value) return;
  partPrinting.value = true;
  partResult.value = null;

  try {
    if (partForm.serialize && partForm.quantity > 1) {
      // Print individual serialized labels + 1 bag label
      let printed = 0;
      for (let i = 0; i < partForm.quantity; i++) {
        const serial = formatSerial(i);
        const elements = composeSingleLabel(serial);
        await api.printLabel({ elements });
        printed++;
      }
      // Print bag label
      const bagElements = composeBagLabel();
      await api.printLabel({ elements: bagElements });
      printed++;

      partResult.value = `✅ Printed ${partForm.quantity} serialized labels + 1 bag label (${printed} total)`;
    } else if (partForm.printPerPart && partForm.quantity > 1) {
      // Print identical individual labels via ^PQ + 1 bag label
      const elements = composeSingleLabel();
      elements.push({ type: 'raw', zpl: `^PQ${partForm.quantity}` });
      await api.printLabel({ elements });

      // Print bag label
      const bagElements = composeBagLabel();
      await api.printLabel({ elements: bagElements });

      partResult.value = `✅ Printed ${partForm.quantity} part labels + 1 bag label`;
    } else {
      // Single label (or qty shown on label)
      const elements = composeSingleLabel();
      await api.printLabel({ elements });
      partResult.value = `✅ Printed "${partForm.partName}"`;
    }
    refreshStats();
  } catch (err: any) {
    partResult.value = `❌ Error: ${err.message}`;
  } finally {
    partPrinting.value = false;
  }
}

const formatBytes = (b: number) => b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(1)} KB`;
const formatUptime = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
</script>

<template>
  <div class="p-6 space-y-6">
    <h1 class="text-2xl font-bold">Dashboard</h1>

    <!-- Status cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-printer" class="text-primary-500" />
            <span class="text-sm font-medium">Printer Status</span>
          </div>
        </template>
        <div class="flex items-center gap-2">
          <span
            class="inline-block w-2.5 h-2.5 rounded-full"
            :class="health?.printer ? 'bg-green-500' : 'bg-red-500'"
          />
          <span class="text-lg font-semibold">{{ health?.printer || 'Not connected' }}</span>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-clock" class="text-amber-500" />
            <span class="text-sm font-medium">Pending Jobs</span>
          </div>
        </template>
        <span class="text-lg font-semibold">{{ stats?.pending ?? 0 }}</span>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-check-circle" class="text-green-500" />
            <span class="text-sm font-medium">Completed Today</span>
          </div>
        </template>
        <span class="text-lg font-semibold">{{ stats?.completed ?? 0 }}</span>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-x-circle" class="text-red-500" />
            <span class="text-sm font-medium">Failed</span>
          </div>
        </template>
        <span class="text-lg font-semibold">{{ stats?.failed ?? 0 }}</span>
      </UCard>
    </div>

    <!-- Quick Print + Part Label side by side -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Quick print -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-send" />
            <span class="font-medium">Quick Print</span>
          </div>
        </template>
        <div class="space-y-3">
          <div class="flex gap-2">
            <UInput
              v-model="printLines"
              placeholder="Type label text and press Enter..."
              size="lg"
              :disabled="printing"
              class="flex-1"
              @keyup.enter="quickPrint"
            />
            <UButton
              icon="i-lucide-arrow-right"
              size="lg"
              color="primary"
              :loading="printing"
              :disabled="!printLines.trim()"
              @click="quickPrint"
            />
          </div>
          <p v-if="printResult" class="text-sm" :class="printResult.startsWith('✅') ? 'text-green-600' : 'text-red-600'">
            {{ printResult }}
          </p>
        </div>
      </UCard>

      <!-- Quick Print Part Label -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-tag" class="text-primary-500" />
            <span class="font-medium">Quick Print Part Label</span>
          </div>
        </template>
        <div class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Part Name" required>
              <UInput
                v-model="partForm.partName"
                placeholder="FTS Lens Mount"
                size="sm"
                :disabled="partPrinting"
              />
            </UFormField>
            <UFormField label="Part Number" required>
              <UInput
                v-model="partForm.partNumber"
                placeholder="135853-002"
                size="sm"
                :disabled="partPrinting"
              />
            </UFormField>
            <UFormField label="Revision">
              <UInput
                v-model="partForm.rev"
                placeholder="A"
                size="sm"
                :disabled="partPrinting"
              />
            </UFormField>
            <UFormField label="Vendor">
              <UInput
                v-model="partForm.vendor"
                placeholder="NRG"
                size="sm"
                :disabled="partPrinting"
              />
            </UFormField>
            <UFormField label="Ticket #">
              <UInput
                v-model="partForm.ticket"
                placeholder="PI-8088"
                size="sm"
                :disabled="partPrinting"
              />
            </UFormField>
            <UFormField label="Barcode (auto)">
              <UInput
                :model-value="partBarcode"
                disabled
                size="sm"
                placeholder="partNumber-rev-vendor"
              />
            </UFormField>
            <UFormField label="Quantity" class="col-span-2">
              <UInput
                v-model.number="partForm.quantity"
                type="number"
                :min="1"
                :max="50"
                size="sm"
                :disabled="partPrinting"
              />
            </UFormField>
          </div>
          <div v-if="partForm.quantity > 1" class="space-y-2">
            <div class="flex items-center gap-2">
              <UCheckbox
                v-model="partForm.printPerPart"
                label="Print 1 label per part"
                :disabled="partForm.serialize"
              />
              <span class="text-xs text-gray-500">({{ partForm.quantity }} labels + 1 bag label)</span>
            </div>
            <div class="flex items-center gap-4">
              <UCheckbox
                v-model="partForm.serialize"
                label="Serialize labels"
              />
              <div v-if="partForm.serialize" class="flex items-center gap-2">
                <span class="text-xs text-gray-500">Start at:</span>
                <UInput
                  v-model.number="partForm.serialStart"
                  type="number"
                  :min="1"
                  size="xs"
                  class="w-16"
                />
                <span class="text-xs text-gray-500">
                  ({{ formatSerial(0) }} ... {{ formatSerial(partForm.quantity - 1) }})
                </span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <UButton
              label="Print Label"
              icon="i-lucide-printer"
              color="primary"
              size="sm"
              :loading="partPrinting"
              :disabled="!partForm.partName.trim() || !partForm.partNumber.trim()"
              @click="printPartLabel"
            />
            <p v-if="partResult" class="text-sm" :class="partResult.startsWith('✅') ? 'text-green-600' : 'text-red-600'">
              {{ partResult }}
            </p>
          </div>
        </div>
      </UCard>
    </div>

    <!-- System info -->
    <UCard v-if="debug">
      <template #header>
        <span class="font-medium">System Info</span>
      </template>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div>
          <span class="text-gray-500">Uptime</span>
          <p class="font-medium">{{ formatUptime(debug.server.uptime) }}</p>
        </div>
        <div>
          <span class="text-gray-500">Memory</span>
          <p class="font-medium">{{ formatBytes(debug.server.memory.rss) }}</p>
        </div>
        <div>
          <span class="text-gray-500">Database</span>
          <p class="font-medium">{{ debug.database.sizeFormatted }}</p>
        </div>
        <div>
          <span class="text-gray-500">Node.js</span>
          <p class="font-medium">{{ debug.server.nodeVersion }}</p>
        </div>
      </div>
    </UCard>
  </div>
</template>
