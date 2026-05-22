<template>
  <Dialog v-model="show" :options="{ title: pivotId ? 'Edit pivot table' : 'Create pivot table', size: 'lg' }">
    <template #body-content>

      <!-- ── Source range ─────────────────────────────────────────────────── -->
      <div class="pv-section">
        <p class="pv-label">Source range</p>
        <div class="pv-range-row">
          <FormControl
            v-model="rangeInput"
            type="text"
            placeholder="e.g. A1:F100"
            class="pv-range-input"
            @blur="detectFields"
            @keydown.enter.prevent="detectFields"
          />
          <Button size="sm" variant="outline" label="Detect fields" @click="detectFields" />
        </div>
        <p v-if="rangeError" class="pv-error">{{ rangeError }}</p>
      </div>

      <!-- ── Buckets ──────────────────────────────────────────────────────── -->
      <div v-if="availableFields.length" class="pv-buckets">

        <!-- Rows -->
        <div class="pv-bucket">
          <p class="pv-bucket-label">
            <FeatherIcon name="align-left" class="pv-bucket-icon" /> Rows
          </p>
          <div class="pv-bucket-body">
            <div v-for="f in rowFields" :key="f" class="pv-chip">
              <span class="pv-chip-label">{{ f }}</span>
              <button class="pv-chip-x" @click="removeFrom('rows', f)">
                <FeatherIcon name="x" class="pv-chip-x-icon" />
              </button>
            </div>
            <Dropdown :options="addFieldOpts('rows')" placement="bottom-start">
              <template #default="{ open }">
                <Button size="sm" :variant="open ? 'subtle' : 'ghost'" icon="plus" label="Add field" class="pv-add-btn" />
              </template>
            </Dropdown>
          </div>
        </div>

        <!-- Columns -->
        <div class="pv-bucket">
          <p class="pv-bucket-label">
            <FeatherIcon name="columns" class="pv-bucket-icon" /> Columns
          </p>
          <div class="pv-bucket-body">
            <div v-for="f in colFields" :key="f" class="pv-chip">
              <span class="pv-chip-label">{{ f }}</span>
              <button class="pv-chip-x" @click="removeFrom('cols', f)">
                <FeatherIcon name="x" class="pv-chip-x-icon" />
              </button>
            </div>
            <Dropdown :options="addFieldOpts('cols')" placement="bottom-start">
              <template #default="{ open }">
                <Button size="sm" :variant="open ? 'subtle' : 'ghost'" icon="plus" label="Add field" class="pv-add-btn" />
              </template>
            </Dropdown>
          </div>
        </div>

        <!-- Values -->
        <div class="pv-bucket">
          <p class="pv-bucket-label">
            <FeatherIcon name="hash" class="pv-bucket-icon" /> Values
          </p>
          <div class="pv-bucket-body">
            <div v-for="v in valueFields" :key="v.field" class="pv-chip pv-chip--value">
              <Dropdown :options="aggOpts(v)" placement="bottom-start">
                <template #default>
                  <button class="pv-agg-btn">{{ v.agg.toUpperCase() }}</button>
                </template>
              </Dropdown>
              <span class="pv-chip-label">{{ v.field }}</span>
              <button class="pv-chip-x" @click="removeFrom('values', v.field)">
                <FeatherIcon name="x" class="pv-chip-x-icon" />
              </button>
            </div>
            <Dropdown :options="addFieldOpts('values')" placement="bottom-start">
              <template #default="{ open }">
                <Button size="sm" :variant="open ? 'subtle' : 'ghost'" icon="plus" label="Add field" class="pv-add-btn" />
              </template>
            </Dropdown>
          </div>
        </div>

      </div>

      <!-- ── Preview ────────────────────────────────────────────────────────── -->
      <div v-if="previewTable.length" class="pv-section">
        <p class="pv-label">Preview <span class="pv-preview-hint">(first 6 rows)</span></p>
        <div class="pv-preview-wrap">
          <table class="pv-preview-table">
            <thead>
              <tr>
                <th v-for="(h, i) in previewTable[0]" :key="i" class="pv-th">{{ h }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in previewTable.slice(1)" :key="ri" :class="{ 'pv-total-row': ri === previewTable.length - 2 }">
                <td v-for="(cell, ci) in row" :key="ci" class="pv-td" :class="{ 'pv-td--num': typeof cell === 'number' }">
                  {{ cell === '' ? '' : cell }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </template>

    <template #actions>
      <Button @click="show = false">Cancel</Button>
      <Button
        variant="solid"
        :disabled="!canCreate"
        :label="pivotId ? 'Update pivot' : 'Create pivot'"
        @click="onConfirm"
      />
    </template>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { AGG_OPTIONS, computePivot } from '../../engine/pivot.js'

const props = defineProps({
  modelValue:     { type: Boolean, default: false },
  sheet:          { type: Object,  required: true },
  currentSheet:   { type: String,  default: '' },
  initialRange:   { type: String,  default: '' },
  pivotId:        { type: String,  default: '' },
  existingConfig: { type: Object,  default: null },
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const show = computed({
  get: () => props.modelValue,
  set: v  => emit('update:modelValue', v),
})

// ── State ────────────────────────────────────────────────────────────────────

const rangeInput      = ref('')
const rangeError      = ref('')
const availableFields = ref([])
const rowFields       = ref([])
const colFields       = ref([])
const valueFields     = ref([])   // { field, agg }[]

watch(show, open => {
  if (!open) return
  if (props.existingConfig) {
    const c = props.existingConfig
    rangeInput.value  = c.sourceRange || ''
    rowFields.value   = [...(c.rows   || [])]
    colFields.value   = [...(c.cols   || [])]
    valueFields.value = (c.values || []).map(v => ({ ...v }))
    _parseFields()
  } else {
    rangeInput.value  = props.initialRange || ''
    rowFields.value   = []
    colFields.value   = []
    valueFields.value = []
    availableFields.value = []
    if (rangeInput.value) detectFields()
  }
})

// ── Field detection ───────────────────────────────────────────────────────────

function _parseFields() {
  const range = rangeInput.value.trim()
  if (!range) { rangeError.value = 'Enter a range first.'; return false }
  const [start, end] = range.includes(':') ? range.split(':') : [range, range]
  const data = props.sheet.getRangeValues(start, end, props.currentSheet)
  if (!data || !data[0]) { rangeError.value = 'Could not read range.'; return false }
  rangeError.value = ''
  // Filter out blank/null/zero cells — those are empty header columns
  availableFields.value = data[0]
    .filter(h => h !== null && h !== undefined && h !== '' && h !== 0)
    .map(h => String(h))
  return true
}

function detectFields() { _parseFields() }

// ── Field assignment ──────────────────────────────────────────────────────────

function addFieldOpts(bucket) {
  return availableFields.value.map(f => ({
    label:   f,
    onClick: () => addTo(bucket, f),
  }))
}

function addTo(bucket, f) {
  if (bucket === 'rows'   && !rowFields.value.includes(f))              rowFields.value.push(f)
  if (bucket === 'cols'   && !colFields.value.includes(f))              colFields.value.push(f)
  if (bucket === 'values' && !valueFields.value.some(v => v.field === f)) valueFields.value.push({ field: f, agg: 'sum' })
}

function removeFrom(bucket, f) {
  if (bucket === 'rows')   rowFields.value   = rowFields.value.filter(x => x !== f)
  if (bucket === 'cols')   colFields.value   = colFields.value.filter(x => x !== f)
  if (bucket === 'values') valueFields.value = valueFields.value.filter(v => v.field !== f)
}

function aggOpts(v) {
  return AGG_OPTIONS.map(o => ({
    label:   o.label,
    onClick: () => { v.agg = o.value },
  }))
}

// ── Preview ───────────────────────────────────────────────────────────────────

const previewTable = computed(() => {
  if (!rowFields.value.length || !valueFields.value.length || !rangeInput.value) return []
  const config = {
    sourceSheet: props.currentSheet,
    sourceRange: rangeInput.value.trim(),
    rows:   rowFields.value,
    cols:   colFields.value,
    values: valueFields.value,
  }
  const table = computePivot(config, (s, e, sh) => props.sheet.getRangeValues(s, e, sh))
  return table.slice(0, 7)   // header + 5 data rows + total
})

// ── Confirm ───────────────────────────────────────────────────────────────────

const canCreate = computed(() =>
  availableFields.value.length > 0
  && rowFields.value.length > 0
  && valueFields.value.length > 0
  && !rangeError.value
)

function onConfirm() {
  if (!canCreate.value) return
  emit('confirm', {
    id:          props.pivotId || undefined,
    sourceSheet: props.currentSheet,
    sourceRange: rangeInput.value.trim(),
    rows:        [...rowFields.value],
    cols:        [...colFields.value],
    values:      valueFields.value.map(v => ({ ...v })),
  })
  show.value = false
}
</script>

<style scoped>
.pv-section { margin-bottom: 20px; }

.pv-label {
  font-size: 12px; font-weight: 600; color: var(--ink-gray-6);
  text-transform: uppercase; letter-spacing: .04em; margin: 0 0 8px;
}

.pv-range-row { display: flex; gap: 8px; align-items: center; }
.pv-range-input { flex: 1; }

.pv-error { font-size: 12px; color: var(--ink-red-5); margin: 4px 0 0; }

/* ── Buckets ── */
.pv-buckets {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;
  margin-bottom: 20px;
}
.pv-bucket {
  border: 1px solid var(--outline-gray-2); border-radius: 8px; padding: 10px 10px 8px;
  min-height: 100px; display: flex; flex-direction: column;
}
.pv-bucket-label {
  font-size: 11px; font-weight: 600; color: var(--ink-gray-5);
  text-transform: uppercase; letter-spacing: .04em;
  display: flex; align-items: center; gap: 4px; margin: 0 0 8px;
}
.pv-bucket-icon { width: 12px; height: 12px; }

.pv-bucket-body { display: flex; flex-direction: column; gap: 4px; flex: 1; }

/* ── Field chips ── */
.pv-chip {
  display: flex; align-items: center; gap: 4px;
  background: var(--surface-gray-2); border-radius: 6px;
  padding: 3px 6px 3px 8px; font-size: 12px; color: var(--ink-gray-8);
}
.pv-chip--value { padding-left: 4px; }
.pv-chip-label  { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pv-chip-x {
  background: none; border: none; cursor: pointer; padding: 1px;
  display: flex; align-items: center; color: var(--ink-gray-4);
  border-radius: 3px; flex-shrink: 0;
}
.pv-chip-x:hover { background: var(--surface-gray-4); color: var(--ink-gray-7); }
.pv-chip-x-icon  { width: 11px; height: 11px; }

.pv-agg-btn {
  background: var(--surface-gray-4); border: none; border-radius: 4px;
  padding: 1px 5px; font-size: 10px; font-weight: 700; color: var(--ink-gray-7);
  cursor: pointer; white-space: nowrap; flex-shrink: 0;
}
.pv-agg-btn:hover { background: var(--outline-gray-3); }

.pv-add-btn { margin-top: 2px; }
.pv-add-btn :deep(button) { color: var(--ink-gray-5); font-size: 12px; }

/* ── Preview table ── */
.pv-preview-hint { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--ink-gray-4); }
.pv-preview-wrap {
  overflow-x: auto; border: 1px solid var(--outline-gray-2);
  border-radius: 8px; max-height: 200px; overflow-y: auto;
}
.pv-preview-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.pv-th {
  background: var(--surface-gray-2); font-weight: 600; color: var(--ink-gray-7);
  padding: 6px 10px; text-align: left; white-space: nowrap;
  border-bottom: 1px solid var(--outline-gray-2); position: sticky; top: 0;
}
.pv-td {
  padding: 5px 10px; color: var(--ink-gray-8); border-bottom: 1px solid var(--outline-gray-1);
  white-space: nowrap;
}
.pv-td--num { text-align: right; font-variant-numeric: tabular-nums; }
.pv-total-row .pv-td { font-weight: 600; background: var(--surface-gray-1); }
</style>
