<script setup lang="ts">
/**
 * LabelPreview — renders a visual preview of a printed label.
 *
 * Takes the label `elements` array in the /api/print/label payload shape plus
 * the label size in dots, and draws a scaled SVG approximation.
 *
 * Element rotation is honoured: each shape is drawn in its unrotated
 * coordinate space and placed with an SVG transform, matching how ZPL treats
 * `^FO` as the top-left of the *rotated* bounding box. The geometry lives in
 * useTemplateEngine so the designer canvas and this preview agree.
 */
import type { Rotation, PrintLabelElement, BarcodeType } from '../composables/useTemplateEngine';
import { rotationTransform, estimateBarcodeWidth, is2dSymbology } from '../composables/useTemplateEngine';
import {
  measureZplText,
  resolveFontSize,
  zplTextRender,
  type ZplTextRender,
} from '../composables/useZplFonts';

/** A drawable element: unrotated geometry plus the transform that places it. */
interface DrawnElement {
  key: number;
  kind: 'text' | 'qrcode' | 'barcode' | 'matrix' | 'box';
  x: number;
  y: number;
  w: number;
  h: number;
  transform?: string;
  text: string;
  reverse: boolean;
  showText: boolean;
  /** SVG text attributes derived from the element's ZPL font. Text only. */
  render?: ZplTextRender;
}

const props = withDefaults(defineProps<{
  elements: PrintLabelElement[];
  widthDots?: number;
  heightDots?: number;
  dpi?: number;
  maxWidthPx?: number;
}>(), {
  widthDots: 406,
  heightDots: 203,
  dpi: 203,
  maxWidthPx: 400,
});

const scale = computed(() => props.maxWidthPx / props.widthDots);
const svgWidth = computed(() => props.widthDots * scale.value);
const svgHeight = computed(() => props.heightDots * scale.value);

// Parse raw ZPL `^FO{x},{y}^GB{w},{h},{t}` into a rectangle. Box elements bake
// their rotation into the ^GB dimensions, so no transform is needed here.
function parseGraphicBox(zpl: string) {
  const match = zpl.match(/\^FO(\d+),(\d+)\^GB(\d+),(\d+),(\d+)/);
  if (!match) return null;
  return {
    x: parseInt(match[1]!, 10),
    y: parseInt(match[2]!, 10),
    w: parseInt(match[3]!, 10),
    h: parseInt(match[4]!, 10),
  };
}

const drawn = computed<DrawnElement[]>(() => {
  const out: DrawnElement[] = [];

  props.elements.forEach((el, i) => {
    const o = el.options ?? {};
    const x = o.x ?? 0;
    const y = o.y ?? 0;
    const rotation: Rotation = o.rotation ?? 'N';
    const content = el.content ?? '';

    if (el.type === 'text' && content) {
      // Resolve the ^A parameters exactly as ZPLBuilder.text() would, then ask
      // the font for its real metrics. History entries are raw print payloads,
      // so the height/width/ratio defaulting has to match the builder's or a
      // reprinted label won't look like its own preview.
      const size = resolveFontSize({ height: o.height, width: o.width, ratio: o.ratio });
      const metrics = measureZplText(content, { font: o.font, height: size.height, width: size.width });
      const w = Math.max(1, Math.round(metrics.width));
      // The character cell, not the ink: it is what ^FO anchors, so rotating it
      // is what puts rotated text in the right place. Same reasoning as
      // resolveTemplate().
      const h = Math.max(1, Math.round(metrics.cellHeight));
      out.push({
        key: i,
        kind: 'text',
        x,
        y,
        w,
        h,
        transform: rotationTransform({ x, y, w, h }, rotation) || undefined,
        text: metrics.printable,
        reverse: !!o.reverse,
        showText: false,
        render: zplTextRender(metrics, o.font, y),
      });
    } else if (el.type === 'qrcode' && content) {
      const size = (o.magnification ?? 5) * 21;
      out.push({
        key: i,
        kind: 'qrcode',
        x,
        y,
        w: size,
        h: size,
        transform: rotationTransform({ x, y, w: size, h: size }, rotation) || undefined,
        text: content,
        reverse: false,
        showText: false,
      });
    } else if (el.type === 'barcode' && content) {
      const h = o.height ?? 50;
      // 2D symbologies come through the barcode element too; those are square.
      const symbology = (o.type ?? 'CODE128') as BarcodeType;
      const is2d = is2dSymbology(symbology);
      const w = is2d ? h : estimateBarcodeWidth(content, symbology, o.narrowBarWidth);
      out.push({
        key: i,
        kind: is2d ? 'matrix' : 'barcode',
        x,
        y,
        w,
        h,
        transform: rotationTransform({ x, y, w, h }, rotation) || undefined,
        text: content,
        reverse: false,
        showText: o.humanReadable !== false && !is2d,
      });
    } else if (el.type === 'raw' && el.zpl) {
      const box = parseGraphicBox(el.zpl);
      if (box) {
        out.push({
          key: i,
          kind: 'box',
          ...box,
          text: '',
          reverse: false,
          showText: false,
        });
      }
    }
  });

  return out;
});

