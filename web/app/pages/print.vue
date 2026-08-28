<script setup lang="ts">
/**
 * Print from a saved template.
 *
 * The designer builds templates; this is where they get used. Pick one, fill in
 * its variables, check the preview, print. No layout controls — the whole point
 * is that whoever prints a label doesn't have to understand the design.
 *
 * Resolution happens client-side, the same `resolveTemplate()` the designer uses,
 * so the label that comes out here is identical to the designer's "Print test"
 * for the same inputs.
 */
import type { StoredTemplate } from '../composables/useApi'
import type { LabelTemplate } from '../composables/useTemplateEngine'
import {
  resolveTemplate, toPrintElements, usedVariables, sizeKey, SIZE_PRESETS,
} from '../composables/useTemplateEngine'

const api = useApi()
const toast = useToast()
const { printLabel, load: loadPrinters, printer: activePrinter } = usePrintTarget()

// ─── State ──────────────────────────────────────────────────────────────────
const templates = ref<StoredTemplate[]>([])
const loadingList = ref(true)
// undefined rather than null so USelect renders it as "nothing selected".
const selectedId = ref<string | undefined>(undefined)
const template = ref<LabelTemplate | null>(null)
const values = reactive<Record<string, string>>({})
const copies = ref(1)
const printing = ref(false)

/** Label size to render for. Defaults to the template's own base size. */
const widthDots = ref(406)
const heightDots = ref(203)

// ─── Derived ────────────────────────────────────────────────────────────────
const templateItems = computed(() =>
  templates.value.map(t => ({ label: t.name, value: t.id }))
)

/**
 * Variables to show as inputs.
 *
 * Declared variables come first, in the order the designer defined them. A
 * template can also reference a token it never declared — that would otherwise
 * be an invisible always-blank field, so those are listed too rather than
 * silently printing nothing.
 */
const fields = computed(() => {
  const tpl = template.value
  if (!tpl) return []
  const declared = tpl.variables.map(v => ({
    name: v.name,
    label: v.label || v.name,
    sample: v.sample,
    declared: true,
  }))
  const known = new Set(declared.map(d => d.name))
  const undeclared = usedVariables(tpl)
    .filter(name => !known.has(name))
    .map(name => ({ name, label: name, sample: '', declared: false }))
  return [...declared, ...undeclared]
})

/** Declared variables the template never actually uses — harmless but confusing. */
const unusedFields = computed(() => {
  const tpl = template.value
  if (!tpl) return []
  const used = new Set(usedVariables(tpl))
  return tpl.variables.filter(v => !used.has(v.name)).map(v => v.name)
})

const blankFields = computed(() =>
  fields.value.filter(f => !(values[f.name] ?? '').trim()).map(f => f.label)
)

/**
 * Resolved elements for the preview and the print payload.
 *
 * `useSamples: false` matters here: a blank field must stay blank rather than
 * inheriting the designer's mock value, or someone prints a label carrying a
 * sample part number and never notices.
 */
const resolved = computed(() => {
  const tpl = template.value
  if (!tpl) return []
  return resolveTemplate(
    tpl,
    values,
    { widthDots: widthDots.value, heightDots: heightDots.value },
    { useSamples: false },
  )
})

const printElements = computed(() => toPrintElements(resolved.value))

/** Elements whose ink falls outside the label. */
const overflowing = computed(() =>
  resolved.value.filter(el =>
    el.bounds.x < 0
    || el.bounds.y < 0
    || el.bounds.x + el.bounds.w > widthDots.value
    || el.bounds.y + el.bounds.h > heightDots.value
  ).length
)

const sizeItems = computed(() => {
  const items = SIZE_PRESETS.map(s => ({
    label: `${s.name} (${s.widthDots}×${s.heightDots})`,
    value: sizeKey(s.widthDots, s.heightDots),
  }))
  // A template's base size need not be one of the presets, and printing at a
  // size that isn't offered would be impossible otherwise.
  const tpl = template.value
  if (tpl) {
    const key = sizeKey(tpl.baseWidthDots, tpl.baseHeightDots)
    if (!items.some(i => i.value === key)) {
      items.unshift({ label: `Template default (${tpl.baseWidthDots}×${tpl.baseHeightDots})`, value: key })
    }
  }
  return items
})

