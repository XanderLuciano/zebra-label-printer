<script setup lang="ts">
/**
 * TemplateCanvas — interactive WYSIWYG editor surface for a label template.
 *
 * Renders the *resolved* elements (so it matches print output) as scaled SVG,
 * supports click-to-select and drag-to-move. Movement is emitted as new
 * percentage coordinates so the parent can write to the base template or a
 * per-size override.
 */
import type { LabelTemplate, Rotation, ResolvedElement } from '../composables/useTemplateEngine'
import { resolveTemplate, effectiveElement } from '../composables/useTemplateEngine'
import { zplTextRender, type ZplTextRender } from '../composables/useZplFonts'

/** Degree labels for the rotation marker on the selected element */
const rotationLabels: Record<Rotation, string> = { N: '0°', R: '90°', I: '180°', B: '270°' }

const props = withDefaults(defineProps<{
  template: LabelTemplate
  values: Record<string, string>
  widthDots: number
  heightDots: number
  selectedId?: string | null
  maxWidthPx?: number
  maxHeightPx?: number
}>(), {
  selectedId: null,
  maxWidthPx: 520,
  maxHeightPx: 520,
})

const emit = defineEmits<{
  (e: 'select', id: string | null): void
  (e: 'move', payload: { id: string; xPct: number; yPct: number }): void
}>()

const svgRef = ref<SVGSVGElement | null>(null)

/**
 * A resolved element plus, for text, the SVG attributes that reproduce its ZPL
 * font on screen.
 *
 * Computed once per element here rather than called from the template, so the
 * six attributes each `<text>` needs don't each trigger their own measurement
 * pass on every re-render.
 */
type DrawableElement = ResolvedElement & { render?: ZplTextRender }

const resolved = computed<DrawableElement[]>(() =>
  resolveTemplate(props.template, props.values, { widthDots: props.widthDots, heightDots: props.heightDots })
    .map(el => el.type === 'text' && el.textMetrics
      ? { ...el, render: zplTextRender(el.textMetrics, el.font, el.y) }
      : el)
)

// Fit the label within the max box while preserving aspect ratio.
const display = computed(() => {
  const scaleW = props.maxWidthPx / props.widthDots
  const scaleH = props.maxHeightPx / props.heightDots
  const scale = Math.min(scaleW, scaleH)
  return {
    width: Math.round(props.widthDots * scale),
    height: Math.round(props.heightDots * scale),
  }
})

// ─── Drag handling ──────────────────────────────────────────────────────────
interface DragState {
  id: string
  startPct: { x: number; y: number }
  startClient: { x: number; y: number }
}
let drag: DragState | null = null

function elById(id: string) {
  const el = props.template.elements.find(e => e.id === id)
  if (!el) return null
  return effectiveElement(el, props.template, { widthDots: props.widthDots, heightDots: props.heightDots })
}