/** Evenly spaced fake bars across a barcode placeholder */
function barX(el: DrawnElement, j: number): number {
  return el.x + (j / 20) * el.w;
}
</script>

<template>
  <svg
    :width="svgWidth"
    :height="svgHeight"
    :viewBox="`0 0 ${widthDots} ${heightDots}`"
    class="border border-gray-300 rounded bg-white"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    :aria-label="`Label preview, ${widthDots} by ${heightDots} dots`"
  >
    <!-- Label background -->
    <rect x="0" y="0" :width="widthDots" :height="heightDots" fill="white" />

    <g v-for="el in drawn" :key="el.key" :transform="el.transform">
      <!-- Text, sized and spaced from the element's own ZPL font metrics -->
      <template v-if="el.kind === 'text' && el.render">
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

      <!-- QR code placeholder -->
      <template v-else-if="el.kind === 'qrcode'">
        <rect :x="el.x" :y="el.y" :width="el.w" :height="el.h" fill="white" stroke="black" stroke-width="1" />
        <!-- Finder patterns: top-left, top-right, bottom-left -->
        <rect :x="el.x + el.w * 0.06" :y="el.y + el.h * 0.06" :width="el.w * 0.24" :height="el.h * 0.24" fill="black" />
        <rect :x="el.x + el.w * 0.70" :y="el.y + el.h * 0.06" :width="el.w * 0.24" :height="el.h * 0.24" fill="black" />
        <rect :x="el.x + el.w * 0.06" :y="el.y + el.h * 0.70" :width="el.w * 0.24" :height="el.h * 0.24" fill="black" />
        <rect
          :x="el.x + el.w * 0.38"
          :y="el.y + el.h * 0.38"
          :width="el.w * 0.24"
          :height="el.h * 0.24"
          fill="black"
          opacity="0.3"
        />
      </template>

      <!-- 2D matrix placeholder (QR/Data Matrix via the barcode element) -->
      <template v-else-if="el.kind === 'matrix'">
        <rect :x="el.x" :y="el.y" :width="el.w" :height="el.h" fill="white" stroke="black" stroke-width="2" />
        <rect :x="el.x + el.w * 0.08" :y="el.y + el.h * 0.08" :width="el.w * 0.25" :height="el.h * 0.25" fill="black" />
      </template>

      <!-- 1D barcode placeholder -->
      <template v-else-if="el.kind === 'barcode'">
        <rect :x="el.x" :y="el.y" :width="el.w" :height="el.h" fill="white" />
        <line
          v-for="j in 20"
          :key="j"
          :x1="barX(el, j)"
          :y1="el.y"
          :x2="barX(el, j)"
          :y2="el.y + el.h"
          stroke="black"
          :stroke-width="j % 3 === 0 ? el.w / 40 : el.w / 90"
        />
        <text
          v-if="el.showText"
          :x="el.x + el.w / 2"
          :y="el.y + el.h + el.h * 0.28"
          :font-size="el.h * 0.24"
          font-family="monospace"
          fill="black"
          text-anchor="middle"
        >{{ el.text }}</text>
      </template>

      <!-- Box / line from raw ^GB -->
      <rect
        v-else-if="el.kind === 'box'"
        :x="el.x"
        :y="el.y"
        :width="el.w"
        :height="el.h"
        fill="black"
      />
    </g>
  </svg>
</template>
