import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed }                          from 'vue'
import { useVersionHistory }                      from './useVersionHistory.js'

// ── fixtures ──────────────────────────────────────────────────────────────────

const SHEET_ID = 'SHEET-001'

function makeSheetEngine(current = 'Sheet1') {
  return {
    snapshot:       () => ({ current }),
    restore:        vi.fn(),
    getCurrentSheet: () => current,
  }
}

function makeEngine() { return { snapshot: () => ({}), restore: vi.fn() } }

function makeGrid() {
  return {
    setDiffOverlay:     vi.fn(),
    setActiveDiffSheet: vi.fn(),
    viewSnapshot:       () => null,
    viewRestore:        vi.fn(),
    moveTo:             vi.fn(),
  }
}

function makeApi(overrides = {}) {
  return {
    list:      vi.fn().mockResolvedValue([]),
    getState:  vi.fn().mockResolvedValue({ sheets_data: '{}', title: '' }),
    cellDiff:  vi.fn().mockResolvedValue(null),
    restore:   vi.fn().mockResolvedValue(undefined),
    name:      vi.fn().mockResolvedValue(undefined),
    clearName: vi.fn().mockResolvedValue(undefined),
    makeACopy: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

function makeComposable(apiOverrides = {}) {
  const sheet      = makeSheetEngine()
  const formats    = makeEngine()
  const merge      = makeEngine()
  const comments   = makeEngine()
  const validation = makeEngine()
  const condFormat = makeEngine()
  const sortFilter = makeEngine()
  const grid       = makeGrid()
  const currentTitle = ref('My Sheet')
  const activeCell   = ref('A1')

  const vh = useVersionHistory({
    sheetId:        computed(() => SHEET_ID),
    getSheet:       () => sheet,
    getFormats:     () => formats,
    getMerge:       () => merge,
    getComments:    () => comments,
    getValidation:  () => validation,
    getCondFormat:  () => condFormat,
    getSortFilter:  () => sortFilter,
    getGrid:        () => grid,
    currentTitle,
    switchSheet:    vi.fn(),
    syncNames:      vi.fn(),
    repopulateGrid: vi.fn(),
    syncViewMirrors: vi.fn(),
    loadSheet:      vi.fn().mockResolvedValue(undefined),
    history:        { push: vi.fn() },
    activeCell,
    _versionsApi:   makeApi(apiOverrides),
  })

  return { vh, currentTitle, activeCell, grid }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useVersionHistory', () => {

  // (a) openVersionHistory sets vhOpen = true
  describe('openVersionHistory', () => {
    it('sets vhOpen to true for a saved sheet', async () => {
      const { vh } = makeComposable()
      expect(vh.vhOpen.value).toBe(false)
      await vh.openVersionHistory()
      expect(vh.vhOpen.value).toBe(true)
    })

    it('does nothing when sheetId is "new"', async () => {
      const sheet  = makeSheetEngine()
      const api    = makeApi()
      const vh = useVersionHistory({
        sheetId:         computed(() => 'new'),
        getSheet:        () => sheet,
        getFormats:      () => makeEngine(),
        getMerge:        () => makeEngine(),
        getComments:     () => makeEngine(),
        getValidation:   () => makeEngine(),
        getCondFormat:   () => makeEngine(),
        getSortFilter:   () => makeEngine(),
        getGrid:         () => makeGrid(),
        currentTitle:    ref(''),
        switchSheet:     vi.fn(),
        syncNames:       vi.fn(),
        repopulateGrid:  vi.fn(),
        syncViewMirrors: vi.fn(),
        loadSheet:       vi.fn(),
        history:         { push: vi.fn() },
        activeCell:      ref('A1'),
        _versionsApi:    api,
      })
      await vh.openVersionHistory()
      expect(vh.vhOpen.value).toBe(false)
      expect(api.list).not.toHaveBeenCalled()
    })
  })

  // (b) closeVersionHistory clears state
  describe('closeVersionHistory', () => {
    it('sets vhOpen to false and does not call exitPreview when no active preview', () => {
      const { vh } = makeComposable()
      vh.vhOpen.value = true
      vh.closeVersionHistory()
      expect(vh.vhOpen.value).toBe(false)
    })

    it('calls exitPreview when a version is active, clearing vhActive', async () => {
      const api = makeApi({
        getState: vi.fn().mockResolvedValue({ sheets_data: '{}', title: '' }),
        cellDiff: vi.fn().mockRejectedValue(new Error('no diff')),
      })
      const { vh } = makeComposable(api)
      vh.vhOpen.value   = true
      vh.vhActive.value = 'VER-001'   // simulate active preview without full flow
      vh.closeVersionHistory()
      expect(vh.vhOpen.value).toBe(false)
      expect(vh.vhActive.value).toBe('')
    })
  })

  // (c) _refreshVersions populates vhVersions from mock API
  describe('_refreshVersions (via openVersionHistory)', () => {
    it('populates vhVersions with data returned by the API', async () => {
      const versions = [
        { name: 'VER-001', version_name: 'Initial', created: '2026-01-01' },
        { name: 'VER-002', version_name: '',         created: '2026-01-02' },
      ]
      const { vh } = makeComposable({ list: vi.fn().mockResolvedValue(versions) })
      await vh.openVersionHistory()
      expect(vh.vhVersions.value).toEqual(versions)
      expect(vh.vhLoading.value).toBe(false)
    })

    it('sets vhError when the API call rejects', async () => {
      const { vh } = makeComposable({
        list: vi.fn().mockRejectedValue(new Error('network error')),
      })
      await vh.openVersionHistory()
      expect(vh.vhError.value).toBe('network error')
      expect(vh.vhLoading.value).toBe(false)
    })
  })

  // (d) exitPreview restores the stash
  describe('exitPreview', () => {
    it('clears diff state and vhActive when no stash exists', () => {
      const { vh } = makeComposable()
      vh.vhActive.value = 'VER-XYZ'
      vh.exitPreview()
      expect(vh.vhActive.value).toBe('')
      expect(vh.vhDiff.value).toBeNull()
      expect(vh.vhStepIdx.value).toBeNull()
    })

    it('restores the stashed title via _applyState when a stash was captured', async () => {
      const stashedTitle  = 'Stashed Sheet Title'
      const restoredTitle = ref(stashedTitle)

      const sheet      = makeSheetEngine()
      const formats    = makeEngine()
      const api = makeApi({
        getState: vi.fn().mockResolvedValue({
          sheets_data: JSON.stringify({ sheet: {}, formats: {} }),
          title: 'Version Title',
        }),
        cellDiff: vi.fn().mockRejectedValue(new Error('skip')),
      })

      const vh = useVersionHistory({
        sheetId:         computed(() => SHEET_ID),
        getSheet:        () => sheet,
        getFormats:      () => formats,
        getMerge:        () => makeEngine(),
        getComments:     () => makeEngine(),
        getValidation:   () => makeEngine(),
        getCondFormat:   () => makeEngine(),
        getSortFilter:   () => makeEngine(),
        getGrid:         () => makeGrid(),
        currentTitle:    restoredTitle,
        switchSheet:     vi.fn(),
        syncNames:       vi.fn(),
        repopulateGrid:  vi.fn(),
        syncViewMirrors: vi.fn(),
        loadSheet:       vi.fn().mockResolvedValue(undefined),
        history:         { push: vi.fn() },
        activeCell:      ref('A1'),
        _versionsApi:    api,
      })

      // Entering preview captures the stash and applies the version state.
      await vh.previewVersion('VER-001')
      expect(vh.vhActive.value).toBe('VER-001')
      // The version state has title 'Version Title', so currentTitle changes.
      expect(restoredTitle.value).toBe('Version Title')

      // Now exit — the stash (title = 'Stashed Sheet Title') must be restored.
      vh.exitPreview()
      expect(vh.vhActive.value).toBe('')
      expect(restoredTitle.value).toBe(stashedTitle)
    })
  })

  // (e) _flattenDiff sorts entries by row then col
  describe('flattenDiff (via stepPreviewDiff)', () => {
    it('steps to cells in row-then-col order across sheets', async () => {
      // Provide a diff where cells appear out-of-order; verify stepping order.
      const diff = {
        sheets: {
          Sheet1: { C3: { old: '', new: 'x' }, A1: { old: '', new: 'y' }, B2: { old: '', new: 'z' } },
        },
        total_changed_cells: 3,
      }
      const api = makeApi({
        getState: vi.fn().mockResolvedValue({ sheets_data: '{}', title: '' }),
        cellDiff: vi.fn().mockResolvedValue(diff),
      })
      const activeCell = ref('A1')
      const vh = useVersionHistory({
        sheetId:         computed(() => SHEET_ID),
        getSheet:        () => makeSheetEngine(),
        getFormats:      () => makeEngine(),
        getMerge:        () => makeEngine(),
        getComments:     () => makeEngine(),
        getValidation:   () => makeEngine(),
        getCondFormat:   () => makeEngine(),
        getSortFilter:   () => makeEngine(),
        getGrid:         () => makeGrid(),
        currentTitle:    ref('T'),
        switchSheet:     vi.fn(),
        syncNames:       vi.fn(),
        repopulateGrid:  vi.fn(),
        syncViewMirrors: vi.fn(),
        loadSheet:       vi.fn().mockResolvedValue(undefined),
        history:         { push: vi.fn() },
        activeCell,
        _versionsApi:    api,
      })

      await vh.previewVersion('VER-001')

      // Step forward from start — should land on A1 (row 0, col 0).
      vh.stepPreviewDiff(1)
      expect(activeCell.value).toBe('A1')
      expect(vh.vhStepIdx.value).toBe(0)

      // Step forward again — should land on B2 (row 1, col 1).
      vh.stepPreviewDiff(1)
      expect(activeCell.value).toBe('B2')
      expect(vh.vhStepIdx.value).toBe(1)

      // Step forward again — should land on C3 (row 2, col 2).
      vh.stepPreviewDiff(1)
      expect(activeCell.value).toBe('C3')
      expect(vh.vhStepIdx.value).toBe(2)
    })

    it('wraps around when stepping past the last entry', async () => {
      const diff = {
        sheets: { Sheet1: { A1: { old: '', new: 'x' } } },
        total_changed_cells: 1,
      }
      const api = makeApi({
        getState: vi.fn().mockResolvedValue({ sheets_data: '{}', title: '' }),
        cellDiff: vi.fn().mockResolvedValue(diff),
      })
      const activeCell = ref('Z99')
      const vh = useVersionHistory({
        sheetId:         computed(() => SHEET_ID),
        getSheet:        () => makeSheetEngine(),
        getFormats:      () => makeEngine(),
        getMerge:        () => makeEngine(),
        getComments:     () => makeEngine(),
        getValidation:   () => makeEngine(),
        getCondFormat:   () => makeEngine(),
        getSortFilter:   () => makeEngine(),
        getGrid:         () => makeGrid(),
        currentTitle:    ref('T'),
        switchSheet:     vi.fn(),
        syncNames:       vi.fn(),
        repopulateGrid:  vi.fn(),
        syncViewMirrors: vi.fn(),
        loadSheet:       vi.fn().mockResolvedValue(undefined),
        history:         { push: vi.fn() },
        activeCell,
        _versionsApi:    api,
      })

      await vh.previewVersion('VER-001')
      vh.stepPreviewDiff(1)   // idx 0 → A1
      vh.stepPreviewDiff(1)   // idx wraps back to 0 → A1
      expect(activeCell.value).toBe('A1')
      expect(vh.vhStepIdx.value).toBe(0)
    })
  })
})
