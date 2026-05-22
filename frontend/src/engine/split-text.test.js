import { describe, it, expect } from 'vitest'
import { parseRow, detectSeparator, resolveSeparator, splitRange } from './split-text.js'

describe('parseRow', () => {
	it('splits on a simple separator', () => {
		expect(parseRow('a,b,c', ',')).toEqual(['a', 'b', 'c'])
	})

	it('preserves quoted commas', () => {
		expect(parseRow('"a,b",c', ',')).toEqual(['a,b', 'c'])
	})

	it('handles escaped quotes inside a quoted field', () => {
		expect(parseRow('"He said ""hi""",ok', ',')).toEqual(['He said "hi"', 'ok'])
	})

	it('keeps empty tokens', () => {
		expect(parseRow('a,,b', ',')).toEqual(['a', '', 'b'])
	})

	it('returns a single token when separator is absent', () => {
		expect(parseRow('hello', ',')).toEqual(['hello'])
	})

	it('handles tab separator', () => {
		expect(parseRow('a\tb\tc', '\t')).toEqual(['a', 'b', 'c'])
	})

	it('returns input unchanged when separator is empty', () => {
		expect(parseRow('a,b,c', '')).toEqual(['a,b,c'])
	})

	it('handles null / undefined input safely', () => {
		expect(parseRow(null, ',')).toEqual([''])
		expect(parseRow(undefined, ',')).toEqual([''])
	})

	it('treats multi-char separators as plain string split (no CSV quoting)', () => {
		expect(parseRow('a||b||c', '||')).toEqual(['a', 'b', 'c'])
	})
})

describe('detectSeparator', () => {
	it('picks tab when present', () => {
		expect(detectSeparator(['a\tb', 'c\td'])).toBe('tab')
	})

	it('picks comma over space when both present', () => {
		expect(detectSeparator(['hello world,foo'])).toBe('comma')
	})

	it('falls back to space when no other separator works', () => {
		expect(detectSeparator(['a b c'])).toBe('space')
	})

	it('returns null when no separator produces a split', () => {
		expect(detectSeparator(['abc', 'def'])).toBeNull()
	})

	it('returns null on empty input', () => {
		expect(detectSeparator([])).toBeNull()
		expect(detectSeparator([''])).toBeNull()
	})
})

describe('resolveSeparator', () => {
	it('resolves a named key to its literal', () => {
		expect(resolveSeparator(['x'], 'comma')).toBe(',')
		expect(resolveSeparator(['x'], 'tab')).toBe('\t')
	})

	it('resolves auto by running detect', () => {
		expect(resolveSeparator(['a,b'], 'auto')).toBe(',')
	})

	it('returns null for auto when nothing matches', () => {
		expect(resolveSeparator(['abc'], 'auto')).toBeNull()
	})

	it('accepts a custom separator string', () => {
		expect(resolveSeparator(['x'], { kind: 'custom', value: '::' })).toBe('::')
	})

	it('returns null for empty custom value', () => {
		expect(resolveSeparator(['x'], { kind: 'custom', value: '' })).toBeNull()
	})
})

describe('splitRange', () => {
	it('returns a token grid + max-cols width', () => {
		const r = splitRange(['a,b,c', 'd,e'], ',')
		expect(r.tokens).toEqual([['a', 'b', 'c'], ['d', 'e']])
		expect(r.maxCols).toBe(3)
	})

	it('returns the values unchanged when no separator is provided', () => {
		const r = splitRange(['hello', 'world'], null)
		expect(r.tokens).toEqual([['hello'], ['world']])
		expect(r.maxCols).toBe(1)
	})

	it('handles empty cells in the column', () => {
		const r = splitRange(['a,b', '', 'c,d,e'], ',')
		expect(r.tokens).toEqual([['a', 'b'], [''], ['c', 'd', 'e']])
		expect(r.maxCols).toBe(3)
	})
})
