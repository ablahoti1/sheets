import { describe, it, expect, vi } from 'vitest'
import { createHistory } from './history.js'

// The history is a generic snapshot/restore stack. Two distinct behaviours
// to verify here: (a) the classic full-restore on undo when no collab is
// running, and (b) the conflict-aware path where each pushed snapshot
// remembers the local-only touches that arrived after it, so a later undo
// reverts ONLY those touches and leaves remote-applied keys alone.

describe('history — basic stack semantics', () => {
  it('init seeds the first snapshot and is idempotent', () => {
    const snapshot = vi.fn(() => 1)
    const h = createHistory({ snapshot, restore: () => {} })
    h.init()
    h.init()
    expect(snapshot).toHaveBeenCalledTimes(1)
  })

  it('undo restores the previous full snapshot', () => {
    const snapshots = ['A', 'B', 'C']
    let idx = 0
    const restore = vi.fn()
    const h = createHistory({ snapshot: () => snapshots[idx++], restore })
    h.push(); h.push(); h.push()
    expect(h.undo()).toBe(true)
    expect(restore).toHaveBeenLastCalledWith('B', { touches: null })
  })

  it('redo replays the snapshot we undid past', () => {
    const restore = vi.fn()
    const h = createHistory({ snapshot: () => Math.random(), restore })
    h.push(); h.push()
    h.undo()
    restore.mockClear()
    expect(h.redo()).toBe(true)
    expect(restore).toHaveBeenCalledTimes(1)
  })
})

describe('history — conflict-aware touches', () => {
  it('each entry remembers the touches of the op that produced it, and undo passes them through', () => {
    // Push N captures (snap_N, drain_N) where drain_N is the cells op-N
    // touched. Undo from index N → N-1 should restore snap_{N-1} AND
    // signal drain_N as the cells to revert.
    let snapCalls = 0, drainCalls = 0
    const drains = []
    const restore = vi.fn()
    const h = createHistory({
      snapshot:        () => `snap${snapCalls++}`,
      restore,
      getLocalTouches: () => {
        const t = new Set([`Sheet1|cell${drainCalls++}`])
        drains.push(t)
        return t
      },
    })
    h.push(); h.push(); h.push()
    // Stack: [{snap0,d0}, {snap1,d1}, {snap2,d2}], index=2.
    h.undo()  // 2 → 1: restore snap1, signal d2 as the cells to revert.
    expect(restore).toHaveBeenLastCalledWith('snap1', { touches: drains[2] })
    h.undo()  // 1 → 0: restore snap0, signal d1.
    expect(restore).toHaveBeenLastCalledWith('snap0', { touches: drains[1] })
  })

  it('redo always full-restores (touches: null) — undo is the safer direction', () => {
    let i = 0
    const restore = vi.fn()
    const h = createHistory({
      snapshot:        () => `snap${i}`,
      restore,
      getLocalTouches: () => new Set([`touch${i++}`]),
    })
    h.push(); h.push()
    h.undo()
    restore.mockClear()
    h.redo()
    const [, opts] = restore.mock.calls[0]
    expect(opts.touches).toBeNull()
  })

  it('falls back to a null touches argument when getLocalTouches is not provided', () => {
    const restore = vi.fn()
    const h = createHistory({ snapshot: () => 'x', restore })
    h.push(); h.push()
    h.undo()
    expect(restore).toHaveBeenLastCalledWith('x', { touches: null })
  })
})
