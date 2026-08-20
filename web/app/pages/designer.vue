<script setup lang="ts">
/**
 * Label Template Designer.
 *
 * Design reusable label templates with relative positioning, {{variable}}
 * data binding, per-size overrides, real-time canvas preview, and pixel-accurate
 * Labelary rendering. Templates auto-scale to any label size; overrides let you
 * fine-tune a design for a specific size.
 */
import type {
  LabelTemplate, TemplateElement, ElementType,
  BarcodeType, Rotation, ErrorCorrection, TextAlign,
} from '../composables/useTemplateEngine'
import {
  emptyTemplate, newElement, resolveTemplate, toPrintElements, sizeKey, substitute,
  SIZE_PRESETS, BARCODE_TYPES, DPI,
} from '../composables/useTemplateEngine'
import {
  ZPL_FONT_IDS, zplFont, measureZplText, DESIGNER_DEFAULT_RATIO,
} from '../composables/useZplFonts'

const api = useApi()
const toast = useToast()
// Routes prints to the server queue or a local USB printer, per the
// per-browser preference in Settings.
const { printLabel, load: loadPrintTarget } = usePrintTarget()

// Literal token example for help text (kept out of the template to avoid
// the Vue compiler tripping on nested `{{ }}` delimiters).
const tokenExample = '{{partNumber}}'

// ─── State ────────────────────────────────────────────────────────────────
const template = ref<LabelTemplate>(emptyTemplate())
const selectedId = ref<string | null>(null)
const values = reactive<Record<string, string>>({})

const targetW = ref(template.value.baseWidthDots)
const targetH = ref(template.value.baseHeightDots)

const savedTemplates = ref<Array<{ id: string; name: string }>>([])
// undefined rather than null: USelect's modelValue is `string | undefined`, and
// both render as "nothing selected".
const loadId = ref<string | undefined>(undefined)
const saving = ref(false)
const printing = ref(false)

// Accurate (Labelary) preview
const autoAccurate = ref(false)
const accurateUrl = ref<string | null>(null)
const accurateError = ref<string | null>(null)
const accurateLoading = ref(false)
const lastZpl = ref('')

// ─── Derived ──────────────────────────────────────────────────────────────
const isBase = computed(() =>
  targetW.value === template.value.baseWidthDots && targetH.value === template.value.baseHeightDots
)
const currentSizeKey = computed(() => sizeKey(targetW.value, targetH.value))
const hasOverrides = computed(() => !!template.value.overrides[currentSizeKey.value])

const selectedEl = computed<TemplateElement | null>(() => {
  if (!selectedId.value) return null
  const el = template.value.elements.find(e => e.id === selectedId.value)
  if (!el) return null
  if (isBase.value) return el
  const ov = template.value.overrides[currentSizeKey.value]?.[el.id]
  return ov ? ({ ...el, ...ov } as TemplateElement) : el
})

const resolved = computed(() =>
  resolveTemplate(template.value, values, { widthDots: targetW.value, heightDots: targetH.value })
)

/**
 * What the selected text element's font and size actually come out as.
 *
 * Two things are otherwise invisible. Bitmap fonts A–H only render at whole
 * multiples of their character cell, so a font height of 14% can quietly snap to
 * something noticeably different — the number input says one thing and the
 * printer does another. And now that text width is measured properly, it's worth
 * saying when a string runs off the edge of the label.
 */
const selectedFontInfo = computed(() => {
  const el = selectedEl.value
  if (!el || el.type !== 'text') return null

  const requestedHeight = Math.max(1, Math.round((el.fontHeightPct / 100) * targetH.value))
  const requestedWidth = Math.max(1, Math.round(requestedHeight * (el.ratio ?? DESIGNER_DEFAULT_RATIO)))
  const metrics = measureZplText(
    substitute(el.content, values, template.value.variables),
    { font: el.font, height: requestedHeight, width: requestedWidth },
  )
  const drawn = resolved.value.find(r => r.id === el.id)

  return {
    spec: zplFont(el.font),
    requestedHeight,
    requestedWidth,
    metrics,
    /** True when the run extends past the right or bottom label edge. */
    overflows: drawn
      ? drawn.bounds.x + drawn.bounds.w > targetW.value || drawn.bounds.y + drawn.bounds.h > targetH.value
      : false,
  }
})

