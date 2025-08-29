# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe , json
from frappe.model.document import Document


class ItemGroupRateMaster(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		amended_from: DF.Link | None
		customer_master: DF.Link
		item_group_master: DF.Link
		price_master: DF.Currency
	# end: auto-generated types

@frappe.whitelist()
def update_item_prices_from_group_rate(docname):
    doc = frappe.get_doc("Item Group Rate Master", docname)
    item_group = doc.item_group_master
    customer = doc.customer_master
    rate = doc.price_master
    price_list = "Standard Selling"  # or use a custom one

    items = frappe.get_all("Item", filters={"item_group": item_group}, fields=["name"])
    for item in items:
        existing = frappe.get_all("Item Price", filters={
            "item_code": item.name,
            "price_list": price_list,
            "customer": customer
        })
        
        if existing:
            item_price_doc = frappe.get_doc("Item Price", existing[0].name)
            old_price_rate = item_price_doc.price_list_rate
            changed_price_json = {
             "price_list_rate": {
           		 "old": old_price_rate,
            	 "new": rate
        	}
			}
            frappe.db.set_value("Item Price", existing[0].name, "price_list_rate", rate) 
            create_version_log("Item Price",existing[0].name,changed_price_json)
            frappe.db.commit()
        else:
            item_price_doc=frappe.get_doc({
                "doctype": "Item Price",
                "item_code": item.name,
                "price_list": price_list,
                "price_list_rate": rate,
                "customer": customer
            })
            item_price_doc.insert()
            frappe.db.commit()
@frappe.whitelist()
def apply_rate_change_to_group(item_group, rate_delta):
    rate_delta = float(rate_delta)
    rate_masters = frappe.get_all("Item Group Rate Master", 
        filters={"item_group_master": item_group},
        fields=["name", "price_master"]
    )

    for entry in rate_masters:
        old_rate = float(entry.price_master)
        new_rate = float(entry.price_master) + rate_delta
        changed_json = {
             "price_master": {
            "old": old_rate,
            "new": new_rate
        }
		}
        frappe.db.set_value("Item Group Rate Master", entry.name, "price_master", new_rate)
        create_version_log("Item Group Rate Master",entry.name,changed_json)
        frappe.db.commit()
        update_item_prices_from_group_rate(entry.name)

def create_version_log(ref_doctype, ref_name, data):
    version_doc = frappe.new_doc("Version")
    version_doc.ref_doctype = ref_doctype
    version_doc.docname = ref_name
    version_doc.data = json.dumps({
        "changed": [[field, data[field]["old"], data[field]["new"]] for field in data]
    })
    version_doc.save(ignore_permissions=True)
    frappe.db.commit()