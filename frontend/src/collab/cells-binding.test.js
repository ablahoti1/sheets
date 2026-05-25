import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'
import { createYDoc, ROOT } from './ydoc.js'
import { bindCells, LOCAL_ORIGIN } from './cells-binding.js'

// Minimal sheet-engine stub. Just enough to verify the binding doesn't
// rely on the engine's internals — only its public setCell/getCurrentSheet.
function fakeSheet() {
	const store = { Sheet1: {} }
	let current = 'Sheet1'
	return {
		_store: store,
		setCell: vi.fn(function (id, value, sheet) {
			const s = sheet || current
			store[s] = store[s] || {}
			if (value === '' || value == null) delete store[s][id]
			else store[s][id] = value
		}),
		getCurrentSheet: () => current,
	}
}


describe('bindCells', () => {
	it('mirrors local setCell into the Y.Map', () => {
		const doc = createYDoc()
		const sheet = fakeSheet()
		bindCells({ doc, sheet })
		sheet.setCell('A1', 42, 'Sheet1')
		expect(doc.getMap(ROOT.CELLS).get('Sheet1').get('A1')).toBe(42)
	})

	it('does not echo a local write back to the engine', () => {
		const doc = createYDoc()
		const sheet = fakeSheet()
		// bindCells *replaces* sheet.setCell with a patched version. Capture
		// the underlying spy beforehand so we can assert on the original.
		const origSpy = sheet.setCell
		bindCells({ doc, sheet })
		sheet.setCell('A1', 99, 'Sheet1')
		// The patched setCell calls _origSetCell exactly once. The Y.Map
		// observer must NOT fire a second _origSetCell because the write
		// originated locally (LOCAL_ORIGIN).
		expect(origSpy).toHaveBeenCalledTimes(1)
	})

	it('applies a remote Y.Map write through the engine', () => {
		const doc = createYDoc()
		const sheet = fakeSheet()
		bindCells({ doc, sheet })
		// Simulate a remote update by writing with a non-LOCAL origin.
		const cellsRoot = doc.getMap(ROOT.CELLS)
		const m = new Y.Map()
		cellsRoot.set('Sheet1', m)
		doc.transact(() => m.set('B2', 'remote'), 'remote-test')
		expect(sheet._store.Sheet1.B2).toBe('remote')
	})

	it('removes the cell from the engine on a remote delete', () => {
		const doc = createYDoc()
		const sheet = fakeSheet()
		const cellsRoot = doc.getMap(ROOT.CELLS)
		const m = new Y.Map()
		cellsRoot.set('Sheet1', m)
		doc.transact(() => m.set('A1', 1), 'pre')
		bindCells({ doc, sheet })
		// Prime the engine with the same value (so we can see the delete).
		sheet.setCell('A1', 1, 'Sheet1')
		expect(sheet._store.Sheet1.A1).toBe(1)
		doc.transact(() => m.delete('A1'), 'remote')
		expect(sheet._store.Sheet1.A1).toBeUndefined()
	})

	it('emits onRemoteSheetChange for the affected sub-sheet', () => {
		const doc = createYDoc()
		const sheet = fakeSheet()
		const onRemote = vi.fn()
		const cellsRoot = doc.getMap(ROOT.CELLS)
		const m = new Y.Map()
		cellsRoot.set('Sheet1', m)
		bindCells({ doc, sheet, onRemoteSheetChange: onRemote })
		doc.transact(() => m.set('A1', 9), 'remote')
		expect(onRemote).toHaveBeenCalledWith('Sheet1')
	})

	it('attaches an observer to a sub-sheet that arrives after binding', () => {
		const doc = createYDoc()
		const sheet = fakeSheet()
		bindCells({ doc, sheet })
		// "Sheet2" doesn't exist in the doc yet. After we add it, a remote
		// write inside it should still get propagated to the engine.
		const cellsRoot = doc.getMap(ROOT.CELLS)
		const newMap = new Y.Map()
		doc.transact(() => cellsRoot.set('Sheet2', newMap), 'remote')
		doc.transact(() => newMap.set('Z9', 'late'), 'remote')
		expect(sheet._store.Sheet2.Z9).toBe('late')
	})

	it('dispose stops the bidirectional sync', () => {
		const doc = createYDoc()
		const sheet = fakeSheet()
		const { dispose } = bindCells({ doc, sheet })
		dispose()
		sheet.setCell('A1', 1, 'Sheet1')
		// Local writes no longer reach the Y.Map.
		expect(doc.getMap(ROOT.CELLS).get('Sheet1')).toBeUndefined()
	})
})

