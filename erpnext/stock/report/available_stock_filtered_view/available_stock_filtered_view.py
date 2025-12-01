from frappe import _
import frappe


def execute(filters=None):
    columns = get_columns()
    data = get_data(filters)
    return columns, data


def get_columns():
    return [
        {"label": _("Item"), "fieldname": "item_name",
         "fieldtype": "Data", "width": 300},
        {"label": _("Size"), "fieldname": "size",
         "fieldtype": "Data", "width": 180},
        {"label": _("Weight/Unit"), "fieldname": "actual_qty",
         "fieldtype": "Float", "width": 180},
        {"label": _("Supplier"), "fieldname": "supplier_name",
         "fieldtype": "Link", "options": "Supplier", "width": 300},
        {"label": _("Purchase Date"), "fieldname": "posting_date",
         "fieldtype": "Data",  "width": 200},
        {"label": _("Item ID"), "fieldname": "item_id",
         "fieldtype": "Data",  "width": 200}
    ]


def get_data(filters):
    conditions = []
    values = {}

    if filters.get("company"):
        conditions.append("sle.company = %(company)s")
        values["company"] = filters["company"]

    if filters.get("item_name"):
        conditions.append("item.item_name LIKE %(item_name)s")
        values["item_name"] = f"%{filters['item_name']}%"

    if filters.get("size"):
        conditions.append("item.size LIKE %(size)s")
        values["size"] = f"%{filters['size']}%"

    if filters.get("qty"):
        conditions.append("1=1")  # no row-level filter
        having_clause = "HAVING SUM(sle.actual_qty) LIKE %(qty)s"
        values["qty"] = f"{filters['qty']}%"
    else:
        having_clause = "HAVING SUM(sle.actual_qty) > 0"

    query = f"""
        SELECT 
            sle.item_id,
            item.item_name,
            SUM(sle.actual_qty) AS actual_qty,
            item.size,
			sle.posting_date,
   			pr.supplier AS supplier_name
		   
        FROM `tabStock Ledger Entry` sle
        JOIN `tabItem` item ON sle.item_code = item.name
        LEFT JOIN `tabPurchase Receipt` pr 
        ON pr.name = sle.voucher_no AND sle.voucher_type = 'Purchase Receipt'
        WHERE 
        sle.display_stock != 1
         and sle.is_cancelled = 0
        AND sle.docstatus = 1
        {"AND " + " AND ".join(conditions) if conditions else ""}
        
        group by sle.item_id,item.item_code
        {having_clause}
        ORDER BY sle.posting_date DESC, sle.posting_time DESC
          
    """
    return frappe.db.sql(query, values, as_dict=True)
