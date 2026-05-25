import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { usePivotIntegration } from './usePivotIntegration.js'

// ── Fake pivot engine ────────────────────────────────────────────────────────

function fakePivotEngine() {
  const store = []
  let nextId  = 1
  let onChange = null
  const notify = () => onChange?.()
  return {
    list:         ()       => [...store],
    get:          (id)     => store.find(p => p.id === id) ?? null,
    add:          (config) => { store.push({ ...config, id: String(nextId++) }); notify() },
    update:       (id, cfg)=> { const i = store.findIndex(p => p.id === id); if (i >= 0) { store[i] = { ...cfg, id }; notify() } },
    remove:       (id)     => { const i = store.findIndex(p => p.id === id); if (i >= 0) { store.splice(i, 1); notify() } },
    restore:      (data)   => { store.splice(0); (data?.pivots ? Object.values(data.pivots) : []).forEach(p => store.push({ ...p })); notify() },
    affectsPivot: (sh)     => store.some(p => p.sourceSheet === sh),
    setOnChange:  (cb)     => { onChange = cb },
  }
}

function fakeSheet() {
  const cells = {}
  const sheets = ['Sheet1']
  return {
    getSheetNames: ()        => [...sheets],
    addSheet:      (name)    => sheets.push(name),
    setCell:       (id, v, sh) => { cells[`${sh}:${id}`] = v },
    getCell:       (id, sh)  => cells[`${sh}:${id}`] ?? '',
    getRawData:    (sh)      => {
      const prefix = `${sh}:`
      return Object.fromEntries(
        Object.entries(cells).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v])
      )
    },
    getRangeValues: () => [],
  }
}

function makeDeps(overrides = {}) {
  const pivot       = fakePivotEngine()
  const sheet       = fakeSheet()
  const currentSheet = ref('Sheet1')
  const renderVersion = ref(0)
  const contextMenu = { open: false }
  const switchSheet = vi.fn()
  const syncNames   = vi.fn()
  const history     = { push: vi.fn() }
  const isDirty     = ref(false)
  const repopulateGrid = vi.fn()

  const deps = {
    pivot, sheet, currentSheet, renderVersion,
    getGrid: () => null,
    contextMenu, switchSheet, syncNames,
    history, isDirty, repopulateGrid,
    ...overrides,
  }
  return { deps, pivot, sheet, currentSheet }
}

// ── isPivotSheet ──────────────────────────────────────────────────────────────

describe('isPivotSheet', () => {
  it('returns false when no pivots exist', () => {
    const { deps } = makeDeps()
    const { isPivotSheet } = usePivotIntegration(deps)
    expect(isPivotSheet('Sheet1')).toBe(false)
  })

  it('returns true when a pivot outputs to the given sheet', () => {
    const { deps, pivot } = makeDeps()
    pivot.add({ outputSheet: 'PivotOut', sourceSheet: 'Sheet1', rows: ['A'], cols: [], values: [] })
    const { isPivotSheet } = usePivotIntegration(deps)
    expect(isPivotSheet('PivotOut')).toBe(true)
  })
})

// ── activePivotConfig ─────────────────────────────────────────────────────────

describe('activePivotConfig', () => {
  it('is null when current sheet is not a pivot output', () => {
    const { deps } = makeDeps()
    const { activePivotConfig } = usePivotIntegration(deps)
    expect(activePivotConfig.value).toBeNull()
  })

  it('returns the matching config when current sheet is a pivot output', () => {
    const { deps, pivot, currentSheet } = makeDeps()
    pivot.add({ outputSheet: 'PivotOut', sourceSheet: 'Sheet1', rows: ['A'], cols: [], values: [] })
    currentSheet.value = 'PivotOut'
    const { activePivotConfig } = usePivotIntegration(deps)
    expect(activePivotConfig.value?.outputSheet).toBe('PivotOut')
  })
})

// ── onPivotDelete ─────────────────────────────────────────────────────────────

