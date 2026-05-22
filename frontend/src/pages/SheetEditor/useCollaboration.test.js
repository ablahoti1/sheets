// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref }                                             from 'vue'
import { useCollaboration, CURSOR_PALETTE }                from './useCollaboration.js'

// ── Test helpers ──────────────────────────────────────────────────────────────

function fakeSheet() {
  const cells = {}
  return {
    setCell: vi.fn((id, value, sheet = 'Sheet1') => { cells[`${sheet}:${id}`] = value }),
    getCell: (id, sheet = 'Sheet1') => cells[`${sheet}:${id}`] ?? '',
  }
}

function fakeRealtime() {
  const handlers = {}
  return {
    on:        vi.fn((event, fn) => { handlers[event] = fn }),
    off:       vi.fn((event, fn) => { if (handlers[event] === fn) delete handlers[event] }),
    emit:      (event, data) => handlers[event]?.(data),
    _handlers: handlers,
  }
}

function makeDeps(overrides = {}) {
  const sheetId      = ref('doc-abc')
  const currentSheet = ref('Sheet1')
  const sheet        = fakeSheet()
  const realtime     = fakeRealtime()
  const callFn       = vi.fn(() => Promise.resolve())
  const repopulate   = vi.fn()
  const onUnmounted  = vi.fn()

  let watchCallback
  const watchFn = (source, callback, options) => {
    watchCallback = callback
    if (options?.immediate) callback(source.value, undefined)
  }

  const deps = {
    sheetId,
    currentSheet,
    getSheet:       () => sheet,
    repopulateGrid: repopulate,
    _self:          'alice@example.com',
    _realtime:      realtime,
    _callFn:        callFn,
    _watch:         watchFn,
    _onUnmounted:   onUnmounted,
    ...overrides,
  }
  const result = useCollaboration(deps)
  return {
    ...result,
    sheetId, currentSheet, sheet, realtime, callFn, repopulate, onUnmounted, watchCallback,
  }
}

function emitCursor(realtime, overrides = {}) {
  realtime.emit('sheet_cursor', {
    sheet: 'doc-abc', user: 'bob@example.com',
    full_name: 'Bob Smith', initials: 'BS', r: 3, c: 5, sub_sheet: 'Sheet1',
    ...overrides,
  })
}

function emitPresence(realtime, overrides = {}) {
  realtime.emit('sheet_presence', {
    sheet: 'doc-abc', user: 'bob@example.com',
    full_name: 'Bob Smith', initials: 'BS', user_image: null,
    ...overrides,
  })
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

describe('useCollaboration — lifecycle', () => {
  it('registers all realtime listeners on start', () => {
    const { realtime } = makeDeps()
    expect(realtime.on).toHaveBeenCalledWith('sheet_presence', expect.any(Function))
    expect(realtime.on).toHaveBeenCalledWith('sheet_op',       expect.any(Function))
    expect(realtime.on).toHaveBeenCalledWith('sheet_cursor',   expect.any(Function))
  })

  it('does not start when sheetId is "new"', () => {
    const realtime = fakeRealtime()
    useCollaboration({
      sheetId: ref('new'), currentSheet: ref('Sheet1'),
      getSheet: () => fakeSheet(), repopulateGrid: vi.fn(),
      _self: 'u@x.com', _realtime: realtime, _callFn: vi.fn(),
      _watch:        (src, cb, opts) => { if (opts?.immediate) cb(src.value, undefined) },
      _onUnmounted:  vi.fn(),
    })
    expect(realtime.on).not.toHaveBeenCalled()
  })

  it('removes all listeners when the sheet id is cleared', () => {
    const { realtime, watchCallback } = makeDeps()
    watchCallback(undefined, 'doc-abc')
    expect(realtime.off).toHaveBeenCalledWith('sheet_presence', expect.any(Function))
    expect(realtime.off).toHaveBeenCalledWith('sheet_op',       expect.any(Function))
    expect(realtime.off).toHaveBeenCalledWith('sheet_cursor',   expect.any(Function))
  })

  it('removes all listeners on unmount', () => {
    const { realtime, onUnmounted } = makeDeps()
    const unmountFn = onUnmounted.mock.calls[0][0]
    unmountFn()
    expect(realtime.off).toHaveBeenCalledWith('sheet_presence', expect.any(Function))
    expect(realtime.off).toHaveBeenCalledWith('sheet_op',       expect.any(Function))
    expect(realtime.off).toHaveBeenCalledWith('sheet_cursor',   expect.any(Function))
  })

  it('pings presence immediately on start', () => {
    const callFn = vi.fn(() => Promise.resolve())
    makeDeps({ _callFn: callFn })
    expect(callFn).toHaveBeenCalledWith(
      'frappe_sheets_next.api.ping_presence',
      expect.objectContaining({ name: 'doc-abc' }),
    )
  })
})

// ── Presence ──────────────────────────────────────────────────────────────────

describe('useCollaboration — presentUsers', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('adds a peer to presentUsers on presence event', () => {
    const { realtime, presentUsers } = makeDeps()
    emitPresence(realtime)
    expect(presentUsers.value).toHaveLength(1)
    expect(presentUsers.value[0].user).toBe('bob@example.com')
  })

  it('ignores presence events from self', () => {
    const { realtime, presentUsers } = makeDeps()
    emitPresence(realtime, { user: 'alice@example.com' })
    expect(presentUsers.value).toHaveLength(0)
  })

  it('ignores presence events for a different sheet', () => {
    const { realtime, presentUsers } = makeDeps()
    emitPresence(realtime, { sheet: 'other-doc' })
    expect(presentUsers.value).toHaveLength(0)
  })

  it('removes a peer after the expiry timeout', () => {
    const { realtime, presentUsers } = makeDeps()
    emitPresence(realtime)
    expect(presentUsers.value).toHaveLength(1)
    vi.advanceTimersByTime(35_000)
    expect(presentUsers.value).toHaveLength(0)
  })

  it('resets the expiry timer when a peer re-pings', () => {
    const { realtime, presentUsers } = makeDeps()
    emitPresence(realtime)
    vi.advanceTimersByTime(20_000)
    emitPresence(realtime)                          // refresh heartbeat
    vi.advanceTimersByTime(20_000)
    expect(presentUsers.value).toHaveLength(1)      // still present
    vi.advanceTimersByTime(15_001)
    expect(presentUsers.value).toHaveLength(0)      // now expired
  })

  it('clears presentUsers on stop', () => {
    const { realtime, presentUsers, watchCallback } = makeDeps()
    emitPresence(realtime)
    expect(presentUsers.value).toHaveLength(1)
    watchCallback(undefined, 'doc-abc')             // triggers _stop
    expect(presentUsers.value).toHaveLength(0)
  })
})

