import { describe, it, expect, vi } from 'vitest'
import { createNamedRanges } from './named-ranges.js'

describe('createNamedRanges — add', () => {
	it('stores a valid entry', () => {
		const nr = createNamedRanges()
		expect(nr.add({ name: 'Revenue', sheet: 'Sheet1', range: 'B2:B100' }).name).toBe('Revenue')
		expect(nr.get('Revenue')).toMatchObject({ name: 'Revenue', sheet: 'Sheet1', range: 'B2:B100' })
	})

	it('lookup is case-insensitive', () => {
		const nr = createNamedRanges()
		nr.add({ name: 'Revenue', sheet: 'Sheet1', range: 'A1' })
		expect(nr.has('revenue')).toBe(true)
		expect(nr.has('REVENUE')).toBe(true)
		expect(nr.get('REVENUE')?.name).toBe('Revenue')   // original casing preserved
	})

	it('rejects names that look like cell refs', () => {
		const nr = createNamedRanges()
		expect(nr.add({ name: 'A1', sheet: 'Sheet1', range: 'B1' }).error).toMatch(/cell reference/i)
	})

	it('rejects reserved words', () => {
		const nr = createNamedRanges()
		expect(nr.add({ name: 'TRUE', sheet: 'Sheet1', range: 'A1' }).error).toMatch(/reserved/i)
	})

	it('rejects names containing spaces or punctuation', () => {
		const nr = createNamedRanges()
		expect(nr.add({ name: 'My Range', sheet: 'Sheet1', range: 'A1' }).error).toBeTruthy()
		expect(nr.add({ name: 'foo-bar',  sheet: 'Sheet1', range: 'A1' }).error).toBeTruthy()
		expect(nr.add({ name: '1Revenue', sheet: 'Sheet1', range: 'A1' }).error).toBeTruthy()
	})

	it('rejects names that collide with a built-in function via the hook', () => {
		const nr = createNamedRanges({ isBuiltinFunction: n => n === 'SUM' })
		expect(nr.add({ name: 'SUM', sheet: 'Sheet1', range: 'A1' }).error).toMatch(/built-in/i)
	})

	it('rejects duplicate names', () => {
		const nr = createNamedRanges()
		nr.add({ name: 'Revenue', sheet: 'Sheet1', range: 'A1' })
		expect(nr.add({ name: 'Revenue', sheet: 'Sheet2', range: 'B2' }).error).toMatch(/exists/i)
	})

	it('rejects malformed ranges', () => {
		const nr = createNamedRanges()
		expect(nr.add({ name: 'X', sheet: 'Sheet1', range: 'A' }).error).toMatch(/range/i)
		expect(nr.add({ name: 'Y', sheet: 'Sheet1', range: '123' }).error).toMatch(/range/i)
		expect(nr.add({ name: 'Z', sheet: 'Sheet1', range: 'A1:' }).error).toMatch(/range/i)
	})
})

describe('createNamedRanges — update / remove', () => {
	it('update changes range in place', () => {
		const nr = createNamedRanges()
		nr.add({ name: 'X', sheet: 'Sheet1', range: 'A1' })
		nr.update('X', { range: 'B2:B5' })
		expect(nr.get('X').range).toBe('B2:B5')
	})

	it('update can rename without losing data', () => {
		const nr = createNamedRanges()
		nr.add({ name: 'X', sheet: 'Sheet1', range: 'A1' })
		nr.update('X', { name: 'Y' })
		expect(nr.has('X')).toBe(false)
		expect(nr.get('Y')).toMatchObject({ name: 'Y', sheet: 'Sheet1', range: 'A1' })
	})

	it('update returns an error for unknown name', () => {
		const nr = createNamedRanges()
		expect(nr.update('nope', { range: 'A1' }).error).toMatch(/not found/i)
	})

	it('remove deletes the entry', () => {
		const nr = createNamedRanges()
		nr.add({ name: 'X', sheet: 'Sheet1', range: 'A1' })
		nr.remove('X')
		expect(nr.has('X')).toBe(false)
	})
})

describe('createNamedRanges — resolve', () => {
	it('returns sheet + start + end for a single cell', () => {
		const nr = createNamedRanges()
		nr.add({ name: 'PriceCell', sheet: 'Data', range: 'B2' })
		expect(nr.resolve('PriceCell')).toEqual({ sheet: 'Data', start: 'B2', end: 'B2' })
	})

	it('returns the parsed range for A1:B5', () => {
		const nr = createNamedRanges()
		nr.add({ name: 'PriceTable', sheet: 'Data', range: 'B2:D10' })
		expect(nr.resolve('PriceTable')).toEqual({ sheet: 'Data', start: 'B2', end: 'D10' })
	})

	it('returns null for unknown names', () => {
		const nr = createNamedRanges()
		expect(nr.resolve('Nope')).toBeNull()
	})
})

describe('createNamedRanges — renameSheet', () => {
	it('rewrites the sheet field for every matching entry', () => {
		const nr = createNamedRanges()
		nr.add({ name: 'A', sheet: 'Sheet1', range: 'A1' })
		nr.add({ name: 'B', sheet: 'Sheet1', range: 'B1' })
		nr.add({ name: 'C', sheet: 'Other',  range: 'C1' })
		nr.renameSheet('Sheet1', 'Data')
		expect(nr.get('A').sheet).toBe('Data')
		expect(nr.get('B').sheet).toBe('Data')
		expect(nr.get('C').sheet).toBe('Other')   // unchanged
	})
})

describe('createNamedRanges — snapshot / restore + onChange', () => {
	it('round-trips entries', () => {
		const nr = createNamedRanges()
		nr.add({ name: 'X', sheet: 'Sheet1', range: 'A1' })
		nr.add({ name: 'Y', sheet: 'Sheet2', range: 'B1:B5' })
		const snap = nr.snapshot()

		const nr2 = createNamedRanges()
		nr2.restore(snap)
		expect(nr2.list().map(e => e.name).sort()).toEqual(['X', 'Y'])
		expect(nr2.get('Y').range).toBe('B1:B5')
	})

	it('fires onChange for add / update / remove / restore', () => {
		const nr = createNamedRanges()
		const cb = vi.fn()
		nr.setOnChange(cb)
		nr.add({ name: 'X', sheet: 'Sheet1', range: 'A1' })
		nr.update('X', { range: 'B1' })
		nr.remove('X')
		nr.restore({ entries: { Y: { name: 'Y', sheet: 'Sheet1', range: 'A1' } } })
		expect(cb.mock.calls.length).toBeGreaterThanOrEqual(4)
	})
})
