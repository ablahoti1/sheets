import { describe, it, expect } from 'vitest'
import { dateDetector } from './date.js'

describe('dateDetector', () => {
	// ── Daily ──────────────────────────────────────────────────────────

	it('detects a one-day step in DMY format and preserves the format', () => {
		const r = dateDetector.detect(['01-04-2025', '02-04-2025'])
		expect(r.kind).toBe('date')
		expect(r.next(1)).toBe('03-04-2025')
		expect(r.next(2)).toBe('04-04-2025')
	})

	it('detects ISO YMD', () => {
		const r = dateDetector.detect(['2025-04-01', '2025-04-02'])
		expect(r.next(1)).toBe('2025-04-03')
	})

	it('preserves slash separator', () => {
		const r = dateDetector.detect(['01/04/2025', '02/04/2025'])
		expect(r.next(1)).toBe('03/04/2025')
	})

	it('preserves non-zero-padded shape', () => {
		const r = dateDetector.detect(['1-4-2025', '2-4-2025'])
		expect(r.next(1)).toBe('3-4-2025')
	})

	// ── Weekly ─────────────────────────────────────────────────────────

	it('detects weekly step', () => {
		const r = dateDetector.detect(['01-04-2025', '08-04-2025'])
		expect(r.next(1)).toBe('15-04-2025')
		expect(r.next(2)).toBe('22-04-2025')
	})

	// ── Monthly ────────────────────────────────────────────────────────

	it('detects monthly step (same day-of-month)', () => {
		const r = dateDetector.detect(['01-01-2025', '01-02-2025'])
		expect(r.next(1)).toBe('01-03-2025')
		expect(r.next(2)).toBe('01-04-2025')
	})

	it('clamps day-of-month when the target month is shorter', () => {
		// 31-01 → 28-02 because Feb has 28 days (2025 non-leap)
		const r = dateDetector.detect(['31-12-2024', '31-01-2025'])
		expect(r.next(1)).toBe('28-02-2025')
	})

	// ── Yearly ─────────────────────────────────────────────────────────

	it('detects yearly step', () => {
		const r = dateDetector.detect(['01-01-2020', '01-01-2021'])
		expect(r.next(1)).toBe('01-01-2022')
		expect(r.next(3)).toBe('01-01-2024')
	})

	// ── Edge cases ─────────────────────────────────────────────────────

	it('single-cell date extends by one day per offset', () => {
		const r = dateDetector.detect(['01-04-2025'])
		expect(r.next(1)).toBe('02-04-2025')
		expect(r.next(3)).toBe('04-04-2025')
	})

	it('backward direction subtracts the step', () => {
		const r = dateDetector.detect(['10-04-2025', '11-04-2025'])
		expect(r.next(1, -1)).toBe('09-04-2025')
		expect(r.next(3, -1)).toBe('07-04-2025')
	})

	it('returns null when no parser matches', () => {
		expect(dateDetector.detect(['hello', 'world'])).toBeNull()
	})

	it('returns null for irregular date gaps', () => {
		// 3 days, then 7 days — neither pure daily nor monthly.
		expect(dateDetector.detect(['01-04-2025', '04-04-2025', '11-04-2025']))
			.toBeNull()
	})
})
