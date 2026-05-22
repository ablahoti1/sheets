import { describe, it, expect } from 'vitest'
import { timeDetector } from './time.js'

describe('timeDetector', () => {
	it('detects an hour step', () => {
		const r = timeDetector.detect(['09:00', '10:00'])
		expect(r.kind).toBe('time')
		expect(r.next(1)).toBe('11:00')
		expect(r.next(2)).toBe('12:00')
	})

	it('detects a minute step', () => {
		const r = timeDetector.detect(['09:00', '09:01'])
		expect(r.next(1)).toBe('09:02')
		expect(r.next(15)).toBe('09:16')
	})

	it('detects a second step', () => {
		const r = timeDetector.detect(['09:00:00', '09:00:30'])
		expect(r.next(1)).toBe('09:01:00')
		expect(r.next(2)).toBe('09:01:30')
	})

	it('preserves AM/PM and switches when crossing noon', () => {
		const r = timeDetector.detect(['11:00 AM', '12:00 PM'])
		expect(r.next(1)).toBe('1:00 PM')
		expect(r.next(2)).toBe('2:00 PM')
	})

	it('handles lowercase am/pm', () => {
		const r = timeDetector.detect(['11:00 am', '12:00 pm'])
		expect(r.next(1)).toBe('1:00 pm')
	})

	it('wraps past midnight', () => {
		const r = timeDetector.detect(['23:00', '23:30'])
		expect(r.next(1)).toBe('00:00')
		expect(r.next(2)).toBe('00:30')
	})

	it('backward direction subtracts the step', () => {
		const r = timeDetector.detect(['10:00', '11:00'])
		expect(r.next(1, -1)).toBe('09:00')
		expect(r.next(2, -1)).toBe('08:00')
	})

	it('single cell extends by one minute (Google default)', () => {
		const r = timeDetector.detect(['09:00'])
		expect(r.next(1)).toBe('09:01')
	})

	it('preserves zero-padded hour', () => {
		const r = timeDetector.detect(['09:00', '09:30'])
		expect(r.next(1)).toBe('10:00')
	})

	it('returns null for non-time strings', () => {
		expect(timeDetector.detect(['Mon', 'Tue'])).toBeNull()
	})

	it('returns null for irregular spacing', () => {
		expect(timeDetector.detect(['09:00', '09:10', '09:25'])).toBeNull()
	})
})
