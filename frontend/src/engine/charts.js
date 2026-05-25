// Chart engine — pure store, no Vue / DOM / ECharts here.
//
// Same shape as `engine/pivot.js`: an in-memory map of chart configs with
// `add/update/remove/list/snapshot/restore` and an `onChange` callback the
// Vue layer subscribes to so reactive computeds re-evaluate when configs
// mutate. The mutation set is what lands in sheets_data, persisted by
// usePersistence alongside formats / merge / pivots / etc.
//
// ChartConfig shape:
//   {
//     id, sourceSheet, sourceRange,    // e.g. "Sheet1", "A1:D20"
//     chartType,                       // 'line' | 'bar' | 'pie' | 'area' | 'scatter'
//     title,
//     hasHeader,                       // first row of source treated as labels
//     encoding: {                      // which column maps to which axis
//       x: number,                     // column index (0-based) into sourceRange
//       y: number[],                   // 1+ series columns
//     },
//     position: { sheet, x, y, width, height },  // px on the canvas overlay
//     options: { stacked, smooth, showLegend, colorScheme }
//   }
//
// Pure store — no rendering, no data fetching, no ECharts.

export function createChartEngine() {
	let _charts  = {}   // id → ChartConfig
	let _nextId  = 1
	let _onChange = null

	function _newId() { return `chart_${_nextId++}` }
	function _notify() { _onChange?.() }

	function setOnChange(cb) { _onChange = cb }

	function add(config) {
		const id = config.id || _newId()
		_charts[id] = { ...config, id }
		_notify()
		return id
	}

	function update(id, patch) {
		if (!_charts[id]) return
		_charts[id] = { ..._charts[id], ...patch, id }
		_notify()
	}

	function remove(id) {
		if (id in _charts) { delete _charts[id]; _notify() }
	}

	function get(id)  { return _charts[id] }
	function list()   { return Object.values(_charts) }

	function listForSheet(sheetName) {
		return Object.values(_charts).filter(c => c.position?.sheet === sheetName)
	}

	// True when `sheetName` is the source for any chart — drives "should I
	// recompute" decisions when cells change.
	function affectsChart(sheetName) {
		return Object.values(_charts).some(c => c.sourceSheet === sheetName)
	}

	function snapshot() {
		return { charts: JSON.parse(JSON.stringify(_charts)), nextId: _nextId }
	}

	function restore(data) {
		if (!data) return
		_charts = JSON.parse(JSON.stringify(data.charts || {}))
		_nextId = data.nextId || 1
		// Defensive: keep nextId ahead of any restored id so future _newId()
		// can't collide with one that's already there.
		for (const id of Object.keys(_charts)) {
			const m = /^chart_(\d+)$/.exec(id)
			if (m) {
				const n = parseInt(m[1], 10)
				if (n >= _nextId) _nextId = n + 1
			}
		}
		_notify()
	}

	return {
		add, update, remove, get, list, listForSheet, affectsChart,
		snapshot, restore, setOnChange,
	}
}

// ── Helpers shared with view layer ───────────────────────────────────────────

// Default position for a freshly-inserted chart. The overlay offsets
// subsequent inserts so they don't stack perfectly on top of each other.
export const DEFAULT_CHART_SIZE = { width: 480, height: 320 }

// Stable list of supported chart types — keep in sync with what ChartView
// knows how to render.
export const CHART_TYPES = ['line', 'bar', 'pie', 'area', 'scatter']

export function isValidChartType(t) {
	return CHART_TYPES.includes(t)
}

// Espresso-aligned categorical palette. ECharts default greys clash with
// the rest of the UI; this set matches the cyan accent already used in the
// brand mark and the cursor palette.
export const ESPRESSO_PALETTE = [
	'#0E7490', '#A5F0FA', '#0891B2', '#67E8F9',
	'#155E75', '#22D3EE', '#0C4A6E', '#7DD3FC',
]
