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
  quantity: 1,
  printPerPart: false,
});
const partPrinting = ref(false);
const partResult = ref<string | null>(null);

// Auto-generate barcode from partNumber-rev-vendor
const partBarcode = computed(() => {
  const parts: string[] = [];
  if (partForm.partNumber.trim()) parts.push(partForm.partNumber.trim());
  if (partForm.rev.trim()) parts.push(partForm.rev.trim());
  if (partForm.vendor.trim()) parts.push(partForm.vendor.trim());
  return parts.join('-');
});

function composeLabelElements() {
  const elements: Array<Record<string, unknown>> = [
    {
      type: 'qrcode',
      content: partBarcode.value,
      options: { x: 40, y: 50, magnification: 4 },
    },
    {
      type: 'text',
      content: partForm.partName,
      options: { x: 160, y: 50, height: 35, width: 28 },
    },
    {
      type: 'text',
      content: partForm.partNumber,
      options: { x: 160, y: 95, height: 30, width: 28 },
    },
  ];

  const infoParts: string[] = [];
  if (partForm.rev.trim()) infoParts.push(`Rev ${partForm.rev.trim()}`);
  if (partForm.quantity > 1 && !partForm.printPerPart) infoParts.push(`Qty: ${partForm.quantity}`);
  if (partForm.vendor.trim()) infoParts.push(partForm.vendor.trim());
  if (infoParts.length > 0) {
    elements.push({
      type: 'text',
      content: infoParts.join(' | '),
      options: { x: 160, y: 135, height: 25, width: 20 },
    });
  }

  // Add print quantity command if printing 1 label per part
  const copies = partForm.printPerPart ? partForm.quantity : 1;
  if (copies > 1) {
    elements.push({
      type: 'raw',
      zpl: `^PQ${copies}`,
    });
  }

  return elements;
}

async function printPartLabel() {
  if (!partForm.partName.trim() || !partForm.partNumber.trim() || !partBarcode.value) return;
  partPrinting.value = true;
  partResult.value = null;

  try {
    const elements = composeLabelElements();
    const result = await api.printLabel({ elements });
    const copies = partForm.printPerPart ? partForm.quantity : 1;
    partResult.value = result.success
      ? `✅ Printed "${partForm.partName}"${copies > 1 ? ` ×${copies}` : ''}! ${result.queued ? '(Queued)' : ''}`
      : `❌ Failed`;
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
        <div class="space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormGroup label="Part Name" required>
              <UInput
                v-model="partForm.partName"
                placeholder="FTS Lens Mount"
                :disabled="partPrinting"
              />
            </UFormGroup>
            <UFormGroup label="Part Number" required>
              <UInput
                v-model="partForm.partNumber"
                placeholder="135853-002"
                :disabled="partPrinting"
              />
            </UFormGroup>
            <UFormGroup label="Rev">
              <UInput
                v-model="partForm.rev"
                placeholder="A"
                :disabled="partPrinting"
              />
            </UFormGroup>
            <UFormGroup label="Vendor">
              <UInput
                v-model="partForm.vendor"
                placeholder="NRG"
                :disabled="partPrinting"
              />
            </UFormGroup>
            <UFormGroup label="Quantity">
              <UInput
                v-model.number="partForm.quantity"
                type="number"
                :min="1"
                :max="50"
                :disabled="partPrinting"
              />
            </UFormGroup>
            <UFormGroup label="Barcode (auto)">
              <UInput
                :model-value="partBarcode"
                disabled
                placeholder="partNumber-rev-vendor"
              />
            </UFormGroup>
          </div>
          <div v-if="partForm.quantity > 1" class="flex items-center gap-2">
            <UCheckbox
              v-model="partForm.printPerPart"
              label="Print 1 label per part"
            />
            <span class="text-xs text-gray-500">({{ partForm.quantity }} labels)</span>
          </div>
          <div class="flex items-center gap-3">
            <UButton
              label="Print Label"
              icon="i-lucide-printer"
              color="primary"
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
