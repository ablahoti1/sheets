import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useShortcuts } from './useShortcuts.js'

// In node env there is no `document`, so we need to stub it per test.
function stubActiveElement(tagName = 'DIV', isFormulaInput = false) {
  const el = { tagName, value: '' }
  const formulaEl = isFormulaInput ? el : { tagName: 'INPUT', value: '' }
  Object.defineProperty(global, 'document', {
    value: { activeElement: el },
    writable: true, configurable: true,
  })
  return formulaEl
}

function makeActions(overrides = {}) {
  return {
    formulaInputEl:         () => null,
    undo:                   vi.fn(),
    redo:                   vi.fn(),
    onSave:                 vi.fn(),
    toggleFmt:              vi.fn(),
    repeatLast:             vi.fn(),
    toggleShowFormulas:     vi.fn(),
    showFindReplace:        ref(false),
    showShortcutsHelp:      ref(false),
    openVersionHistory:     vi.fn(),
    openHyperlinkDialog:    vi.fn(),
    openCommentPanel:       vi.fn(),
    openQuickFilterForActive: vi.fn(),
    zoomBy:                 vi.fn(),
    resetZoom:              vi.fn(),
    commentPanel:           { open: false },
    dropdownPanel:          { open: false },
    splitText:              { open: false },
    revertSplitPreview:     vi.fn(),
    closeSplit:             vi.fn(),
    clipboard:              { hasData: vi.fn(() => false), clear: vi.fn() },
    clipboardHas:           ref(false),
    setMarchingAnts:        vi.fn(),
    fillDown:               vi.fn(),
    fillRight:              vi.fn(),
    ...overrides,
  }
}

function key(opts = {}) {
  return {
    key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    preventDefault: vi.fn(),
    ...opts,
  }
}

beforeEach(() => {
  // Default: active element is a non-input div
  stubActiveElement('DIV')
})

// ── Format shortcuts ──────────────────────────────────────────────────────────

describe('format shortcuts', () => {
  it('Cmd+Z calls undo', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'z', metaKey: true }))
    expect(a.undo).toHaveBeenCalled()
  })

  it('Cmd+Y calls redo', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'y', metaKey: true }))
    expect(a.redo).toHaveBeenCalled()
  })

  it('Cmd+Shift+Z calls redo', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'z', metaKey: true, shiftKey: true }))
    expect(a.redo).toHaveBeenCalled()
  })

  it('Cmd+B calls toggleFmt("bold")', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'b', metaKey: true }))
    expect(a.toggleFmt).toHaveBeenCalledWith('bold')
  })

  it('F4 calls repeatLast', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'F4' }))
    expect(a.repeatLast).toHaveBeenCalled()
  })
})

// ── View shortcuts ────────────────────────────────────────────────────────────

describe('view shortcuts', () => {
  it('Cmd+S calls onSave', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 's', metaKey: true }))
    expect(a.onSave).toHaveBeenCalled()
  })

  it('Cmd+F opens find/replace', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'f', metaKey: true }))
    expect(a.showFindReplace.value).toBe(true)
  })

  it('Cmd+= zooms in', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: '=', metaKey: true }))
    expect(a.zoomBy).toHaveBeenCalledWith(+0.1)
  })

  it('Cmd+- zooms out', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: '-', metaKey: true }))
    expect(a.zoomBy).toHaveBeenCalledWith(-0.1)
  })

  it('Cmd+0 resets zoom', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: '0', metaKey: true }))
    expect(a.resetZoom).toHaveBeenCalled()
  })

  it('? opens shortcuts help', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: '?' }))
    expect(a.showShortcutsHelp.value).toBe(true)
  })

  it('Cmd+` calls toggleShowFormulas', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: '`', code: 'Backquote', metaKey: true }))
    expect(a.toggleShowFormulas).toHaveBeenCalled()
  })
})

// ── Nav shortcuts ─────────────────────────────────────────────────────────────

describe('nav shortcuts', () => {
  it('Cmd+L opens hyperlink dialog', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'l', metaKey: true }))
    expect(a.openHyperlinkDialog).toHaveBeenCalled()
  })

  it('Shift+F2 opens comment panel', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'F2', shiftKey: true }))
    expect(a.openCommentPanel).toHaveBeenCalled()
  })

  it('Alt+ArrowDown opens quick filter', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'ArrowDown', altKey: true }))
    expect(a.openQuickFilterForActive).toHaveBeenCalled()
  })

  it('Cmd+Alt+Shift+H opens version history', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'h', metaKey: true, altKey: true, shiftKey: true }))
    expect(a.openVersionHistory).toHaveBeenCalled()
  })
})

// ── Escape handling ───────────────────────────────────────────────────────────

describe('escape handling', () => {
  it('Escape closes commentPanel when open', () => {
    const a = makeActions()
    a.commentPanel.open = true
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'Escape' }))
    expect(a.commentPanel.open).toBe(false)
  })

  it('Escape closes dropdownPanel when open', () => {
    const a = makeActions()
    a.dropdownPanel.open = true
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'Escape' }))
    expect(a.dropdownPanel.open).toBe(false)
  })

  it('Escape clears clipboard marching ants', () => {
    const a = makeActions({ clipboard: { hasData: vi.fn(() => true), clear: vi.fn() } })
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'Escape' }))
    expect(a.clipboard.clear).toHaveBeenCalled()
    expect(a.setMarchingAnts).toHaveBeenCalledWith(null)
  })
})

// ── Fill shortcuts ────────────────────────────────────────────────────────────

describe('fill shortcuts', () => {
  it('Cmd+D calls fillDown', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'd', metaKey: true }))
    expect(a.fillDown).toHaveBeenCalled()
  })

  it('Cmd+R calls fillRight', () => {
    const a = makeActions()
    const { onGlobalKey } = useShortcuts(a)
    onGlobalKey(key({ key: 'r', metaKey: true }))
    expect(a.fillRight).toHaveBeenCalled()
  })
})
