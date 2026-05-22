import { ref, watch, onUnmounted } from 'vue'
import { call }                    from '../../utils/api.js'

// ── Constants ──────────────────────────────────────────────────────────────────

const PING_INTERVAL = 15_000   // ms between presence heartbeats
const EXPIRE_AFTER  = 35_000   // ms of silence before a peer is removed
const DEBOUNCE_MS   = 80       // ms to coalesce rapid cell edits

// Collaboration cursor palette — 8 distinct colours not covered by Espresso tokens.
export const CURSOR_PALETTE = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#AB47BC', '#00ACC1', '#FF7043', '#8D6E63']

function hashUserColor(user) {
  let hash = 0
  for (const char of user) hash = (hash * 31 + char.charCodeAt(0)) & 0xFFFFFFFF
  return CURSOR_PALETTE[Math.abs(hash) % CURSOR_PALETTE.length]
}

// ── Composable ─────────────────────────────────────────────────────────────────

/**
 * Unified collaboration composable that handles both presence (who is viewing)
 * and live-sync (remote cell ops and cursor broadcasts).
 *
 * A single `_start` / `_stop` lifecycle manages all realtime listeners so there
 * is only one watcher and one unmount teardown.
 *
 * @param {{
 *   sheetId:        import('vue').Ref<string>,
 *   currentSheet:   import('vue').Ref<string>,
 *   getSheet:       () => object,
 *   repopulateGrid: () => void,
 *   _self?:         string,
 *   _realtime?:     { on: Function, off: Function },
 *   _callFn?:       (method: string, args: object) => Promise<any>,
 *   _watch?:        typeof watch,
 *   _onUnmounted?:  typeof onUnmounted,
 * }} opts
 */
export function useCollaboration({
  sheetId,
  currentSheet,
  getSheet,
  repopulateGrid,
  _self        = window.frappe?.session?.user,
  _realtime    = window.frappe?.realtime,
  _callFn      = (method, args) => call(method, args),
  _watch       = watch,
  _onUnmounted = onUnmounted,
}) {
  // ── Presence state ───────────────────────────────────────────────────────────

  const presentUsers = ref([])           // other users currently viewing — not self
  const _peers       = new Map()         // user → { data, timerId }
  let   _pingTimer   = null

  // ── Live-sync state ──────────────────────────────────────────────────────────

  // user → { row, col, subSheet, color, fullName, initials }
  const remoteCursors = ref(new Map())

  let _sheetId   = null
  let _pending   = new Map()            // subSheet → Map<cellId, value>
  let _flushTimer = null

  // ── Shared lifecycle flag ────────────────────────────────────────────────────

  let _listening = false

  // ── Presence handlers ────────────────────────────────────────────────────────

  function _onPresence(data) {
    if (!data || data.sheet !== _sheetId || data.user === _self) return
    const existing = _peers.get(data.user)
    if (existing?.timerId) clearTimeout(existing.timerId)
    const timerId = setTimeout(() => { _peers.delete(data.user); _syncPresentUsers() }, EXPIRE_AFTER)
    _peers.set(data.user, { ...data, timerId })
    _syncPresentUsers()
  }

  function _syncPresentUsers() {
    presentUsers.value = [..._peers.values()].map(
      ({ user, full_name, initials, user_image }) => ({ user, full_name, initials, user_image })
    )
  }

  function _ping() {
    if (!_sheetId) return
    _callFn('frappe_sheets_next.api.ping_presence', { name: _sheetId }).catch(() => {})
  }

  // ── Live-sync broadcast ──────────────────────────────────────────────────────

  function broadcastCellChange(subSheet, id, value) {
    if (!_sheetId) return
    _enqueue(subSheet, [[id, value]])
  }

  function broadcastBatchChange(subSheet, cellChanges) {
    if (!_sheetId) return
    _enqueue(subSheet, cellChanges.map(change => [change.id, change.value]))
  }

  function _enqueue(subSheet, pairs) {
    if (!_pending.has(subSheet)) _pending.set(subSheet, new Map())
    const cellMap = _pending.get(subSheet)
    for (const [id, value] of pairs) cellMap.set(id, value)
    clearTimeout(_flushTimer)
    _flushTimer = setTimeout(_flush, DEBOUNCE_MS)
  }

  function _flush() {
    if (!_sheetId) { _pending = new Map(); return }
    for (const [subSheet, cellMap] of _pending) {
      const op = JSON.stringify({ type: 'cells', subSheet, cells: Object.fromEntries(cellMap) })
      _callFn('frappe_sheets_next.api.broadcast_op', { name: _sheetId, op }).catch(() => {})
    }
    _pending = new Map()
  }

  function broadcastCursor(row, col, subSheet) {
    if (!_sheetId) return
    _callFn('frappe_sheets_next.api.broadcast_cursor',
      { name: _sheetId, r: row, c: col, sub_sheet: subSheet }).catch(() => {})
  }

  // ── Live-sync receive ────────────────────────────────────────────────────────

  function _onOp(data) {
    if (!data || data.sheet !== _sheetId || data.user === _self) return
    let op
    try { op = JSON.parse(data.op) } catch { return }
    if (op.type !== 'cells') return
    const sheet = getSheet()
    for (const [id, value] of Object.entries(op.cells)) sheet.setCell(id, value, op.subSheet)
    // onCellChanged fires for every setCell — correct for the current sub-sheet but
    // contaminates the canvas for cross-sheet ops; repopulate to restore correct state.
    if (op.subSheet !== currentSheet.value) repopulateGrid()
  }

  function _onCursor(data) {
    if (!data || data.sheet !== _sheetId || data.user === _self) return
    const next = new Map(remoteCursors.value)
    next.set(data.user, {
      row:      data.r,
      col:      data.c,
      subSheet: data.sub_sheet,
      color:    hashUserColor(data.user),
      fullName: data.full_name,
      initials: data.initials,
    })
    remoteCursors.value = next
  }

  // ── Shared lifecycle ─────────────────────────────────────────────────────────

  function _start(docId) {
    if (_listening) _stop()
    _sheetId   = docId
    _listening = true

    // Presence listeners
    _realtime?.on('sheet_presence', _onPresence)
    _ping()
    _pingTimer = setInterval(_ping, PING_INTERVAL)

    // Live-sync listeners
    _realtime?.on('sheet_op',     _onOp)
    _realtime?.on('sheet_cursor', _onCursor)
  }

  function _stop() {
    if (!_listening) return

    // Presence teardown
    _realtime?.off('sheet_presence', _onPresence)
    clearInterval(_pingTimer)
    for (const { timerId } of _peers.values()) clearTimeout(timerId)
    _peers.clear()
    presentUsers.value = []

    // Live-sync teardown
    clearTimeout(_flushTimer)
    _realtime?.off('sheet_op',     _onOp)
    _realtime?.off('sheet_cursor', _onCursor)
    _pending            = new Map()
    remoteCursors.value = new Map()

    _listening = false
    _sheetId   = null
  }

  _watch(sheetId, docId => {
    if (docId && docId !== 'new') _start(docId)
    else                          _stop()
  }, { immediate: true })

  _onUnmounted(_stop)

  return {
    presentUsers,
    remoteCursors,
    broadcastCellChange,
    broadcastBatchChange,
    broadcastCursor,
  }
}
