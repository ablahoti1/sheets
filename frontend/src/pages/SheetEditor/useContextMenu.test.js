import { describe, it, expect, vi } from 'vitest'
import { useContextMenu } from './useContextMenu.js'

const VP = { width: 1280, height: 800 }
const getViewport = () => VP

function fakeGrid({ hitRegion = {}, preSel = null, sel = { r0: 0, c0: 0, r1: 0, c1: 0 } } = {}) {
  return {
    getHitRegion: vi.fn(() => ({ cell: null, headerRow: null, headerCol: null, ...hitRegion })),
    getPreMousedownSel: vi.fn(() => preSel),
    getSelection: vi.fn(() => sel),
    setSelection: vi.fn(),
  }
}

function fakeEvent({ x = 100, y = 200 } = {}) {
  return { preventDefault: vi.fn(), clientX: x, clientY: y }
}

function makeCtx(gridOpts) {
  const grid = fakeGrid(gridOpts)
  const ctx  = useContextMenu({ getGrid: () => grid, getViewport })
  return { ...ctx, grid }
}

describe('useContextMenu — initial state', () => {
  it('contextMenu starts closed', () => {
    const { contextMenu } = makeCtx()
    expect(contextMenu.open).toBe(false)
  })

  it('tabMenu starts closed', () => {
    const { tabMenu } = makeCtx()
    expect(tabMenu.open).toBe(false)
  })
})

describe('openCanvasContextMenu', () => {
  it('calls e.preventDefault()', () => {
    const { openCanvasContextMenu } = makeCtx()
    const e = fakeEvent()
    openCanvasContextMenu(e)
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('sets mode to cell for a normal cell hit', () => {
    const { contextMenu, openCanvasContextMenu } = makeCtx({
      hitRegion: { cell: { r: 2, c: 3 }, headerRow: null, headerCol: null },
    })
    openCanvasContextMenu(fakeEvent())
    expect(contextMenu.mode).toBe('cell')
    expect(contextMenu.open).toBe(true)
  })

  it('sets mode to colHeader when headerCol is hit', () => {
    const { contextMenu, openCanvasContextMenu } = makeCtx({
      hitRegion: { cell: null, headerRow: null, headerCol: 2 },
    })
    openCanvasContextMenu(fakeEvent())
    expect(contextMenu.mode).toBe('colHeader')
  })

  it('sets mode to rowHeader when headerRow is hit', () => {
    const { contextMenu, openCanvasContextMenu } = makeCtx({
      hitRegion: { cell: null, headerRow: 3, headerCol: null },
    })
    openCanvasContextMenu(fakeEvent())
    expect(contextMenu.mode).toBe('rowHeader')
  })

  it('clamps x to viewport width - 224', () => {
    const { contextMenu, openCanvasContextMenu } = makeCtx()
    openCanvasContextMenu(fakeEvent({ x: 1300, y: 100 }))
    expect(contextMenu.x).toBe(VP.width - 224)
  })

  it('sets useBottom=true when near viewport bottom (cell mode ~620px est)', () => {
    const { contextMenu, openCanvasContextMenu } = makeCtx({
      hitRegion: { cell: { r: 0, c: 0 }, headerRow: null, headerCol: null },
    })
    // clientY=500 → spaceBelow=300 < 620 → flip
    openCanvasContextMenu(fakeEvent({ x: 100, y: 500 }))
    expect(contextMenu.useBottom).toBe(true)
  })

  it('sets useBottom=false when near viewport top', () => {
    const { contextMenu, openCanvasContextMenu } = makeCtx({
      hitRegion: { cell: { r: 0, c: 0 }, headerRow: null, headerCol: null },
    })
    // clientY=100 → spaceBelow=700 > 620 → no flip
    openCanvasContextMenu(fakeEvent({ x: 100, y: 100 }))
    expect(contextMenu.useBottom).toBe(false)
  })

  it('closes tabMenu when opening canvas menu', () => {
    const { tabMenu, openCanvasContextMenu } = makeCtx()
    tabMenu.open = true
    openCanvasContextMenu(fakeEvent())
    expect(tabMenu.open).toBe(false)
  })
})

describe('openTabMenu', () => {
  it('opens the tab menu with the correct name and position', () => {
    const { tabMenu, openTabMenu } = makeCtx()
    openTabMenu(fakeEvent({ x: 80, y: 750 }), 'Sheet2')
    expect(tabMenu.open).toBe(true)
    expect(tabMenu.name).toBe('Sheet2')
    expect(tabMenu.bottom).toBe(VP.height - 750 + 2)
  })

  it('closes the canvas context menu when opening tab menu', () => {
    const { contextMenu, openTabMenu } = makeCtx()
    contextMenu.open = true
    openTabMenu(fakeEvent(), 'Sheet1')
    expect(contextMenu.open).toBe(false)
  })
})
