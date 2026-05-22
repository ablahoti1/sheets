"""Version history API for the Sheet doctype.

Frappe records a Version row on every save (track_changes: 1).  Each row's
`data` JSON has shape:

    {"changed": [["sheets_data", "<old>", "<new>"], ...], ...}

We layer a small API on top to:

  - list versions for a sheet, joined with names from Sheet Version Name
  - reconstruct the sheets_data state at a specific version
  - restore a version (creates a new save → new Version row, history is
    append-only)
  - name a version (pins it; named versions skip retention pruning)
  - derive per-cell history by diffing consecutive Versions' sheets_data

All endpoints check the caller has read permission on the underlying Sheet
before returning anything.  Restoring + naming also require write permission.
"""

import json
from typing import Any

import frappe
from frappe import _

SHEETS_DATA_FIELD = "sheets_data"


# ── Public endpoints ──────────────────────────────────────────────────────────


@frappe.whitelist()
def list_versions(sheet: str, limit: int = 200) -> list[dict]:
	"""Return version metadata for one sheet, newest first.

	Each entry: {name, timestamp, user, version_name?, touched_fields[],
	             op_labels[], primary_op?}.

	op_labels are derived from Sheet Op Log entries created in the window
	between this Version and the previous one — gives the UI the "Imported
	.xlsx file" / "Pasted 24 cells" subtitle.  primary_op is the dominant
	op_type if one exists.
	"""
	_require_read(sheet)
	versions = frappe.get_all(
		"Version",
		filters={"ref_doctype": "Sheet", "docname": sheet},
		fields=["name", "owner", "creation", "data"],
		order_by="creation desc",
		limit=int(limit),
	)
	names = _name_map(sheet)
	ops_by_window = _ops_by_version_window(sheet, versions)
	return [_version_summary(v, names, ops_by_window.get(v["name"], []))
	        for v in versions]


def _ops_by_version_window(sheet: str, versions: list[dict]) -> dict[str, list[dict]]:
	"""Bucket Op Log entries into their Version row.

	Two paths:
	  1. Explicit link — op.version is set (modern flow).  Use it directly.
	  2. Fallback — op.version is null.  Pick the first Version whose
	     creation is >= op.creation (the save that committed the op).
	"""
	if not versions:
		return {}
	known = {v["name"] for v in versions}
	all_ops = frappe.get_all(
		"Sheet Op Log",
		filters={"sheet": sheet},
		fields=["name", "creation", "op_type", "summary", "cell_refs", "version"],
		order_by="creation asc",
		limit=2000,
	)
	chrono  = list(reversed(versions))  # oldest-first
	buckets = {v["name"]: [] for v in chrono}
	j = 0
	for op in all_ops:
		if op.get("version") and op["version"] in known:
			buckets[op["version"]].append(op)
			continue
		# Fallback: pick the first version with creation >= op.creation.
		while j < len(chrono) and chrono[j]["creation"] < op["creation"]:
			j += 1
		if j < len(chrono):
			buckets[chrono[j]["name"]].append(op)
	return buckets


@frappe.whitelist()
def get_version_state(sheet: str, version: str) -> dict:
	"""Reconstruct the sheet state at the given Version row.

	Returns {title, sheets_data}.  Uses the diff chain — see _state_at.
	"""
	_require_read(sheet)
	return _state_at(sheet, version)


@frappe.whitelist()
def restore_version(sheet: str, version: str) -> str:
	"""Apply the state-at-version to the live doc.

	This creates a NEW save → a NEW Version row appears in the log.  History
	is append-only — restoring never deletes.  A `restore` op log entry is
	emitted alongside, hard-linked to the new Version row.
	"""
	_require_write(sheet)
	state = _state_at(sheet, version)
	doc = frappe.get_doc("Sheet", sheet)
	doc.title        = state["title"]
	doc.sheets_data  = state["sheets_data"]
	doc.save()
	# Look up the Version row just produced so we can hard-link the op.
	# Newest first; the save we just made tops the list.
	latest = frappe.get_all(
		"Version",
		filters={"ref_doctype": "Sheet", "docname": sheet},
		fields=["name"],
		order_by="creation desc",
		limit=1,
	)
	new_version = latest[0]["name"] if latest else None
	op = frappe.new_doc("Sheet Op Log")
	op.sheet   = sheet
	op.op_type = "restore"
	op.summary = f"Restored version from {version}"
	op.version = new_version
	op.insert(ignore_permissions=False)
	return doc.name


