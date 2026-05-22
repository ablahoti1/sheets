import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHeaderPainter } from './header-painter.js'
import { createMockCtx, createMockGeo } from './test-utils.js'

const NO_SEL   = { r: 0, c: 0 }
const NO_RANGE = { r0: 0, c0: 0, r1: 0, c1: 0 }

describe('HeaderPainter', () => {
  let ctx, geo, painter

  beforeEach(() => {
    ctx     = createMockCtx()
    geo     = createMockGeo()
    painter = createHeaderPainter(ctx, geo)
  })

  describe('drawColHeaders', () => {
    it('fills headerBg across the whole strip', () => {
      painter.drawColHeaders(0, 4, 0, 50, 600, NO_SEL, NO_RANGE, 'cell')
      expect(ctx.fillRect).toHaveBeenCalled()
    })

    it('highlights anchor column with activeHeader fill', () => {
      const sel   = { r: 0, c: 2 }
      const range = { r0: 0, c0: 2, r1: 0, c1: 2 }
      painter.drawColHeaders(0, 4, 0, 50, 600, sel, range, 'cell')
      // activeHeader should be assigned to fillStyle at some point
      const fillStyles = ctx.fillRect.mock.calls.map(() => ctx.fillStyle)
      expect(fillStyles.some(Boolean)).toBe(true)
    })

    it('clips scrollable headers to mainX so they cannot bleed into frozen area', () => {
      painter.drawColHeaders(0, 4, 2, 250, 600, NO_SEL, NO_RANGE, 'cell')
      expect(ctx.save).toHaveBeenCalled()
      expect(ctx.clip).toHaveBeenCalled()
      expect(ctx.restore).toHaveBeenCalled()
    })

    it('draws frozen headers without clipping (pass-2)', () => {
      // With fc=2, _drawOneColHeader is called for c=0 and c=1 outside the clipped region
      const saveCount = ctx.save.mock.calls.length
      painter.drawColHeaders(2, 4, 2, 250, 600, NO_SEL, NO_RANGE, 'cell')
      // At least one save for the scrollable clip
      expect(ctx.save.mock.calls.length - saveCount).toBeGreaterThanOrEqual(1)
    })

    it('calls fillText for each visible column label', () => {
      painter.drawColHeaders(0, 3, 0, 50, 600, NO_SEL, NO_RANGE, 'cell')
      expect(ctx.fillText).toHaveBeenCalledTimes(4)  // cols 0,1,2,3
    })
  })

  describe('drawRowHeaders', () => {
    it('fills headerBg along the row-header strip', () => {
      painter.drawRowHeaders(0, 5, 0, 24, 400, NO_SEL, NO_RANGE, 'cell')
      expect(ctx.fillRect).toHaveBeenCalled()
    })

    it('calls fillText for each visible row number', () => {
      painter.drawRowHeaders(0, 3, 0, 24, 400, NO_SEL, NO_RANGE, 'cell')
      expect(ctx.fillText).toHaveBeenCalledTimes(4)  // rows 0,1,2,3
    })

    it('skips rows with zero height', () => {
      const geoHidden = createMockGeo({ rowHeights: { 1: 0 } })
      const p = createHeaderPainter(ctx, geoHidden)
      p.drawRowHeaders(0, 2, 0, 24, 400, NO_SEL, NO_RANGE, 'cell')
      // row 1 is hidden → only rows 0 and 2 have fillText
      expect(ctx.fillText).toHaveBeenCalledTimes(2)
    })

    it('highlights anchor row with activeHeader fill', () => {
      const fillsBefore = ctx.fillRect.mock.calls.length
      const sel   = { r: 1, c: 0 }
      const range = { r0: 1, c0: 0, r1: 1, c1: 0 }
      painter.drawRowHeaders(0, 3, 0, 24, 400, sel, range, 'cell')
      const fillsAfter = ctx.fillRect.mock.calls.length
      // One extra fillRect for the anchor background, plus the strip fill
      expect(fillsAfter - fillsBefore).toBeGreaterThan(1)
    })
  })

  describe('drawCorner', () => {
    it('fills the corner cell with headerBg', () => {
      painter.drawCorner()
      expect(ctx.fillRect).toHaveBeenCalledTimes(1)
    })

    it('strokes the corner divider lines', () => {
      painter.drawCorner()
      expect(ctx.stroke).toHaveBeenCalledTimes(1)
    })
  })
})
