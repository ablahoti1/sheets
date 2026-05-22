import { describe, it, expect } from 'vitest'
import { textNumberDetector } from './text-number.js'

describe('textNumberDetector', () => {
	// ── Single embedded number ─────────────────────────────────────────

	it('extends a Q1/Q2 quarter sequence linearly past Q4', () => {
		// Spec note: Google extends linearly (Q5 etc), not wraps.
		const r = textNumberDetector.detect(['Q1', 'Q2'])
		expect(r.kind).toBe('text-number')
		expect(r.next(1)).toBe('Q3')
		expect(r.next(3)).toBe('Q5')
	})

	it('preserves zero-padding width', () => {
		const r = textNumberDetector.detect(['Product-001', 'Product-002'])
		expect(r.next(1)).toBe('Product-003')
		expect(r.next(8)).toBe('Product-010')
		expect(r.next(98)).toBe('Product-100')
	})

	it('handles literal-only prefix', () => {
		const r = textNumberDetector.detect(['Item 1', 'Item 2'])
		expect(r.next(1)).toBe('Item 3')
		expect(r.next(4)).toBe('Item 6')
	})

	it('handles literal-only suffix', () => {
		const r = textNumberDetector.detect(['1st', '2nd'])
		// 'st' and 'nd' are different literals → skeleton mismatch → null
		expect(r).toBeNull()
	})

	// ── Multiple embedded numbers ─────────────────────────────────────

	it('holds constant numbers and advances varying ones', () => {
		// A1B2, A1B3 → constant A1, varying B-number
		const r = textNumberDetector.detect(['A1B2', 'A1B3'])
		expect(r.next(1)).toBe('A1B4')
		expect(r.next(2)).toBe('A1B5')
	})

	it('advances multiple slots independently', () => {
		const r = textNumberDetector.detect(['R1-C1', 'R2-C2'])
		expect(r.next(1)).toBe('R3-C3')
		expect(r.next(2)).toBe('R4-C4')
	})

	// ── Backward direction ─────────────────────────────────────────────

	it('backward direction decrements from the first value', () => {
		const r = textNumberDetector.detect(['Q3', 'Q4'])
		expect(r.next(1, -1)).toBe('Q2')
		expect(r.next(3, -1)).toBe('Q0')
	})

	// ── Edge cases ─────────────────────────────────────────────────────

	it('returns null when literal segments differ', () => {
		expect(textNumberDetector.detect(['Q1', 'X2'])).toBeNull()
	})

	it('returns null when the integer slot is non-arithmetic', () => {
		expect(textNumberDetector.detect(['Q1', 'Q2', 'Q4'])).toBeNull()
	})

	it('returns null when there are no embedded integers (so alphabetic can handle it)', () => {
		expect(textNumberDetector.detect(['A', 'B'])).toBeNull()
	})

	it('returns null when all numbers are identical (caller copies)', () => {
		expect(textNumberDetector.detect(['Q1', 'Q1'])).toBeNull()
	})

	it('single cell extends by +1', () => {
		const r = textNumberDetector.detect(['Item 5'])
		expect(r.next(1)).toBe('Item 6')
		expect(r.next(3)).toBe('Item 8')
	})
})