@frappe.whitelist()
def name_version(sheet: str, version: str, version_name: str) -> str:
	"""Pin a name on a Version row.  Idempotent — overwrites prior name."""
	_require_write(sheet)
	name = (version_name or "").strip()
	if not name:
		frappe.throw(_("Version name is required"))
	existing = frappe.db.exists("Sheet Version Name", {"version": version})
	if existing:
		row = frappe.get_doc("Sheet Version Name", existing)
		row.version_name = name
		row.save()
		return row.name
	row = frappe.new_doc("Sheet Version Name")
	row.version = version
	row.sheet   = sheet
	row.version_name = name
	row.insert()
	return row.name


@frappe.whitelist()
def make_a_copy(sheet: str, version: str, title: str = "") -> str:
	"""Create a new Sheet doc seeded with the state at this version.

	Mirrors Google Sheets' "Make a copy" — gives the user a snapshot to
	branch from without touching the original.
	"""
	_require_read(sheet)
	state = _state_at(sheet, version)
	dup = frappe.new_doc("Sheet")
	src_doc = frappe.get_doc("Sheet", sheet)
	dup.title        = (title or f"{src_doc.title} (snapshot)")[:280]
	dup.sheets_data  = state["sheets_data"]
	dup.insert(ignore_permissions=False)
	return dup.name


@frappe.whitelist()
def clear_version_name(sheet: str, version: str) -> str:
	"""Unpin a named version.  Idempotent."""
	_require_write(sheet)
	existing = frappe.db.exists("Sheet Version Name", {"version": version})
	if existing:
		frappe.delete_doc("Sheet Version Name", existing, ignore_permissions=False)
	return "ok"


@frappe.whitelist()
def cell_history(sheet: str, cell_ref: str, sheet_name: str = "Sheet1", limit: int = 50) -> list[dict]:
	"""Per-cell change stream.  Merges Op Log (rich) + Version diff (fallback).

	Each entry: {timestamp, user, before, after, op_type, source, summary?}.
	`source` is 'op-log' for entries from instrumented call sites and
	'version-diff' for entries derived by diffing two Version rows.

	When both sources cover the same cell change (timestamps within ~1s and
	identical before/after), Op Log wins — it carries op_type + summary.

	Format-only changes are excluded.
	"""
	_require_read(sheet)
	op_entries  = _cell_history_from_ops(sheet, sheet_name, cell_ref, limit)
	ver_entries = _cell_history_from_versions(sheet, sheet_name, cell_ref, limit)
	merged = _merge_cell_streams(op_entries, ver_entries)
	merged.sort(key=lambda e: e["timestamp"], reverse=True)
	return merged[:int(limit)]


def _cell_history_from_ops(sheet: str, sheet_name: str, cell_ref: str,
                           limit: int) -> list[dict]:
	rows = frappe.get_all(
		"Sheet Op Log",
		filters={"sheet": sheet, "op_type": ("not in", ("format", "cond-format"))},
		fields=["name", "creation", "owner", "op_type", "summary",
		        "cell_refs", "before_json", "after_json", "sub_sheet"],
		order_by="creation desc",
		limit=int(limit) * 4,
	)
	out = []
	for r in rows:
		if r.get("sub_sheet") and r["sub_sheet"] != sheet_name:
			continue
		refs   = _parse_json_list(r.get("cell_refs"))
		if refs and cell_ref not in refs:
			continue
		before = _parse_json_obj(r.get("before_json")).get(cell_ref)
		after  = _parse_json_obj(r.get("after_json")).get(cell_ref)
		if before == after:
			continue
		out.append({
			"version":   None,
			"timestamp": r["creation"],
			"user":      r["owner"],
			"before":    before,
			"after":     after,
			"op_type":   r["op_type"],
			"summary":   r.get("summary"),
			"source":    "op-log",
		})
	return out