// ─── Variable value syncing ─────────────────────────────────────────────────
watch(() => template.value.variables.map(v => v.name), () => {
  for (const v of template.value.variables) {
    if (values[v.name] === undefined) values[v.name] = ''
  }
}, { immediate: true, deep: true })

// ─── Element mutation (routes to base or per-size override) ─────────────────
function patchEl(id: string, patch: Record<string, unknown>) {
  const el = template.value.elements.find(e => e.id === id)
  if (!el) return
  if (isBase.value) {
    Object.assign(el, patch)
  } else {
    const key = currentSizeKey.value
    if (!template.value.overrides[key]) template.value.overrides[key] = {}
    if (!template.value.overrides[key][id]) template.value.overrides[key][id] = {}
    Object.assign(template.value.overrides[key][id], patch)
  }
}

function setField(field: string, value: unknown) {
  if (!selectedId.value) return
  patchEl(selectedId.value, { [field]: value })
}

function fieldModel<T>(name: string, numeric = false) {
  return computed<T>({
    get: () => (selectedEl.value as Record<string, unknown> | null)?.[name] as T,
    set: (v: T) => setField(name, numeric ? Number(v) : v),
  })
}

// Field models for the property editor (reactive so writable computeds unwrap in template)
const f = reactive({
  name: fieldModel<string>('name'),
  content: fieldModel<string>('content'),
  xPct: fieldModel<number>('xPct', true),
  yPct: fieldModel<number>('yPct', true),
  rotation: fieldModel<Rotation>('rotation'),
  hidden: fieldModel<boolean>('hidden'),
  fontHeightPct: fieldModel<number>('fontHeightPct', true),
  ratio: fieldModel<number>('ratio', true),
  font: fieldModel<string>('font'),
  reverse: fieldModel<boolean>('reverse'),
  align: fieldModel<TextAlign>('align'),
  // Typed as BarcodeType, not string: it's bound to a USelect built from
  // BARCODE_TYPES, so widening to string would discard the only check that a
  // valid symbology reaches the printer.
  barcodeType: fieldModel<BarcodeType>('barcodeType'),
  heightPct: fieldModel<number>('heightPct', true),
  narrowBarWidth: fieldModel<number>('narrowBarWidth', true),
  humanReadable: fieldModel<boolean>('humanReadable'),
  magnification: fieldModel<number>('magnification', true),
  errorCorrection: fieldModel<ErrorCorrection>('errorCorrection'),
  widthPct: fieldModel<number>('widthPct', true),
  thickness: fieldModel<number>('thickness', true),
  rounding: fieldModel<number>('rounding', true),
  fill: fieldModel<boolean>('fill'),
})

// ─── Canvas events ──────────────────────────────────────────────────────────
function onSelect(id: string | null) { selectedId.value = id }
function onMove(p: { id: string; xPct: number; yPct: number }) {
  patchEl(p.id, { xPct: p.xPct, yPct: p.yPct })
}

// ─── Element list actions ───────────────────────────────────────────────────
function addElement(type: ElementType) {
  const el = newElement(type)
  template.value.elements.push(el)
  selectedId.value = el.id
}

function deleteElement(id: string) {
  template.value.elements = template.value.elements.filter(e => e.id !== id)
  // Iterate values, not keys: an indexed lookup is `| undefined` under
  // noUncheckedIndexedAccess even though the key demonstrably exists.
  for (const sizeOverrides of Object.values(template.value.overrides)) {
    Reflect.deleteProperty(sizeOverrides, id)
  }
  if (selectedId.value === id) selectedId.value = null
}

