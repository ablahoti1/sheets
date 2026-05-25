import { describe, it, expect, vi } from 'vitest'
import { buildAlignOptions, buildBorderOptions, buildMoreToolbarOptions } from './toolbar.config.js'

describe('buildAlignOptions', () => {
  it('returns two groups: Horizontal and Vertical', () => {
    const opts = buildAlignOptions({ setAlign: vi.fn(), setValign: vi.fn() })
    expect(opts).toHaveLength(2)
    expect(opts[0].group).toBe('Horizontal')
    expect(opts[1].group).toBe('Vertical')
  })

  it('horizontal group has 3 items', () => {
    const opts = buildAlignOptions({ setAlign: vi.fn(), setValign: vi.fn() })
    expect(opts[0].items).toHaveLength(3)
  })

  it('clicking Left calls setAlign("left")', () => {
    const setAlign = vi.fn()
    const opts = buildAlignOptions({ setAlign, setValign: vi.fn() })
    opts[0].items[0].onClick()
    expect(setAlign).toHaveBeenCalledWith('left')
  })

  it('clicking Middle calls setValign("middle")', () => {
    const setValign = vi.fn()
    const opts = buildAlignOptions({ setAlign: vi.fn(), setValign })
    opts[1].items[1].onClick()
    expect(setValign).toHaveBeenCalledWith('middle')
  })
})

describe('buildBorderOptions', () => {
  it('returns three groups', () => {
    const opts = buildBorderOptions({ applyBorder: vi.fn() })
    expect(opts).toHaveLength(3)
  })

  it('clicking All borders calls applyBorder("all")', () => {
    const applyBorder = vi.fn()
    const opts = buildBorderOptions({ applyBorder })
    opts[0].items[0].onClick()
    expect(applyBorder).toHaveBeenCalledWith('all')
  })

  it('No border item has red theme', () => {
    const opts = buildBorderOptions({ applyBorder: vi.fn() })
    const noBorder = opts[2].items[0]
    expect(noBorder.theme).toBe('red')
  })

  it('clicking No border calls applyBorder("none")', () => {
    const applyBorder = vi.fn()
    const opts = buildBorderOptions({ applyBorder })
    opts[2].items[0].onClick()
    expect(applyBorder).toHaveBeenCalledWith('none')
  })
})

describe('buildMoreToolbarOptions', () => {
  function makeHandlers() {
    return {
      toggleFmt: vi.fn(), toggleWrap: vi.fn(), toggleFormatPainter: vi.fn(),
      clearFormatting: vi.fn(), adjustDecimals: vi.fn(), openCfDialog: vi.fn(),
      openHyperlinkDialog: vi.fn(), toggleMerge: vi.fn(), toggleSortFilter: vi.fn(),
      applyBorder: vi.fn(), zoomBy: vi.fn(), resetZoom: vi.fn(), openPivotDialog: vi.fn(),
    }
  }

  it('returns 7 groups (Format, Numbers, Cells, Borders, View, Insert, Workbook)', () => {
    const opts = buildMoreToolbarOptions(makeHandlers())
    expect(opts).toHaveLength(7)
    expect(opts.map(g => g.group)).toEqual(
      ['Format', 'Numbers', 'Cells', 'Borders', 'View', 'Insert', 'Workbook'],
    )
  })

  it('Strikethrough calls toggleFmt("strikethrough")', () => {
    const h = makeHandlers()
    const opts = buildMoreToolbarOptions(h)
    opts[0].items[0].onClick()
    expect(h.toggleFmt).toHaveBeenCalledWith('strikethrough')
  })

  it('Toggle filter calls toggleSortFilter', () => {
    const h = makeHandlers()
    const opts = buildMoreToolbarOptions(h)
    const filterItem = opts[2].items.find(i => i.label === 'Toggle filter')
    filterItem.onClick()
    expect(h.toggleSortFilter).toHaveBeenCalled()
  })

  it('Zoom in calls zoomBy(+0.1)', () => {
    const h = makeHandlers()
    const opts = buildMoreToolbarOptions(h)
    const zoomIn = opts[4].items.find(i => i.label === 'Zoom in')
    zoomIn.onClick()
    expect(h.zoomBy).toHaveBeenCalledWith(+0.1)
  })

  it('Pivot table calls openPivotDialog', () => {
    const h = makeHandlers()
    const opts = buildMoreToolbarOptions(h)
    const pivot = opts[5].items[0]
    pivot.onClick()
    expect(h.openPivotDialog).toHaveBeenCalled()
  })
})
