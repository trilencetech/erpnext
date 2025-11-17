# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class MasterItemCodeFromThickness(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		film_type: DF.Data
		name: DF.Int | None
		prefix: DF.Data
		thick: DF.Int
	# end: auto-generated types
	pass