const currentSizeKey = computed({
  get: () => sizeKey(widthDots.value, heightDots.value),
  set: (key: string) => {
    const [w, h] = key.split('x').map(Number)
    if (w && h) {
      widthDots.value = w
      heightDots.value = h
    }
  },
})

const isBaseSize = computed(() =>
  !!template.value
  && widthDots.value === template.value.baseWidthDots
  && heightDots.value === template.value.baseHeightDots
)

// ─── Loading ────────────────────────────────────────────────────────────────
async function refreshList() {
  loadingList.value = true
  try {
    const res = await api.listTemplates()
    templates.value = res.templates
  } catch (e) {
    toast.add({ title: 'Could not load templates', description: (e as Error).message, color: 'error' })
  } finally {
    loadingList.value = false
  }
}

async function selectTemplate(id: string) {
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
    for (const f of fields.value) values[f.name] = ''
    widthDots.value = t.baseWidthDots
    heightDots.value = t.baseHeightDots
  } catch (e) {
    toast.add({ title: 'Could not load template', description: (e as Error).message, color: 'error' })
  }
}

watch(selectedId, (id) => { if (id) selectTemplate(id) })

// Keep a value slot for every field, including undeclared tokens discovered
// after the template loads.
watch(fields, (list) => {
  for (const f of list) if (values[f.name] === undefined) values[f.name] = ''
}, { immediate: true })

function fillWithSamples() {
  for (const f of fields.value) {
    if (f.sample) values[f.name] = f.sample
  }
}

function clearFields() {
  for (const f of fields.value) values[f.name] = ''
}

// ─── Printing ───────────────────────────────────────────────────────────────
async function print() {
  const elements = printElements.value
  if (!elements.length) {
    toast.add({ title: 'Nothing to print', description: 'This template has no visible elements.', color: 'warning' })
    return
  }
  printing.value = true
  try {
    const res = await printLabel({ elements, copies: copies.value })
    toast.add(res.success
      ? {
          title: res.target === 'local' ? 'Sent to local USB printer' : 'Sent to printer',
          description: `${template.value?.name} · ${copies.value} ${copies.value === 1 ? 'copy' : 'copies'}`,
          color: 'success',
        }
      : { title: 'Print failed', description: res.error, color: 'error' })
  } finally {
    printing.value = false
  }
}

onMounted(() => {
  loadPrinters()
  refreshList()
})
</script>

