import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSelectionPainter } from './selection-painter.js'
import { createMockCtx, createMockGeo } from './test-utils.js'

describe('SelectionPainter', () => {
  let ctx, geo, painter

  beforeEach(() => {
    ctx     = createMockCtx()
    geo     = createMockGeo()
    painter = createSelectionPainter(ctx, geo)
  })

  describe('drawSelFill', () => {
    it('fills the bounding rect of a single-cell range', () => {
      painter.drawSelFill({ r0: 1, c0: 1, r1: 1, c1: 1 })
      expect(ctx.fillRect).toHaveBeenCalledTimes(1)
    })

    it('uses selFill color', () => {
      painter.drawSelFill({ r0: 0, c0: 0, r1: 2, c1: 2 })
      expect(ctx.fillStyle).toMatch(/rgba/)
    })

    it('fills a multi-cell range with a larger rect', () => {
      painter.drawSelFill({ r0: 0, c0: 0, r1: 0, c1: 0 })
      const [, , w1] = ctx.fillRect.mock.calls[0]
      ctx.fillRect.mockClear()

      painter.drawSelFill({ r0: 0, c0: 0, r1: 0, c1: 2 })
      const [, , w2] = ctx.fillRect.mock.calls[0]
      expect(w2).toBeGreaterThan(w1)
    })
  })

  const SINGLE = { r0: 0, c0: 0, r1: 0, c1: 0 }

  describe('drawSelectionBorder', () => {
    it('strokes a rect around the active cell', () => {
      painter.drawSelectionBorder({ r: 0, c: 0 }, SINGLE, 0, 0, 50, 24, 600, 400, null)
      expect(ctx.strokeRect).toHaveBeenCalledTimes(1)
    })

    it('draws a fill-handle arc at the range bottom-right corner', () => {
      painter.drawSelectionBorder({ r: 0, c: 0 }, SINGLE, 0, 0, 50, 24, 600, 400, null)
      // Two arcs: white ring (r=5) + filled dot (r=4)
      expect(ctx.arc).toHaveBeenCalledTimes(2)
      expect(ctx.fill).toHaveBeenCalledTimes(2)
    })

    it('places fill handle at r1,c1 corner of a multi-cell range', () => {
      const range = { r0: 0, c0: 0, r1: 0, c1: 1 }
      painter.drawSelectionBorder({ r: 0, c: 0 }, range, 0, 0, 50, 24, 600, 400, null)
      // arc x should be at colX(1) + cw(1) = 100 + 100 = 200
      const [arcX] = ctx.arc.mock.calls[0]
      expect(arcX).toBeGreaterThan(100)
    })

    it('spans merged cell footprint when getMergeInfo returns a merge', () => {
      const getMergeInfo = vi.fn(() => ({ colSpan: 3, rowSpan: 2 }))
      painter.drawSelectionBorder({ r: 0, c: 0 }, SINGLE, 0, 0, 50, 24, 600, 400, getMergeInfo)
      const [, , w, h] = ctx.strokeRect.mock.calls[0]
      expect(w).toBeGreaterThan(100 - 2)  // spans 3 cols
      expect(h).toBeGreaterThan(24  - 2)  // spans 2 rows
    })

    it('saves and restores ctx around clipping', () => {
      painter.drawSelectionBorder({ r: 0, c: 0 }, SINGLE, 0, 0, 50, 24, 600, 400, null)
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.restore).toHaveBeenCalled()
    })
  })

  describe('drawMarchingAnts', () => {
    it('draws a dashed rect around the given range', () => {
      painter.drawMarchingAnts({ r0: 0, c0: 0, r1: 1, c1: 1 }, 0)
      expect(ctx.strokeRect).toHaveBeenCalledTimes(1)
      expect(ctx.setLineDash).toHaveBeenCalledWith([4, 4])
    })

    it('applies phase offset to lineDashOffset', () => {
      painter.drawMarchingAnts({ r0: 0, c0: 0, r1: 0, c1: 0 }, 42)
      expect(ctx.lineDashOffset).toBe(-42)
    })

    it('saves and restores ctx state', () => {
      painter.drawMarchingAnts({ r0: 0, c0: 0, r1: 0, c1: 0 }, 0)
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.restore).toHaveBeenCalled()
    })
  })

  describe('drawPickerRect', () => {
    it('fills and strokes the picker range', () => {
      painter.drawPickerRect({ r0: 0, c0: 0, r1: 1, c1: 1 })
      expect(ctx.fillRect).toHaveBeenCalledTimes(1)
      expect(ctx.strokeRect).toHaveBeenCalledTimes(1)
    })

    it('uses a dashed stroke', () => {
      painter.drawPickerRect({ r0: 0, c0: 0, r1: 0, c1: 0 })
      expect(ctx.setLineDash).toHaveBeenCalledWith([6, 4])
    })

    it('saves and restores ctx state', () => {
      painter.drawPickerRect({ r0: 0, c0: 0, r1: 0, c1: 0 })
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.restore).toHaveBeenCalled()
    })
  })
})
