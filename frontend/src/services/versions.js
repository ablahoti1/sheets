// Client for the backend version-history API (versions.py).
//
// Pure data-fetch helpers — no Vue state inside.  Returns the same shapes the
// backend produces so the UI layer can render directly.

import { call } from '../utils/api.js'

const PREFIX = 'frappe_sheets_next.versions'

export function list(sheet, limit = 200) {
	return call(`${PREFIX}.list_versions`, { sheet, limit })
}

export function getState(sheet, version) {
	return call(`${PREFIX}.get_version_state`, { sheet, version })
}

export function restore(sheet, version) {
	return call(`${PREFIX}.restore_version`, { sheet, version })
}

export function name(sheet, version, versionName) {
	return call(`${PREFIX}.name_version`,
		{ sheet, version, version_name: versionName })
}

export function clearName(sheet, version) {
	return call(`${PREFIX}.clear_version_name`, { sheet, version })
}

export function makeACopy(sheet, version, title = '') {
	return call(`${PREFIX}.make_a_copy`, { sheet, version, title })
}

export function cellHistory(sheet, cellRef, sheetName = 'Sheet1', limit = 50) {
	return call(`${PREFIX}.cell_history`,
		{ sheet, cell_ref: cellRef, sheet_name: sheetName, limit })
}

// Cells changed between `version` and the one immediately before it (or
// `against`, when provided).  Drives the preview-mode highlighting layer.
export function cellDiff(sheet, version, against = '') {
	return call(`${PREFIX}.cell_diff`, { sheet, version, against })
}

// Record an op against the in-flight save.  Frontend call sites
// (paste, fill, import, etc.) fire this immediately after their mutation
// so the resulting Version row gets the right label + cell-history entry.
//
// Payloads are kept small — only the cells the op actually touched.
export function recordOp({ sheet, opType, cellRefs = null, before = null,
                           after = null, summary = '', subSheet = '',
                           version = '' }) {
	return call(`${PREFIX}.record_op`, {
		sheet,
		op_type:   opType,
		cell_refs: cellRefs && JSON.stringify(cellRefs),
		before:    before && JSON.stringify(before),
		after:     after  && JSON.stringify(after),
		summary,
		sub_sheet: subSheet,
		version,
	})
}

// Convenience: returns the Version row name created by the most-recent save
// for a given sheet.  Frontend uses it to hard-link ops to their Version.
export function latestVersion(sheet) {
	return call(`${PREFIX}.latest_version`, { sheet })
}