def _cell_history_from_versions(sheet: str, sheet_name: str, cell_ref: str,
                                limit: int) -> list[dict]:
	versions = frappe.get_all(
		"Version",
		filters={"ref_doctype": "Sheet", "docname": sheet},
		fields=["name", "owner", "creation", "data"],
		order_by="creation desc",
		limit=int(limit) * 4,
	)
	out = []
	for v in versions:
		change = _diff_cell(v, sheet_name, cell_ref)
		if change is None:
			continue
		out.append({
			"version":   v["name"],
			"timestamp": v["creation"],
			"user":      v["owner"],
			"before":    change["before"],
			"after":     change["after"],
			"op_type":   "edit",
			"summary":   None,
			"source":    "version-diff",
		})
	return out


def _merge_cell_streams(op_entries: list[dict], ver_entries: list[dict]) -> list[dict]:
	"""Dedupe Op Log + Version-diff streams that report the same change.

	Same change = identical (before, after) and timestamps within 2 seconds.
	Op Log wins (richer op_type + summary).
	"""
	out = list(op_entries)
	for ve in ver_entries:
		dup = False
		for oe in op_entries:
			if oe["before"] == ve["before"] and oe["after"] == ve["after"]:
				if _ts_diff_seconds(oe["timestamp"], ve["timestamp"]) <= 2:
					dup = True
					break
		if not dup:
			out.append(ve)
	return out


def _ts_diff_seconds(a, b) -> float:
	from datetime import datetime
	def _parse(x):
		if isinstance(x, datetime): return x
		return datetime.fromisoformat(str(x).replace(" ", "T"))
	return abs((_parse(a) - _parse(b)).total_seconds())


def _parse_json_list(v: str | None) -> list:
	if not v:
		return []
	try:
		parsed = json.loads(v)
	except (ValueError, TypeError):
		return []
	return parsed if isinstance(parsed, list) else []


def _parse_json_obj(v: str | None) -> dict:
	if not v:
		return {}
	try:
		parsed = json.loads(v)
	except (ValueError, TypeError):
		return {}
	return parsed if isinstance(parsed, dict) else {}


# ── Cell diff between two versions (drives preview highlighting) ──────────────


@frappe.whitelist()
def cell_diff(sheet: str, version: str, against: str = "") -> dict:
	"""Return the set of cells that changed between two versions.

	`against` defaults to the version *immediately before* the given one.
	Used by the preview banner to paint changed cells teal.

	Returns:
	    {
	      sheets: {"Sheet1": {"A1": {"before": "x", "after": "y"}, ...}},
	      total_changed_cells: int,
	      total_changed_rows:  int,
	    }
	"""
	_require_read(sheet)
	target_state  = _state_at(sheet, version)
	against_state = _state_at(sheet, against) if against else _previous_state(sheet, version)
	if not against_state:
		# No predecessor → everything in the target version is "new" — but we
		# don't have a clean "before"; report no diff to keep the UI sane.
		return {"sheets": {}, "total_changed_cells": 0, "total_changed_rows": 0}

	target_sheets  = _extract_sheets(target_state["sheets_data"])
	against_sheets = _extract_sheets(against_state["sheets_data"])
	diff = _diff_sheet_maps(against_sheets, target_sheets)
	rows = _count_changed_rows(diff)
	return {
		"sheets": diff,
		"total_changed_cells": sum(len(v) for v in diff.values()),
		"total_changed_rows":  rows,
	}


def _previous_state(sheet: str, version: str) -> dict | None:
	target = frappe.get_doc("Version", version)
	prev = frappe.get_all(
		"Version",
		filters={"ref_doctype": "Sheet", "docname": sheet,
		         "creation": ("<", target.creation)},
		fields=["name"],
		order_by="creation desc",
		limit=1,
	)
	if not prev:
		return None
	return _state_at(sheet, prev[0]["name"])


def _extract_sheets(blob: str | None) -> dict[str, dict]:
	if not blob:
		return {}
	try:
		parsed = json.loads(blob)
	except (ValueError, TypeError):
		return {}
	# Live shape: parsed.sheet.sheets[name]
	root = parsed.get("sheet") if isinstance(parsed, dict) else None
	if isinstance(root, dict) and isinstance(root.get("sheets"), dict):
		return {k: (v if isinstance(v, dict) else {})
		        for k, v in root["sheets"].items()}
	# Legacy: parsed[name].data
	out = {}
	if isinstance(parsed, dict):
		for k, v in parsed.items():
			if isinstance(v, dict):
				data = v.get("data") if isinstance(v.get("data"), dict) else v
				out[k] = data if isinstance(data, dict) else {}
	return out


