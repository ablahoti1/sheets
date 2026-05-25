// Custom Yjs provider that syncs over Frappe's `socketio` realtime.
//
// Frappe Cloud / on-prem benches already expose `frappe.realtime` (a socket.io
// client) wired to the same site the user authenticated against, with auth +
// room semantics built in. Building on it means:
//
//   * Zero extra infrastructure — no y-websocket server to deploy.
//   * Permission checks land naturally inside whitelisted endpoints.
//   * Presence + ops + persistence share one transport.
//
// Wire format (server-relayed event):
//   event: 'yjs_update'
//   payload: { sheet: <docName>, update: <base64 Y.encodeStateAsUpdate>,
//              from: <session.user> }
//
// Two messages on connect: state-sync (each peer sends a state vector and
// receives missing updates) is collapsed into a single fire-and-replay: the
// new peer requests a full state from the room via `yjs_state_request`, any
// online peer replies with `yjs_state` carrying a full doc update.

import * as Y from 'yjs'
import { REMOTE_ORIGIN } from './cells-binding.js'

const EVT_UPDATE        = 'yjs_update'
const EVT_STATE_REQUEST = 'yjs_state_request'
const EVT_STATE         = 'yjs_state'

/**
 * @param {object}  opts
 * @param {Y.Doc}   opts.doc
 * @param {string}  opts.sheetId        - backend Sheet docname (= room key)
 * @param {object}  opts.realtime       - the global frappe.realtime client
 *                                        (window.frappe.realtime in prod;
 *                                        tests inject a mock)
 * @param {string}  [opts.selfTag]      - identifier echoed in payloads so we
 *                                        ignore our own broadcasts (defaults
 *                                        to a fresh random id per client)
 */
export function createFrappeProvider({ doc, sheetId, realtime, selfTag } = {}) {
	if (!doc || !sheetId || !realtime) {
		throw new Error('createFrappeProvider: doc, sheetId and realtime are required')
	}

	const tag = selfTag || `cli-${Math.random().toString(36).slice(2, 10)}`
	let stopped = false

	const _onLocalUpdate = (update, origin) => {
		if (stopped) return
		// Echoes of updates we just applied locally would re-enter the
		// network, so guard against the REMOTE_ORIGIN tag.
		if (origin === REMOTE_ORIGIN) return
		realtime.publish?.(EVT_UPDATE, {
			sheet:  sheetId,
			from:   tag,
			update: _bytesToBase64(update),
		})
	}

	const _onRemoteUpdate = (payload) => {
		if (stopped) return
		if (!payload || payload.sheet !== sheetId) return
		if (payload.from === tag) return
		const bytes = _base64ToBytes(payload.update)
		Y.applyUpdate(doc, bytes, REMOTE_ORIGIN)
	}

	const _onStateRequest = (payload) => {
		if (stopped) return
		if (!payload || payload.sheet !== sheetId) return
		if (payload.from === tag) return  // don't reply to ourselves
		const full = Y.encodeStateAsUpdate(doc)
		realtime.publish?.(EVT_STATE, {
			sheet:  sheetId,
			from:   tag,
			to:     payload.from,
			update: _bytesToBase64(full),
		})
	}

	const _onState = (payload) => {
		if (stopped) return
		if (!payload || payload.sheet !== sheetId) return
		if (payload.from === tag) return
		// Optional point-to-point — if `to` is set and isn't us, ignore.
		if (payload.to && payload.to !== tag) return
		const bytes = _base64ToBytes(payload.update)
		Y.applyUpdate(doc, bytes, REMOTE_ORIGIN)
	}

	// Wire it up.
	doc.on('update', _onLocalUpdate)
	realtime.on?.(EVT_UPDATE,        _onRemoteUpdate)
	realtime.on?.(EVT_STATE_REQUEST, _onStateRequest)
	realtime.on?.(EVT_STATE,         _onState)

	// Announce ourselves so any online peer replays us their state.
	realtime.publish?.(EVT_STATE_REQUEST, { sheet: sheetId, from: tag })

	function destroy() {
		stopped = true
		doc.off('update', _onLocalUpdate)
		realtime.off?.(EVT_UPDATE,        _onRemoteUpdate)
		realtime.off?.(EVT_STATE_REQUEST, _onStateRequest)
		realtime.off?.(EVT_STATE,         _onState)
	}

	return { destroy, tag }
}

// ── byte ↔ base64 (browser-safe, chunked to avoid stack overflows) ─────

function _bytesToBase64(bytes) {
	const CHUNK = 0x8000
	let bin = ''
	for (let i = 0; i < bytes.length; i += CHUNK)
		bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
	return btoa(bin)
}

function _base64ToBytes(b64) {
	const bin = atob(b64)
	const out = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
	return out
}
