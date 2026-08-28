<script setup lang="ts">
/**
 * Printer management — pick a printer, then configure that printer.
 *
 * Replaces the old "print target + global label size" pair of controls. That
 * arrangement had one label size shared by every printer, so running a 2×1"
 * printer and a 4×6" printer at once meant re-entering the geometry on every
 * switch, and nothing told you whether the printer you were about to use was
 * actually loaded with that stock.
 *
 * Both kinds of printer are configured identically here. Where the configuration
 * is stored differs, because only one side can reach each printer:
 *
 *   • A **local** printer is USB-attached to this machine and driven from the
 *     browser over WebUSB. Its config is saved in this browser, keyed to the
 *     device, so a different machine's printer is unaffected.
 *   • A **server** printer is driven by the host process, and its config lives on
 *     the server where every client sees it.
 */

const toast = useToast()
const printers = usePrinters()
const { applyMediaConfig, calibrate, printText } = usePrintTarget()

const selected = printers.selected

// Poll while this page is open, so a printer unplugged on the server turns red
// without needing a reload.
printers.watchWhileMounted()

/** How each health verdict is presented. */
const HEALTH_DISPLAY: Record<string, { label: string; dot: string; colour: 'success' | 'warning' | 'error' | 'neutral'; icon: string }> = {
  ready: { label: 'Ready', dot: 'bg-green-500', colour: 'success', icon: 'i-lucide-check' },
  unplugged: { label: 'Unplugged', dot: 'bg-red-500', colour: 'error', icon: 'i-lucide-unplug' },
  offline: { label: 'Stopped', dot: 'bg-amber-500', colour: 'warning', icon: 'i-lucide-pause' },
  missing: { label: 'Missing', dot: 'bg-red-500', colour: 'error', icon: 'i-lucide-circle-help' },
  unknown: { label: 'Unknown', dot: 'bg-gray-300 dark:bg-gray-600', colour: 'neutral', icon: 'i-lucide-circle-help' },
}

const display = computed(() => HEALTH_DISPLAY[selected.value?.health ?? 'unknown']!)

function displayFor(health: string) {
  return HEALTH_DISPLAY[health] ?? HEALTH_DISPLAY.unknown!
}

// ── Selecting ──────────────────────────────────────────────────────────────

const printerItems = computed(() =>
  printers.printers.value.map(p => ({
    value: p.id,
    label: p.name,
    suffix: p.connection === 'local' ? 'This browser (USB)' : 'Server',
    ready: p.ready,
    dot: displayFor(p.health).dot,
  })))

/** Short description of where the selected printer lives. */
const connectionSummary = computed(() => {
  const p = selected.value
  if (!p) return ''
  if (p.connection === 'local') {
    return `USB printer attached to this computer, driven from this browser. Settings are saved here, not on the server.`
  }
  return `Driven by the server${p.cupsName ? ` via the CUPS queue '${p.cupsName}'` : ''}. Everyone using this server sees it.`
})

// ── Adding ─────────────────────────────────────────────────────────────────

const connectingUsb = ref(false)

async function addLocal() {
  connectingUsb.value = true
  try {
    const added = await printers.addLocalPrinter()
    if (added) {
      toast.add({
        title: `${added.name} added`,
        description: 'Set its label size below so prints come out at the right dimensions.',
        color: 'success',
      })
    } else if (printers.localUsbError.value) {
      toast.add({ title: 'Could not connect', description: printers.localUsbError.value, color: 'error' })
    }
  } finally {
    connectingUsb.value = false
  }
}

const addingServer = ref<string | null>(null)

async function addServer(cupsName: string, model: string) {
  addingServer.value = cupsName
  try {
    const added = await printers.addServerPrinter({ name: model || cupsName, cupsName })
    toast.add({
      title: `${added.name} added`,
      description: 'Set its label size below so prints come out at the right dimensions.',
      color: 'success',
    })
  } catch (e) {
    toast.add({ title: 'Could not add printer', description: (e as Error).message, color: 'error' })
  } finally {
    addingServer.value = null
  }
}

const rechecking = ref(false)

/** Re-poll the server rather than waiting for the next tick. */
async function recheck() {
  rechecking.value = true
  try {
    await printers.refreshServer()
    const printer = selected.value
    if (printer?.ready) toast.add({ title: `${printer.name} is ready`, color: 'success' })
    else if (printer) {
      toast.add({ title: display.value.label, description: printer.readyHint, color: display.value.colour })
    }
  } finally {
    rechecking.value = false
  }
}