function duplicateElement(id: string) {
  const el = template.value.elements.find(e => e.id === id)
  if (!el) return
  const copy = JSON.parse(JSON.stringify(el)) as TemplateElement
  copy.id = `${el.type}_${Date.now().toString(36)}`
  copy.xPct = Math.min(120, el.xPct + 5)
  copy.yPct = Math.min(120, el.yPct + 5)
  template.value.elements.push(copy)
  selectedId.value = copy.id
}

function elementLabel(el: TemplateElement): string {
  return el.name || el.type
}

// ─── Variables ──────────────────────────────────────────────────────────────
function addVariable() {
  const n = template.value.variables.length + 1
  template.value.variables.push({ name: `var${n}`, label: '', sample: '' })
}
function removeVariable(idx: number) {
  template.value.variables.splice(idx, 1)
}
function insertVariable(name: string) {
  if (!selectedEl.value || !('content' in selectedEl.value)) return
  const cur = (selectedEl.value.content as string) ?? ''
  setField('content', `${cur}{{${name}}}`)
}

// ─── Sizes ──────────────────────────────────────────────────────────────────
function applyBasePreset(key: string) {
  const p = SIZE_PRESETS.find(s => sizeKey(s.widthDots, s.heightDots) === key)
  if (!p) return
  template.value.baseWidthDots = p.widthDots
  template.value.baseHeightDots = p.heightDots
  targetW.value = p.widthDots
  targetH.value = p.heightDots
}
function applyTargetPreset(key: string) {
  const p = SIZE_PRESETS.find(s => sizeKey(s.widthDots, s.heightDots) === key)
  if (!p) return
  targetW.value = p.widthDots
  targetH.value = p.heightDots
}
function resetToBaseSize() {
  targetW.value = template.value.baseWidthDots
  targetH.value = template.value.baseHeightDots
}
function clearOverrides() {
  Reflect.deleteProperty(template.value.overrides, currentSizeKey.value)
}

// ─── Select item lists ──────────────────────────────────────────────────────
const sizeItems = SIZE_PRESETS.map(s => ({
  label: `${s.name} (${s.widthDots}×${s.heightDots})`,
  value: sizeKey(s.widthDots, s.heightDots),
}))
const fontItems = ZPL_FONT_IDS.map(v => ({ label: zplFont(v).label, value: v as string }))
const barcodeItems = BARCODE_TYPES.map(v => ({ label: v, value: v }))
// Annotated rather than inferred: without the value type these arrays infer
// `value: string`, which widens the bound USelect and silently allows an invalid
// value to reach the ZPL builder.
const rotationItems: Array<{ label: string; value: Rotation }> = [
  { label: '0°', value: 'N' }, { label: '90°', value: 'R' },
  { label: '180°', value: 'I' }, { label: '270°', value: 'B' },
]
const alignItems: Array<{ label: string; value: TextAlign }> = [
  { label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }, { label: 'Right', value: 'right' },
]
const ecItems: Array<{ label: string; value: ErrorCorrection }> = [
  { label: 'L (7%)', value: 'L' }, { label: 'M (15%)', value: 'M' },
  { label: 'Q (25%)', value: 'Q' }, { label: 'H (30%)', value: 'H' },
]

// ─── Persistence ────────────────────────────────────────────────────────────
function buildDef(): Record<string, unknown> {
  const t = template.value
  return {
    name: t.name,
    description: t.description || undefined,
    baseWidthDots: t.baseWidthDots,
    baseHeightDots: t.baseHeightDots,
    variables: t.variables,
    elements: t.elements,
    overrides: t.overrides,
  }
}

async function refreshTemplateList() {
  try {
    const res = await api.listTemplates()
    savedTemplates.value = res.templates.map(t => ({ id: t.id, name: t.name }))
  } catch { /* ignore */ }
}

