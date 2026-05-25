import { describe, it, expect } from 'vitest'
import { detectPattern, applyPattern } from './smart-fill.js'

// Compact helper: build an examples array from inline literals.
//   ex(['John Doe', 'John', 'Doe'], ['Jane Smith', 'Jane', 'Smith'])
// → [{ target:'John Doe', sources:['John','Doe'] }, { target:'Jane Smith', sources:['Jane','Smith'] }]
function ex(...rows) {
	return rows.map(r => ({ target: r[0], sources: r.slice(1) }))
}

const fillFor = (pattern, ...rows) =>
	rows.map(sources => applyPattern(pattern, sources))

// ── Edge cases ──────────────────────────────────────────────────────────────

describe('detectPattern — empty input', () => {
	it('returns null for an empty examples array', () => {
		expect(detectPattern([])).toBeNull()
		expect(detectPattern(null)).toBeNull()
	})

	it('returns null when no examples have a target value', () => {
		expect(detectPattern([{ target: '', sources: ['x'] }])).toBeNull()
		expect(detectPattern([{ target: null, sources: ['x'] }])).toBeNull()
	})
})

// ── Literal ─────────────────────────────────────────────────────────────────

describe('literal pattern', () => {
	it('detects when every target is identical', () => {
		const p = detectPattern(ex(['x', 'a'], ['x', 'b'], ['x', 'c']))
		expect(p).toEqual({ type: 'literal', value: 'x' })
		expect(fillFor(p, ['z'])).toEqual(['x'])
	})
})

// ── Column copy ─────────────────────────────────────────────────────────────

describe('column-copy pattern', () => {
	it('detects "just copy column 0"', () => {
		const p = detectPattern(ex(['John', 'John', 'Doe'], ['Jane', 'Jane', 'Smith']))
		expect(p).toEqual({ type: 'column-copy', col: 0 })
		expect(fillFor(p, ['Alex', 'Doe'])).toEqual(['Alex'])
	})

	it('detects copy from a later column', () => {
		const p = detectPattern(ex(['Doe', 'John', 'Doe'], ['Smith', 'Jane', 'Smith']))
		expect(p).toEqual({ type: 'column-copy', col: 1 })
	})
})

// ── Case ───────────────────────────────────────────────────────────────────

describe('case pattern', () => {
	it('detects UPPER on column 0', () => {
		const p = detectPattern(ex(['JOHN', 'john'], ['JANE', 'jane']))
		expect(p).toEqual({ type: 'case', col: 0, transform: 'upper' })
		expect(fillFor(p, ['alex'])).toEqual(['ALEX'])
	})

	it('detects LOWER', () => {
		const p = detectPattern(ex(['john', 'John'], ['jane', 'Jane']))
		expect(p).toEqual({ type: 'case', col: 0, transform: 'lower' })
	})

	it('detects PROPER', () => {
		const p = detectPattern(ex(['John Doe', 'john doe'], ['Jane Smith', 'jane smith']))
		expect(p).toEqual({ type: 'case', col: 0, transform: 'proper' })
	})
})

// ── Word extraction ─────────────────────────────────────────────────────────

describe('word pattern', () => {
	it('detects "first word"', () => {
		const p = detectPattern(ex(['John', 'John Doe'], ['Jane', 'Jane Smith']))
		expect(p).toEqual({ type: 'word', col: 0, position: 'first' })
		expect(fillFor(p, ['Alex Pratt'])).toEqual(['Alex'])
	})

	it('detects "last word"', () => {
		const p = detectPattern(ex(['Doe', 'John Doe'], ['Smith', 'Jane Smith']))
		expect(p).toEqual({ type: 'word', col: 0, position: 'last' })
		expect(fillFor(p, ['Alex Pratt'])).toEqual(['Pratt'])
	})

	it('detects "nth word" (middle initial style)', () => {
		const p = detectPattern(ex(['Q.', 'John Q. Doe'], ['R.', 'Jane R. Smith']))
		expect(p).toEqual({ type: 'word', col: 0, position: 1 })
	})
})

// ── Email parts ─────────────────────────────────────────────────────────────

describe('email-part pattern', () => {
	it('detects username extraction', () => {
		const p = detectPattern(ex(['john', 'john@example.com'], ['jane', 'jane@example.com']))
		expect(p).toEqual({ type: 'email-part', col: 0, part: 'local' })
		expect(fillFor(p, ['alex@x.io'])).toEqual(['alex'])
	})

	it('detects domain extraction', () => {
		const p = detectPattern(ex(['example.com', 'john@example.com'], ['contoso.com', 'jane@contoso.com']))
		expect(p).toEqual({ type: 'email-part', col: 0, part: 'domain' })
		expect(fillFor(p, ['alex@x.io'])).toEqual(['x.io'])
	})

	it('does not match a non-email-shaped source', () => {
		const p = detectPattern(ex(['john', 'john_doe'], ['jane', 'jane_smith']))
		// Should hit some other detector (word/substring), not email.
		expect(p?.type).not.toBe('email-part')
	})
})

