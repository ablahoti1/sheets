import { describe, it, expect } from 'vitest'
import { detectSeries } from './index.js'

// Pipeline-level tests — verify priority order (date > named > numeric).

describe('detectSeries pipeline', () => {
	it('prefers date detector over numeric for date-looking strings', () => {
		const r = detectSeries(['01-04-2025', '02-04-2025'])
		expect(r.kind).toBe('date')
	})

	it('prefers named-sequence over numeric for day names', () => {
		const r = detectSeries(['Mon', 'Tue'])
		expect(r.kind).toBe('named-sequence')
	})

	it('falls through to numeric for plain numbers', () => {
		const r = detectSeries(['10', '20'])
		expect(r.kind).toBe('numeric')
		expect(r.next(1)).toBe(30)
	})

	it('returns null when nothing matches (caller defaults to copy)', () => {
		expect(detectSeries(['foo', 'bar'])).toBeNull()
	})

	it('treats four-digit year strings as numeric (no date parser triggers without separators)', () => {
		// 2020, 2021 looks like both year sequence and integer sequence —
		// numeric detector wins because no parser matches bare year strings.
		const r = detectSeries(['2020', '2021'])
		expect(r.kind).toBe('numeric')
		expect(r.next(1)).toBe(2022)
	})
})
