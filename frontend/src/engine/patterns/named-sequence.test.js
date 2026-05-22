import { describe, it, expect } from 'vitest'
import { namedSequenceDetector } from './named-sequence.js'

describe('namedSequenceDetector', () => {
	// ── Days ─────────────────────────────────────────────────────────

	it('continues abbreviated day names', () => {
		const r = namedSequenceDetector.detect(['Mon', 'Tue'])
		expect(r.kind).toBe('named-sequence')
		expect(r.next(1)).toBe('Wed')
		expect(r.next(2)).toBe('Thu')
	})

	it('wraps from Saturday back to Sunday', () => {
		const r = namedSequenceDetector.detect(['Sat'])
		expect(r.next(1)).toBe('Sun')
	})

	it('continues full day names', () => {
		const r = namedSequenceDetector.detect(['Monday', 'Tuesday'])
		expect(r.next(1)).toBe('Wednesday')
	})

	it('preserves lowercase input', () => {
		const r = namedSequenceDetector.detect(['mon', 'tue'])
		expect(r.next(1)).toBe('wed')
	})

	it('preserves uppercase input', () => {
		const r = namedSequenceDetector.detect(['JAN', 'FEB'])
		expect(r.next(1)).toBe('MAR')
	})

	// ── Months ───────────────────────────────────────────────────────

	it('continues abbreviated month names', () => {
		const r = namedSequenceDetector.detect(['Jan', 'Feb'])
		// next(N) extends past the LAST source value (Feb).
		// Feb +1 = Mar, Feb +10 = Dec, Feb +11 wraps to Jan.
		expect(r.next(1)).toBe('Mar')
		expect(r.next(10)).toBe('Dec')
		expect(r.next(11)).toBe('Jan')
	})

	it('continues full month names', () => {
		const r = namedSequenceDetector.detect(['January', 'February'])
		expect(r.next(1)).toBe('March')
	})

	it('handles a step > 1', () => {
		const r = namedSequenceDetector.detect(['Jan', 'Mar'])
		expect(r.next(1)).toBe('May')
		expect(r.next(2)).toBe('Jul')
	})

	// ── Edge cases ───────────────────────────────────────────────────

	it('returns null when values mix different sequences', () => {
		expect(namedSequenceDetector.detect(['Mon', 'Jan'])).toBeNull()
	})

	it('returns null on irregular stepping', () => {
		expect(namedSequenceDetector.detect(['Jan', 'Feb', 'Apr'])).toBeNull()
	})

	it('backward direction wraps the other way', () => {
		const r = namedSequenceDetector.detect(['Wed', 'Thu'])
		expect(r.next(1, -1)).toBe('Tue')
		expect(r.next(3, -1)).toBe('Sun')
	})
})
