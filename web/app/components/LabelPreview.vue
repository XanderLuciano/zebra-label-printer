<script setup lang="ts">
/**
 * LabelPreview — renders a visual preview of a printed label.
 * Takes the label elements array and label size (in dots) and renders
 * a scaled SVG representation of what the label looks like.
 */

interface LabelElement {
  type: 'text' | 'qrcode' | 'barcode' | 'raw';
  content?: string;
  zpl?: string;
  options?: {
    x?: number;
    y?: number;
    height?: number;
    width?: number;
    magnification?: number;
    type?: string;
  };
}

const props = withDefaults(defineProps<{
  elements: LabelElement[];
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
</script>

<template>
  <svg
    :width="svgWidth"
    :height="svgHeight"
    :viewBox="`0 0 ${widthDots} ${heightDots}`"
    class="border border-gray-300 rounded bg-white"
    xmlns="http://www.w3.org/2000/svg"
  >
    <!-- Label background -->
    <rect x="0" y="0" :width="widthDots" :height="heightDots" fill="white" />

    <template v-for="(el, i) in elements" :key="i">
      <!-- Text element -->
      <text
        v-if="el.type === 'text' && el.content"
        :x="el.options?.x ?? 0"
        :y="(el.options?.y ?? 0) + (el.options?.height ?? 20)"
        :font-size="el.options?.height ?? 20"
        font-family="monospace"
        fill="black"
      >
        {{ el.content }}
      </text>

      <!-- QR code placeholder -->
      <g v-else-if="el.type === 'qrcode' && el.content">
        <rect
          :x="el.options?.x ?? 0"
          :y="el.options?.y ?? 0"
          :width="(el.options?.magnification ?? 5) * 21"
          :height="(el.options?.magnification ?? 5) * 21"
          fill="white"
          stroke="black"
          stroke-width="1"
        />
        <!-- Simple QR pattern representation -->
        <rect
          :x="(el.options?.x ?? 0) + 2"
          :y="(el.options?.y ?? 0) + 2"
          :width="(el.options?.magnification ?? 5) * 5"
          :height="(el.options?.magnification ?? 5) * 5"
          fill="black"
        />
        <rect
          :x="(el.options?.x ?? 0) + (el.options?.magnification ?? 5) * 16 - 2"
          :y="(el.options?.y ?? 0) + 2"
          :width="(el.options?.magnification ?? 5) * 5"
          :height="(el.options?.magnification ?? 5) * 5"
          fill="black"
        />
        <rect
          :x="(el.options?.x ?? 0) + 2"
          :y="(el.options?.y ?? 0) + (el.options?.magnification ?? 5) * 16 - 2"
          :width="(el.options?.magnification ?? 5) * 5"
          :height="(el.options?.magnification ?? 5) * 5"
          fill="black"
        />
        <!-- Center data area -->
        <rect
          :x="(el.options?.x ?? 0) + (el.options?.magnification ?? 5) * 7"
          :y="(el.options?.y ?? 0) + (el.options?.magnification ?? 5) * 7"
          :width="(el.options?.magnification ?? 5) * 7"
          :height="(el.options?.magnification ?? 5) * 7"
          fill="black"
          opacity="0.3"
        />
        <!-- QR label text (small) -->
        <text
          :x="(el.options?.x ?? 0) + (el.options?.magnification ?? 5) * 10.5"
          :y="(el.options?.y ?? 0) + (el.options?.magnification ?? 5) * 21 + 10"
          font-size="8"
          font-family="monospace"
          fill="#666"
          text-anchor="middle"
        >
          QR
        </text>
      </g>

      <!-- Barcode placeholder -->
      <g v-else-if="el.type === 'barcode' && el.content">
        <rect
          :x="el.options?.x ?? 0"
          :y="el.options?.y ?? 0"
          :width="150"
          :height="el.options?.height ?? 50"
          fill="white"
          stroke="black"
          stroke-width="0.5"
        />
        <!-- Barcode lines pattern -->
        <line
          v-for="j in 20"
          :key="j"
          :x1="(el.options?.x ?? 0) + j * 7"
          :y1="el.options?.y ?? 0"
          :x2="(el.options?.x ?? 0) + j * 7"
          :y2="(el.options?.y ?? 0) + (el.options?.height ?? 50)"
          stroke="black"
          :stroke-width="j % 3 === 0 ? 3 : 1"
        />
        <text
          :x="(el.options?.x ?? 0) + 75"
          :y="(el.options?.y ?? 0) + (el.options?.height ?? 50) + 12"
          font-size="10"
          font-family="monospace"
          fill="black"
          text-anchor="middle"
        >
          {{ el.content }}
        </text>
      </g>
    </template>
  </svg>
</template>