def _diff_sheet_maps(before: dict[str, dict], after: dict[str, dict]) -> dict[str, dict]:
	"""Per-sheet cell diff.  Includes additions, deletions, and changes."""
	out: dict[str, dict] = {}
	all_sheet_names = set(before) | set(after)
	for sn in all_sheet_names:
		b = before.get(sn) or {}
		a = after.get(sn)  or {}
		changes = {}
		for cell in set(b) | set(a):
			if b.get(cell) != a.get(cell):
				changes[cell] = {"before": b.get(cell), "after": a.get(cell)}
		if changes:
			out[sn] = changes
	return out


def _count_changed_rows(diff: dict[str, dict]) -> int:
	import re
	rows = set()
	for sn, cells in diff.items():
		for ref in cells:
			m = re.match(r"^[A-Z]+(\d+)$", ref)
			if m:
				rows.add((sn, int(m.group(1))))
	return len(rows)


# ── State reconstruction ──────────────────────────────────────────────────────


def _state_at(sheet: str, version: str) -> dict:
	"""Reconstruct {title, sheets_data} at the given version.

	Strategy: for each field, find the first Version row at-or-after the
	target whose `changed` touches the field; its `new` value is the state
	at the target version.  If no such version exists (the field hasn't
	changed since the target), the live doc holds the answer.
	"""
	target = frappe.get_doc("Version", version)
	if target.docname != sheet:
		frappe.throw(_("Version does not belong to this sheet"))

	live = frappe.get_doc("Sheet", sheet)
	state = {"title": live.title, "sheets_data": live.sheets_data or "{}"}

	for field in ("title", SHEETS_DATA_FIELD):
		val = _field_at(sheet, version, field, target.creation)
		if val is not None:
			state[field] = val
	return state


def _field_at(sheet: str, version: str, field: str, creation) -> Any:
	"""Return the field's value at the given Version row, or None if the
	field hasn't been touched at-or-after that version (caller falls back to
	the live doc value).
	"""
	# First check the target version itself.
	target_change = _change_for(version, field)
	if target_change is not None:
		return target_change["new"]

	# Otherwise walk forward — earliest version after `creation` that touched
	# the field holds the answer in its `old` slot.
	rows = frappe.get_all(
		"Version",
		filters={"ref_doctype": "Sheet", "docname": sheet,
		         "creation": (">", creation)},
		fields=["name", "data"],
		order_by="creation asc",
	)
	for r in rows:
		ch = _change_from_row(r, field)
		if ch is not None:
			return ch["old"]
	# Field hasn't changed since the target version — live doc is correct.
	return None


def _change_for(version: str, field: str) -> dict | None:
	data = frappe.db.get_value("Version", version, "data")
	if not data:
		return None
	return _change_from_data(data, field)


def _change_from_row(row: dict, field: str) -> dict | None:
	return _change_from_data(row.get("data"), field)


def _change_from_data(data: str | None, field: str) -> dict | None:
	if not data:
		return None
	try:
		parsed = json.loads(data)
	except (ValueError, TypeError):
		return None
	for entry in parsed.get("changed", []):
		if not entry or len(entry) < 3:
			continue
		if entry[0] == field:
			return {"old": entry[1], "new": entry[2]}
	return None


# ── Cell-history diffing ──────────────────────────────────────────────────────


def _diff_cell(version_row: dict, sheet_name: str, cell_ref: str) -> dict | None:
	"""Extract the change to one cell from a version's sheets_data diff.

	Returns {before, after} or None if the cell wasn't touched in this
	version.  Walks the JSON delta — does not load the full doc.
	"""
	change = _change_from_data(version_row.get("data"), SHEETS_DATA_FIELD)
	if change is None:
		return None
	old_cell = _cell_in_blob(change["old"], sheet_name, cell_ref)
	new_cell = _cell_in_blob(change["new"], sheet_name, cell_ref)
	if old_cell == new_cell:
		return None
	return {"before": old_cell, "after": new_cell}


