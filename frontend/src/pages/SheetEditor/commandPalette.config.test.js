import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCommandGroups } from './commandPalette.config.js'

// frappe-ui's CommandPaletteItem is a Vue component; stub it so the import
// succeeds in a Node/vitest environment without a full Vue setup.
vi.mock('frappe-ui', () => ({ CommandPaletteItem: { name: 'CommandPaletteItem' } }))

function makeActions(overrides = {}) {
  const ref = (value) => ({ value })

  return {
    // Format
    toggleFmt:        vi.fn(),
    setAlign:         vi.fn(),
    setValign:        vi.fn(),
    adjustDecimals:   vi.fn(),
    toggleWrap:       vi.fn(),
    clearFormatting:  vi.fn(),
    // Edit
    undo:             vi.fn(),
    redo:             vi.fn(),
    repeatLast:       vi.fn(),
    showFindReplace:  ref(false),
    showFormulas:     ref(false),
    repopulateGrid:   vi.fn(),
    showShortcutsHelp: ref(false),
    // Structure
    contextMenu:      { targetRow: null, targetCol: null },
    getGrid:          vi.fn(() => ({ getSelection: vi.fn(() => ({ r0: 1, c0: 2 })) })),
    doInsertRow:      vi.fn(),
    doDeleteRow:      vi.fn(),
    doInsertCol:      vi.fn(),
    doDeleteCol:      vi.fn(),
    doHideRows:       vi.fn(),
    doHideCols:       vi.fn(),
    doUnhideAllRows:  vi.fn(),
    doUnhideAllCols:  vi.fn(),
    doAutoFitCol:     vi.fn(),
    doAutoFitRow:     vi.fn(),
    toggleMerge:      vi.fn(),
    addRowsCount:     ref(100),
    doAddMoreRows:    vi.fn(),
    // View
    doFreezeRow:      vi.fn(),
    doFreezeCol:      vi.fn(),
    doUnfreezeRows:   vi.fn(),
    doUnfreezeCols:   vi.fn(),
    showSortFilter:   ref(false),
    // Insert
    openPivotDialog:  vi.fn(),
    // Sheet
    addSheet:         vi.fn(),
    currentSheet:     ref('Sheet1'),
    openRenameDialog: vi.fn(),
    doDuplicateSheet: vi.fn(),
    doDeleteSheet:    vi.fn(),
    // File
    onSave:           vi.fn(),
    exportCSV:        vi.fn(),
    exportXLSX:       vi.fn(),
    exportPDF:        vi.fn(),
    csvInputRef:      ref({ click: vi.fn() }),
    xlsxInputRef:     ref({ click: vi.fn() }),
    ...overrides,
  }
}

// ─── (a) shape ───────────────────────────────────────────────────────────────

describe('buildCommandGroups — shape', () => {
  it('returns an array with 7 groups', () => {
    const groups = buildCommandGroups(makeActions())
    expect(Array.isArray(groups)).toBe(true)
    expect(groups).toHaveLength(7)
  })

  it('each group has a title string and an items array', () => {
    const groups = buildCommandGroups(makeActions())
    for (const group of groups) {
      expect(typeof group.title).toBe('string')
      expect(group.title.length).toBeGreaterThan(0)
      expect(Array.isArray(group.items)).toBe(true)
      expect(group.items.length).toBeGreaterThan(0)
    }
  })

  it('group titles are Format, Edit, Structure, View, Insert, Sheet, File', () => {
    const groups = buildCommandGroups(makeActions())
    const titles = groups.map((g) => g.title)
    expect(titles).toEqual(['Format', 'Edit', 'Structure', 'View', 'Insert', 'Sheet', 'File'])
  })

  it('each item has name, title, description and fn', () => {
    const groups = buildCommandGroups(makeActions())
    for (const group of groups) {
      for (const it of group.items) {
        expect(typeof it.name).toBe('string')
        expect(typeof it.title).toBe('string')
        expect(typeof it.description).toBe('string')
        expect(typeof it.fn).toBe('function')
      }
    }
  })
})

// ─── (b) format group callbacks ──────────────────────────────────────────────

describe('buildCommandGroups — Format group', () => {
  let actions, formatGroup

  beforeEach(() => {
    actions = makeActions()
    formatGroup = buildCommandGroups(actions).find((g) => g.title === 'Format')
  })

  it('bold item calls toggleFmt("bold")', () => {
    formatGroup.items.find((i) => i.name === 'bold').fn()
    expect(actions.toggleFmt).toHaveBeenCalledWith('bold')
  })

  it('italic item calls toggleFmt("italic")', () => {
    formatGroup.items.find((i) => i.name === 'italic').fn()
    expect(actions.toggleFmt).toHaveBeenCalledWith('italic')
  })

  it('align-left item calls setAlign("left")', () => {
    formatGroup.items.find((i) => i.name === 'align-left').fn()
    expect(actions.setAlign).toHaveBeenCalledWith('left')
  })

  it('valign-top item calls setValign("top")', () => {
    formatGroup.items.find((i) => i.name === 'valign-top').fn()
    expect(actions.setValign).toHaveBeenCalledWith('top')
  })

  it('dec-inc item calls adjustDecimals(+1)', () => {
    formatGroup.items.find((i) => i.name === 'dec-inc').fn()
    expect(actions.adjustDecimals).toHaveBeenCalledWith(+1)
  })

  it('wrap item calls toggleWrap()', () => {
    formatGroup.items.find((i) => i.name === 'wrap').fn()
    expect(actions.toggleWrap).toHaveBeenCalled()
  })

  it('clearFmt item calls clearFormatting()', () => {
    formatGroup.items.find((i) => i.name === 'clearFmt').fn()
    expect(actions.clearFormatting).toHaveBeenCalled()
  })
})

// ─── (c) edit group callbacks ─────────────────────────────────────────────────

describe('buildCommandGroups — Edit group', () => {
  let actions, editGroup

  beforeEach(() => {
    actions = makeActions()
    editGroup = buildCommandGroups(actions).find((g) => g.title === 'Edit')
  })

  it('undo item calls undo()', () => {
    editGroup.items.find((i) => i.name === 'undo').fn()
    expect(actions.undo).toHaveBeenCalled()
  })

  it('redo item calls redo()', () => {
    editGroup.items.find((i) => i.name === 'redo').fn()
    expect(actions.redo).toHaveBeenCalled()
  })

  it('repeat item calls repeatLast()', () => {
    editGroup.items.find((i) => i.name === 'repeat').fn()
    expect(actions.repeatLast).toHaveBeenCalled()
  })

  it('find item sets showFindReplace.value to true', () => {
    editGroup.items.find((i) => i.name === 'find').fn()
    expect(actions.showFindReplace.value).toBe(true)
  })

  it('formulas item toggles showFormulas.value and calls repopulateGrid', () => {
    actions.showFormulas.value = false
    editGroup.items.find((i) => i.name === 'formulas').fn()
    expect(actions.showFormulas.value).toBe(true)
    expect(actions.repopulateGrid).toHaveBeenCalled()
  })

  it('shortcuts item sets showShortcutsHelp.value to true', () => {
    editGroup.items.find((i) => i.name === 'shortcuts').fn()
    expect(actions.showShortcutsHelp.value).toBe(true)
  })
})
