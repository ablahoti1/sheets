import { describe, it, expect } from 'vitest'
import { alphabeticDetector, _internal } from './alphabetic.js'

describe('alphabeticDetector', () => {
	it('continues uppercase single-letter sequence', () => {
		const r = alphabeticDetector.detect(['A', 'B'])
		expect(r.kind).toBe('alphabetic')
		expect(r.next(1)).toBe('C')
		expect(r.next(3)).toBe('E')
	})

	it('preserves lowercase', () => {
		const r = alphabeticDetector.detect(['a', 'b'])
		expect(r.next(1)).toBe('c')
	})

	it('wraps from Z to AA like a spreadsheet column label', () => {
		const r = alphabeticDetector.detect(['Y', 'Z'])
		expect(r.next(1)).toBe('AA')
		expect(r.next(2)).toBe('AB')
	})

	it('continues two-letter labels (AA, AB → AC)', () => {
		const r = alphabeticDetector.detect(['AA', 'AB'])
		expect(r.next(1)).toBe('AC')
	})

	it('handles step > 1', () => {
		const r = alphabeticDetector.detect(['A', 'C'])
		expect(r.next(1)).toBe('E')
		expect(r.next(2)).toBe('G')
	})

	it('single cell extends by +1', () => {
		const r = alphabeticDetector.detect(['M'])
		expect(r.next(1)).toBe('N')
		expect(r.next(5)).toBe('R')
	})

	it('backward direction decrements', () => {
		const r = alphabeticDetector.detect(['D', 'E'])
		expect(r.next(1, -1)).toBe('C')
		expect(r.next(3, -1)).toBe('A')
	})

	it('returns null for non-letter input', () => {
		expect(alphabeticDetector.detect(['A1', 'B1'])).toBeNull()
	})

	it('returns null when input is empty', () => {
		expect(alphabeticDetector.detect([])).toBeNull()
	})

	it('returns null when sequence is non-arithmetic', () => {
		expect(alphabeticDetector.detect(['A', 'C', 'F'])).toBeNull()
	})

	it('returns null when all values identical (caller copies)', () => {
		expect(alphabeticDetector.detect(['A', 'A'])).toBeNull()
	})
})

describe('alphabetic internals', () => {
	it('_alphaIndex matches Excel column convention', () => {
		expect(_internal._alphaIndex('A')).toBe(1)
		expect(_internal._alphaIndex('Z')).toBe(26)
		expect(_internal._alphaIndex('AA')).toBe(27)
		expect(_internal._alphaIndex('AZ')).toBe(52)
		expect(_internal._alphaIndex('BA')).toBe(53)
	})

	it('_indexToAlpha is the inverse', () => {
		for (const s of ['A', 'M', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']) {
			expect(_internal._indexToAlpha(_internal._alphaIndex(s))).toBe(s)
		}
	})
})
