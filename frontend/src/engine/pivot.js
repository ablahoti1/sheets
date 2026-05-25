import { parseCellId, colLabel, cellId } from '../utils/cells.js'

export const AGG_OPTIONS = [
  { value: 'sum',    label: 'SUM'     },
  { value: 'count',  label: 'COUNT'   },
  { value: 'avg',    label: 'AVERAGE' },
  { value: 'min',    label: 'MIN'     },
  { value: 'max',    label: 'MAX'     },
  { value: 'counta', label: 'COUNTA'  },
]

// ── Pure helpers ────────────────────────────────────────────────────────────

function _agg(vals, fn) {
  if (!vals.length) return ''
  const nums = vals.filter(v => typeof v === 'number' && !isNaN(v))
  switch (fn) {
    case 'sum':    return nums.reduce((a, b) => a + b, 0)
    case 'count':  return vals.length   // count all non-empty values (text + numbers)
    case 'counta': return vals.length
    case 'avg':    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : ''
    case 'min':    return nums.length ? Math.min(...nums) : ''
    case 'max':    return nums.length ? Math.max(...nums) : ''
    default:       return nums.reduce((a, b) => a + b, 0)
  }
}

// Build a Map key string from row values at given column indices.
function _makeKey(row, idxs) {
  return idxs.map(i => String(row[i] ?? '')).join('\x00')
}

// Split a composite key back into its parts.
function _keyParts(key) { return key.split('\x00') }

// ── Pivot computation (pure) ─────────────────────────────────────────────────

export function computePivot(config, getRangeValues) {
  const { sourceSheet, sourceRange, rows, cols, values } = config
  if (!sourceRange || !rows.length || !values.length) return []

  const [start, end] = sourceRange.includes(':') ? sourceRange.split(':') : [sourceRange, sourceRange]
  const data = getRangeValues(start, end, sourceSheet)
  if (!data || data.length < 2) return []

  const headers = data[0].map(h => String(h ?? ''))
  const dataRows = data.slice(1).filter(r => r.some(v => v !== null && v !== undefined && v !== ''))
  if (!dataRows.length) return []

  const rowIdxs = rows.map(f => headers.indexOf(f)).filter(i => i >= 0)
  const colIdxs = (cols || []).map(f => headers.indexOf(f)).filter(i => i >= 0)
  const valCols = values
    .map(v => ({ idx: headers.indexOf(v.field), agg: v.agg || 'sum', field: v.field }))
    .filter(v => v.idx >= 0)
  if (!valCols.length || !rowIdxs.length) return []

  // Collect ordered unique row/col keys
  const rowKeyList = [], colKeyList = []
  const rowKeySet = new Set(), colKeySet = new Set()
  const hasColFields = colIdxs.length > 0

  for (const row of dataRows) {
    const rk = _makeKey(row, rowIdxs)
    const ck = hasColFields ? _makeKey(row, colIdxs) : ''
    if (!rowKeySet.has(rk)) { rowKeySet.add(rk); rowKeyList.push(rk) }
    if (hasColFields && !colKeySet.has(ck)) { colKeySet.add(ck); colKeyList.push(ck) }
  }

  // Sort keys: numeric-looking keys numerically, otherwise alphabetically.
  const _sortKeys = list => list.sort((a, b) => {
    const an = Number(a), bn = Number(b)
    if (!isNaN(an) && !isNaN(bn)) return an - bn
    return a.localeCompare(b)
  })
  _sortKeys(rowKeyList)
  if (hasColFields) _sortKeys(colKeyList)

  // Build aggregation buckets  rk\x01ck\x01vi → [values]
  const buckets = new Map()
  for (const row of dataRows) {
    const rk = _makeKey(row, rowIdxs)
    const ck = hasColFields ? _makeKey(row, colIdxs) : ''
    for (let vi = 0; vi < valCols.length; vi++) {
      const key = `${rk}\x01${ck}\x01${vi}`
      if (!buckets.has(key)) buckets.set(key, [])
      const raw = row[valCols[vi].idx]
      if (raw !== null && raw !== undefined && raw !== '') {
        const n = Number(raw)
        buckets.get(key).push(isNaN(n) ? raw : n)
      }
    }
  }

  const get = (rk, ck, vi) => buckets.get(`${rk}\x01${ck}\x01${vi}`) || []

  const table = []

  // ── Header row ────────────────────────────────────────────────────────────
  const hdr = [...rows.slice(0, rowIdxs.length)]
  if (hasColFields) {
    for (const ck of colKeyList) {
      const label = _keyParts(ck).join(' / ') || '(blank)'
      for (const vc of valCols) {
        hdr.push(valCols.length > 1 ? `${label} – ${vc.agg.toUpperCase()}(${vc.field})` : label)
      }
    }
    for (const vc of valCols) {
      hdr.push(valCols.length > 1 ? `Total – ${vc.agg.toUpperCase()}(${vc.field})` : 'Grand Total')
    }
  } else {
    for (const vc of valCols) {
      hdr.push(`${vc.agg.toUpperCase()}(${vc.field})`)
    }
    if (valCols.length > 1) hdr.push('Grand Total')
  }
  table.push(hdr)

  // ── Data rows ─────────────────────────────────────────────────────────────
  for (const rk of rowKeyList) {
    const row = _keyParts(rk).map(p => p || '(blank)')
    if (hasColFields) {
      for (const ck of colKeyList) {
        for (let vi = 0; vi < valCols.length; vi++) row.push(_agg(get(rk, ck, vi), valCols[vi].agg))
      }
      for (let vi = 0; vi < valCols.length; vi++) {
        const rowVals = colKeyList.flatMap(ck => get(rk, ck, vi))
        row.push(_agg(rowVals, valCols[vi].agg))
      }
    } else {
      for (let vi = 0; vi < valCols.length; vi++) row.push(_agg(get(rk, '', vi), valCols[vi].agg))
      if (valCols.length > 1) {
        const allVals = valCols.flatMap((_, vi) => get(rk, '', vi))
        row.push(_agg(allVals, valCols[0].agg))
      }
    }
    table.push(row)
  }

  // ── Grand total row ────────────────────────────────────────────────────────
  const totalRow = rows.slice(0, rowIdxs.length).map((_, i) => i === 0 ? 'Grand Total' : '')
  if (hasColFields) {
    for (const ck of colKeyList) {
      for (let vi = 0; vi < valCols.length; vi++) {
        const colVals = rowKeyList.flatMap(rk => get(rk, ck, vi))
        totalRow.push(_agg(colVals, valCols[vi].agg))
      }
    }
    for (let vi = 0; vi < valCols.length; vi++) {
      const all = rowKeyList.flatMap(rk => colKeyList.flatMap(ck => get(rk, ck, vi)))
      totalRow.push(_agg(all, valCols[vi].agg))
    }
  } else {
    for (let vi = 0; vi < valCols.length; vi++) {
      const all = rowKeyList.flatMap(rk => get(rk, '', vi))
      totalRow.push(_agg(all, valCols[vi].agg))
    }
    if (valCols.length > 1) totalRow.push('')
  }
  table.push(totalRow)

  return table
}

