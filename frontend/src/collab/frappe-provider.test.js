import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { createYDoc } from './ydoc.js'
import { createFrappeProvider } from './frappe-provider.js'

// In-memory realtime bus — peers attached to the same bus see each other's
// publishes. Mirrors the contract of frappe.realtime: `on(event, cb)`,
// `off(event, cb)`, `publish(event, payload)`.
function createBus() {
	const subs = new Map()  // event → Set<cb>
	return {
		_subs: subs,
		on:  (event, cb) => {
			let s = subs.get(event)
			if (!s) { s = new Set(); subs.set(event, s) }
			s.add(cb)
		},
		off: (event, cb) => subs.get(event)?.delete(cb),
		publish: (event, payload) => {
			// Defer to mimic real network async-ness without setTimeouts.
			queueMicrotask(() => {
				const s = subs.get(event)
				if (s) for (const cb of [...s]) cb(payload)
			})
		},
	}
}

const flush = () => new Promise(resolve => queueMicrotask(resolve))

describe('createFrappeProvider', () => {
	it('publishes local doc updates over the realtime bus', async () => {
		const bus = createBus()
		const doc = createYDoc()
		createFrappeProvider({ doc, sheetId: 'SHEET-1', realtime: bus, selfTag: 'A' })
		// First call on connect: yjs_state_request
		await flush()
		expect(bus._subs.get('yjs_update')).toBeTruthy()

		// Make a local write — should publish a yjs_update.
		const received = []
		bus.on('yjs_update', p => { received.push(p) })
		doc.getMap('cells').set('Sheet1', new Y.Map())
		await flush()
		// First publish from the provider, plus our own listener saw it.
		expect(received.length).toBeGreaterThan(0)
		expect(received[0].sheet).toBe('SHEET-1')
		expect(received[0].from).toBe('A')
	})

	it('ignores its own echo (same `from` tag)', async () => {
		const bus = createBus()
		const doc = createYDoc()
		createFrappeProvider({ doc, sheetId: 'SHEET-1', realtime: bus, selfTag: 'A' })
		await flush()

		// Re-publish a fake echo with our own tag — doc state must not change.
		const sizeBefore = Y.encodeStateAsUpdate(doc).length
		bus.publish('yjs_update', {
			sheet: 'SHEET-1', from: 'A',
			update: btoa(String.fromCharCode(...Y.encodeStateAsUpdate(doc))),
		})
		await flush()
		expect(Y.encodeStateAsUpdate(doc).length).toBe(sizeBefore)
	})

	it('two providers on the same bus converge', async () => {
		const bus = createBus()
		const docA = createYDoc()
		const docB = createYDoc()
		createFrappeProvider({ doc: docA, sheetId: 'SHEET-1', realtime: bus, selfTag: 'A' })
		createFrappeProvider({ doc: docB, sheetId: 'SHEET-1', realtime: bus, selfTag: 'B' })
		await flush()

		// A writes a cell.
		const cellsA = docA.getMap('cells')
		const m = new Y.Map()
		docA.transact(() => cellsA.set('Sheet1', m), 'test')
		docA.transact(() => m.set('A1', 'hi'), 'test')

		// Wait for the bus to flush.
		await flush(); await flush(); await flush()

		const cellsB = docB.getMap('cells')
		expect(cellsB.get('Sheet1')?.get('A1')).toBe('hi')
	})

	it('a late joiner receives the current state via yjs_state_request', async () => {
		const bus = createBus()
		const docA = createYDoc()
		createFrappeProvider({ doc: docA, sheetId: 'SHEET-1', realtime: bus, selfTag: 'A' })
		await flush()
		// A populates the doc before B joins.
		const m = new Y.Map()
		docA.transact(() => docA.getMap('cells').set('Sheet1', m), 'pre')
		docA.transact(() => m.set('A1', 'pre-joined'), 'pre')
		await flush()

		// B joins late — should receive state replay.
		const docB = createYDoc()
		createFrappeProvider({ doc: docB, sheetId: 'SHEET-1', realtime: bus, selfTag: 'B' })
		await flush(); await flush()
		expect(docB.getMap('cells').get('Sheet1')?.get('A1')).toBe('pre-joined')
	})

	it('filters out cross-sheet traffic', async () => {
		const bus = createBus()
		const docA = createYDoc()
		const docB = createYDoc()
		createFrappeProvider({ doc: docA, sheetId: 'SHEET-1', realtime: bus, selfTag: 'A' })
		createFrappeProvider({ doc: docB, sheetId: 'SHEET-2', realtime: bus, selfTag: 'B' })
		await flush()

		const m = new Y.Map()
		docA.transact(() => docA.getMap('cells').set('Sheet1', m), 'test')
		docA.transact(() => m.set('A1', 'A-only'), 'test')
		await flush(); await flush()

		// Doc B is on a different sheet — must not have received anything.
		expect(docB.getMap('cells').get('Sheet1')).toBeUndefined()
	})

	it('destroy() unsubscribes from the bus', async () => {
		const bus = createBus()
		const doc = createYDoc()
		const { destroy } = createFrappeProvider({
			doc, sheetId: 'SHEET-1', realtime: bus, selfTag: 'A',
		})
		await flush()
		expect(bus._subs.get('yjs_update').size).toBeGreaterThan(0)
		destroy()
		expect(bus._subs.get('yjs_update').size).toBe(0)
	})
})
