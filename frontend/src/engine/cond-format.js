// Conditional formatting engine.
// Rules are stored per-sheet as an ordered array. Each rule:
//   { id, range: {r0,c0,r1,c1}, condition: { type, value, value2 }, format: { backgroundColor, color } }
// Condition types: 'gt','lt','gte','lte','eq','neq','between','contains','notcontains','empty','notempty','formula'
// Pure state + evaluation, no DOM dependency.

import { parseCellId, colLabel, cellId } from '../utils/cells.js'

let _nextId = 1

export function createCondFormatEngine() {
  // { sheetName: [ rule, ... ] }
  const store = {}

  function ensure(sheet) {
    if (!store[sheet]) store[sheet] = []
  }

  function getRules(sheet = 'Sheet1') {
    return store[sheet] || []
  }

  function addRule(rule, sheet = 'Sheet1') {
    ensure(sheet)
    const r = { ...rule, id: _nextId++ }
    store[sheet].push(r)
    return r.id
  }

  function updateRule(id, patch, sheet = 'Sheet1') {
    const rules = store[sheet]
    if (!rules) return
    const idx = rules.findIndex(r => r.id === id)
    if (idx !== -1) rules[idx] = { ...rules[idx], ...patch }
  }

  function removeRule(id, sheet = 'Sheet1') {
    if (!store[sheet]) return
    store[sheet] = store[sheet].filter(r => r.id !== id)
  }

  function _testCondition(cond, rawVal, getCellValue) {
    if (cond.type === 'empty')    return rawVal === '' || rawVal == null
    if (cond.type === 'notempty') return rawVal !== '' && rawVal != null
    if (cond.type === 'formula') {
      try { return !!getCellValue?.(cond.value) } catch { return false }
    }
    const s = String(rawVal ?? '')
    if (cond.type === 'contains')    return s.toLowerCase().includes(String(cond.value).toLowerCase())
    if (cond.type === 'notcontains') return !s.toLowerCase().includes(String(cond.value).toLowerCase())
    const n = parseFloat(rawVal)
    const v = parseFloat(cond.value)
    if (isNaN(n) || isNaN(v)) return false
    if (cond.type === 'gt')  return n > v
    if (cond.type === 'lt')  return n < v
    if (cond.type === 'gte') return n >= v
    if (cond.type === 'lte') return n <= v
    if (cond.type === 'eq')  return n === v
    if (cond.type === 'neq') return n !== v
    if (cond.type === 'between') return n >= v && n <= parseFloat(cond.value2)
    return false
  }

  // Duplicate any rules that overlap srcRect into destRect (used by copy-paste).
  function addRulesForRange(srcRect, destRect, sheet = 'Sheet1') {
    const rules = store[sheet] || []
    const overlapping = rules.filter(({ range: { r0, c0, r1, c1 } }) =>
      r0 <= srcRect.r1 && r1 >= srcRect.r0 && c0 <= srcRect.c1 && c1 >= srcRect.c0)
    for (const rule of overlapping)
      addRule({ range: { ...destRect }, condition: { ...rule.condition }, format: { ...rule.format } }, sheet)
  }

  // Expand any rule that overlaps srcRect to also cover newTotal (used by fill handle).
  function extendRulesToRange(srcRect, newTotal, sheet = 'Sheet1') {
    const rules = store[sheet]
    if (!rules) return
    for (const rule of rules) {
      const { r0, c0, r1, c1 } = rule.range
      if (r0 > srcRect.r1 || r1 < srcRect.r0 || c0 > srcRect.c1 || c1 < srcRect.c0) continue
      rule.range = {
        r0: Math.min(r0, newTotal.r0), c0: Math.min(c0, newTotal.c0),
        r1: Math.max(r1, newTotal.r1), c1: Math.max(c1, newTotal.c1),
      }
    }
  }

  function getFormatOverride(id, rawVal, sheet = 'Sheet1', getCellValue = null) {
    const p = parseCellId(id)
    if (!p) return null
    const rules = store[sheet] || []
    for (const rule of rules) {
      const { r0, c0, r1, c1 } = rule.range
      if (p.row < r0 || p.row > r1 || p.col < c0 || p.col > c1) continue
      if (_testCondition(rule.condition, rawVal, getCellValue)) return rule.format
    }
    return null
  }

  function _shiftRules(sheet, rowDelta, colDelta, pred) {
    const rules = store[sheet]
    if (!rules) return
    for (const rule of rules) {
      const { r0, c0, r1, c1 } = rule.range
      if (!pred(r0, c0, r1, c1)) continue
      rule.range = {
        r0: r0 + rowDelta, c0: c0 + colDelta,
        r1: r1 + rowDelta, c1: c1 + colDelta,
      }
    }
  }

  function insertRow(atRow, sheet = 'Sheet1') {
    _shiftRules(sheet, 1, 0, (r0) => r0 >= atRow)
  }

  function deleteRow(atRow, sheet = 'Sheet1') {
    if (!store[sheet]) return
    store[sheet] = store[sheet].filter(r => !(r.range.r0 === atRow && r.range.r1 === atRow))
    _shiftRules(sheet, -1, 0, (r0) => r0 > atRow)
  }

  function insertCol(atCol, sheet = 'Sheet1') {
    _shiftRules(sheet, 0, 1, (r0, c0) => c0 >= atCol)
  }

  function deleteCol(atCol, sheet = 'Sheet1') {
    if (!store[sheet]) return
    store[sheet] = store[sheet].filter(r => !(r.range.c0 === atCol && r.range.c1 === atCol))
    _shiftRules(sheet, 0, -1, (r0, c0) => c0 > atCol)
  }

  function renameSheet(oldName, newName) {
    if (!store[oldName] || store[newName] || oldName === newName) return
    store[newName] = store[oldName]
    delete store[oldName]
  }

  function duplicateSheet(srcName, newName) {
    if (store[newName]) return
    store[newName] = JSON.parse(JSON.stringify(store[srcName] || []))
  }

  function deleteSheet(name) { delete store[name] }

  function snapshot() { return JSON.parse(JSON.stringify(store)) }

  function restore(snap) {
    for (const k of Object.keys(store)) delete store[k]
    for (const [k, v] of Object.entries(snap)) store[k] = v
  }

  return {
    getRules, addRule, updateRule, removeRule, getFormatOverride,
    addRulesForRange, extendRulesToRange,
    insertRow, deleteRow, insertCol, deleteCol,
    renameSheet, duplicateSheet, deleteSheet,
    snapshot, restore,
  }
}
