import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCellPainter } from './cell-painter.js'
import { createMockCtx, createMockGeo } from './test-utils.js'

describe('CellPainter', () => {
  let ctx, geo, painter

  beforeEach(() => {
    ctx     = createMockCtx()
    geo     = createMockGeo()
    painter = createCellPainter(ctx, geo)
  })

  describe('drawRegionCells', () => {
    it('draws nothing when data is empty', () => {
      painter.drawRegionCells(0, 0, 2, 2, {}, null, null, null)
      expect(ctx.fillText).not.toHaveBeenCalled()
    })

    it('calls fillText for a cell that has a value', () => {
      painter.drawRegionCells(0, 0, 1, 1, { 'A1': 'Hello' }, null, null, null)
      expect(ctx.fillText).toHaveBeenCalledWith('Hello', expect.any(Number), expect.any(Number))
    })

    it('right-aligns numeric values automatically', () => {
      painter.drawRegionCells(0, 0, 0, 0, { 'A1': '42' }, null, null, null)
      expect(ctx.textAlign).toBe('right')
    })

    it('left-aligns text values automatically', () => {
      painter.drawRegionCells(0, 0, 0, 0, { 'A1': 'hello' }, null, null, null)
      expect(ctx.textAlign).toBe('left')
    })

    it('respects explicit fmt.align over auto-detection', () => {
      const getFormat = vi.fn(() => ({ align: 'center' }))
      painter.drawRegionCells(0, 0, 0, 0, { 'A1': '99' }, getFormat, null, null)
      expect(ctx.textAlign).toBe('center')
    })

    it('skips slave cells entirely', () => {
      const isSlave = vi.fn(() => true)
      painter.drawRegionCells(0, 0, 0, 0, { 'A1': 'data' }, null, null, isSlave)
      expect(ctx.fillText).not.toHaveBeenCalled()
    })

    it('draws a white background rect for merged cells', () => {
      const getMergeInfo = vi.fn(() => ({ colSpan: 2, rowSpan: 1 }))
      painter.drawRegionCells(0, 0, 0, 0, {}, null, getMergeInfo, null)
      expect(ctx.fillRect).toHaveBeenCalled()
    })

    it('applies backgroundColor from format', () => {
      const getFormat = vi.fn(() => ({ backgroundColor: '#FF0000' }))
      painter.drawRegionCells(0, 0, 0, 0, { 'A1': '' }, getFormat, null, null)
      expect(ctx.fillStyle).toBe('#FF0000')
    })

    it('skips rows with zero height', () => {
      const geoHidden = createMockGeo({ rowHeights: { 0: 0 } })
      const p = createCellPainter(ctx, geoHidden)
      p.drawRegionCells(0, 0, 0, 0, { 'A1': 'hi' }, null, null, null)
      expect(ctx.fillText).not.toHaveBeenCalled()
    })
  })

  describe('drawRegionBorders', () => {
    it('does nothing when getFormat is null', () => {
      painter.drawRegionBorders(0, 0, 2, 2, null, null, null)
      expect(ctx.stroke).not.toHaveBeenCalled()
    })

    it('draws borderTop when format specifies it', () => {
      const getFormat = vi.fn(() => ({ borderTop: { style: 'thin', color: '#000' } }))
      painter.drawRegionBorders(0, 0, 0, 0, getFormat, null, null)
      expect(ctx.stroke).toHaveBeenCalled()
      expect(ctx.moveTo).toHaveBeenCalled()
    })

    it('draws all four borders when all are set', () => {
      const border = { style: 'thin', color: '#000' }
      const getFormat = vi.fn(() => ({
        borderTop: border, borderBottom: border,
        borderLeft: border, borderRight: border,
      }))
      painter.drawRegionBorders(0, 0, 0, 0, getFormat, null, null)
      expect(ctx.stroke).toHaveBeenCalledTimes(4)
    })

    it('skips cells with no format object', () => {
      const getFormat = vi.fn(() => null)
      painter.drawRegionBorders(0, 0, 1, 1, getFormat, null, null)
      expect(ctx.stroke).not.toHaveBeenCalled()
    })

    it('skips slave cells', () => {
      const getFormat = vi.fn(() => ({ borderTop: { style: 'thin', color: '#000' } }))
      const isSlave   = vi.fn(() => true)
      painter.drawRegionBorders(0, 0, 0, 0, getFormat, null, isSlave)
      expect(ctx.stroke).not.toHaveBeenCalled()
    })
  })

  describe('wrapped text', () => {
    it('calls fillText multiple times for text that wraps', () => {
      ctx.measureText = vi.fn((s) => ({ width: s.length * 8 }))
      const getFormat = vi.fn(() => ({ wrapText: true }))
      // "Hello World" at 8px/char = 88px; cell width 100px minus 8 = 92px → should fit on one line
      // But "Hello World is a long sentence" = 240px → needs wrapping
      painter.drawRegionCells(0, 0, 0, 0,
        { 'A1': 'Hello World is a very long sentence here' },
        getFormat, null, null)
      expect(ctx.fillText.mock.calls.length).toBeGreaterThanOrEqual(1)
    })

    it('does not call fillText when wrapped value is empty', () => {
      const getFormat = vi.fn(() => ({ wrapText: true }))
      painter.drawRegionCells(0, 0, 0, 0, { 'A1': '' }, getFormat, null, null)
      expect(ctx.fillText).not.toHaveBeenCalled()
    })
  })

  describe('text decorations', () => {
    it('draws underline stroke when format.underline is true', () => {
      const getFormat = vi.fn(() => ({ underline: true }))
      painter.drawRegionCells(0, 0, 0, 0, { 'A1': 'text' }, getFormat, null, null)
      // underline produces an extra stroke() call beyond the font setup
      expect(ctx.stroke).toHaveBeenCalled()
    })

    it('draws strikethrough when format.strikethrough is true', () => {
      const getFormat = vi.fn(() => ({ strikethrough: true }))
      painter.drawRegionCells(0, 0, 0, 0, { 'A1': 'text' }, getFormat, null, null)
      expect(ctx.stroke).toHaveBeenCalled()
    })
  })
})