// ── Broadcast cell changes ────────────────────────────────────────────────────

describe('useCollaboration — broadcastCellChange', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('calls broadcast_op after the debounce window', () => {
    const { broadcastCellChange, callFn } = makeDeps()
    broadcastCellChange('Sheet1', 'A1', '42')
    expect(callFn).not.toHaveBeenCalledWith(
      'frappe_sheets_next.api.broadcast_op', expect.anything(),
    )
    vi.advanceTimersByTime(80)
    expect(callFn).toHaveBeenCalledWith(
      'frappe_sheets_next.api.broadcast_op',
      expect.objectContaining({ name: 'doc-abc' }),
    )
    const op = JSON.parse(callFn.mock.calls.find(([m]) => m === 'frappe_sheets_next.api.broadcast_op')[1].op)
    expect(op).toEqual({ type: 'cells', subSheet: 'Sheet1', cells: { A1: '42' } })
  })

  it('coalesces rapid edits to the same cell', () => {
    const { broadcastCellChange, callFn } = makeDeps()
    broadcastCellChange('Sheet1', 'A1', '1')
    broadcastCellChange('Sheet1', 'A1', '2')
    broadcastCellChange('Sheet1', 'A1', '3')
    vi.advanceTimersByTime(80)
    const opCalls = callFn.mock.calls.filter(([m]) => m === 'frappe_sheets_next.api.broadcast_op')
    expect(opCalls).toHaveLength(1)
    expect(JSON.parse(opCalls[0][1].op).cells.A1).toBe('3')
  })

  it('sends separate ops per sub-sheet', () => {
    const { broadcastCellChange, callFn } = makeDeps()
    broadcastCellChange('Sheet1', 'A1', 'x')
    broadcastCellChange('Sheet2', 'B2', 'y')
    vi.advanceTimersByTime(80)
    const opCalls   = callFn.mock.calls.filter(([m]) => m === 'frappe_sheets_next.api.broadcast_op')
    const subSheets = opCalls.map(([, args]) => JSON.parse(args.op).subSheet)
    expect(subSheets).toContain('Sheet1')
    expect(subSheets).toContain('Sheet2')
  })

  it('does nothing before a sheet is loaded', () => {
    const callFn = vi.fn(() => Promise.resolve())
    useCollaboration({
      sheetId: ref('new'), currentSheet: ref('Sheet1'),
      getSheet: () => fakeSheet(), repopulateGrid: vi.fn(),
      _self: 'u@x.com', _realtime: fakeRealtime(), _callFn: callFn,
      _watch:       (src, cb, opts) => { if (opts?.immediate) cb(src.value, undefined) },
      _onUnmounted: vi.fn(),
    }).broadcastCellChange('Sheet1', 'A1', '1')
    vi.advanceTimersByTime(80)
    expect(callFn).not.toHaveBeenCalledWith('frappe_sheets_next.api.broadcast_op', expect.anything())
  })
})

// ── Broadcast batch changes ───────────────────────────────────────────────────

describe('useCollaboration — broadcastBatchChange', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('batches all cells into one op', () => {
    const { broadcastBatchChange, callFn } = makeDeps()
    broadcastBatchChange('Sheet1', [{ id: 'A1', value: 'a' }, { id: 'B2', value: 'b' }])
    vi.advanceTimersByTime(80)
    const opCall = callFn.mock.calls.find(([m]) => m === 'frappe_sheets_next.api.broadcast_op')
    expect(JSON.parse(opCall[1].op).cells).toEqual({ A1: 'a', B2: 'b' })
  })
})

