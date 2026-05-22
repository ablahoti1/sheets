// Cell comments (notes) engine — stores per-cell text annotations.
// Pure state, no DOM dependency.

import { parseCellId, colLabel } from '../utils/cells.js'

export function createCommentsEngine() {
  // { sheetName: { cellId: 'comment text' } }
  const store = {}

  function ensure(sheet) {
    if (!store[sheet]) store[sheet] = {}
  }

  function get(id, sheet = 'Sheet1') {
    return store[sheet]?.[id] ?? null
  }

  function set(id, text, sheet = 'Sheet1') {
    ensure(sheet)
    if (text && text.trim()) store[sheet][id] = text
    else delete store[sheet][id]
  }

  function clear(id, sheet = 'Sheet1') {
    if (store[sheet]) delete store[sheet][id]
  }

  function hasComment(id, sheet = 'Sheet1') {
    return !!store[sheet]?.[id]
  }

  function getAll(sheet = 'Sheet1') {
    return store[sheet] || {}
  }

  function _shift(sheet, pred, newIdFn, descending) {
    ensure(sheet)
    const st = store[sheet]
    const entries = Object.entries(st)
      .map(([id, text]) => ({ id, p: parseCellId(id), text }))
      .filter(({ p }) => p && pred(p))
    entries.sort((a, b) => descending ? b.p.row - a.p.row : a.p.row - b.p.row)
    for (const { id, p, text } of entries) {
      delete st[id]
      const nid = newIdFn(p)
      if (nid) st[nid] = text
    }
  }

  function insertRow(atRow, sheet = 'Sheet1') {
    _shift(sheet, p => p.row >= atRow, p => colLabel(p.col) + (p.row + 2), true)
  }

  function deleteRow(atRow, sheet = 'Sheet1') {
    ensure(sheet)
    for (const id of Object.keys(store[sheet] || {})) {
      const p = parseCellId(id)
      if (p && p.row === atRow) delete store[sheet][id]
    }
    _shift(sheet, p => p.row > atRow, p => colLabel(p.col) + p.row, false)
  }

  function insertCol(atCol, sheet = 'Sheet1') {
    ensure(sheet)
    const st = store[sheet]
    const entries = Object.entries(st)
      .map(([id, text]) => ({ id, p: parseCellId(id), text }))
      .filter(({ p }) => p && p.col >= atCol)
      .sort((a, b) => b.p.col - a.p.col)
    for (const { id, p, text } of entries) {
      delete st[id]
      st[colLabel(p.col + 1) + (p.row + 1)] = text
    }
  }

  function deleteCol(atCol, sheet = 'Sheet1') {
    ensure(sheet)
    const st = store[sheet]
    for (const id of Object.keys(st)) {
      const p = parseCellId(id)
      if (p && p.col === atCol) delete st[id]
    }
    const entries = Object.entries(st)
      .map(([id, text]) => ({ id, p: parseCellId(id), text }))
      .filter(({ p }) => p && p.col > atCol)
      .sort((a, b) => a.p.col - b.p.col)
    for (const { id, p, text } of entries) {
      delete st[id]
      st[colLabel(p.col - 1) + (p.row + 1)] = text
    }
  }

  function renameSheet(oldName, newName) {
    if (!store[oldName] || store[newName] || oldName === newName) return
    store[newName] = store[oldName]
    delete store[oldName]
  }

  function duplicateSheet(srcName, newName) {
    if (store[newName]) return
    store[newName] = JSON.parse(JSON.stringify(store[srcName] || {}))
  }

  function deleteSheet(name) { delete store[name] }

  function snapshot() { return JSON.parse(JSON.stringify(store)) }

  function restore(snap) {
    for (const k of Object.keys(store)) delete store[k]
    for (const [k, v] of Object.entries(snap)) store[k] = v
  }

  return {
    get, set, clear, hasComment, getAll,
    insertRow, deleteRow, insertCol, deleteCol,
    renameSheet, duplicateSheet, deleteSheet,
    snapshot, restore,
  }
}