const reconnecting = ref(false)

async function reconnect() {
  const printer = selected.value
  if (!printer) return
  reconnecting.value = true
  try {
    const ok = await printers.reconnectLocalPrinter(printer.id)
    toast.add(ok
      ? { title: `${printer.name} reconnected`, color: 'success' }
      : {
          title: 'Still not connected',
          description: printers.localUsbError.value
            ?? 'Plug the printer in, then use "Connect USB printer" to re-authorise it.',
          color: 'warning',
        })
  } finally {
    reconnecting.value = false
  }
}

// ── Renaming ───────────────────────────────────────────────────────────────

const nameDraft = ref('')
const renaming = ref(false)

watch(selected, printer => { nameDraft.value = printer?.name ?? '' }, { immediate: true })

const nameChanged = computed(() =>
  !!selected.value && nameDraft.value.trim().length > 0 && nameDraft.value !== selected.value.name)

async function saveName() {
  const printer = selected.value
  if (!printer || !nameChanged.value) return
  renaming.value = true
  try {
    await printers.configure(printer.id, { name: nameDraft.value.trim() })
    toast.add({ title: 'Printer renamed', color: 'success' })
  } catch (e) {
    toast.add({ title: 'Rename failed', description: (e as Error).message, color: 'error' })
  } finally {
    renaming.value = false
  }
}

// ── Label size ─────────────────────────────────────────────────────────────

const customWidth = ref('')
const customHeight = ref('')
const sizeSaving = ref(false)

const sizeKey = computed(() => {
  const size = selected.value?.labelSize
  return size ? `${size.widthDots}x${size.heightDots}` : ''
})

/**
 * Save a label size on the selected printer, then push it to the hardware.
 *
 * Saving alone only changes the ZPL this app generates; the printer keeps its own
 * stored print width and gap settings until told otherwise, which is what produces
 * clipped or drifting labels after a stock change.
 */
async function setSize(size: { widthDots: number; heightDots: number; name: string }) {
  const printer = selected.value
  if (!printer) return

  sizeSaving.value = true
  try {
    await printers.configure(printer.id, {
      labelSize: labelSizeFromDots(size.widthDots, size.heightDots, printer.dpi, size.name),
    })

    const applied = await applyMediaConfig({
      printerId: printer.id,
      widthDots: size.widthDots,
      heightDots: size.heightDots,
    })

    toast.add(applied.success
      ? { title: `${printer.name} set to ${size.name}`, color: 'success' }
      : {
          title: 'Saved, but the printer was not updated',
          description: applied.error,
          color: 'warning',
        })
  } catch (e) {
    toast.add({ title: 'Failed to save label size', description: (e as Error).message, color: 'error' })
  } finally {
    sizeSaving.value = false
  }
}

async function setCustomSize() {
  const printer = selected.value
  if (!printer) return

  const w = parseFloat(customWidth.value)
  const h = parseFloat(customHeight.value)
  if (!w || !h || w <= 0 || h <= 0) return

  await setSize({
    widthDots: Math.round(w * printer.dpi),
    heightDots: Math.round(h * printer.dpi),
    name: `${w}×${h}" (custom)`,
  })

  customWidth.value = ''
  customHeight.value = ''
}

// ── Media configuration ────────────────────────────────────────────────────

const trackingItems = [
  { label: 'Gap / die-cut labels', value: 'gap' as const },
  { label: 'Black mark', value: 'mark' as const },
  { label: 'Continuous roll', value: 'continuous' as const },
  { label: 'Auto-detect', value: 'auto' as const },
]

const dpiItems = [
  { label: '203 DPI (standard)', value: 203 },
  { label: '300 DPI (high-res)', value: 300 },
  { label: '600 DPI (ultra-high)', value: 600 },
]

const mediaApplying = ref(false)
const calibrating = ref(false)

async function setTracking(tracking: 'gap' | 'mark' | 'continuous' | 'auto') {
  const printer = selected.value
  if (!printer) return
  await printers.configure(printer.id, { tracking })
}

/**
 * Change the print head resolution.
 *
 * The dot dimensions stay put and the inches are re-derived: the same 609×1015
 * dots is a 3×5" label at 203 DPI but a 2×3.4" one at 300.
 */