// Convergence is the real test — two clients editing → both end up identical.
describe('bindCells convergence', () => {
	it('two peers each writing to A1 converge to the same value', () => {
		const docA = createYDoc()
		const docB = createYDoc()
		const sheetA = fakeSheet()
		const sheetB = fakeSheet()
		bindCells({ doc: docA, sheet: sheetA })
		bindCells({ doc: docB, sheet: sheetB })

		// Manual relay loop to keep the test simple and deterministic.
		docA.on('update', (u, origin) => {
			if (origin === LOCAL_ORIGIN) Y.applyUpdate(docB, u, 'remote')
		})
		docB.on('update', (u, origin) => {
			if (origin === LOCAL_ORIGIN) Y.applyUpdate(docA, u, 'remote')
		})

		sheetA.setCell('A1', 'from-A', 'Sheet1')
		sheetB.setCell('B2', 'from-B', 'Sheet1')

		// Both engines see both writes.
		expect(sheetA._store.Sheet1.B2).toBe('from-B')
		expect(sheetB._store.Sheet1.A1).toBe('from-A')
	})

	it('concurrent writes to the same cell converge (deterministic LWW per Yjs)', () => {
		const docA = createYDoc()
		const docB = createYDoc()
		const sheetA = fakeSheet()
		const sheetB = fakeSheet()
		bindCells({ doc: docA, sheet: sheetA })
		bindCells({ doc: docB, sheet: sheetB })

		// Each side writes in isolation, then they swap updates — the
		// classic CRDT race. Yjs guarantees both sides converge to the
		// same value regardless of arrival order.
		sheetA.setCell('A1', 'value-from-A', 'Sheet1')
		sheetB.setCell('A1', 'value-from-B', 'Sheet1')

		const upA = Y.encodeStateAsUpdate(docA)
		const upB = Y.encodeStateAsUpdate(docB)
		Y.applyUpdate(docA, upB, 'remote')
		Y.applyUpdate(docB, upA, 'remote')

		expect(sheetA._store.Sheet1.A1).toBe(sheetB._store.Sheet1.A1)
	})

	// ── Local-touch tracking (powers conflict-aware undo) ─────────────────────

	it('drainLocalTouches lists each cell the patched setCell wrote since last drain', () => {
		const doc = createYDoc()
		const sheet = fakeSheet()
		const { drainLocalTouches } = bindCells({ doc, sheet })

		sheet.setCell('A1', 'x', 'Sheet1')
		sheet.setCell('B2', 'y', 'Sheet1')
		const first = drainLocalTouches()
		expect(first).toEqual(new Set(['Sheet1|A1', 'Sheet1|B2']))

		// Drain is destructive — a follow-up call returns only what landed
		// after the last drain.
		sheet.setCell('C3', 'z', 'Sheet1')
		expect(drainLocalTouches()).toEqual(new Set(['Sheet1|C3']))
	})

	it('drainLocalTouches does NOT record remote writes', () => {
		// Two docs, one shared cell write done remotely. The local sheet
		// should pick up the value (so the engine stays in sync) but NOT
		// add the cell to its local-touch set — otherwise undo would try
		// to revert a cell the local user never touched.
		const docA = createYDoc()
		const docB = createYDoc()
		const sheetA = fakeSheet()
		const { drainLocalTouches } = bindCells({ doc: docA, sheet: sheetA })
		bindCells({ doc: docB, sheet: fakeSheet() })

		// B writes; A receives it via Yjs update.
		docB.getMap(ROOT.CELLS).set('Sheet1', new Y.Map())
		docB.getMap(ROOT.CELLS).get('Sheet1').set('A1', 'from-B')
		Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB), 'remote')

		expect(sheetA._store.Sheet1.A1).toBe('from-B')          // engine stayed in sync
		expect(drainLocalTouches().size).toBe(0)                // but no local touch
	})
})
