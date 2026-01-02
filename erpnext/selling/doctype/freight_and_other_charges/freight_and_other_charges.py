# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document


class FreightandOtherCharges(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		amended_from: DF.Link | None
		amount: DF.Currency
		charges_type: DF.Literal["Freight", "Rent for Purchase", "Other"]
		company: DF.Link
		date: DF.Date
		delivery_note: DF.Link | None
		description: DF.Data
		name: DF.Int | None
		paid_status: DF.Literal["UnPaid", "Paid"]
		purchase_invoice: DF.Link | None
	# end: auto-generated types
	pass