// ── Write pivot output to sheet ──────────────────────────────────────────────

export function writePivotToSheet(table, outputSheet, setCell, clearSheet) {
  clearSheet(outputSheet)
  for (let r = 0; r < table.length; r++) {
    for (let c = 0; c < table[r].length; c++) {
      const v = table[r][c]
      if (v === null || v === undefined || v === '') continue
      // Preserve numeric type so values sort/formula-reference correctly.
      setCell(cellId(r, c), typeof v === 'number' ? v : String(v), outputSheet)
    }
  }
}

// ── Engine (stateful) ─────────────────────────────────────────────────────────

export function createPivotEngine() {
  let _pivots = {}   // id → PivotConfig
  let _nextId  = 1
  let _onChange = null

  function _newId() { return `pivot_${_nextId++}` }
  function _notify() { _onChange?.() }

  // Register a callback fired after every mutation (add/update/remove/restore).
  // Consumers wire this to a Vue ref so list-driven computeds re-evaluate —
  // crucial for `restore`, which used to silently rehydrate state without
  // triggering reactivity, hiding the pivot edit FAB on page reload.
  function setOnChange(cb) { _onChange = cb }

  function add(config) {
    const id = config.id || _newId()
    _pivots[id] = { ...config, id }
    _notify()
    return id
  }

  function update(id, config) {
    if (_pivots[id]) {
      _pivots[id] = { ..._pivots[id], ...config, id }
      _notify()
    }
  }

  function remove(id) {
    if (id in _pivots) { delete _pivots[id]; _notify() }
  }

  function list() { return Object.values(_pivots) }

  function get(id) { return _pivots[id] }

  // Returns true if the given sheet+cellId falls within any pivot's source range.
  function affectsPivot(sheetName) {
    return Object.values(_pivots).some(p => p.sourceSheet === sheetName)
  }

  function snapshot() { return { pivots: JSON.parse(JSON.stringify(_pivots)), nextId: _nextId } }

  function restore(data) {
    if (!data) return
    _pivots = JSON.parse(JSON.stringify(data.pivots || {}))
    _nextId  = data.nextId  || 1
    _notify()
  }

  return { add, update, remove, list, get, affectsPivot, snapshot, restore, setOnChange }
}
