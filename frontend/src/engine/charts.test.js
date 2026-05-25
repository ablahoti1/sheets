import { describe, it, expect, vi } from 'vitest'
import { createChartEngine, CHART_TYPES, isValidChartType, ESPRESSO_PALETTE } from './charts.js'

describe('createChartEngine — basic CRUD', () => {
	it('add returns an id and persists the config', () => {
		const ce = createChartEngine()
		const id = ce.add({ chartType: 'bar', sourceRange: 'A1:B2' })
		expect(id).toMatch(/^chart_\d+$/)
		expect(ce.get(id)).toMatchObject({ id, chartType: 'bar', sourceRange: 'A1:B2' })
	})

	it('respects a caller-provided id', () => {
		const ce = createChartEngine()
		ce.add({ id: 'fixed-1', chartType: 'pie' })
		expect(ce.get('fixed-1')).toBeTruthy()
	})

	it('update merges a patch', () => {
		const ce = createChartEngine()
		const id = ce.add({ chartType: 'bar', title: 'old' })
		ce.update(id, { title: 'new', chartType: 'line' })
		expect(ce.get(id)).toMatchObject({ title: 'new', chartType: 'line' })
	})

	it('update on missing id is a no-op', () => {
		const ce = createChartEngine()
		expect(() => ce.update('does-not-exist', { title: 'x' })).not.toThrow()
		expect(ce.get('does-not-exist')).toBeUndefined()
	})

	it('remove deletes the config', () => {
		const ce = createChartEngine()
		const id = ce.add({ chartType: 'bar' })
		ce.remove(id)
		expect(ce.get(id)).toBeUndefined()
		expect(ce.list()).toHaveLength(0)
	})

	it('list returns all configs', () => {
		const ce = createChartEngine()
		ce.add({ chartType: 'bar' })
		ce.add({ chartType: 'line' })
		expect(ce.list()).toHaveLength(2)
	})
})

describe('createChartEngine — onChange notifications', () => {
	it('fires on add', () => {
		const ce = createChartEngine()
		const cb = vi.fn()
		ce.setOnChange(cb)
		ce.add({ chartType: 'bar' })
		expect(cb).toHaveBeenCalledTimes(1)
	})

	it('fires on update', () => {
		const ce = createChartEngine()
		const id = ce.add({ chartType: 'bar' })
		const cb = vi.fn()
		ce.setOnChange(cb)
		ce.update(id, { chartType: 'line' })
		expect(cb).toHaveBeenCalledTimes(1)
	})

	it('does not fire on update of a missing id', () => {
		const ce = createChartEngine()
		const cb = vi.fn()
		ce.setOnChange(cb)
		ce.update('nope', { title: 'x' })
		expect(cb).not.toHaveBeenCalled()
	})

	it('fires on remove of an existing id, not a missing one', () => {
		const ce = createChartEngine()
		const id = ce.add({ chartType: 'bar' })
		const cb = vi.fn()
		ce.setOnChange(cb)
		ce.remove('nope')
		expect(cb).not.toHaveBeenCalled()
		ce.remove(id)
		expect(cb).toHaveBeenCalledTimes(1)
	})

	it('fires on restore (so reactive computeds re-run after page reload)', () => {
		const ce = createChartEngine()
		const cb = vi.fn()
		ce.setOnChange(cb)
		ce.restore({ charts: { 'chart_1': { id: 'chart_1', chartType: 'pie' } }, nextId: 2 })
		expect(cb).toHaveBeenCalled()
	})
})

describe('createChartEngine — listForSheet / affectsChart', () => {
	it('listForSheet filters by position.sheet', () => {
		const ce = createChartEngine()
		ce.add({ chartType: 'bar', position: { sheet: 'Sheet1' } })
		ce.add({ chartType: 'pie', position: { sheet: 'Sheet2' } })
		expect(ce.listForSheet('Sheet1')).toHaveLength(1)
		expect(ce.listForSheet('Sheet2')).toHaveLength(1)
		expect(ce.listForSheet('Sheet3')).toHaveLength(0)
	})

	it('affectsChart checks sourceSheet, not position.sheet', () => {
		const ce = createChartEngine()
		ce.add({ chartType: 'bar', sourceSheet: 'Data', position: { sheet: 'Charts' } })
		expect(ce.affectsChart('Data')).toBe(true)
		expect(ce.affectsChart('Charts')).toBe(false)
	})
})

describe('createChartEngine — snapshot / restore round trip', () => {
	it('preserves all configs', () => {
		const ce = createChartEngine()
		ce.add({ chartType: 'bar', title: 'A', sourceRange: 'A1:B5' })
		ce.add({ chartType: 'pie', title: 'B', sourceRange: 'C1:D5' })
		const snap = ce.snapshot()

		const ce2 = createChartEngine()
		ce2.restore(snap)
		expect(ce2.list()).toHaveLength(2)
		expect(ce2.list().map(c => c.title).sort()).toEqual(['A', 'B'])
	})

	it('advances nextId past restored ids so new adds do not collide', () => {
		const ce = createChartEngine()
		ce.restore({
			charts: { 'chart_5': { id: 'chart_5', chartType: 'bar' } },
			nextId: 1,                        // deliberately stale
		})
		const newId = ce.add({ chartType: 'line' })
		expect(newId).not.toBe('chart_5')
		expect(parseInt(newId.replace('chart_', ''), 10)).toBeGreaterThan(5)
	})

	it('restore(undefined) is a no-op', () => {
		const ce = createChartEngine()
		ce.add({ chartType: 'bar' })
		expect(() => ce.restore(undefined)).not.toThrow()
		expect(ce.list()).toHaveLength(1)
	})

	it('restore(empty) clears existing charts', () => {
		const ce = createChartEngine()
		ce.add({ chartType: 'bar' })
		ce.restore({ charts: {}, nextId: 1 })
		expect(ce.list()).toHaveLength(0)
	})
})

describe('CHART_TYPES + ESPRESSO_PALETTE', () => {
	it('CHART_TYPES includes the v1 set', () => {
		expect(CHART_TYPES).toContain('line')
		expect(CHART_TYPES).toContain('bar')
		expect(CHART_TYPES).toContain('pie')
		expect(CHART_TYPES).toContain('area')
		expect(CHART_TYPES).toContain('scatter')
	})

	it('isValidChartType', () => {
		expect(isValidChartType('bar')).toBe(true)
		expect(isValidChartType('candlestick')).toBe(false)
	})

	it('ESPRESSO_PALETTE has at least 8 distinct colours', () => {
		expect(new Set(ESPRESSO_PALETTE).size).toBeGreaterThanOrEqual(8)
	})
})
