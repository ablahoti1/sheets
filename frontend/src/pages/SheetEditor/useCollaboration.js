import { ref, watch, onUnmounted } from 'vue'
import { call }                        from '../../utils/api.js'
import { createYDoc, hydrateYDoc }     from '../../collab/ydoc.js'
import { bindCells }                   from '../../collab/cells-binding.js'
import { createFrappeProvider }        from '../../collab/frappe-provider.js'
import { createRealtimeAdapter }       from '../../collab/realtime-adapter.js'
import { createAwareness }             from '../../collab/awareness.js'

// Collaboration cursor palette — 8 distinct colours not covered by Espresso tokens.
export const CURSOR_PALETTE = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#AB47BC', '#00ACC1', '#FF7043', '#8D6E63']

function hashUserColor(user) {
  let hash = 0
  for (const char of (user || '')) hash = (hash * 31 + char.charCodeAt(0)) & 0xFFFFFFFF
  return CURSOR_PALETTE[Math.abs(hash) % CURSOR_PALETTE.length]
}

/**
 * Unified collaboration composable powered by a Yjs document per sheet.
 *
 *   * Cell edits are mirrored via a Y.Map binding so concurrent writes
 *     converge automatically — no more last-write-wins data loss.
 *   * Presence and cursor positions live in Yjs awareness — one volatile
 *     channel shared with the same transport.
 *   * The previous bespoke `broadcast_op` / `sheet_cursor` / `ping_presence`
 *     flow is retired; the backend endpoints still exist but are no longer
 *     called from the editor.
 *
 * The external API (`presentUsers`, `remoteCursors`, `broadcastCellChange`,
 * `broadcastBatchChange`, `broadcastCursor`) is preserved so index.vue
 * doesn't need to change — the broadcast functions are now no-ops for cells
 * (the patched `sheet.setCell` from `bindCells` handles publishing) and
 * thin awareness setters for the cursor.
 *
 * @param {{
 *   sheetId:        import('vue').Ref<string>,
 *   currentSheet:   import('vue').Ref<string>,
 *   getSheet:       () => object,
 *   repopulateGrid: () => void,
 *   _self?:         string,
 *   _realtime?:     { on: Function, off: Function },
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
  const presentUsers  = ref([])           // other users currently viewing
  const remoteCursors = ref(new Map())    // userId → { row, col, subSheet, color, ... }

  let _doc       = null
  let _provider  = null
  let _awareness = null
  let _binding   = null
  let _sheetId   = null

  // ── Outbound API (kept for backwards-compatibility with index.vue) ──────────

  function broadcastCellChange(/* subSheet, id, value */) {
    // No-op: local writes are mirrored to the Y.Doc by bindCells's patched
    // sheet.setCell, then republished by the Frappe provider. Keeping this
    // function so index.vue's call sites compile without edits.
  }

  function broadcastBatchChange(/* subSheet, cellChanges */) {
    // Same reasoning as broadcastCellChange.
  }

  function broadcastCursor(row, col, subSheet, range = null) {
    // `range` is the full selection rectangle ({r0,c0,r1,c1}); peers paint
    // it as the "where this user is selected" outline. If absent (e.g.
    // legacy callers), the remote painter falls back to a single-cell rect
    // at the anchor.
    _awareness?.setLocalState({ cursor: { row, col, range, subSheet } })
  }

  // ── Awareness → reactive refs ───────────────────────────────────────────────

  function _syncFromAwareness() {
    if (!_awareness) return
    const peers   = _awareness.getStates()    // already excludes our clientId
    const users   = []
    const cursors = new Map()
    const seen    = new Set()                  // dedupe presence by user id

    for (const state of peers.values()) {
      const user = state?.user
      if (!user || !user.id || user.id === _self) continue
      if (!seen.has(user.id)) {
        seen.add(user.id)
        users.push({
          user:        user.id,
          full_name:   user.fullName,
          initials:    user.initials,
          user_image:  user.image,
        })
      }
      if (state.cursor) {
        // Fallback range = single anchor cell (back-compat with peers that
        // haven't upgraded to the range-aware payload yet).
        const c = state.cursor
        const range = c.range || { r0: c.row, c0: c.col, r1: c.row, c1: c.col }
        cursors.set(user.id, {
          row:      c.row,
          col:      c.col,
          range,
          subSheet: c.subSheet,
          color:    hashUserColor(user.id),
          fullName: user.fullName,
          initials: user.initials,
        })
      }
    }
    presentUsers.value  = users
    remoteCursors.value = cursors
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  function _start(docId) {
    if (_doc) _stop()
    _sheetId = docId

    const sheet  = getSheet()
    const identity = _readUserIdentity()

    // 1. New Y.Doc and seed it from the current engine state. Late peers'
    //    state-sync replay will overwrite this with the authoritative copy
    //    of the first peer to join, so seeding the first peer's view is
    //    enough — Yjs convergence handles the rest.
    _doc = createYDoc()
    hydrateYDoc(_doc, { sheet: sheet?.snapshot?.() })

    // 2. Patch sheet.setCell so every write also lands in Y.Map; observe
    //    remote writes and apply them through the engine. Cross-sheet
    //    remote writes still need a full canvas repopulate because the
    //    engine's onCellChanged callback paints to the active grid only.
    _binding = bindCells({
      doc: _doc,
      sheet,
      onRemoteSheetChange(name) {
        if (name !== currentSheet.value) repopulateGrid()
      },
    })

    // 3. Realtime adapter (publish via yjs_relay API + subscribe via
    //    frappe.realtime), then a custom Yjs provider on top of it.
    const adapter = createRealtimeAdapter({
      sheetId:  _sheetId,
      realtime: _realtime,
      callFn:   _callFn,
    })
    _provider = createFrappeProvider({ doc: _doc, sheetId: _sheetId, realtime: adapter })

    // 4. Awareness reuses the provider's self tag so a single clientId
    //    serves both the CRDT sync and presence — easier debugging,
    //    consistent dedupe.
    _awareness = createAwareness({
      sheetId:  _sheetId,
      realtime: adapter,
      clientId: _provider.tag,
      initial:  { user: identity, cursor: null },
    })
    _awareness.on('change', _syncFromAwareness)
    _syncFromAwareness()
  }

  function _stop() {
    _binding?.dispose()
    _awareness?.destroy()
    _provider?.destroy()
    _doc?.destroy()
    _binding = _awareness = _provider = _doc = null
    _sheetId = null
    presentUsers.value  = []
    remoteCursors.value = new Map()
  }

  function _readUserIdentity() {
    const id = _self
    // Guard against `window` being undefined (tests run in node) — the
    // composable should still function with just an id.
    const w = (typeof window !== 'undefined') ? window : undefined
    const fullName = w?.frappe?.session?.user_fullname
      || w?.frappe?.boot?.user_info?.[id]?.fullname
      || id
      || 'Anonymous'
    const parts = String(fullName).split(' ').filter(Boolean)
    const initials = ((parts[0]?.[0] || '?')
      + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
    return {
      id,
      fullName: String(fullName),
      initials,
      image: w?.frappe?.boot?.user_info?.[id]?.image || '',
    }
  }

  _watch(sheetId, docId => {
    if (docId && docId !== 'new') _start(docId)
    else                          _stop()
  }, { immediate: true })

  _onUnmounted(_stop)

  // Conflict-aware undo support — index.vue's history pulls this between
  // pushes to remember which cells *this* client touched in each undo
  // segment. When collab is off (no binding), there's nothing to drain so
  // we return an empty set and undo falls back to the snapshot restore.
  function drainLocalTouches() {
    return _binding?.drainLocalTouches?.() || new Set()
  }

  return {
    presentUsers,
    remoteCursors,
    broadcastCellChange,
    broadcastBatchChange,
    broadcastCursor,
    drainLocalTouches,
  }
}
