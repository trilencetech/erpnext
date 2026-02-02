import frappe
# customer_query.py


@frappe.whitelist()
def customer_query(doctype, txt, searchfield, start, page_len, filters):
    return frappe.db.sql("""
        SELECT c.name, c.customer_name
        FROM `tabCustomer` c
        JOIN `tabCustomer Company` cc ON cc.parent = c.name
        WHERE cc.company = %s AND c.name LIKE %s
    """, (filters.get("company"), "%" + txt + "%"))

# supplier_query.py


@frappe.whitelist()
def supplier_query(doctype, txt, searchfield, start, page_len, filters):
    return frappe.db.sql("""
        SELECT s.name, s.supplier_name
        FROM `tabSupplier` s
        JOIN `tabCustomer Company` sc ON sc.parent = s.name
        WHERE sc.company = %s AND s.name LIKE %s
    """, (filters.get("company"), "%" + txt + "%"))
