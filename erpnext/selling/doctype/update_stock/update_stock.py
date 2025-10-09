# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class UpdateStock(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from erpnext.selling.doctype.update_stock_item.update_stock_item import UpdateStockItem
        from frappe.types import DF

        amended_from: DF.Link | None
        company: DF.Link
        customer: DF.Link
        items: DF.Table[UpdateStockItem]
        total_amount: DF.Currency
        total_qty: DF.Float
    # end: auto-generated types

    def on_submit(self):
        for row in self.items:
            # Find matching Stock Ledger Entry
            sle = frappe.db.get_all("Stock Ledger Entry", filters={
                "item_code": row.item_code,
                "actual_qty": row.qty,
                "company": self.company
            }, fields=["name"])

            for entry in sle:
                frappe.db.set_value("Stock Ledger Entry",
                                    entry.name, "display_stock", 1)

    def on_cancel(self):
        for row in self.items:
            sle = frappe.db.get_all("Stock Ledger Entry", filters={
                "item_code": row.item_code,
                "actual_qty": row.qty,
                "company": self.company
            }, fields=["name"])

            for entry in sle:
                frappe.db.set_value("Stock Ledger Entry",
                                    entry.name, "display_stock", 0)