// ── Substring ──────────────────────────────────────────────────────────────

describe('substring pattern', () => {
	it('detects LEFT(_, 3)', () => {
		const p = detectPattern(ex(['INV', 'INVOICE-001'], ['ORD', 'ORDER-042']))
		expect(p).toEqual({ type: 'substring', col: 0, from: 'left', start: 0, length: 3 })
		expect(fillFor(p, ['PURCHASE-7'])).toEqual(['PUR'])
	})

	it('detects RIGHT(_, 3)', () => {
		const p = detectPattern(ex(['001', 'INVOICE-001'], ['042', 'ORDER-042']))
		// Should detect either substring(right, 3) OR a word/concat depending
		// on order; assert by outcome rather than tag.
		expect(applyPattern(p, ['PURCHASE-7'])).toBe('E-7')
	})
})

// ── Concatenation ──────────────────────────────────────────────────────────

describe('concat pattern', () => {
	it('detects two-column join with space', () => {
		const p = detectPattern(ex(['John Doe', 'John', 'Doe'], ['Jane Smith', 'Jane', 'Smith']))
		expect(p).toEqual({ type: 'concat', cols: [0, 1], sep: ' ' })
		expect(fillFor(p, ['Alex', 'Pratt'])).toEqual(['Alex Pratt'])
	})

	it('detects join with comma+space', () => {
		const p = detectPattern(ex(['Doe, John', 'Doe', 'John'], ['Smith, Jane', 'Smith', 'Jane']))
		expect(p).toEqual({ type: 'concat', cols: [0, 1], sep: ', ' })
	})

	it('detects three-column concat', () => {
		const p = detectPattern(ex(
			['John-M-Doe',  'John', 'M', 'Doe'],
			['Jane-R-Smith', 'Jane', 'R', 'Smith'],
		))
		expect(p).toEqual({ type: 'concat', cols: [0, 1, 2], sep: '-' })
		expect(fillFor(p, ['Alex', 'Q', 'Pratt'])).toEqual(['Alex-Q-Pratt'])
	})

	it('detects empty separator (squish columns)', () => {
		const p = detectPattern(ex(['ID42', 'ID', '42'], ['ID99', 'ID', '99']))
		expect(p).toEqual({ type: 'concat', cols: [0, 1], sep: '' })
	})
})

// ── Robustness ──────────────────────────────────────────────────────────────

describe('robustness', () => {
	it('returns null when examples conflict', () => {
		// First says UPPER, second says LOWER — no consistent transform.
		expect(detectPattern(ex(['JOHN', 'john'], ['jane', 'JANE']))).toBeNull()
	})

	it('only samples the first 4 examples', () => {
		// 5th example is contradictory — but we cap at 4 so the pattern still
		// detects (matching Sheets behaviour: trust the leading examples).
		const e = [
			...ex(['JOHN', 'john'], ['JANE', 'jane'], ['ALEX', 'alex'], ['MARY', 'mary']),
			{ target: 'wrong', sources: ['x'] },
		]
		const p = detectPattern(e)
		expect(p?.type).toBe('case')
	})

	it('applyPattern returns null when source column is missing', () => {
		const p = { type: 'case', col: 2, transform: 'upper' }
		expect(applyPattern(p, ['a'])).toBeNull()
	})

	it('applyPattern is a no-op for null patterns', () => {
		expect(applyPattern(null, ['x'])).toBeNull()
	})
})

// ── Composition with applyPattern across a fill range ───────────────────────

describe('end-to-end fill', () => {
	it('fills a 3-row name column from first+last source', () => {
		const examples = ex(
			['John Doe',   'John',  'Doe'],
			['Jane Smith', 'Jane',  'Smith'],
		)
		const p = detectPattern(examples)
		// Apply to fresh source rows.
		const rest = [
			['Alex',  'Pratt'],
			['Mary',  'Liu'],
			['Pat',   ''],
		]
		expect(fillFor(p, ...rest)).toEqual([
			'Alex Pratt',
			'Mary Liu',
			'Pat ',     // trailing space when one half is empty — by design
		])
	})

	it('fills a domain-extraction column', () => {
		const examples = ex(
			['example.com',  'john@example.com'],
			['contoso.com',  'jane@contoso.com'],
		)
		const p = detectPattern(examples)
		expect(fillFor(p, ['x@yahoo.com'], ['y@gmail.com'], ['no-at-sign']))
			.toEqual(['yahoo.com', 'gmail.com', null])
	})
})
