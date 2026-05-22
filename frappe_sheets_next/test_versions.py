"""Integration tests for the version-history API.

Covers list/get/restore/name + cell_history + retention pruning against a
real Sheet doc + Frappe Version records.  Each test inserts a fresh doc,
mutates it through the save flow (so Frappe writes Version rows), then
exercises the public versions.py endpoints.
"""

import json
from contextlib import contextmanager

import frappe
from frappe.tests import IntegrationTestCase

from frappe_sheets_next import versions

EXTRA_TEST_RECORD_DEPENDENCIES = []
IGNORE_TEST_RECORD_DEPENDENCIES = []


def _data(cells_by_sheet: dict) -> str:
	"""Build the sheets_data JSON in the production shape — see
	usePersistence.js _persist().  Tests need to match prod or the cell-
	history diff (versions.py:_cell_in_blob) won't find the cells.
	"""
	first = next(iter(cells_by_sheet)) if cells_by_sheet else "Sheet1"
	return json.dumps({
		"sheet": {"sheets": cells_by_sheet, "current": first},
	})


@contextmanager
def _track_versions():
	"""Frappe tests default to ignore_version=True (see document.py:695).
	Production saves track versions automatically; tests must opt-in.  This
	flips the flag for the duration of a `with` block so doc.save() inside
	calls from versions.py (e.g. restore_version) also create Version rows.
	"""
	prev = frappe.in_test
	frappe.in_test = False
	try:
		yield
	finally:
		frappe.in_test = prev


