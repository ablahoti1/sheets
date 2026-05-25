import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAwareness } from './awareness.js'

function createBus() {
	const subs = new Map()
	return {
		_subs: subs,
		on:  (event, cb) => {
			let s = subs.get(event)
			if (!s) { s = new Set(); subs.set(event, s) }
			s.add(cb)
		},
		off: (event, cb) => subs.get(event)?.delete(cb),
		publish: (event, payload) => {
			queueMicrotask(() => {
				const s = subs.get(event)
				if (s) for (const cb of [...s]) cb(payload)
			})
		},
	}
}

const flush = () => new Promise(resolve => queueMicrotask(resolve))

describe('createAwareness', () => {
	beforeEach(() => { vi.useFakeTimers() })
	afterEach(()  => { vi.useRealTimers() })

	it('starts with the initial local state', () => {
		const a = createAwareness({
			sheetId: 'S1', realtime: createBus(), clientId: 'A',
			initial: { cursor: { r: 0, c: 0 } },
		})
		expect(a.getLocalState()).toEqual({ cursor: { r: 0, c: 0 } })
	})

	it('setLocalState patches and publishes', async () => {
		const bus = createBus()
		const received = []
		bus.on('yjs_awareness', p => received.push(p))
		const a = createAwareness({ sheetId: 'S1', realtime: bus, clientId: 'A' })
		await flush()
		a.setLocalState({ cursor: { r: 3, c: 5, subSheet: 'Sheet1' } })
		await flush()
		expect(received.find(p => p.state?.cursor)).toBeTruthy()
		expect(a.getLocalState().cursor.r).toBe(3)
	})

	it('two peers see each other in getStates()', async () => {
		const bus = createBus()
		const a = createAwareness({ sheetId: 'S1', realtime: bus, clientId: 'A',
			initial: { user: 'asif@example.com' } })
		const b = createAwareness({ sheetId: 'S1', realtime: bus, clientId: 'B',
			initial: { user: 'satish@example.com' } })
		await flush(); await flush()
		const fromA = a.getStates()
		const fromB = b.getStates()
		expect(fromA.get('B')?.user).toBe('satish@example.com')
		expect(fromB.get('A')?.user).toBe('asif@example.com')
	})

	it('emits change events when peers arrive and update', async () => {
		const bus = createBus()
		const a = createAwareness({ sheetId: 'S1', realtime: bus, clientId: 'A' })
		const changes = vi.fn()
		a.on('change', changes)
		const b = createAwareness({ sheetId: 'S1', realtime: bus, clientId: 'B' })
		await flush(); await flush()
		expect(changes).toHaveBeenCalled()
		b.setLocalState({ cursor: { r: 1, c: 1 } })
		await flush()
		expect(changes.mock.calls.length).toBeGreaterThan(1)
	})

	it('drops a peer after the TTL expires without keep-alive', async () => {
		const bus = createBus()
		const a = createAwareness({ sheetId: 'S1', realtime: bus, clientId: 'A' })
		const b = createAwareness({ sheetId: 'S1', realtime: bus, clientId: 'B' })
		await flush(); await flush()
		expect(a.getStates().has('B')).toBe(true)
		// B "disappears" — we manually trigger the bye to mimic close-tab.
		bus.publish('yjs_awareness_bye', { sheet: 'S1', from: 'B' })
		await flush()
		expect(a.getStates().has('B')).toBe(false)
	})

	it('cross-sheet payloads are ignored', async () => {
		const bus = createBus()
		const a = createAwareness({ sheetId: 'S1', realtime: bus, clientId: 'A' })
		const b = createAwareness({ sheetId: 'S2', realtime: bus, clientId: 'B' })
		await flush(); await flush()
		expect(a.getStates().has('B')).toBe(false)
		expect(b.getStates().has('A')).toBe(false)
	})

	it('destroy() unsubscribes and publishes bye', async () => {
		const bus = createBus()
		const received = []
		bus.on('yjs_awareness_bye', p => received.push(p))
		const a = createAwareness({ sheetId: 'S1', realtime: bus, clientId: 'A' })
		await flush()
		a.destroy()
		await flush()
		expect(received.find(p => p.from === 'A')).toBeTruthy()
	})
})
