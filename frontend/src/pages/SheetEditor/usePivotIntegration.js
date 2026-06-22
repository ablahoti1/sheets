import { ref, computed, watch } from 'vue'
import { computePivotModel, computePivotModelAsync, pivotDrillDown, writePivotToSheet } from '../../engine/pivot.js'
import { colLabel, cellId, parseCellId } from '../../utils/cells.js'
import { COL_HEADER_H, ROW_HEADER_W } from '../../canvas/constants.js'

// Styling applied to the pivot's column header row (row 0) and Grand Total
// row (last row). Matches the Google Sheets look the user asked for.
const PIVOT_HEADER_FORMAT = { bold: true, backgroundColor: '#d9e0e8' }

/**
 * @param {{
 *   pivot: object,
 *   sheet: object,
 *   currentSheet: import('vue').Ref<string>,
 *   renderVersion: import('vue').Ref<number>,
 *   getGrid: () => object,
 *   contextMenu: { open: boolean },
 *   switchSheet: (name: string) => void,
 *   syncNames: () => void,
 *   history: { push: () => void },
 *   isDirty: import('vue').Ref<boolean>,
 *   repopulateGrid: () => void,
 * }} opts
 */
export function usePivotIntegration({
  pivot, sheet, formats, currentSheet, renderVersion, getGrid,
  contextMenu, switchSheet, syncNames,
  history, isDirty, repopulateGrid,
}) {
  const pivotDialogOpen   = ref(false)
  const pivotInitialRange = ref('')
  const pivotEditId       = ref('')
  const pivotEditConfig   = ref(null)
  const pivotVersion      = ref(0)
  // True while an async pivot build is aggregating the source rows — drives a
  // spinner so big sheets don't look frozen.
  const pivotBuilding     = ref(false)
  // Row/column count of the last-rendered pivot output; used to position the
  // edit FAB and the highlight overlay without re-running the full
  // computePivot() on every canvas render frame.
  const _pivotRowCount    = ref(0)
  const _pivotColCount    = ref(0)

  // Every engine mutation (including restore on page reload) bumps the version,
  // so reactive computeds like `activePivotConfig` re-evaluate. Without this,
  // the edit FAB stays hidden after a reload because `pivot.restore()` runs
  // silently and the cached computed never sees the new pivot list.
  pivot.setOnChange?.(() => { pivotVersion.value++ })

  // Reading pivotVersion forces Vue to re-evaluate on every add/update/delete.
  const activePivotConfig = computed(() => {
    void pivotVersion.value
    return pivot.list().find(p => p.outputSheet === currentSheet.value) ?? null
  })

  // Set of sheet names that are pivot outputs — computed so templates reactively
  // update tab styles when pivots are added or deleted.
  const pivotSheetNames = computed(() => {
    void pivotVersion.value
    return new Set(pivot.list().map(p => p.outputSheet))
  })

  function isPivotSheet(name) { return pivotSheetNames.value.has(name) }

  // After a page reload, pivot.restore() puts the config back but never calls
  // _applyPivotOutput, so the in-memory _pivotRowCount stays at 0 — and both
  // the edit FAB and the highlight overlay (which gate on rows > 0) silently
  // hide. Watch the active config: when it becomes non-null, do a READ-ONLY
  // computePivot() to derive dimensions. We don't go through _applyPivotOutput
  // because its setCell writes would bump renderVersion and could mark the
  // sheet dirty even though the cells already match the saved snapshot.
  //
  // Also (re-)apply the header/total banding so older pivots created before
  // this styling existed pick it up the first time they're opened. formats.set
  // is idempotent and doesn't mark isDirty by itself, so this is safe to run
  // on every activation.
  watch(activePivotConfig, (cfg) => {
    if (!cfg) {
      _pivotRowCount.value = 0
      _pivotColCount.value = 0
      return
    }
    // Derive dimensions from the already-written output sheet rather than
    // re-running the aggregation just for row/col counts — that re-pivoted
    // every source row (100k+) on every page load / sheet switch.
    const { rows, cols } = _outputExtent(cfg.outputSheet)
    _pivotRowCount.value = rows
    _pivotColCount.value = cols
    _restyleHeaderAndTotal(cfg.outputSheet, rows, cols)
  }, { immediate: true })

  // Positions the edit FAB below the Grand Total row without re-running
  // computePivot() — _pivotRowCount is updated whenever pivot output is written.
  // getCellRect returns coordinates even when the cell has scrolled above the
  // visible cell area, so the FAB would otherwise overlap the column/row
  // headers when the user scrolls past the pivot. Gate on the headers.
  const pivotFabStyle = computed(() => {
    void pivotVersion.value
    renderVersion.value
    const cfg  = activePivotConfig.value
    const grid = getGrid()
    const rows = _pivotRowCount.value
    if (!grid || !cfg || !rows) return null
    const rect = grid.getCellRect?.(rows - 1, 0)
    if (!rect) return null
    const zoom = grid.getZoom?.() ?? 1
    const top  = rect.y + rect.height + 6
    if (top < COL_HEADER_H * zoom || rect.x + rect.width < ROW_HEADER_W * zoom) {
      return null
    }
    return { top: top + 'px', left: rect.x + 'px' }
  })

  // Highlight overlay — a thin coloured border drawn over the pivot output
  // range so users can see it's a generated table (Google Sheets does the
  // same). Anchored on getCellRect of the top-left and bottom-right output
  // cells; tracks scroll/zoom via the renderVersion read.
  //
  // Clip the overlay to the visible cell area so it never bleeds into the
  // column/row headers when scrolled. Hide entirely when the pivot has
  // scrolled completely above/left of the visible area.
  const pivotHighlightStyle = computed(() => {
    void pivotVersion.value
    renderVersion.value
    const cfg  = activePivotConfig.value
    const grid = getGrid()
    const rows = _pivotRowCount.value
    const cols = _pivotColCount.value
    if (!grid || !cfg || !rows || !cols) return null
    const tl = grid.getCellRect?.(0, 0)
    const br = grid.getCellRect?.(rows - 1, cols - 1)
    if (!tl || !br) return null
    const zoom    = grid.getZoom?.() ?? 1
    const headerY = COL_HEADER_H * zoom
    const headerX = ROW_HEADER_W * zoom
    const right   = br.x + br.width
    const bottom  = br.y + br.height
    if (bottom <= headerY || right <= headerX) return null
    const top  = Math.max(tl.y, headerY)
    const left = Math.max(tl.x, headerX)
    return {
      top:    top  + 'px',
      left:   left + 'px',
      width:  (right  - left) + 'px',
      height: (bottom - top)  + 'px',
    }
  })

  const pivotBannerMenuOptions = [
    { label: 'Edit pivot',   icon: 'edit-2',                    onClick: onPivotEdit   },
    { label: 'Delete pivot', icon: 'trash-2', theme: 'red',     onClick: onPivotDelete },
  ]

  function openPivotDialog() {
    contextMenu.open = false
    const grid = getGrid()
    const sel  = grid?.getSelection()
    pivotInitialRange.value = sel
      ? `${colLabel(sel.c0)}${sel.r0 + 1}:${colLabel(sel.c1)}${sel.r1 + 1}`
      : ''
    pivotEditId.value     = ''
    pivotEditConfig.value = null
    pivotDialogOpen.value = true
  }

  function onPivotEdit() {
    const cfg = activePivotConfig.value
    if (!cfg) return
    pivotEditId.value       = cfg.id
    pivotEditConfig.value   = { ...cfg }
    pivotInitialRange.value = cfg.sourceRange || ''
    pivotDialogOpen.value   = true
  }

  async function onPivotRefresh() {
    const cfg = activePivotConfig.value
    if (!cfg) return
    await _applyPivotOutput(cfg)
    repopulateGrid()
  }

  function onPivotDelete() {
    const cfg = activePivotConfig.value
    if (!cfg) return
    pivot.remove(cfg.id)
  }

  function _clearPivotOutputSheet(sheetName) {
    const data = sheet.getRawData(sheetName)
    for (const id of Object.keys(data)) {
      sheet.setCell(id, '', sheetName)
      // Clear the format too — otherwise the previous header/total band
      // lingers on rows the new (shorter) pivot no longer occupies.
      formats?.clear?.(id, sheetName)
    }
  }

  // Async, chunked build. Aggregates the source in row blocks, yielding between
  // them so a 100k-row pivot doesn't freeze the UI. A newer build supersedes an
  // in-flight one via the token (e.g. rapid edits / refresh).
  let _buildToken = 0
  async function _applyPivotOutput(config) {
    const token = ++_buildToken
    pivotBuilding.value = true
    try {
      const model = await computePivotModelAsync(
        config,
        (s, e, sh) => sheet.getRangeValues(s, e, sh),
        { onYield: () => _yieldUnlessSuperseded(token) },
      )
      if (token !== _buildToken) return
      const table = model?.table ?? []
      _pivotRowCount.value = table.length
      _pivotColCount.value = table[0]?.length || 0
      writePivotToSheet(
        table, config.outputSheet,
        (id, val, sh) => sheet.setCell(id, val, sh),
        shName => _clearPivotOutputSheet(shName),
      )
      _styleHeaderAndTotal(table, config.outputSheet)
    } finally {
      if (token === _buildToken) pivotBuilding.value = false
    }
  }

  // Yield a macrotask so the UI can paint/respond between blocks; resolves
  // false when a newer build has taken over so the engine bails early.
  function _yieldUnlessSuperseded(token) {
    return new Promise(res => setTimeout(() => res(token === _buildToken), 0))
  }

  // Row/col extent of an already-written sheet (pivot output is small/grouped),
  // used to size overlays without re-aggregating the source.
  function _outputExtent(sheetName) {
    const data = sheet.getRawData(sheetName)
    let maxR = -1, maxC = -1
    for (const id of Object.keys(data)) {
      const p = parseCellId(id)
      if (!p) continue
      if (p.row > maxR) maxR = p.row
      if (p.col > maxC) maxC = p.col
    }
    return { rows: maxR + 1, cols: maxC + 1 }
  }

  // Re-apply header/total banding from an extent (used on load so pivots made
  // before this styling existed pick it up, without recomputing the table).
  function _restyleHeaderAndTotal(outputSheet, rows, cols) {
    if (!formats?.set || rows <= 0 || cols <= 0) return
    const lastRow = rows - 1
    for (let c = 0; c < cols; c++) {
      formats.set(cellId(0, c), PIVOT_HEADER_FORMAT, outputSheet)
      if (lastRow > 0) formats.set(cellId(lastRow, c), PIVOT_HEADER_FORMAT, outputSheet)
    }
  }

  // Apply the bold + #d9e0e8 banding to row 0 (column headers) and the last
  // row (Grand Total). Walks every column in the pivot width so the band is
  // continuous even for cells the engine left empty (which writePivotToSheet
  // skipped). Re-applied on every recompute since _clearPivotOutputSheet wipes
  // formats first.
  function _styleHeaderAndTotal(table, outputSheet) {
    if (!formats?.set || !table.length) return
    const cols = table[0]?.length || 0
    const lastRow = table.length - 1
    for (let c = 0; c < cols; c++) {
      formats.set(cellId(0, c), PIVOT_HEADER_FORMAT, outputSheet)
      if (lastRow > 0) {
        formats.set(cellId(lastRow, c), PIVOT_HEADER_FORMAT, outputSheet)
      }
    }
  }

  // Double-click drill-down: given a cell (r, c) on the current pivot output
  // sheet, open the underlying source rows in a fresh sheet (Google Sheets
  // behaviour). Returns true when it handled the cell so the grid skips the
  // cell editor; false for non-pivot sheets or non-drillable cells.
  function drillDownAt(r, c) {
    const cfg = activePivotConfig.value
    if (!cfg) return false
    const model = computePivotModel(cfg, (s, e, sh) => sheet.getRangeValues(s, e, sh))
    const res = pivotDrillDown(model, r, c)
    if (!res || !res.rows.length) return false

    const existing = sheet.getSheetNames()
    let name = 'Drill-down'; let n = 2
    while (existing.includes(name)) name = `Drill-down ${n++}`
    sheet.addSheet(name)
    syncNames()

    const table = [res.headers, ...res.rows]
    for (let rr = 0; rr < table.length; rr++) {
      const tr = table[rr]
      for (let cc = 0; cc < tr.length; cc++) {
        const v = tr[cc]
        if (v === null || v === undefined || v === '') continue
        sheet.setCell(cellId(rr, cc), typeof v === 'number' ? v : String(v), name)
      }
    }
    if (formats?.set) {
      for (let cc = 0; cc < res.headers.length; cc++) formats.set(cellId(0, cc), { bold: true }, name)
    }

    switchSheet(name)
    repopulateGrid()
    history.push(); isDirty.value = true
    return true
  }

  async function recomputePivotsForSheet(srcSheet) {
    if (!pivot.affectsPivot(srcSheet)) return
    for (const cfg of pivot.list()) {
      if (cfg.sourceSheet === srcSheet) await _applyPivotOutput(cfg)
    }
    repopulateGrid()
  }

  async function onPivotConfirm(config) {
    const existing = sheet.getSheetNames()
    let outputSheet
    if (config.id) {
      const old = pivot.get(config.id)
      outputSheet = old?.outputSheet || `Pivot – ${config.rows.join(', ')}`
      pivot.update(config.id, { ...config, outputSheet })
    } else {
      const baseName = `Pivot – ${config.rows.join(', ')}`
      outputSheet = baseName; let n = 2
      while (existing.includes(outputSheet)) outputSheet = `${baseName} ${n++}`
      sheet.addSheet(outputSheet)
      syncNames()
      config.outputSheet = outputSheet
      pivot.add(config)
    }
    // Switch first so the user sees the output sheet (with a spinner) while it
    // builds, then fill it in.
    switchSheet(outputSheet)
    await _applyPivotOutput({ ...config, outputSheet })
    repopulateGrid()
    history.push(); isDirty.value = true
  }

  return {
    pivotDialogOpen, pivotInitialRange, pivotEditId, pivotEditConfig, pivotVersion, pivotBuilding,
    activePivotConfig, pivotFabStyle, pivotHighlightStyle, pivotBannerMenuOptions,
    isPivotSheet, openPivotDialog, onPivotEdit, onPivotRefresh, onPivotDelete, onPivotConfirm,
    recomputePivotsForSheet, drillDownAt,
  }
}
