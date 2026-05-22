import frappe
from frappe.model.document import Document


class SheetVersionName(Document):
	# begin: auto-generated types
	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		sheet: DF.Link
		version: DF.Link
		version_name: DF.Data
	# end: auto-generated types

	def validate(self):
		name = (self.version_name or "").strip()
		if not name:
			frappe.throw("Version name is required")
		self.version_name = name[:120]
