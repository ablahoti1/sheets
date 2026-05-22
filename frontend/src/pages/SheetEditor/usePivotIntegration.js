import { ref, computed } from 'vue'
import { computePivot, writePivotToSheet } from '../../engine/pivot.js'
import { colLabel } from '../../utils/cells.js'

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
  pivot, sheet, currentSheet, renderVersion, getGrid,
  contextMenu, switchSheet, syncNames,
  history, isDirty, repopulateGrid,
}) {
  const pivotDialogOpen   = ref(false)
  const pivotInitialRange = ref('')
  const pivotEditId       = ref('')
  const pivotEditConfig   = ref(null)
  const pivotVersion      = ref(0)
  // Row count of the last-rendered pivot output; used to position the edit FAB
  // without re-running the full computePivot() on every canvas render frame.
  const _pivotRowCount    = ref(0)

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

  // Positions the edit FAB below the Grand Total row without re-running
  // computePivot() — _pivotRowCount is updated whenever pivot output is written.
  const pivotFabStyle = computed(() => {
    void pivotVersion.value
    renderVersion.value
    const cfg  = activePivotConfig.value
    const grid = getGrid()
    const rows = _pivotRowCount.value
    if (!grid || !cfg || !rows) return null
    const rect = grid.getCellRect?.(rows - 1, 0)
    if (!rect) return null
    return { top: (rect.y + rect.height + 6) + 'px', left: rect.x + 'px' }
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

  function onPivotRefresh() {
    const cfg = activePivotConfig.value
    if (!cfg) return
    _applyPivotOutput(cfg)
    repopulateGrid()
  }

  function onPivotDelete() {
    const cfg = activePivotConfig.value
    if (!cfg) return
    pivot.remove(cfg.id)
    pivotVersion.value++
  }

  function _clearPivotOutputSheet(sheetName) {
    const data = sheet.getRawData(sheetName)
    for (const id of Object.keys(data)) sheet.setCell(id, '', sheetName)
  }

  function _applyPivotOutput(config) {
    const table = computePivot(config, (s, e, sh) => sheet.getRangeValues(s, e, sh))
    _pivotRowCount.value = table.length
    writePivotToSheet(
      table, config.outputSheet,
      (id, val, sh) => sheet.setCell(id, val, sh),
      shName => _clearPivotOutputSheet(shName),
    )
  }

  function recomputePivotsForSheet(srcSheet) {
    if (!pivot.affectsPivot(srcSheet)) return
    for (const cfg of pivot.list()) {
      if (cfg.sourceSheet === srcSheet) _applyPivotOutput(cfg)
    }
    repopulateGrid()
  }

  function onPivotConfirm(config) {
    const existing = sheet.getSheetNames()
    if (config.id) {
      const old = pivot.get(config.id)
      const outputSheet = old?.outputSheet || `Pivot – ${config.rows.join(', ')}`
      pivot.update(config.id, { ...config, outputSheet })
      _applyPivotOutput({ ...config, outputSheet })
      switchSheet(outputSheet)
    } else {
      const baseName = `Pivot – ${config.rows.join(', ')}`
      let outputSheet = baseName; let n = 2
      while (existing.includes(outputSheet)) outputSheet = `${baseName} ${n++}`
      sheet.addSheet(outputSheet)
      syncNames()
      config.outputSheet = outputSheet
      pivot.add(config)
      _applyPivotOutput({ ...config, outputSheet })
      switchSheet(outputSheet)
    }
    pivotVersion.value++
    repopulateGrid()
    history.push(); isDirty.value = true
  }

  return {
    pivotDialogOpen, pivotInitialRange, pivotEditId, pivotEditConfig, pivotVersion,
    activePivotConfig, pivotFabStyle, pivotBannerMenuOptions,
    isPivotSheet, openPivotDialog, onPivotEdit, onPivotRefresh, onPivotDelete, onPivotConfirm,
    recomputePivotsForSheet,
  }
}
