import { describe, it, expect } from 'vitest'
import { buildOption } from './chart-data.js'

// Helper: drill into the ECharts option without retyping the full structure
// in every test.
const cfg = (over = {}) => ({
	chartType: 'bar',
	title:     '',
	hasHeader: true,
	encoding:  { x: 0, y: [1] },
	options:   {},
	...over,
})

const MATRIX = [
	['Month', 'Sales', 'Profit'],
	['Jan', 100, 20],
	['Feb', 120, 25],
	['Mar', 150, 30],
]

describe('buildOption — generic', () => {
	it('returns the empty-state option for an empty matrix', () => {
		const opt = buildOption(cfg(), [])
		expect(opt.title.text).toBe('No data')
	})

	it('includes the configured title as the top-left heading', () => {
		const opt = buildOption(cfg({ title: 'My Chart' }), MATRIX)
		expect(opt.title.text).toBe('My Chart')
	})

	it('honours showLegend=false', () => {
		const opt = buildOption(cfg({ options: { showLegend: false } }), MATRIX)
		expect(opt.legend.show).toBe(false)
	})

	it('uses ESPRESSO palette by default', () => {
		const opt = buildOption(cfg(), MATRIX)
		expect(opt.color[0]).toMatch(/^#[0-9A-F]{6}$/i)
		expect(opt.color.length).toBeGreaterThanOrEqual(4)
	})
})

describe('buildOption — bar chart', () => {
	it('builds a single bar series from one y column', () => {
		const opt = buildOption(cfg({ chartType: 'bar' }), MATRIX)
		expect(opt.xAxis.data).toEqual(['Jan', 'Feb', 'Mar'])
		expect(opt.series).toHaveLength(1)
		expect(opt.series[0].type).toBe('bar')
		expect(opt.series[0].data).toEqual([100, 120, 150])
		expect(opt.series[0].name).toBe('Sales')
	})

	it('builds multiple series when y has multiple columns', () => {
		const opt = buildOption(cfg({ chartType: 'bar', encoding: { x: 0, y: [1, 2] } }), MATRIX)
		expect(opt.series).toHaveLength(2)
		expect(opt.series.map(s => s.name)).toEqual(['Sales', 'Profit'])
		expect(opt.series[1].data).toEqual([20, 25, 30])
	})

	it('applies stack="total" when options.stacked is true', () => {
		const opt = buildOption(cfg({ chartType: 'bar', options: { stacked: true } }), MATRIX)
		expect(opt.series[0].stack).toBe('total')
	})

	it('omits stack when stacked is false', () => {
		const opt = buildOption(cfg({ chartType: 'bar' }), MATRIX)
		expect(opt.series[0].stack).toBeUndefined()
	})
})

describe('buildOption — line chart', () => {
	it('uses series type "line"', () => {
		const opt = buildOption(cfg({ chartType: 'line' }), MATRIX)
		expect(opt.series[0].type).toBe('line')
	})

	it('smooth=true propagates to the series', () => {
		const opt = buildOption(cfg({ chartType: 'line', options: { smooth: true } }), MATRIX)
		expect(opt.series[0].smooth).toBe(true)
	})
})

describe('buildOption — area chart', () => {
	it('uses series type "line" with an areaStyle', () => {
		const opt = buildOption(cfg({ chartType: 'area' }), MATRIX)
		expect(opt.series[0].type).toBe('line')
		expect(opt.series[0].areaStyle).toBeDefined()
		expect(opt.series[0].areaStyle.opacity).toBeGreaterThan(0)
	})
})

describe('buildOption — scatter chart', () => {
	it('uses series type "scatter" with a circle marker', () => {
		const opt = buildOption(cfg({ chartType: 'scatter' }), MATRIX)
		expect(opt.series[0].type).toBe('scatter')
		expect(opt.series[0].symbol).toBe('circle')
	})

	it('xAxis is "value" (not "category") for scatter', () => {
		const opt = buildOption(cfg({ chartType: 'scatter' }), MATRIX)
		expect(opt.xAxis.type).toBe('value')
	})
})

describe('buildOption — pie chart', () => {
	it('produces one pie series with label/value entries', () => {
		const opt = buildOption(cfg({ chartType: 'pie' }), MATRIX)
		expect(opt.series).toHaveLength(1)
		expect(opt.series[0].type).toBe('pie')
		expect(opt.series[0].data).toHaveLength(3)
		expect(opt.series[0].data[0]).toEqual({ name: 'Jan', value: 100 })
	})

	it('drops zero-value slices', () => {
		const data = [['Label', 'Value'], ['A', 0], ['B', 10], ['C', 0]]
		const opt  = buildOption(cfg({ chartType: 'pie' }), data)
		expect(opt.series[0].data).toEqual([{ name: 'B', value: 10 }])
	})
})

describe('buildOption — hasHeader handling', () => {
	it('hasHeader=true: first row used as series names + skipped from data', () => {
		const opt = buildOption(cfg({ chartType: 'bar' }), MATRIX)
		expect(opt.series[0].name).toBe('Sales')
		expect(opt.xAxis.data).not.toContain('Month')
	})

	it('hasHeader=false: series gets a default name + first row included', () => {
		const opt = buildOption(cfg({ chartType: 'bar', hasHeader: false }), MATRIX)
		expect(opt.series[0].name).toBe('Series 1')
		expect(opt.xAxis.data[0]).toBe('Month')
	})
})

describe('buildOption — robustness', () => {
	it('coerces non-numeric cells to 0', () => {
		const data = [['m', 'v'], ['Jan', 'oops'], ['Feb', 10]]
		const opt = buildOption(cfg(), data)
		expect(opt.series[0].data).toEqual([0, 10])
	})

	it('defaults encoding when missing — first col x, rest y', () => {
		const opt = buildOption({ chartType: 'bar', hasHeader: true }, MATRIX)
		expect(opt.series).toHaveLength(2)
	})

	it('renders without options object', () => {
		const opt = buildOption({ chartType: 'bar', hasHeader: true, encoding: { x: 0, y: [1] } }, MATRIX)
		expect(opt.series[0].data).toEqual([100, 120, 150])
	})
})
