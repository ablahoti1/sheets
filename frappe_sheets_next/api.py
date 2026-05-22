import json

import frappe

# 5 MB cap on the serialized workbook. Larger than any realistic sheet today;
# the validation is here so a runaway client / malicious payload can't crash
# the database backend.
MAX_SHEETS_DATA_BYTES = 5 * 1024 * 1024
MAX_TITLE_LEN = 280


# ── Presence ──────────────────────────────────────────────────────────────────

@frappe.whitelist()
def ping_presence(name: str) -> None:
	"""Broadcast caller's identity to all clients watching this sheet."""
	user = frappe.session.user
	identity = _user_identity(user)
	frappe.publish_realtime(
		"sheet_presence",
		{"sheet": name, "user": user, **identity},
		after_commit=False,
	)


# ── Real-time collaboration ───────────────────────────────────────────────────

@frappe.whitelist()
def broadcast_op(name: str, op: str) -> None:
	"""Broadcast a cell-op JSON string to all clients watching this sheet."""
	frappe.has_permission("Sheet", doc=name, throw=True)
	frappe.publish_realtime(
		"sheet_op",
		{"sheet": name, "user": frappe.session.user, "op": op},
		after_commit=False,
	)


@frappe.whitelist()
def broadcast_cursor(name: str, r: int, c: int, sub_sheet: str) -> None:
	"""Broadcast cursor position to all clients watching this sheet."""
	user = frappe.session.user
	identity = _user_identity(user)
	frappe.publish_realtime(
		"sheet_cursor",
		{"sheet": name, "user": user, **identity,
		 "r": int(r), "c": int(c), "sub_sheet": sub_sheet},
		after_commit=False,
	)


# ── Sharing ───────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_sheet_shares(name: str) -> list:
	"""Return users who have explicit share access to this sheet."""
	frappe.has_permission("Sheet", doc=name, throw=True)
	rows = frappe.get_all(
		"DocShare",
		filters={"share_doctype": "Sheet", "share_name": name},
		fields=["user", "read", "write", "share"],
	)
	for row in rows:
		identity = _user_identity(row["user"])
		row.update(identity)
		row["user_image"] = frappe.db.get_value("User", row["user"], "user_image") or ""
	return rows


@frappe.whitelist()
def share_sheet(name: str, user: str, write: int = 0) -> dict:
	frappe.has_permission("Sheet", doc=name, throw=True)
	if not frappe.db.exists("User", user):
		frappe.throw(f"User {user} not found")
	frappe.share.add("Sheet", name, user, write=int(write), share=0, notify=True)
	return {"status": "ok"}


@frappe.whitelist()
def unshare_sheet(name: str, user: str) -> dict:
	frappe.has_permission("Sheet", doc=name, throw=True)
	frappe.share.remove("Sheet", name, user)
	return {"status": "ok"}


@frappe.whitelist()
def list_sheets() -> list:
	return frappe.get_list(
		"Sheet",
		fields=["name", "title", "modified", "owner"],
		filters={"owner": frappe.session.user},
		order_by="modified desc",
		limit=100,
	)


@frappe.whitelist()
def get_sheet(name: str) -> dict:
	doc = frappe.get_doc("Sheet", name)
	return {
		"name": doc.name,
		"title": doc.title,
		"sheets_data": doc.sheets_data or "{}",
	}


@frappe.whitelist()
def save_sheet(title: str, sheets_data: str, name: str = "") -> str:
	_validate_payload(title, sheets_data)
	title = _clean_title(title)
	if name:
		doc = frappe.get_doc("Sheet", name)
		doc.title = title
		doc.sheets_data = sheets_data
		doc.save()
	else:
		doc = frappe.new_doc("Sheet")
		doc.title = title
		doc.sheets_data = sheets_data
		doc.insert()
	return doc.name


@frappe.whitelist()
def delete_sheet(name: str) -> str:
	frappe.delete_doc("Sheet", name, ignore_permissions=False)
	return "ok"


@frappe.whitelist()
def rename_sheet(name: str, title: str) -> str:
	title = _clean_title(title)
	if not title:
		frappe.throw("Title is required")
	doc = frappe.get_doc("Sheet", name)
	doc.title = title
	doc.save()
	return doc.name


@frappe.whitelist()
def duplicate_sheet(name: str) -> str:
	src = frappe.get_doc("Sheet", name)
	dup = frappe.new_doc("Sheet")
	dup.title = _clean_title(f"{src.title} (copy)")
	dup.sheets_data = src.sheets_data
	dup.insert()
	return dup.name


# ── internal helpers ──────────────────────────────────────────────────────────


def _user_identity(user: str) -> dict:
	"""Return full_name, initials, and user_image for the given user."""
	full_name = frappe.db.get_value("User", user, "full_name") or user
	user_image = frappe.db.get_value("User", user, "user_image") or ""
	parts = full_name.split()
	initials = (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper()
	return {"full_name": full_name, "initials": initials, "user_image": user_image}


def _validate_payload(title: str, sheets_data: str) -> None:
	if not isinstance(sheets_data, str):
		frappe.throw("sheets_data must be a JSON string")
	if len(sheets_data.encode("utf-8")) > MAX_SHEETS_DATA_BYTES:
		frappe.throw(
			f"Sheet exceeds the {MAX_SHEETS_DATA_BYTES // (1024 * 1024)} MB limit"
		)
	try:
		json.loads(sheets_data)
	except (ValueError, TypeError):
		frappe.throw("sheets_data is not valid JSON")


def _clean_title(title: str) -> str:
	title = (title or "").strip() or "Untitled Spreadsheet"
	if len(title) > MAX_TITLE_LEN:
		title = title[:MAX_TITLE_LEN]
	return title