async function save() {
  saving.value = true
  try {
    const def = buildDef()
    if (template.value.id) {
      await api.updateTemplate(template.value.id, def)
      toast.add({ title: 'Template updated', color: 'success' })
    } else {
      const res = await api.createTemplate(def)
      template.value.id = res.template.id
      loadId.value = res.template.id
      toast.add({ title: 'Template saved', color: 'success' })
    }
    await refreshTemplateList()
  } catch (e) {
    toast.add({ title: 'Save failed', description: (e as Error).message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function loadTemplate(id: string) {
  try {
    const res = await api.getTemplate(id)
    const t = res.template
    template.value = {
      id: t.id,
      name: t.name,
      description: t.description ?? '',
      baseWidthDots: t.baseWidthDots,
      baseHeightDots: t.baseHeightDots,
      variables: t.variables ?? [],
      elements: t.elements ?? [],
      overrides: t.overrides ?? {},
    }
    for (const k of Object.keys(values)) Reflect.deleteProperty(values, k)
    for (const v of template.value.variables) values[v.name] = ''
    targetW.value = t.baseWidthDots
    targetH.value = t.baseHeightDots
    selectedId.value = null
    loadId.value = id
  } catch (e) {
    toast.add({ title: 'Load failed', description: (e as Error).message, color: 'error' })
  }
}

function newTemplate() {
  template.value = emptyTemplate()
  for (const k of Object.keys(values)) Reflect.deleteProperty(values, k)
  for (const v of template.value.variables) values[v.name] = ''
  targetW.value = template.value.baseWidthDots
  targetH.value = template.value.baseHeightDots
  selectedId.value = null
  loadId.value = undefined
}

async function removeTemplate() {
  if (!template.value.id) return
  try {
    await api.deleteTemplate(template.value.id)
    toast.add({ title: 'Template deleted', color: 'success' })
    await refreshTemplateList()
    newTemplate()
  } catch (e) {
    toast.add({ title: 'Delete failed', description: (e as Error).message, color: 'error' })
  }
}

watch(loadId, (id) => { if (id && id !== template.value.id) loadTemplate(id) })

// Keep the preview target locked to the base size while they match, so editing
// the base dimensions doesn't unexpectedly drop you into override-editing mode.
watch(() => [template.value.baseWidthDots, template.value.baseHeightDots] as const, ([nw, nh], [ow, oh]) => {
  if (targetW.value === ow && targetH.value === oh) {
    targetW.value = nw
    targetH.value = nh
  }
})

// ─── Printing ─────────────────────────────────────────────────────────────
async function printTest() {
  const elements = toPrintElements(resolved.value)
  if (!elements.length) {
    toast.add({ title: 'Nothing to print', description: 'Add at least one element.', color: 'warning' })
    return
  }
  printing.value = true
  try {
    const res = await printLabel({ elements })
    toast.add(res.success
      ? { title: res.target === 'local' ? 'Sent to local USB printer' : 'Sent to printer', color: 'success' }
      : { title: 'Print failed', description: res.error, color: 'error' })
  } finally {
    printing.value = false
  }
}

// ─── Accurate (Labelary) preview ────────────────────────────────────────────
async function fetchAccurate() {
  const elements = toPrintElements(resolved.value)
  if (!elements.length) { accurateUrl.value = null; return }
  accurateLoading.value = true
  accurateError.value = null
  try {
    const { zpl } = await api.renderZpl({ elements, widthDots: targetW.value, heightDots: targetH.value })
    lastZpl.value = zpl
    const wIn = (targetW.value / DPI).toFixed(2)
    const hIn = (targetH.value / DPI).toFixed(2)
    const resp = await fetch(`https://api.labelary.com/v1/printers/8dpmm/labels/${wIn}x${hIn}/0/`, {
      method: 'POST',
      // Labelary only accepts form-encoded or multipart bodies. Without an
      // explicit Content-Type the browser sends text/plain for a string body and
      // every request comes back 415, which is why this preview never rendered.
      headers: { Accept: 'image/png', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: zpl,
    })
    if (!resp.ok) {
      accurateError.value = `Labelary error (${resp.status}): ${await resp.text()}`
      return
    }
    const blob = await resp.blob()
    if (accurateUrl.value) URL.revokeObjectURL(accurateUrl.value)
    accurateUrl.value = URL.createObjectURL(blob)
  } catch (e) {
    accurateError.value = (e as Error).message
  } finally {
    accurateLoading.value = false
  }
}

let accurateTimer: ReturnType<typeof setTimeout> | null = null
watch([resolved, targetW, targetH], () => {
  if (!autoAccurate.value) return
  if (accurateTimer) clearTimeout(accurateTimer)
  accurateTimer = setTimeout(fetchAccurate, 800)
})
watch(autoAccurate, (on) => { if (on) fetchAccurate() })

onMounted(() => {
  loadPrintTarget()
  refreshTemplateList()
})
</script>

<template>
  <div class="p-4 lg:p-6">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-3 mb-5">
      <h1 class="text-2xl font-bold flex items-center gap-2 mr-2">
        <UIcon name="i-lucide-pen-tool" class="text-primary-500" />
        Template Designer
      </h1>

      <UInput
        v-model="template.name"
        placeholder="Template name"
        class="w-56"
        icon="i-lucide-tag"
      />

      <USelect
        v-model="loadId"
        :items="savedTemplates.map(t => ({ label: t.name, value: t.id }))"
        placeholder="Load template…"
        icon="i-lucide-folder-open"
        class="w-52"
      />

      <div class="flex-1" />

      <UButton icon="i-lucide-file-plus" variant="soft" color="neutral" label="New" @click="newTemplate" />
      <UButton icon="i-lucide-save" color="primary" label="Save" :loading="saving" @click="save" />
      <UButton
        v-if="template.id"
        icon="i-lucide-trash-2"
        color="error"
        variant="soft"
        label="Delete"
        @click="removeTemplate"
      />
      <UButton icon="i-lucide-printer" color="success" label="Print test" :loading="printing" @click="printTest" />
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-[280px_1fr_300px] gap-5">
      <!-- ── Left column: elements, variables, mock data ─────────────────── -->
      <div class="space-y-5 order-2 xl:order-1">
        <UCard :ui="{ body: 'p-4 space-y-3' }">
          <template #header>
            <span class="font-medium text-sm">Add element</span>
          </template>
          <div class="grid grid-cols-2 gap-2">
            <UButton size="sm" variant="soft" icon="i-lucide-type" label="Text" block @click="addElement('text')" />
            <UButton size="sm" variant="soft" icon="i-lucide-barcode" label="Barcode" block @click="addElement('barcode')" />
            <UButton size="sm" variant="soft" icon="i-lucide-qr-code" label="QR" block @click="addElement('qrcode')" />
            <UButton size="sm" variant="soft" icon="i-lucide-square" label="Box/Line" block @click="addElement('box')" />
          </div>
        </UCard>

        <UCard :ui="{ body: 'p-2' }">
          <template #header>
            <span class="font-medium text-sm">Elements ({{ template.elements.length }})</span>
          </template>
          <div v-if="!template.elements.length" class="text-xs text-gray-500 p-3 text-center">
            No elements yet. Add one above.
          </div>
          <ul class="space-y-1">
            <li
              v-for="el in template.elements"
              :key="el.id"
              class="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm"
              :class="el.id === selectedId ? 'bg-primary-50 dark:bg-primary-950 text-primary-700 dark:text-primary-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800'"
              @click="onSelect(el.id)"
            >
              <UIcon
                :name="el.type === 'text' ? 'i-lucide-type' : el.type === 'barcode' ? 'i-lucide-barcode' : el.type === 'qrcode' ? 'i-lucide-qr-code' : 'i-lucide-square'"
                class="shrink-0"
              />
              <span class="flex-1 truncate">{{ elementLabel(el) }}</span>
              <UButton icon="i-lucide-copy" size="xs" variant="ghost" color="neutral" @click.stop="duplicateElement(el.id)" />
              <UButton icon="i-lucide-x" size="xs" variant="ghost" color="error" @click.stop="deleteElement(el.id)" />
            </li>
          </ul>
        </UCard>

        <UCard :ui="{ body: 'p-4 space-y-3' }">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-medium text-sm">Variables</span>
              <UButton icon="i-lucide-plus" size="xs" variant="soft" label="Add" @click="addVariable" />
            </div>
          </template>
          <div v-if="!template.variables.length" class="text-xs text-gray-500">
            Define variables like <code>partNumber</code>, then reference them in element content as <code>{{ tokenExample }}</code>.
          </div>
          <div v-for="(v, idx) in template.variables" :key="idx" class="space-y-1.5 border-b border-gray-100 dark:border-gray-800 pb-3 last:border-0">
            <div class="flex items-center gap-2">
              <UInput v-model="v.name" size="xs" placeholder="name" class="flex-1" />
              <UButton icon="i-lucide-x" size="xs" variant="ghost" color="error" @click="removeVariable(idx)" />
            </div>
            <UInput v-model="v.label" size="xs" placeholder="Display label (optional)" />
            <UInput v-model="v.sample" size="xs" placeholder="Sample / mock value" icon="i-lucide-flask-conical" />
          </div>
        </UCard>

        <UCard :ui="{ body: 'p-4 space-y-3' }">
          <template #header>
            <span class="font-medium text-sm">Test data</span>
          </template>
          <div v-if="!template.variables.length" class="text-xs text-gray-500">No variables to fill.</div>
          <UFormField v-for="v in template.variables" :key="v.name" :label="v.label || v.name" size="xs">
            <UInput v-model="values[v.name]" size="sm" :placeholder="v.sample || 'value'" />
          </UFormField>
        </UCard>
      </div>

      <!-- ── Center column: canvas + previews ────────────────────────────── -->
      <div class="space-y-4 order-1 xl:order-2">
        <UCard :ui="{ body: 'p-4' }">
          <div class="flex flex-wrap items-center gap-3 mb-4">
            <UFormField label="Preview size" class="min-w-48">
              <USelect
                :model-value="currentSizeKey"
                :items="sizeItems"
                @update:model-value="applyTargetPreset"
              />
            </UFormField>
            <UFormField label="Width (dots)">
              <UInput v-model.number="targetW" type="number" class="w-24" />
            </UFormField>
            <UFormField label="Height (dots)">
              <UInput v-model.number="targetH" type="number" class="w-24" />
            </UFormField>
            <div class="self-end">
              <UButton
                v-if="!isBase"
                size="sm"
                variant="soft"
                color="neutral"
                icon="i-lucide-undo"
                label="Back to base size"
                @click="resetToBaseSize"
              />
            </div>
          </div>

          <UAlert
            v-if="!isBase"
            color="warning"
            variant="soft"
            icon="i-lucide-layers"
            class="mb-4"
            :title="`Editing overrides for ${targetW}×${targetH}`"
            :description="hasOverrides
              ? 'Changes here only affect this size. The base design is unchanged.'
              : 'This size auto-scales from the base design. Any change you make becomes an override for this size only.'"
          >
            <template #actions>
              <UButton v-if="hasOverrides" size="xs" color="warning" variant="soft" label="Clear overrides" @click="clearOverrides" />
            </template>
          </UAlert>

          <div class="flex justify-center bg-gray-50 dark:bg-gray-900 rounded-lg p-4 overflow-auto">
            <TemplateCanvas
              :template="template"
              :values="values"
              :width-dots="targetW"
              :height-dots="targetH"
              :selected-id="selectedId"
              :max-width-px="560"
              :max-height-px="520"
              @select="onSelect"
              @move="onMove"
            />
          </div>
          <p class="text-xs text-gray-500 mt-2 text-center">
            Drag elements to reposition · positions are relative (%), so the design scales to any size.
          </p>
        </UCard>

        <UCard :ui="{ body: 'p-4' }">
          <div class="flex items-center justify-between mb-3">
            <span class="font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-scan-eye" /> Accurate preview (Labelary)
            </span>
            <div class="flex items-center gap-3">
              <UCheckbox v-model="autoAccurate" label="Live" />
              <UButton size="xs" icon="i-lucide-refresh-cw" :loading="accurateLoading" label="Render" @click="fetchAccurate" />
            </div>
          </div>
          <UAlert
            v-if="accurateError"
            color="error"
            variant="soft"
            :description="accurateError"
            class="mb-3"
          />
          <div class="flex justify-center bg-gray-100 dark:bg-gray-900 rounded p-4 min-h-24 items-center">
            <img v-if="accurateUrl" :src="accurateUrl" alt="Accurate label preview" class="max-w-full border border-gray-300 dark:border-gray-600 bg-white">
            <span v-else class="text-xs text-gray-500">
              Renders real ZPL via Labelary for a pixel-accurate preview. Requires internet.
            </span>
          </div>
          <details v-if="lastZpl" class="mt-3">
            <summary class="text-xs text-gray-500 cursor-pointer">View generated ZPL</summary>
            <pre class="text-xs bg-gray-900 text-green-300 rounded p-3 mt-2 overflow-auto max-h-56">{{ lastZpl }}</pre>
          </details>
        </UCard>
      </div>

      <!-- ── Right column: element properties ────────────────────────────── -->
      <div class="order-3">
        <UCard :ui="{ body: 'p-4 space-y-3' }">
          <template #header>
            <span class="font-medium text-sm">Properties</span>
          </template>

          <div v-if="!selectedEl" class="text-xs text-gray-500 py-6 text-center">
            Select an element to edit its properties.
          </div>

          <template v-else>
            <UFormField label="Name">
              <UInput v-model="f.name" size="sm" placeholder="Element name" />
            </UFormField>

            <!-- Content + variable inserters -->
            <template v-if="selectedEl.type !== 'box'">
              <UFormField label="Content">
                <UTextarea v-model="f.content" :rows="2" size="sm" autoresize />
              </UFormField>
              <div v-if="template.variables.length" class="flex flex-wrap gap-1">
                <UBadge
                  v-for="v in template.variables"
                  :key="v.name"
                  color="neutral"
                  variant="soft"
                  size="sm"
                  class="cursor-pointer"
                  @click="insertVariable(v.name)"
                >+ {{ v.name }}</UBadge>
              </div>
            </template>

            <!-- Position -->
            <div class="grid grid-cols-2 gap-2">
              <UFormField label="X (%)">
                <UInput v-model="f.xPct" type="number" size="sm" step="0.5" />
              </UFormField>
              <UFormField label="Y (%)">
                <UInput v-model="f.yPct" type="number" size="sm" step="0.5" />
              </UFormField>
            </div>

            <!-- Text-specific -->
            <template v-if="selectedEl.type === 'text'">
              <div class="grid grid-cols-2 gap-2">
                <UFormField label="Font height (%)">
                  <UInput v-model="f.fontHeightPct" type="number" size="sm" step="0.5" />
                </UFormField>
                <UFormField label="Aspect ratio" help="Character width ÷ height">
                  <UInput v-model="f.ratio" type="number" size="sm" step="0.05" />
                </UFormField>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <UFormField label="Font">
                  <USelect v-model="f.font" :items="fontItems" size="sm" />
                </UFormField>
                <UFormField label="Align">
                  <USelect v-model="f.align" :items="alignItems" size="sm" />
                </UFormField>
              </div>

              <!-- What the font and size actually resolve to on the printer -->
              <div v-if="selectedFontInfo" class="text-xs text-gray-500 space-y-1">
                <p>{{ selectedFontInfo.spec.description }}</p>
                <p>
                  Capitals
                  <span class="font-medium">{{ Math.round(selectedFontInfo.metrics.capHeight) }}</span> dots tall ·
                  text
                  <span class="font-medium">{{ Math.round(selectedFontInfo.metrics.width) }}</span> of
                  {{ targetW }} dots wide
                </p>
                <p v-if="selectedFontInfo.spec.kind === 'bitmap'">
                  Bitmap font — renders at
                  {{ selectedFontInfo.metrics.heightMagnification }}× ×
                  {{ selectedFontInfo.metrics.widthMagnification }}× of its
                  {{ selectedFontInfo.spec.cellHeight }}×{{ selectedFontInfo.spec.cellWidth }} cell, so
                  sizes snap — asking for {{ selectedFontInfo.requestedHeight }} dots gives
                  {{ selectedFontInfo.metrics.cellHeight }}.
                </p>
                <p v-if="selectedFontInfo.spec.charset === 'ocr-a'" class="text-warning">
                  OCR-A has no lowercase — those characters print as blanks.
                </p>
                <p v-else-if="selectedFontInfo.spec.charset === 'upper'" class="text-warning">
                  Uppercase-only font — lowercase is folded up.
                </p>
                <p v-if="selectedFontInfo.overflows" class="text-error">
                  This text runs past the edge of the label.
                </p>
              </div>

              <UCheckbox v-model="f.reverse" label="Reverse (white on black)" />
            </template>

            <!-- Barcode-specific -->
            <template v-else-if="selectedEl.type === 'barcode'">
              <UFormField label="Barcode type">
                <USelect v-model="f.barcodeType" :items="barcodeItems" size="sm" />
              </UFormField>
              <div class="grid grid-cols-2 gap-2">
                <UFormField label="Height (%)">
                  <UInput v-model="f.heightPct" type="number" size="sm" step="0.5" />
                </UFormField>
                <UFormField label="Narrow bar">
                  <UInput v-model="f.narrowBarWidth" type="number" size="sm" />
                </UFormField>
              </div>
              <UCheckbox v-model="f.humanReadable" label="Human-readable text" />
            </template>

            <!-- QR-specific -->
            <template v-else-if="selectedEl.type === 'qrcode'">
              <div class="grid grid-cols-2 gap-2">
                <UFormField label="Magnification">
                  <UInput v-model="f.magnification" type="number" size="sm" :min="1" :max="10" />
                </UFormField>
                <UFormField label="Error correction">
                  <USelect v-model="f.errorCorrection" :items="ecItems" size="sm" />
                </UFormField>
              </div>
            </template>

            <!-- Box-specific -->
            <template v-else-if="selectedEl.type === 'box'">
              <div class="grid grid-cols-2 gap-2">
                <UFormField label="Width (%)">
                  <UInput v-model="f.widthPct" type="number" size="sm" step="0.5" />
                </UFormField>
                <UFormField label="Height (%)">
                  <UInput v-model="f.heightPct" type="number" size="sm" step="0.5" />
                </UFormField>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <UFormField label="Thickness (dots)">
                  <UInput v-model="f.thickness" type="number" size="sm" />
                </UFormField>
                <UFormField label="Rounding">
                  <UInput v-model="f.rounding" type="number" size="sm" :min="0" :max="8" />
                </UFormField>
              </div>
              <UCheckbox v-model="f.fill" label="Filled (solid)" />
            </template>

            <!-- Common: rotation + visibility -->
            <UFormField label="Rotation">
              <USelect v-model="f.rotation" :items="rotationItems" size="sm" />
            </UFormField>
            <UCheckbox v-model="f.hidden" :label="isBase ? 'Hidden' : 'Hidden on this size'" />
          </template>
        </UCard>

        <UCard class="mt-5" :ui="{ body: 'p-4 space-y-3' }">
          <template #header>
            <span class="font-medium text-sm">Base design size</span>
          </template>
          <p class="text-xs text-gray-500">
            The reference size you design against. Everything positions relative to it.
          </p>
          <USelect
            :model-value="sizeKey(template.baseWidthDots, template.baseHeightDots)"
            :items="sizeItems"
            size="sm"
            @update:model-value="applyBasePreset"
          />
          <div class="grid grid-cols-2 gap-2">
            <UFormField label="Width (dots)">
              <UInput v-model.number="template.baseWidthDots" type="number" size="sm" />
            </UFormField>
            <UFormField label="Height (dots)">
              <UInput v-model.number="template.baseHeightDots" type="number" size="sm" />
            </UFormField>
          </div>
        </UCard>
      </div>
    </div>
  </div>
</template>