function onPointerDown(id: string, ev: PointerEvent) {
  ev.preventDefault()
  emit('select', id)
  const el = elById(id)
  if (!el) return
  drag = {
    id,
    startPct: { x: el.xPct, y: el.yPct },
    startClient: { x: ev.clientX, y: ev.clientY },
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(ev: PointerEvent) {
  if (!drag || !svgRef.value) return
  const rect = svgRef.value.getBoundingClientRect()
  const dxDots = ((ev.clientX - drag.startClient.x) / rect.width) * props.widthDots
  const dyDots = ((ev.clientY - drag.startClient.y) / rect.height) * props.heightDots
  const xPct = clamp(drag.startPct.x + (dxDots / props.widthDots) * 100)
  const yPct = clamp(drag.startPct.y + (dyDots / props.heightDots) * 100)
  emit('move', { id: drag.id, xPct: round2(xPct), yPct: round2(yPct) })
}

function onPointerUp() {
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
}

function clamp(v: number) { return Math.max(-20, Math.min(120, v)) }
function round2(v: number) { return Math.round(v * 100) / 100 }

function onBackgroundClick() {
  emit('select', null)
}

onBeforeUnmount(onPointerUp)

// Fake barcode bar widths for the placeholder
function barX(el: { x: number; w: number }, j: number) {
  return el.x + (j / 24) * el.w
}
</script>

<template>
  <div class="inline-block">
    <svg
      ref="svgRef"
      :width="display.width"
      :height="display.height"
      :viewBox="`0 0 ${widthDots} ${heightDots}`"
      class="border border-gray-300 dark:border-gray-600 rounded bg-white shadow-sm touch-none select-none"
      xmlns="http://www.w3.org/2000/svg"
      @pointerdown.self="onBackgroundClick"
    >
      <!-- Label background -->
      <rect x="0" y="0" :width="widthDots" :height="heightDots" fill="white" @pointerdown.self="onBackgroundClick" />

      <template v-for="el in resolved" :key="el.id">
        <!--
          Shapes are drawn in the element's unrotated coordinate space; the
          group transform rotates them into the position ZPL would print them.
          See rotationTransform() in useTemplateEngine.
        -->
        <g
          class="cursor-move"
          :transform="el.transform || undefined"
          @pointerdown="onPointerDown(el.id, $event)"
        >
          <!--
            Text, drawn with the metrics of the ZPL font it will actually print
            in. `font-size` comes from the printer's cap height divided by the
            preview face's own cap ratio, and the baseline sits at the measured
            offset below ^FO — ZPL anchors the *top of the capitals* there, not
            the baseline. `textLength` with lengthAdjust="spacingAndGlyphs"
            forces the run to its measured advance width, which is what makes the
            Font and Aspect ratio controls visibly change the preview.
          -->
          <template v-if="el.type === 'text' && el.render">
            <!-- ^FR inverts the field. Painting the backing black keeps reversed
                 text legible instead of drawing white on white. -->
            <rect
              v-if="el.reverse"
              :x="el.x"
              :y="el.y"
              :width="el.w"
              :height="el.h"
              fill="black"
            />
            <text
              :x="el.x"
              :y="el.render.baselineY"
              :font-size="el.render.fontSize"
              :class="el.render.faceClass"
              :textLength="el.render.textLength"
              lengthAdjust="spacingAndGlyphs"
              :fill="el.reverse ? 'white' : 'black'"
              xml:space="preserve"
            >{{ el.render.content }}</text>
          </template>

          <!-- Box / line -->
          <rect
            v-else-if="el.type === 'box'"
            :x="el.x"
            :y="el.y"
            :width="el.w"
            :height="el.h"
            :fill="el.fill ? 'black' : 'none'"
            stroke="black"
            :stroke-width="el.fill ? 0 : 3"
          />

          <!-- QR placeholder -->
          <g v-else-if="el.type === 'qrcode'">
            <rect :x="el.x" :y="el.y" :width="el.w" :height="el.h" fill="white" stroke="black" stroke-width="2" />
            <rect :x="el.x + el.w * 0.08" :y="el.y + el.h * 0.08" :width="el.w * 0.24" :height="el.h * 0.24" fill="black" />
            <rect :x="el.x + el.w * 0.68" :y="el.y + el.h * 0.08" :width="el.w * 0.24" :height="el.h * 0.24" fill="black" />
            <rect :x="el.x + el.w * 0.08" :y="el.y + el.h * 0.68" :width="el.w * 0.24" :height="el.h * 0.24" fill="black" />
            <rect :x="el.x + el.w * 0.42" :y="el.y + el.h * 0.42" :width="el.w * 0.16" :height="el.h * 0.16" fill="black" opacity="0.35" />
          </g>

          <!-- Barcode placeholder -->
          <g v-else-if="el.type === 'barcode'">
            <template v-if="el.barcodeType === 'QRCODE' || el.barcodeType === 'DATAMATRIX'">
              <rect :x="el.x" :y="el.y" :width="el.h" :height="el.h" fill="white" stroke="black" stroke-width="2" />
              <rect :x="el.x + 6" :y="el.y + 6" :width="el.h * 0.25" :height="el.h * 0.25" fill="black" />
            </template>
            <template v-else>
              <rect :x="el.x" :y="el.y" :width="el.w" :height="el.h" fill="white" />
              <line
                v-for="j in 24"
                :key="j"
                :x1="barX(el, j)"
                :y1="el.y"
                :x2="barX(el, j)"
                :y2="el.y + el.h"
                stroke="black"
                :stroke-width="(j % 3 === 0 ? 4 : 2)"
              />
              <text
                :x="el.x + el.w / 2"
                :y="el.y + el.h + 22"
                font-size="20"
                font-family="monospace"
                fill="black"
                text-anchor="middle"
              >{{ el.text }}</text>
            </template>
          </g>

          <!-- Selection outline — inside the rotated group, so it hugs the
               element in its printed orientation -->
          <rect
            v-if="el.id === selectedId"
            :x="el.x - 4"
            :y="el.y - 4"
            :width="el.w + 8"
            :height="el.h + 8"
            fill="none"
            stroke="#3b82f6"
            stroke-width="2"
            stroke-dasharray="6 4"
            vector-effect="non-scaling-stroke"
          />
        </g>

        <!-- Rotation marker: the un-rotated footprint origin, so it's obvious
             which corner stays pinned when rotation changes -->
        <g v-if="el.id === selectedId && el.rotation !== 'N'" pointer-events="none">
          <circle :cx="el.bounds.x" :cy="el.bounds.y" r="6" fill="#3b82f6" />
          <text
            :x="el.bounds.x + 12"
            :y="el.bounds.y - 8"
            font-size="18"
            font-family="'Helvetica Neue', Arial, sans-serif"
            fill="#3b82f6"
          >{{ rotationLabels[el.rotation] }}</text>
        </g>
      </template>
    </svg>
  </div>
</template>
