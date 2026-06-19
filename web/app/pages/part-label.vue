<script setup lang="ts">
const api = useApi();

// Part label form
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
  bagLabelCount: 1,
});
const partPrinting = ref(false);
const partResult = ref<string | null>(null);

// Persist printPerPart and serialize settings
const { data: savedSettings } = useAsyncData('part-label-settings', () => api.getSettings());
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

// Show bag label option when producing multiple individual labels
const showBagLabels = computed(() =>
  partForm.serialize || (partForm.printPerPart && partForm.quantity > 1)
);

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
function composeBagLabel(): Array<Record<string, unknown>> {
  const labelWidth = 406;
  const margin = 8;
  const lineWidth = labelWidth - margin * 2;

  const elements: Array<Record<string, unknown>> = [
    {
      type: 'text',
      content: partForm.partName,
      options: { x: margin, y: 14, height: 30, width: 24 },
    },
    {
      type: 'raw',
      zpl: `^FO${margin},48^GB${lineWidth},2,2,B^FS`,
    },
  ];

  const bagQrMag = 4;
  const bagQrSize = 21 * bagQrMag;
  const bagQrX = margin;
  const bagQrY = 56;
  elements.push({
    type: 'qrcode',
    content: partBarcode.value,
    options: { x: bagQrX, y: bagQrY, magnification: bagQrMag },
  });

  const bagTextX = bagQrX + bagQrSize + 10;
  const bagTextStartY = 58;
  const bagLineSpacing = 36;

  elements.push({
    type: 'text',
    content: partForm.partNumber,
    options: { x: bagTextX, y: bagTextStartY, height: 26, width: 22 },
  });

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

  const line3Parts: string[] = [];
  if (partForm.ticket.trim()) line3Parts.push(partForm.ticket.trim());
  line3Parts.push(`Qty: ${partForm.quantity}`);
  elements.push({
    type: 'text',
    content: line3Parts.join(' | '),
    options: { x: bagTextX, y: bagTextStartY + bagLineSpacing * 2, height: 22, width: 18 },
  });

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
    const bagCount = Math.max(0, partForm.bagLabelCount);

    if (partForm.serialize) {
      // Print individual serialized labels (works for any quantity, including 1)
      for (let i = 0; i < partForm.quantity; i++) {
        const serial = formatSerial(i);
        const elements = composeSingleLabel(serial);
        await api.printLabel({ elements });
      }
      // Print bag label(s)
      const bagElements = composeBagLabel();
      for (let i = 0; i < bagCount; i++) {
        await api.printLabel({ elements: bagElements });
      }

      const bagMsg = bagCount > 0 ? ` + ${bagCount} bag label${bagCount > 1 ? 's' : ''}` : '';
      partResult.value = `✅ Printed ${partForm.quantity} serialized label${partForm.quantity > 1 ? 's' : ''}${bagMsg}`;
    } else if (partForm.printPerPart && partForm.quantity > 1) {
      // Print identical individual labels via ^PQ
      const elements = composeSingleLabel();
      elements.push({ type: 'raw', zpl: `^PQ${partForm.quantity}` });
      await api.printLabel({ elements });

      // Print bag label(s)
      const bagElements = composeBagLabel();
      for (let i = 0; i < bagCount; i++) {
        await api.printLabel({ elements: bagElements });
      }

      const bagMsg = bagCount > 0 ? ` + ${bagCount} bag label${bagCount > 1 ? 's' : ''}` : '';
      partResult.value = `✅ Printed ${partForm.quantity} part labels${bagMsg}`;
    } else {
      // Single label (or qty shown on label)
      const elements = composeSingleLabel();
      await api.printLabel({ elements });
      partResult.value = `✅ Printed "${partForm.partName}"`;
    }
  } catch (err: any) {
    partResult.value = `❌ Error: ${err.message}`;
  } finally {
    partPrinting.value = false;
  }
}
</script>

<template>
  <div class="p-6 max-w-xl mx-auto">
    <h1 class="text-2xl font-bold mb-6 flex items-center gap-2">
      <UIcon name="i-lucide-tag" class="text-primary-500" />
      Print Part Label
    </h1>

    <UCard>
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Part Name" required>
            <UInput
              v-model="partForm.partName"
              placeholder="FTS Lens Mount"
              :disabled="partPrinting"
            />
          </UFormField>
          <UFormField label="Part Number" required>
            <UInput
              v-model="partForm.partNumber"
              placeholder="135853-002"
              :disabled="partPrinting"
            />
          </UFormField>
          <UFormField label="Revision">
            <UInput
              v-model="partForm.rev"
              placeholder="A"
              :disabled="partPrinting"
            />
          </UFormField>
          <UFormField label="Vendor">
            <UInput
              v-model="partForm.vendor"
              placeholder="NRG"
              :disabled="partPrinting"
            />
          </UFormField>
          <UFormField label="Ticket #">
            <UInput
              v-model="partForm.ticket"
              placeholder="PI-8088"
              :disabled="partPrinting"
            />
          </UFormField>
          <UFormField label="Barcode (auto)">
            <UInput
              :model-value="partBarcode"
              disabled
              placeholder="partNumber-rev-vendor"
            />
          </UFormField>
          <UFormField label="Quantity" class="col-span-2">
            <UInput
              v-model.number="partForm.quantity"
              type="number"
              :min="1"
              :max="50"
              :disabled="partPrinting"
            />
          </UFormField>
        </div>

        <div class="space-y-3 pt-2 border-t border-gray-200 dark:border-gray-700">
          <div v-if="partForm.quantity > 1" class="flex items-center gap-2">
            <UCheckbox
              v-model="partForm.printPerPart"
              label="Print 1 label per part"
              :disabled="partForm.serialize"
            />
            <span class="text-xs text-gray-500">({{ partForm.quantity }} labels)</span>
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
                <template v-if="partForm.quantity > 1">
                  ({{ formatSerial(0) }} ... {{ formatSerial(partForm.quantity - 1) }})
                </template>
                <template v-else>
                  ({{ formatSerial(0) }})
                </template>
              </span>
            </div>
          </div>
          <div v-if="showBagLabels" class="flex items-center gap-2">
            <span class="text-sm">Bag labels:</span>
            <UInput
              v-model.number="partForm.bagLabelCount"
              type="number"
              :min="0"
              :max="20"
              size="xs"
              class="w-16"
            />
            <span class="text-xs text-gray-500">(summary label with total qty)</span>
          </div>
        </div>

        <div class="flex items-center gap-3 pt-2">
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
</template>
