import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { createYDoc, hydrateYDoc, ydocToSnapshot, ROOT, WORKBOOK_KEYS } from './ydoc.js'

describe('createYDoc', () => {
	it('creates a Y.Doc with the four top-level maps', () => {
		const doc = createYDoc()
		expect(doc.getMap(ROOT.WORKBOOK)).toBeInstanceOf(Y.Map)
		expect(doc.getMap(ROOT.CELLS)).toBeInstanceOf(Y.Map)
		expect(doc.getMap(ROOT.FORMATS)).toBeInstanceOf(Y.Map)
		expect(doc.getMap(ROOT.COMMENTS)).toBeInstanceOf(Y.Map)
	})
})

describe('hydrateYDoc', () => {
	it('seeds workbook metadata from sheet.snapshot()', () => {
		const doc = createYDoc()
		hydrateYDoc(doc, {
			sheet: { sheets: { Sheet1: {}, Pivot: {} }, current: 'Pivot' },
		})
		const wb = doc.getMap(ROOT.WORKBOOK)
		expect(wb.get(WORKBOOK_KEYS.CURRENT)).toBe('Pivot')
		expect(wb.get(WORKBOOK_KEYS.SHEET_NAMES).toArray()).toEqual(['Sheet1', 'Pivot'])
	})

	it('seeds cells under per-sheet Y.Maps', () => {
		const doc = createYDoc()
		hydrateYDoc(doc, {
			sheet: { sheets: { Sheet1: { A1: 1, B2: 'x' } }, current: 'Sheet1' },
		})
		const sheet1 = doc.getMap(ROOT.CELLS).get('Sheet1')
		expect(sheet1.get('A1')).toBe(1)
		expect(sheet1.get('B2')).toBe('x')
	})

	it('seeds formats and comments', () => {
		const doc = createYDoc()
		hydrateYDoc(doc, {
			formats:  { Sheet1: { A1: { bold: true } } },
			comments: { Sheet1: { A1: 'hi' } },
		})
		expect(doc.getMap(ROOT.FORMATS).get('Sheet1').get('A1')).toEqual({ bold: true })
		expect(doc.getMap(ROOT.COMMENTS).get('Sheet1').get('A1')).toBe('hi')
	})

	it('handles empty / missing inputs gracefully', () => {
		const doc = createYDoc()
		hydrateYDoc(doc, {})
		const wb = doc.getMap(ROOT.WORKBOOK)
		expect(wb.get(WORKBOOK_KEYS.CURRENT)).toBe('Sheet1')
		expect(wb.get(WORKBOOK_KEYS.SHEET_NAMES).toArray()).toEqual(['Sheet1'])
	})

	it('hydration runs in one transaction (single update event)', () => {
		const doc = createYDoc()
		let updates = 0
		doc.on('update', () => { updates++ })
		hydrateYDoc(doc, {
			sheet: { sheets: { Sheet1: { A1: 1, A2: 2, A3: 3 } }, current: 'Sheet1' },
			formats: { Sheet1: { A1: { bold: true } } },
		})
		expect(updates).toBe(1)
	})
})

describe('ydocToSnapshot', () => {
	it('round-trips a hydrated doc back to the input snapshot', () => {
		const original = {
			sheet:    { sheets: { Sheet1: { A1: 1, B2: 'x' }, Pivot: { C3: 7 } }, current: 'Pivot' },
			formats:  { Sheet1: { A1: { bold: true, color: '#f00' } } },
			comments: { Sheet1: { A1: 'note' } },
		}
		const doc = createYDoc()
		hydrateYDoc(doc, original)
		expect(ydocToSnapshot(doc)).toEqual(original)
	})

	it('returns the default Sheet1/current when the doc was never hydrated', () => {
		const doc = createYDoc()
		const snap = ydocToSnapshot(doc)
		expect(snap.sheet.current).toBe('Sheet1')
		expect(snap.sheet.sheets).toEqual({})
	})
})