async function setDpi(dpi: number) {
  const printer = selected.value
  if (!printer) return
  await printers.configure(printer.id, {
    dpi,
    labelSize: labelSizeFromDots(
      printer.labelSize.widthDots,
      printer.labelSize.heightDots,
      dpi,
      printer.labelSize.name,
    ),
  })
}

/** Re-send the printer's saved geometry to the hardware. */
async function reapply(withCalibration = false) {
  const printer = selected.value
  if (!printer) return
  mediaApplying.value = true
  try {
    const res = await applyMediaConfig({ printerId: printer.id, calibrate: withCalibration })
    toast.add(res.success
      ? {
          title: withCalibration ? 'Configuration applied, calibrating' : 'Configuration applied',
          description: withCalibration
            ? 'The printer will feed a few labels while it measures the gap sensor.'
            : undefined,
          color: 'success',
        }
      : { title: 'Failed to configure the printer', description: res.error, color: 'error' })
  } finally {
    mediaApplying.value = false
  }
}

async function runCalibration() {
  const printer = selected.value
  if (!printer) return
  calibrating.value = true
  try {
    const res = await calibrate(printer.id)
    toast.add(res.success
      ? {
          title: 'Calibration started',
          description: 'The printer will feed 2–4 labels while it measures the gap sensor.',
          color: 'success',
        }
      : { title: 'Calibration failed', description: res.error, color: 'error' })
  } finally {
    calibrating.value = false
  }
}

// ── Test print, default, removal ───────────────────────────────────────────

const testing = ref(false)

/** Print a label naming the printer and its configured size, to confirm both. */
async function testPrint() {
  const printer = selected.value
  if (!printer) return
  testing.value = true
  try {
    const res = await printText({
      lines: [printer.name, `${printer.labelSize.name}`, `${printer.labelSize.widthDots}×${printer.labelSize.heightDots} dots @ ${printer.dpi} DPI`],
    }, printer.id)
    toast.add(res.success
      ? { title: 'Test label sent', color: 'success' }
      : { title: 'Test print failed', description: res.error, color: 'error' })
  } finally {
    testing.value = false
  }
}

const settingDefault = ref(false)

async function makeDefault() {
  const printer = selected.value
  if (!printer) return
  settingDefault.value = true
  try {
    await printers.makeDefault(printer.id)
    toast.add({
      title: `${printer.name} is now the server default`,
      description: 'Used for API requests and TCP prints that do not name a printer.',
      color: 'success',
    })
  } catch (e) {
    toast.add({ title: 'Could not set the default', description: (e as Error).message, color: 'error' })
  } finally {
    settingDefault.value = false
  }
}

const confirmRemove = ref(false)
const removing = ref(false)

