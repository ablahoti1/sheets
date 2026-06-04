<template>
  <div class="cv-wrap" :style="_wrapStyle">
    <VChart
      v-if="option"
      class="cv-chart"
      :option="option"
      :update-options="UPDATE_OPTS"
      autoresize
    />
    <div v-else class="cv-empty">No data</div>
  </div>
</template>

<script setup>
// Thin presentational wrapper around `vue-echarts`. Receives a ChartConfig
// and a matrix of source values; converts them to an ECharts option via
// `engine/chart-data.js`. Everything reactive — when the matrix or config
// changes, ECharts diff-updates in place.
//
// We lazy-register only the chart types we actually use so the bundle
// doesn't drag in the full ECharts library.

import { computed, defineAsyncComponent, onBeforeUnmount, shallowRef, watchEffect } from 'vue'

// Width/height accept either a pixel number (overlay charts get a fixed
// frame) or the string "auto" (preview / responsive contexts where the
// parent controls layout via flex/grid). Echarts `autoresize` handles the
// reflow in both cases.
const _toCssDim = (v) => (v === 'auto' || v == null) ? '100%' : (typeof v === 'number' ? v + 'px' : v)
import { use as echartsUse } from 'echarts/core'
import { CanvasRenderer }    from 'echarts/renderers'
import {
  LineChart, BarChart, PieChart, ScatterChart,
} from 'echarts/charts'
import {
  TitleComponent, TooltipComponent, LegendComponent,
  GridComponent, DataZoomComponent,
} from 'echarts/components'
import { buildOption } from '../../engine/chart-data.js'

// One-time global registration. Idempotent — repeated calls are no-ops.
echartsUse([
  CanvasRenderer,
  LineChart, BarChart, PieChart, ScatterChart,
  TitleComponent, TooltipComponent, LegendComponent,
  GridComponent, DataZoomComponent,
])

// `vue-echarts` is itself heavy; lazy-load the component so editor mount
// doesn't pay for it when no charts exist on the sheet.
const VChart = defineAsyncComponent(() => import('vue-echarts'))

const props = defineProps({
  config: { type: Object, required: true },
  matrix: { type: Array,  default: () => [] },
  width:  { type: [Number, String], default: 480 },
  height: { type: [Number, String], default: 320 },
})

const _wrapStyle = computed(() => ({
  width:  _toCssDim(props.width),
  height: _toCssDim(props.height),
}))

// `notMerge: true` is required for chart-type switches to take effect.
// With merge enabled (ECharts default), switching from bar → line / area /
// pie / scatter keeps the previously-installed series components, so the
// canvas (and the preview in the chart dialog) kept showing a bar chart
// regardless of which type was selected. notMerge: true replaces every
// component on each setOption — perf-acceptable at the small N this dialog
// previews.
const UPDATE_OPTS = { notMerge: true, lazyUpdate: false }

const option = shallowRef(null)
let _rafId = 0

watchEffect(() => {
  // Throttle to one option rebuild per frame — formula recalcs can fire
  // dozens of cell updates in a tight loop during paste / import.
  cancelAnimationFrame(_rafId)
  _rafId = requestAnimationFrame(() => {
    option.value = buildOption(props.config, props.matrix)
  })
})

onBeforeUnmount(() => cancelAnimationFrame(_rafId))
</script>

<style scoped>
.cv-wrap {
  position: relative;
  background: var(--surface-white, #ffffff);
  border-radius: 8px;
  overflow: hidden;
}
.cv-chart { width: 100%; height: 100%; }
.cv-empty {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%;
  color: var(--ink-gray-4, #a3a3a3);
  font: 12px/1 InterVar, Inter, ui-sans-serif, system-ui, sans-serif;
}
</style>