def _cell_in_blob(blob: str | None, sheet_name: str, cell_ref: str) -> Any:
	"""Pull one cell's value out of a serialized sheets_data string.

	Production shape (see usePersistence.js):
	    {"sheet": {"sheets": {"Sheet1": {"A1": "x", ...}}, "current": ...}, ...}

	Older snapshots used flatter shapes; we probe a few defensive paths so the
	API stays robust if the serialisation format evolves.
	"""
	if not blob:
		return None
	try:
		parsed = json.loads(blob)
	except (ValueError, TypeError):
		return None
	if not isinstance(parsed, dict):
		return None

	# Live shape: parsed.sheet.sheets[name][ref]
	root = parsed.get("sheet")
	if isinstance(root, dict):
		sheets = root.get("sheets")
		if isinstance(sheets, dict) and isinstance(sheets.get(sheet_name), dict):
			return sheets[sheet_name].get(cell_ref)

	# Legacy: parsed[name].data[ref]
	sheet = parsed.get(sheet_name) if isinstance(parsed.get(sheet_name), dict) else None
	if sheet is None:
		return None
	data = sheet.get("data") if isinstance(sheet.get("data"), dict) else sheet
	if not isinstance(data, dict):
		return None
	return data.get(cell_ref)


# ── Naming + summarisation ────────────────────────────────────────────────────


def _name_map(sheet: str) -> dict[str, str]:
	rows = frappe.get_all(
		"Sheet Version Name",
		filters={"sheet": sheet},
		fields=["version", "version_name"],
	)
	return {r["version"]: r["version_name"] for r in rows}


def _version_summary(row: dict, names: dict[str, str], ops: list[dict] | None = None) -> dict:
	touched = _touched_fields(row.get("data"))
	op_summary = _summarise_ops(ops or [])
	return {
		"name":          row["name"],
		"timestamp":     row["creation"],
		"user":          row["owner"],
		"version_name":  names.get(row["name"]),
		"touched_fields": touched,
		"has_data_change": SHEETS_DATA_FIELD in touched,
		"primary_op":    op_summary["primary"],
		"op_labels":     op_summary["labels"],
	}


def _summarise_ops(ops: list[dict]) -> dict:
	"""Pick a dominant op_type for the version label.

	Priority (highest wins):
	  import > restore > paste > find-replace > fill > delete > insert >
	  sort > filter > merge > unmerge > resize > freeze > hide > unhide >
	  sheet > validation > comment > cond-format > format > edit
	The first explicit `summary` for the winning op_type is surfaced as the
	human label ("Pasted 24 cells", "Imported .xlsx file").
	"""
	priority = [
		"import", "restore", "paste", "find-replace", "fill",
		"delete", "insert", "sort", "filter", "merge", "unmerge",
		"resize", "freeze", "hide", "unhide", "sheet",
		"validation", "comment", "cond-format", "format", "edit",
	]
	if not ops:
		return {"primary": None, "labels": []}
	by_type: dict[str, list[dict]] = {}
	for o in ops:
		by_type.setdefault(o["op_type"], []).append(o)
	primary = next((t for t in priority if t in by_type), None)
	labels = []
	if primary:
		summaries = [o["summary"] for o in by_type[primary] if o.get("summary")]
		if summaries:
			labels.append(summaries[0])
		else:
			labels.append(_default_label(primary, len(by_type[primary])))
	return {"primary": primary, "labels": labels}


def _default_label(op_type: str, count: int) -> str:
	# Generic labels when callers didn't pass a summary.
	if op_type == "import":  return "Imported file"
	if op_type == "restore": return "Restored an earlier version"
	if op_type == "paste":   return f"Pasted into {count} cell(s)" if count > 1 else "Pasted"
	if op_type == "edit":    return f"Edited {count} cell(s)" if count > 1 else "Edited a cell"
	return op_type.replace("-", " ").capitalize()


def _touched_fields(data: str | None) -> list[str]:
	if not data:
		return []
	try:
		parsed = json.loads(data)
	except (ValueError, TypeError):
		return []
	return [e[0] for e in parsed.get("changed", []) if e and len(e) >= 1]


