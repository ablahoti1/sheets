import { describe, it, expect } from 'vitest'
import { numericDetector, _detectStep, _asNumbers } from './numeric.js'

describe('numericDetector', () => {
	it('detects a positive linear progression', () => {
		const r = numericDetector.detect(['1', '2'])
		expect(r.kind).toBe('numeric')
		expect(r.next(1)).toBe(3)
		expect(r.next(2)).toBe(4)
	})

	it('detects a negative step', () => {
		const r = numericDetector.detect(['10', '7'])
		expect(r.next(1)).toBe(4)
		expect(r.next(3)).toBe(-2)
	})

	it('handles decimal steps without floating-point noise', () => {
		const r = numericDetector.detect(['1.5', '2.0', '2.5'])
		expect(r.next(1)).toBeCloseTo(3.0)
		expect(r.next(2)).toBeCloseTo(3.5)
	})

	it('backward direction extrapolates from the first value', () => {
		const r = numericDetector.detect(['10', '11', '12'])
		expect(r.next(1, -1)).toBe(9)
		expect(r.next(3, -1)).toBe(7)
	})

	it('returns null for single value (no progression possible)', () => {
		expect(numericDetector.detect(['5'])).toBeNull()
	})

	it('returns null when the sequence is non-arithmetic', () => {
		expect(numericDetector.detect(['1', '2', '4', '8'])).toBeNull()
	})

	it('returns null for non-numeric input', () => {
		expect(numericDetector.detect(['1', 'foo'])).toBeNull()
	})
})

describe('numeric internals', () => {
	it('_asNumbers rejects empties', () => {
		expect(_asNumbers(['1', ''])).toBeNull()
	})

	it('_detectStep returns 0 for a constant sequence', () => {
		expect(_detectStep([5, 5, 5])).toBe(0)
	})
})