describe('onPivotDelete', () => {
  it('removes the active pivot config and bumps pivotVersion', () => {
    const { deps, pivot, currentSheet } = makeDeps()
    pivot.add({ outputSheet: 'PivotOut', sourceSheet: 'Sheet1', rows: ['R'], cols: [], values: [] })
    currentSheet.value = 'PivotOut'
    const { onPivotDelete, pivotVersion } = usePivotIntegration(deps)
    const before = pivotVersion.value
    onPivotDelete()
    expect(pivot.list()).toHaveLength(0)
    expect(pivotVersion.value).toBe(before + 1)
  })

  it('does nothing when no active pivot', () => {
    const { deps } = makeDeps()
    const { onPivotDelete } = usePivotIntegration(deps)
    expect(() => onPivotDelete()).not.toThrow()
  })
})

// ── onPivotConfirm — create ───────────────────────────────────────────────────

describe('onPivotConfirm — create', () => {
  it('adds a new pivot, creates output sheet, calls switchSheet', () => {
    const { deps, pivot } = makeDeps()
    const { onPivotConfirm } = usePivotIntegration(deps)
    onPivotConfirm({ rows: ['Region'], cols: [], values: [{ field: 'Sales', agg: 'sum' }] })
    expect(pivot.list()).toHaveLength(1)
    expect(deps.switchSheet).toHaveBeenCalledWith('Pivot – Region')
    expect(deps.history.push).toHaveBeenCalled()
    expect(deps.isDirty.value).toBe(true)
  })

  it('generates unique sheet name when base name is taken', () => {
    const { deps, pivot } = makeDeps()
    deps.sheet.addSheet('Pivot – Region')
    const { onPivotConfirm } = usePivotIntegration(deps)
    onPivotConfirm({ rows: ['Region'], cols: [], values: [] })
    expect(deps.switchSheet).toHaveBeenCalledWith('Pivot – Region 2')
  })
})

// ── onPivotConfirm — edit ────────────────────────────────────────────────────

describe('onPivotConfirm — edit', () => {
  it('updates existing pivot config and reuses output sheet', () => {
    const { deps, pivot, currentSheet } = makeDeps()
    pivot.add({ outputSheet: 'PivotOut', sourceSheet: 'Sheet1', rows: ['A'], cols: [], values: [] })
    const id = pivot.list()[0].id
    currentSheet.value = 'PivotOut'
    const { onPivotConfirm } = usePivotIntegration(deps)
    onPivotConfirm({ id, rows: ['B'], cols: [], values: [], sourceSheet: 'Sheet1' })
    expect(pivot.get(id).rows).toEqual(['B'])
    expect(deps.switchSheet).toHaveBeenCalledWith('PivotOut')
  })
})

// ── restore (page reload) ─────────────────────────────────────────────────────

describe('activePivotConfig after engine restore', () => {
  it('reflects pivots loaded via pivot.restore() on the current output sheet', () => {
    // Reproduces the post-reload bug: usePivotIntegration must observe pivots
    // hydrated by usePersistence.loadSheet() and surface the edit FAB without
    // requiring a manual sheet switch.
    const { deps, pivot, currentSheet } = makeDeps()
    const { activePivotConfig } = usePivotIntegration(deps)

    currentSheet.value = 'PivotOut'
    expect(activePivotConfig.value).toBeNull()

    pivot.restore({ pivots: { p1: { id: 'p1', outputSheet: 'PivotOut', sourceSheet: 'Sheet1', rows: ['A'], cols: [], values: [] } } })
    expect(activePivotConfig.value?.outputSheet).toBe('PivotOut')
  })
})

// ── pivotBannerMenuOptions ────────────────────────────────────────────────────

describe('pivotBannerMenuOptions', () => {
  it('has Edit and Delete items', () => {
    const { deps } = makeDeps()
    const { pivotBannerMenuOptions } = usePivotIntegration(deps)
    const labels = pivotBannerMenuOptions.map(o => o.label)
    expect(labels).toContain('Edit pivot')
    expect(labels).toContain('Delete pivot')
  })
})