# ── Retention prune (called by scheduler) ─────────────────────────────────────


def prune_old_versions(retention_days: int = 30) -> int:
	"""Delete unnamed Version rows older than `retention_days`.

	Named versions are pinned and never pruned.  Returns the number deleted.
	"""
	named = set(
		r["version"]
		for r in frappe.get_all("Sheet Version Name", fields=["version"])
	)
	rows = frappe.get_all(
		"Version",
		filters={
			"ref_doctype": "Sheet",
			"creation": ("<", frappe.utils.add_days(frappe.utils.now_datetime(),
			                                       -retention_days)),
		},
		fields=["name"],
	)
	count = 0
	for r in rows:
		if r["name"] in named:
			continue
		frappe.delete_doc("Version", r["name"], ignore_permissions=True,
		                  delete_permanently=True)
		count += 1
	return count


# ── Operation log ─────────────────────────────────────────────────────────────
#
# The Sheet Op Log captures *intent* (paste vs type vs import vs fill) per
# user action.  Frappe Version captures *state* on each save.  We layer the
# two so:
#   - list_versions labels each Version with the dominant op_type from the
#     ops created in that save window  ("Imported .xlsx file")
#   - cell_history merges Op Log entries (richer — knows it was a paste)
#     with Version-diff fallbacks (handles data from before logging existed).
#
# Schema (Sheet Op Log doctype):
#   sheet, sub_sheet, op_type, cell_refs (JSON), before_json, after_json,
#   summary, version  ── linked when known (e.g. on restore)


@frappe.whitelist()
def record_op(
	sheet: str,
	op_type: str,
	cell_refs: str | list | None = None,
	before: str | dict | None = None,
	after: str | dict | None = None,
	summary: str = "",
	sub_sheet: str = "",
	version: str = "",
) -> str:
	"""Append one entry to the operation log.

	Frontend calls this immediately AFTER the doc save and passes the
	resulting Version row's name as `version` so the op log entry is hard-
	linked to its save.  When `version` is empty we fall back to time-bucket
	matching in _ops_by_version_window.

	`cell_refs` may be a JSON string or a Python list/iterable; we normalise
	to a JSON string for storage.  `before`/`after` are id→value maps (JSON
	string or dict).  `summary` is the human label ("Pasted 24 cells").
	"""
	_require_write(sheet)
	row = frappe.new_doc("Sheet Op Log")
	row.sheet       = sheet
	row.sub_sheet   = sub_sheet or ""
	row.op_type     = op_type
	row.cell_refs   = _ensure_json(cell_refs)
	row.before_json = _ensure_json(before)
	row.after_json  = _ensure_json(after)
	row.summary     = (summary or "")[:140]
	row.version     = version or None
	row.insert(ignore_permissions=False)
	return row.name


def _ensure_json(v) -> str | None:
	if v is None or v == "":
		return None
	if isinstance(v, str):
		return v
	return frappe.as_json(v)


@frappe.whitelist()
def latest_version(sheet: str) -> str | None:
	"""Name of the most recent Version row for this sheet (or None)."""
	_require_read(sheet)
	rows = frappe.get_all(
		"Version",
		filters={"ref_doctype": "Sheet", "docname": sheet},
		fields=["name"],
		order_by="creation desc",
		limit=1,
	)
	return rows[0]["name"] if rows else None


@frappe.whitelist()
def list_ops(sheet: str, limit: int = 200) -> list[dict]:
	"""Return recent ops for a sheet, newest first."""
	_require_read(sheet)
	rows = frappe.get_all(
		"Sheet Op Log",
		filters={"sheet": sheet},
		fields=["name", "creation", "owner", "op_type", "summary",
		        "cell_refs", "sub_sheet"],
		order_by="creation desc",
		limit=int(limit),
	)
	return rows


# ── Permission gates ──────────────────────────────────────────────────────────


def _require_read(sheet: str) -> None:
	doc = frappe.get_doc("Sheet", sheet)
	if not doc.has_permission("read"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)


def _require_write(sheet: str) -> None:
	doc = frappe.get_doc("Sheet", sheet)
	if not doc.has_permission("write"):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