class IntegrationTestVersionsAPI(IntegrationTestCase):
	def setUp(self):
		# Fresh doc per test — guarantees a stable version stream.
		self.doc = frappe.new_doc("Sheet")
		self.doc.title = "Version test"
		self.doc.sheets_data = _data({"Sheet1": {"A1": "first"}})
		self.doc.insert()

	def tearDown(self):
		# Drop any Sheet Version Name rows + Version rows we created so tests
		# don't bleed into each other on the global Version table.
		frappe.db.delete("Sheet Version Name", {"sheet": self.doc.name})
		frappe.db.delete("Version",
		                 {"ref_doctype": "Sheet", "docname": self.doc.name})
		try:
			frappe.delete_doc("Sheet", self.doc.name, force=True)
		except frappe.DoesNotExistError:
			pass

	# ── list_versions ─────────────────────────────────────────────────────

	def test_list_versions_returns_newest_first(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "second"}}); self.doc.save(ignore_version=False)
		self.doc.sheets_data = _data({"Sheet1": {"A1": "third"}});  self.doc.save(ignore_version=False)

		rows = versions.list_versions(self.doc.name)
		self.assertGreaterEqual(len(rows), 2)
		# Newest first — creation timestamps strictly descending.
		for a, b in zip(rows, rows[1:]):
			self.assertGreaterEqual(a["timestamp"], b["timestamp"])

	def test_list_versions_includes_touched_fields(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "x"}}); self.doc.save(ignore_version=False)
		rows = versions.list_versions(self.doc.name)
		self.assertTrue(any("sheets_data" in r["touched_fields"] for r in rows))
		self.assertTrue(any(r["has_data_change"] for r in rows))

	# ── name_version ──────────────────────────────────────────────────────

	def test_name_version_pins_a_name(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "x"}}); self.doc.save(ignore_version=False)
		rows = versions.list_versions(self.doc.name)
		target = rows[0]["name"]

		versions.name_version(self.doc.name, target, "Before launch")
		refreshed = versions.list_versions(self.doc.name)
		named = next(r for r in refreshed if r["name"] == target)
		self.assertEqual(named["version_name"], "Before launch")

	def test_name_version_is_idempotent(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "x"}}); self.doc.save(ignore_version=False)
		target = versions.list_versions(self.doc.name)[0]["name"]

		versions.name_version(self.doc.name, target, "First name")
		versions.name_version(self.doc.name, target, "Second name")
		rows = versions.list_versions(self.doc.name)
		named = next(r for r in rows if r["name"] == target)
		self.assertEqual(named["version_name"], "Second name")

	def test_name_version_rejects_blank(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "x"}}); self.doc.save(ignore_version=False)
		target = versions.list_versions(self.doc.name)[0]["name"]
		with self.assertRaises(frappe.exceptions.ValidationError):
			versions.name_version(self.doc.name, target, "   ")

	# ── clear_version_name ────────────────────────────────────────────────

	def test_clear_version_name_unpins(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "x"}}); self.doc.save(ignore_version=False)
		target = versions.list_versions(self.doc.name)[0]["name"]
		versions.name_version(self.doc.name, target, "Pinned")
		versions.clear_version_name(self.doc.name, target)
		rows = versions.list_versions(self.doc.name)
		named = next(r for r in rows if r["name"] == target)
		self.assertIsNone(named["version_name"])

	# ── get_version_state ─────────────────────────────────────────────────

	def test_get_version_state_returns_data_at_that_version(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "v2"}}); self.doc.save(ignore_version=False)
		mid = versions.list_versions(self.doc.name)[0]["name"]
		self.doc.sheets_data = _data({"Sheet1": {"A1": "v3"}}); self.doc.save(ignore_version=False)

		state = versions.get_version_state(self.doc.name, mid)
		parsed = json.loads(state["sheets_data"])
		self.assertEqual(parsed["sheet"]["sheets"]["Sheet1"]["A1"], "v2")

	# ── restore_version ───────────────────────────────────────────────────

	def test_restore_version_creates_new_version(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "v2"}}); self.doc.save(ignore_version=False)
		mid = versions.list_versions(self.doc.name)[0]["name"]
		self.doc.sheets_data = _data({"Sheet1": {"A1": "v3"}}); self.doc.save(ignore_version=False)
		count_before = len(versions.list_versions(self.doc.name))

		with _track_versions():
			versions.restore_version(self.doc.name, mid)
		count_after = len(versions.list_versions(self.doc.name))
		self.assertEqual(count_after, count_before + 1)

		live = frappe.get_doc("Sheet", self.doc.name)
		parsed = json.loads(live.sheets_data)
		self.assertEqual(parsed["sheet"]["sheets"]["Sheet1"]["A1"], "v2")

	def test_restore_does_not_delete_prior_versions(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "v2"}}); self.doc.save(ignore_version=False)
		self.doc.sheets_data = _data({"Sheet1": {"A1": "v3"}}); self.doc.save(ignore_version=False)
		rows_before = versions.list_versions(self.doc.name)
		mid = rows_before[1]["name"]

		with _track_versions():
			versions.restore_version(self.doc.name, mid)
		rows_after = versions.list_versions(self.doc.name)
		# Every prior row must still be present (history is append-only).
		for r in rows_before:
			self.assertTrue(any(rr["name"] == r["name"] for rr in rows_after))

	# ── cell_history ──────────────────────────────────────────────────────

	def test_cell_history_returns_value_changes_only(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "v2"}}); self.doc.save(ignore_version=False)
		self.doc.sheets_data = _data({"Sheet1": {"A1": "v3"}}); self.doc.save(ignore_version=False)
		hist = versions.cell_history(self.doc.name, "A1", sheet_name="Sheet1")
		afters = [h["after"] for h in hist]
		# Newest-first order — v3 then v2.
		self.assertEqual(afters[0], "v3")
		self.assertIn("v2", afters)

	def test_cell_history_excludes_versions_that_didnt_touch_cell(self):
		# Touch A1 only in one version; another version touches B1.
		self.doc.sheets_data = _data({"Sheet1": {"A1": "x"}}); self.doc.save(ignore_version=False)
		self.doc.sheets_data = _data({"Sheet1": {"A1": "x", "B1": "y"}}); self.doc.save(ignore_version=False)
		hist = versions.cell_history(self.doc.name, "A1", sheet_name="Sheet1")
		# Two entries for A1: initial '' → 'first' (insert wrote no version)
		# plus 'first' → 'x'.  The B1-only version must not appear.
		afters = [h["after"] for h in hist]
		self.assertIn("x", afters)
		self.assertNotIn("y", afters)

	# ── retention pruning ─────────────────────────────────────────────────

	def test_prune_keeps_named_versions(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "x"}}); self.doc.save(ignore_version=False)
		target = versions.list_versions(self.doc.name)[0]["name"]
		versions.name_version(self.doc.name, target, "Keep me")
		# Backdate the named version so it falls inside the prune window.
		frappe.db.set_value("Version", target, "creation",
		                    frappe.utils.add_days(frappe.utils.now_datetime(), -60))

		versions.prune_old_versions(retention_days=30)
		self.assertTrue(frappe.db.exists("Version", target))

	# ── Op Log integration ────────────────────────────────────────────────

	def _drop_op_logs(self):
		frappe.db.delete("Sheet Op Log", {"sheet": self.doc.name})

	def test_record_op_creates_log_entry(self):
		try:
			versions.record_op(
				sheet=self.doc.name,
				op_type="paste",
				cell_refs=["A1", "B1"],
				before={"A1": "old", "B1": "old"},
				after={"A1": "new", "B1": "new"},
				summary="Pasted 2 cells",
				sub_sheet="Sheet1",
			)
			rows = versions.list_ops(self.doc.name)
			self.assertEqual(len(rows), 1)
			self.assertEqual(rows[0]["op_type"], "paste")
			self.assertEqual(rows[0]["summary"], "Pasted 2 cells")
		finally:
			self._drop_op_logs()

	def test_record_op_rejects_unknown_type(self):
		with self.assertRaises(frappe.exceptions.ValidationError):
			versions.record_op(sheet=self.doc.name, op_type="not-a-type")

	def test_list_versions_labels_with_op_type(self):
		try:
			# Mutation + matching op recorded just before save.
			versions.record_op(
				sheet=self.doc.name,
				op_type="import",
				cell_refs=["A1"],
				before={"A1": "first"},
				after={"A1": "imported"},
				summary="Imported .xlsx file",
				sub_sheet="Sheet1",
			)
			self.doc.sheets_data = _data({"Sheet1": {"A1": "imported"}})
			self.doc.save(ignore_version=False)
			rows = versions.list_versions(self.doc.name)
			top = rows[0]
			self.assertEqual(top["primary_op"], "import")
			self.assertIn("Imported .xlsx file", top["op_labels"])
		finally:
			self._drop_op_logs()

	def test_cell_history_uses_op_log_when_available(self):
		try:
			# Op log entry tagged paste; doc save creates Version diff too.
			versions.record_op(
				sheet=self.doc.name,
				op_type="paste",
				cell_refs=["A1"],
				before={"A1": "first"},
				after={"A1": "pasted"},
				summary="Pasted 1 cell",
				sub_sheet="Sheet1",
			)
			self.doc.sheets_data = _data({"Sheet1": {"A1": "pasted"}})
			self.doc.save(ignore_version=False)
			hist = versions.cell_history(self.doc.name, "A1", sheet_name="Sheet1")
			# Dedupe should leave one entry, tagged op-log.
			pasted = [h for h in hist if h["after"] == "pasted"]
			self.assertEqual(len(pasted), 1)
			self.assertEqual(pasted[0]["source"], "op-log")
			self.assertEqual(pasted[0]["op_type"], "paste")
		finally:
			self._drop_op_logs()

	# ── cell_diff ─────────────────────────────────────────────────────────

	def test_cell_diff_lists_changed_cells(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "v1", "B1": "shared"}})
		self.doc.save(ignore_version=False)
		v1 = versions.list_versions(self.doc.name)[0]["name"]
		self.doc.sheets_data = _data({"Sheet1": {"A1": "v2", "B1": "shared"}})
		self.doc.save(ignore_version=False)
		v2 = versions.list_versions(self.doc.name)[0]["name"]

		diff = versions.cell_diff(self.doc.name, v2, against=v1)
		self.assertIn("Sheet1", diff["sheets"])
		self.assertIn("A1", diff["sheets"]["Sheet1"])
		self.assertNotIn("B1", diff["sheets"]["Sheet1"])
		self.assertEqual(diff["total_changed_cells"], 1)
		self.assertEqual(diff["total_changed_rows"], 1)

	def test_cell_diff_falls_back_to_previous_version(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "v1"}})
		self.doc.save(ignore_version=False)
		self.doc.sheets_data = _data({"Sheet1": {"A1": "v2"}})
		self.doc.save(ignore_version=False)
		latest = versions.list_versions(self.doc.name)[0]["name"]

		diff = versions.cell_diff(self.doc.name, latest)
		# Implicit `against` = predecessor.
		self.assertIn("A1", diff["sheets"]["Sheet1"])

	# ── make_a_copy ───────────────────────────────────────────────────────

	def test_make_a_copy_creates_independent_doc(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "snap"}})
		self.doc.save(ignore_version=False)
		target = versions.list_versions(self.doc.name)[0]["name"]

		copy_name = versions.make_a_copy(self.doc.name, target, title="Branch")
		try:
			copy = frappe.get_doc("Sheet", copy_name)
			parsed = json.loads(copy.sheets_data)
			self.assertEqual(parsed["sheet"]["sheets"]["Sheet1"]["A1"], "snap")
			self.assertEqual(copy.title, "Branch")
			# Mutating the original mustn't touch the copy.
			self.doc.sheets_data = _data({"Sheet1": {"A1": "after"}})
			self.doc.save(ignore_version=False)
			copy.reload()
			self.assertEqual(json.loads(copy.sheets_data)["sheet"]["sheets"]["Sheet1"]["A1"], "snap")
		finally:
			frappe.delete_doc("Sheet", copy_name, force=True)

	def test_restore_emits_restore_op_label(self):
		self.doc.sheets_data = _data({"Sheet1": {"A1": "v2"}}); self.doc.save(ignore_version=False)
		mid = versions.list_versions(self.doc.name)[0]["name"]
		self.doc.sheets_data = _data({"Sheet1": {"A1": "v3"}}); self.doc.save(ignore_version=False)
		try:
			with _track_versions():
				versions.restore_version(self.doc.name, mid)
			top = versions.list_versions(self.doc.name)[0]
			self.assertEqual(top["primary_op"], "restore")
		finally:
			self._drop_op_logs()