// ── Broadcast cursor ──────────────────────────────────────────────────────────

describe('useCollaboration — broadcastCursor', () => {
  it('calls broadcast_cursor with row, col, and subSheet', () => {
    const { broadcastCursor, callFn } = makeDeps()
    broadcastCursor(2, 3, 'Sheet1')
    expect(callFn).toHaveBeenCalledWith(
      'frappe_sheets_next.api.broadcast_cursor',
      { name: 'doc-abc', r: 2, c: 3, sub_sheet: 'Sheet1' },
    )
  })
})

// ── Receiving remote ops ──────────────────────────────────────────────────────

describe('useCollaboration — receiving remote ops', () => {
  it('applies received cells to the sheet store', () => {
    const { realtime, sheet } = makeDeps()
    realtime.emit('sheet_op', {
      sheet: 'doc-abc', user: 'bob@example.com',
      op: JSON.stringify({ type: 'cells', subSheet: 'Sheet1', cells: { A1: '99' } }),
    })
    expect(sheet.setCell).toHaveBeenCalledWith('A1', '99', 'Sheet1')
  })

  it('does not call repopulateGrid for current-sheet ops', () => {
    const { realtime, repopulate } = makeDeps()
    realtime.emit('sheet_op', {
      sheet: 'doc-abc', user: 'bob@example.com',
      op: JSON.stringify({ type: 'cells', subSheet: 'Sheet1', cells: { A1: '1' } }),
    })
    expect(repopulate).not.toHaveBeenCalled()
  })

  it('calls repopulateGrid for cross-sheet ops', () => {
    const { realtime, repopulate } = makeDeps()
    realtime.emit('sheet_op', {
      sheet: 'doc-abc', user: 'bob@example.com',
      op: JSON.stringify({ type: 'cells', subSheet: 'Sheet2', cells: { A1: '1' } }),
    })
    expect(repopulate).toHaveBeenCalled()
  })

  it('ignores ops from self', () => {
    const { realtime, sheet } = makeDeps()
    realtime.emit('sheet_op', {
      sheet: 'doc-abc', user: 'alice@example.com',
      op: JSON.stringify({ type: 'cells', subSheet: 'Sheet1', cells: { A1: '5' } }),
    })
    expect(sheet.setCell).not.toHaveBeenCalled()
  })

  it('ignores ops for a different sheet doc', () => {
    const { realtime, sheet } = makeDeps()
    realtime.emit('sheet_op', {
      sheet: 'other-doc', user: 'bob@example.com',
      op: JSON.stringify({ type: 'cells', subSheet: 'Sheet1', cells: { A1: '5' } }),
    })
    expect(sheet.setCell).not.toHaveBeenCalled()
  })

  it('silently ignores malformed op JSON', () => {
    const { realtime, sheet } = makeDeps()
    expect(() => {
      realtime.emit('sheet_op', { sheet: 'doc-abc', user: 'bob@example.com', op: '{bad json' })
    }).not.toThrow()
    expect(sheet.setCell).not.toHaveBeenCalled()
  })
})

// ── Receiving remote cursors ──────────────────────────────────────────────────

describe('useCollaboration — receiving remote cursors', () => {
  it('adds a remote cursor with correct fields', () => {
    const { realtime, remoteCursors } = makeDeps()
    emitCursor(realtime)
    expect(remoteCursors.value.has('bob@example.com')).toBe(true)
    const cursor = remoteCursors.value.get('bob@example.com')
    expect(cursor.row).toBe(3)
    expect(cursor.col).toBe(5)
    expect(cursor.subSheet).toBe('Sheet1')
    expect(cursor.initials).toBe('BS')
    expect(typeof cursor.color).toBe('string')
  })

  it('assigns a color from the collaboration palette', () => {
    const { realtime, remoteCursors } = makeDeps()
    emitCursor(realtime)
    const color = remoteCursors.value.get('bob@example.com').color
    expect(CURSOR_PALETTE).toContain(color)
  })

  it('assigns a deterministic color — same user always gets the same color', () => {
    const { realtime, remoteCursors } = makeDeps()
    emitCursor(realtime)
    const firstColor = remoteCursors.value.get('bob@example.com').color
    emitCursor(realtime)
    expect(remoteCursors.value.get('bob@example.com').color).toBe(firstColor)
  })

  it('ignores cursors from self', () => {
    const { realtime, remoteCursors } = makeDeps()
    emitCursor(realtime, { user: 'alice@example.com' })
    expect(remoteCursors.value.size).toBe(0)
  })

  it('ignores cursors for a different sheet doc', () => {
    const { realtime, remoteCursors } = makeDeps()
    emitCursor(realtime, { sheet: 'other-doc' })
    expect(remoteCursors.value.size).toBe(0)
  })

  it('clears remoteCursors on stop', () => {
    const { realtime, remoteCursors, watchCallback } = makeDeps()
    emitCursor(realtime)
    expect(remoteCursors.value.size).toBe(1)
    watchCallback(undefined, 'doc-abc')
    expect(remoteCursors.value.size).toBe(0)
  })
})