<template>
  <div class="p-4 lg:p-6">
    <div class="flex flex-wrap items-center gap-3 mb-5">
      <h1 class="text-2xl font-bold flex items-center gap-2 mr-2">
        <UIcon name="i-lucide-printer" class="text-primary-500" />
        Print from Template
      </h1>
      <div class="flex-1" />
      <UBadge color="neutral" variant="soft" size="sm">
        <UIcon :name="activePrinter?.connection === 'local' ? 'i-lucide-usb' : 'i-lucide-server'" class="mr-1" />
        {{ activePrinter ? `${activePrinter.name} · ${activePrinter.labelSize.name}` : 'No printer set up' }}
      </UBadge>
      <UButton
        icon="i-lucide-pen-tool"
        variant="soft"
        color="neutral"
        label="Designer"
        to="/designer"
      />
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start">
      <!-- ── Left: template picker + variable fields ───────────────────── -->
      <div class="space-y-5">
        <UCard :ui="{ body: 'p-4 space-y-3' }">
          <template #header>
            <span class="font-medium text-sm">Template</span>
          </template>

          <USelect
            v-model="selectedId"
            :items="templateItems"
            :loading="loadingList"
            placeholder="Choose a template…"
            icon="i-lucide-folder-open"
            class="w-full"
          />

          <p v-if="!loadingList && !templates.length" class="text-xs text-gray-500">
            No templates saved yet. Create one in the
            <NuxtLink to="/designer" class="text-primary-500 underline">Template Designer</NuxtLink>.
          </p>
          <p v-else-if="template?.description" class="text-xs text-gray-500">
            {{ template.description }}
          </p>
        </UCard>

        <UCard v-if="template" :ui="{ body: 'p-4 space-y-3' }">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <span class="font-medium text-sm">Label data</span>
              <div class="flex items-center gap-2">
                <UButton
                  v-if="fields.some(f => f.sample)"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-lucide-wand-2"
                  label="Use samples"
                  @click="fillWithSamples"
                />
                <UButton
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-lucide-eraser"
                  label="Clear"
                  @click="clearFields"
                />
              </div>
            </div>
          </template>

          <p v-if="!fields.length" class="text-xs text-gray-500 py-2">
            This template has no variables — it prints the same label every time.
          </p>

          <UFormField
            v-for="f in fields"
            :key="f.name"
            :label="f.label"
            :help="f.declared ? undefined : 'Referenced in the design but not declared as a variable'"
          >
            <UInput
              v-model="values[f.name]"
              :placeholder="f.sample ? `e.g. ${f.sample}` : f.name"
              class="w-full"
              @keydown.enter="print"
            />
          </UFormField>

          <UAlert
            v-if="blankFields.length"
            color="warning"
            variant="soft"
            icon="i-lucide-triangle-alert"
            :title="`${blankFields.length} field${blankFields.length > 1 ? 's' : ''} left blank`"
            :description="`${blankFields.join(', ')} will print empty.`"
          />
          <UAlert
            v-if="unusedFields.length"
            color="neutral"
            variant="soft"
            icon="i-lucide-info"
            title="Unused variables"
            :description="`${unusedFields.join(', ')} — declared but not placed in the design, so filling them changes nothing.`"
          />
        </UCard>

        <UCard v-if="template" :ui="{ body: 'p-4 space-y-3' }">
          <template #header>
            <span class="font-medium text-sm">Output</span>
          </template>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Label size">
              <USelect v-model="currentSizeKey" :items="sizeItems" class="w-full" />
            </UFormField>
            <UFormField label="Copies">
              <UInput v-model.number="copies" type="number" :min="1" :max="10" class="w-full" />
            </UFormField>
          </div>

          <p v-if="!isBaseSize" class="text-xs text-gray-500">
            Printing at a size other than the template's
            {{ template.baseWidthDots }}×{{ template.baseHeightDots }} base. The design
            scales automatically, and any per-size tweaks saved in the designer apply.
          </p>

          <UButton
            icon="i-lucide-printer"
            color="primary"
            size="lg"
            block
            :label="`Print ${copies > 1 ? copies + ' labels' : 'label'}`"
            :loading="printing"
            :disabled="!printElements.length"
            @click="print"
          />
        </UCard>
      </div>

      <!-- ── Right: preview ────────────────────────────────────────────── -->
      <UCard v-if="template" :ui="{ body: 'p-4' }">
        <template #header>
          <span class="font-medium text-sm flex items-center gap-2">
            <UIcon name="i-lucide-eye" /> Preview
          </span>
        </template>

        <div class="flex justify-center bg-gray-50 dark:bg-gray-900 rounded-lg p-4 overflow-auto">
          <LabelPreview
            :elements="printElements"
            :width-dots="widthDots"
            :height-dots="heightDots"
            :max-width-px="440"
          />
        </div>

        <UAlert
          v-if="overflowing"
          class="mt-3"
          color="warning"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :title="`${overflowing} element${overflowing > 1 ? 's' : ''} outside the label`"
          description="Shorten the text, pick a larger label, or adjust the template in the designer."
        />
        <p class="text-xs text-gray-500 mt-2 text-center">
          Text is measured with the real metrics of each ZPL font, so widths here match the printer.
        </p>
      </UCard>
    </div>
  </div>
</template>