async function remove() {
  const printer = selected.value
  if (!printer) return
  removing.value = true
  try {
    if (printer.connection === 'local') await printers.removeLocalPrinter(printer.id)
    else await printers.removeServerPrinter(printer.id)
    toast.add({
      title: `${printer.name} removed`,
      description: 'Its print history is kept.',
      color: 'neutral',
    })
    confirmRemove.value = false
  } catch (e) {
    toast.add({ title: 'Could not remove printer', description: (e as Error).message, color: 'error' })
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Printer selection -->
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-printer" />
          <span class="font-medium">Printer</span>
          <UBadge
            v-if="selected"
            :color="selected.connection === 'local' ? 'info' : 'primary'"
            variant="subtle"
            size="xs"
          >
            {{ selected.connection === 'local' ? 'This browser (USB)' : 'Server' }}
          </UBadge>
          <UBadge v-if="selected?.isDefault" color="neutral" variant="subtle" size="xs">
            Server default
          </UBadge>
        </div>
      </template>

      <div class="space-y-4 max-w-xl">
        <p class="text-sm text-gray-500">
          Each printer keeps its own label size and media settings, so switching printers
          does not mean reconfiguring one. Prints from this browser go to the printer
          selected here.
        </p>

        <UFormField v-if="printers.hasPrinters.value" label="Print to">
          <USelectMenu
            :model-value="printers.selectedId.value ?? undefined"
            :items="printerItems"
            value-key="value"
            :searchable="printerItems.length > 6"
            @update:model-value="printers.select"
          >
            <template #item-trailing="{ item }">
              <span class="flex items-center gap-2 text-xs text-gray-500">
                <span>{{ item.suffix }}</span>
                <span class="w-2 h-2 rounded-full shrink-0" :class="item.dot" />
              </span>
            </template>
          </USelectMenu>
        </UFormField>

        <UAlert
          v-else
          color="warning"
          variant="soft"
          icon="i-lucide-printer-check"
          title="No printers set up yet"
          description="Add a USB printer attached to this computer, or one the server can see, below."
        />

        <div v-if="selected" class="flex items-start gap-2 text-sm">
          <span class="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" :class="display.dot" />
          <div>
            <p class="font-medium">
              {{ display.label }}
              <span class="font-normal text-gray-500">
                &middot; {{ selected.labelSize.name }}
                ({{ selected.labelSize.widthDots }}×{{ selected.labelSize.heightDots }} dots @ {{ selected.dpi }} DPI)
              </span>
            </p>
            <p class="text-xs text-gray-500 mt-0.5">{{ connectionSummary }}</p>
          </div>
        </div>

        <UAlert
          v-if="selected && !selected.ready"
          :color="display.colour"
          variant="soft"
          :icon="display.icon"
          :title="display.label"
          :description="selected.readyHint"
        >
          <template #actions>
            <UButton
              v-if="selected.connection === 'local'"
              label="Reconnect"
              size="xs"
              :color="display.colour"
              variant="soft"
              :loading="reconnecting"
              @click="reconnect"
            />
            <UButton
              v-else
              label="Check again"
              icon="i-lucide-refresh-cw"
              size="xs"
              :color="display.colour"
              variant="soft"
              :loading="rechecking"
              @click="recheck"
            />
          </template>
        </UAlert>

        <UAlert
          v-if="!printers.localUsbSupported.value"
          color="neutral"
          variant="soft"
          icon="i-lucide-info"
          title="USB printing needs Chrome or Edge"
          description="WebUSB is only implemented in Chromium-based browsers, on HTTPS or localhost. Server printers work in any browser."
        />

        <!-- Add printers -->
        <div class="border-t pt-4 space-y-3">
          <p class="text-sm font-medium">Add a printer</p>

          <UButton
            label="Connect USB printer"
            icon="i-lucide-usb"
            color="primary"
            variant="soft"
            size="sm"
            :loading="connectingUsb"
            :disabled="!printers.localUsbSupported.value"
            @click="addLocal"
          />
          <p class="text-xs text-gray-500">
            Opens the browser's device picker for a printer plugged into this computer.
            The printer must not be claimed by the OS — on Windows switch it to the WinUSB
            driver (Zadig); on macOS and Linux, remove it from CUPS if the connection is refused.
          </p>

          <div v-if="printers.discovered.value.length" class="space-y-2 pt-2">
            <p class="text-xs text-gray-500">
              The server can see these but they are not set up yet:
            </p>
            <div
              v-for="found in printers.discovered.value"
              :key="found.name"
              class="flex items-center justify-between gap-3 text-sm"
            >
              <div class="min-w-0">
                <p class="font-medium truncate">{{ found.model || found.name }}</p>
                <p class="text-xs text-gray-500 truncate">
                  {{ found.name }}
                  <template v-if="found.isZebra"> &middot; Zebra</template>
                </p>
              </div>
              <UButton
                label="Add"
                icon="i-lucide-plus"
                size="xs"
                variant="outline"
                :loading="addingServer === found.name"
                @click="addServer(found.name, found.model)"
              />
            </div>
          </div>
        </div>
      </div>
    </UCard>

    <!-- Selected printer configuration -->
    <UCard v-if="selected">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-ruler" />
          <span class="font-medium">{{ selected.name }} — label stock</span>
          <UBadge variant="subtle" color="primary" size="xs">{{ selected.labelSize.name }}</UBadge>
        </div>
      </template>

      <div class="space-y-5 max-w-xl">
        <p class="text-sm text-gray-500">
          Tell this printer what stock is loaded. Saving also sends the geometry to the
          printer, so it stops using its own stored width and gap settings.
        </p>

        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="size in STANDARD_LABEL_SIZES"
            :key="`${size.widthDots}x${size.heightDots}`"
            :label="size.name"
            :variant="sizeKey === `${size.widthDots}x${size.heightDots}` ? 'solid' : 'outline'"
            :color="sizeKey === `${size.widthDots}x${size.heightDots}` ? 'primary' : 'neutral'"
            size="sm"
            :loading="sizeSaving && sizeKey === `${size.widthDots}x${size.heightDots}`"
            @click="setSize(size)"
          />
        </div>

        <div class="flex items-end gap-3 pt-1 border-t">
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

        <div class="grid grid-cols-2 gap-3 border-t pt-4">
          <UFormField label="Media tracking" help="How the printer finds the top of each label (^MN)">
            <USelectMenu
              :model-value="selected.tracking"
              :items="trackingItems"
              value-key="value"
              :searchable="false"
              size="sm"
              @update:model-value="setTracking"
            />
          </UFormField>
          <UFormField label="Print head density">
            <USelectMenu
              :model-value="selected.dpi"
              :items="dpiItems"
              value-key="value"
              :searchable="false"
              size="sm"
              @update:model-value="setDpi"
            />
          </UFormField>
        </div>

        <p class="text-xs text-gray-500">
          Continuous stock uses <code>^LL</code> for the label length. Gap and mark media get
          their length from the sensor instead, which is what calibration measures.
        </p>

        <div class="flex flex-wrap gap-2 border-t pt-4">
          <UButton
            label="Apply to printer"
            icon="i-lucide-upload"
            color="primary"
            variant="soft"
            size="sm"
            :loading="mediaApplying"
            @click="reapply(false)"
          />
          <UButton
            label="Apply & calibrate"
            icon="i-lucide-crosshair"
            variant="outline"
            size="sm"
            :loading="mediaApplying"
            @click="reapply(true)"
          />
          <UButton
            label="Calibrate only"
            icon="i-lucide-ruler-dimension-line"
            variant="ghost"
            size="sm"
            :loading="calibrating"
            @click="runCalibration"
          />
          <UButton
            label="Print test label"
            icon="i-lucide-file-check"
            variant="outline"
            size="sm"
            :loading="testing"
            :disabled="!selected.ready"
            @click="testPrint"
          />
        </div>
        <p class="text-xs text-amber-600 dark:text-amber-400">
          Calibration feeds 2–4 blank labels while the sensor measures the gap. That's expected, not a fault.
        </p>
      </div>
    </UCard>

    <!-- Identity and removal -->
    <UCard v-if="selected">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-settings-2" />
          <span class="font-medium">{{ selected.name }} — details</span>
        </div>
      </template>

      <div class="space-y-4 max-w-xl">
        <UFormField label="Name">
          <div class="flex gap-2">
            <UInput v-model="nameDraft" size="sm" class="flex-1" />
            <UButton
              label="Rename"
              size="sm"
              variant="outline"
              :loading="renaming"
              :disabled="!nameChanged"
              @click="saveName"
            />
          </div>
        </UFormField>

        <dl class="text-sm grid grid-cols-3 gap-y-2">
          <dt class="text-gray-500">Connection</dt>
          <dd class="col-span-2">
            {{ selected.connection === 'local' ? 'This browser, over WebUSB' : 'Server' }}
            <span class="text-gray-500">({{ selected.transport }})</span>
          </dd>

          <template v-if="selected.cupsName">
            <dt class="text-gray-500">CUPS queue</dt>
            <dd class="col-span-2 font-mono text-xs">{{ selected.cupsName }}</dd>
          </template>

          <template v-if="selected.deviceId">
            <dt class="text-gray-500">USB device</dt>
            <dd class="col-span-2 font-mono text-xs break-all">{{ selected.deviceId }}</dd>
          </template>
        </dl>

        <div class="flex flex-wrap gap-2 border-t pt-4">
          <UButton
            v-if="selected.connection === 'server' && !selected.isDefault"
            label="Make server default"
            icon="i-lucide-star"
            size="sm"
            variant="outline"
            :loading="settingDefault"
            @click="makeDefault"
          />
          <UButton
            v-if="!confirmRemove"
            label="Remove printer"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="sm"
            @click="confirmRemove = true"
          />
          <template v-else>
            <UButton
              label="Confirm remove"
              icon="i-lucide-trash-2"
              color="error"
              variant="soft"
              size="sm"
              :loading="removing"
              @click="remove"
            />
            <UButton label="Cancel" variant="ghost" size="sm" @click="confirmRemove = false" />
          </template>
        </div>
        <p v-if="confirmRemove" class="text-xs text-gray-500">
          Removes the printer and its configuration. Print history is kept.
        </p>
      </div>
    </UCard>
  </div>
</template>
