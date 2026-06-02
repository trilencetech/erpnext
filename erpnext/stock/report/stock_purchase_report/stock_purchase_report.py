from frappe import _
import frappe
import json


def execute(filters=None):
    columns = get_columns()
    data    = get_data(filters)
    return columns, data


# ── COLUMNS — summary view (one row per item) ─────────────────────────────────

def get_columns():
    return [
        {
            "label": _("Item Code"),        "fieldname": "item_code",
            "fieldtype": "Data",            "width": 220,
        },
        {
            "label": _("Item Group"),       "fieldname": "item_group",
            "fieldtype": "Data",            "width": 160,
        },
        {
            "label": _("No. of Receipts"),  "fieldname": "receipt_count",
            "fieldtype": "Int",             "width": 130,
        },
        {
            "label": _("Total Qty (Kgs)"),  "fieldname": "total_qty",
            "fieldtype": "Float",           "width": 150, "precision": 3,
        },
        {
            "label": _("Total Amount (₹)"), "fieldname": "total_amount",
            "fieldtype": "Currency",        "width": 160,
        },
    ]


# ── SUMMARY DATA ──────────────────────────────────────────────────────────────

def get_data(filters):
    conditions = ["pr.docstatus = 1"]
    values     = {}

    if filters.get("company"):
        conditions.append("pr.company = %(company)s")
        values["company"] = filters["company"]

    if filters.get("from_date"):
        conditions.append("pr.posting_date >= %(from_date)s")
        values["from_date"] = filters["from_date"]

    if filters.get("to_date"):
        conditions.append("pr.posting_date <= %(to_date)s")
        values["to_date"] = filters["to_date"]

    if filters.get("supplier"):
        conditions.append("pr.supplier = %(supplier)s")
        values["supplier"] = filters["supplier"]

    if filters.get("item_group"):
        conditions.append("item.item_group = %(item_group)s")
        values["item_group"] = filters["item_group"]

    if filters.get("item_code"):
        conditions.append("pri.item_code = %(item_code)s")
        values["item_code"] = filters["item_code"]

    where = "WHERE " + " AND ".join(conditions)

    rows = frappe.db.sql(
        f"""
        SELECT
            pri.item_code                   AS item_code,
            item.item_group                 AS item_group,
            COUNT(DISTINCT pri.parent)      AS receipt_count,
            SUM(pri.qty)                    AS total_qty,
            SUM(pri.amount)                 AS total_amount
        FROM `tabPurchase Receipt Item` pri
        JOIN `tabPurchase Receipt` pr   ON pr.name   = pri.parent
        JOIN `tabItem`             item ON item.name  = pri.item_code
        {where}
        GROUP BY pri.item_code, item.item_group
        ORDER BY item.item_group, pri.item_code
        """,
        values,
        as_dict=True,
    )

    result    = []
    grand_qty = 0.0
    grand_amt = 0.0

    for row in rows:
        qty = round(float(row.total_qty    or 0), 3)
        amt = round(float(row.total_amount or 0), 2)
        result.append({
            "item_code":     row.item_code,
            "item_group":    row.item_group or "",
            "receipt_count": int(row.receipt_count or 0),
            "total_qty":     qty,
            "total_amount":  amt,
            "row_type":      "data",
        })
        grand_qty += qty
        grand_amt += amt

    if result:
        result.append({
            "item_code":     f"Grand Total  ({len(rows)} items)",
            "item_group":    "",
            "receipt_count": sum(r["receipt_count"] for r in result),
            "total_qty":     round(grand_qty, 3),
            "total_amount":  round(grand_amt, 2),
            "row_type":      "grand_total",
            "bold":          1,
        })

    return result


# ── DRILL-DOWN API ────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_item_purchases(item_code, filters):
    if isinstance(filters, str):
        filters = json.loads(filters)

    conditions = ["pr.docstatus = 1", "pri.item_code = %(item_code)s"]
    values     = {"item_code": item_code}

    if filters.get("company"):
        conditions.append("pr.company = %(company)s")
        values["company"] = filters["company"]

    if filters.get("from_date"):
        conditions.append("pr.posting_date >= %(from_date)s")
        values["from_date"] = filters["from_date"]

    if filters.get("to_date"):
        conditions.append("pr.posting_date <= %(to_date)s")
        values["to_date"] = filters["to_date"]

    if filters.get("supplier"):
        conditions.append("pr.supplier = %(supplier)s")
        values["supplier"] = filters["supplier"]

    rows = frappe.db.sql(
        f"""
        SELECT
            pri.parent          AS purchase_receipt,
            pr.supplier_name    AS supplier,
            pr.posting_date     AS posting_date,
            pri.qty             AS qty,
            pri.rate            AS rate,
            pri.amount          AS amount
        FROM `tabPurchase Receipt Item` pri
        JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
        WHERE {" AND ".join(conditions)}
        ORDER BY pr.posting_date, pr.name
        """,
        values,
        as_dict=True,
    )

    result = []
    for r in rows:
        result.append({
            "purchase_receipt": r.purchase_receipt,
            "supplier":         r.supplier or "",
            "posting_date":     str(r.posting_date) if r.posting_date else "",
            "qty":              round(float(r.qty    or 0), 3),
            "rate":             round(float(r.rate   or 0), 2),
            "amount":           round(float(r.amount or 0), 2),
        })

    return result


# ── PDF / Print — summary page ────────────────────────────────────────────────

@frappe.whitelist()
def get_print_html(filters):
    if isinstance(filters, str):
        filters = json.loads(filters)
    _, data = execute(filters)
    return _render_html(filters, data)


def _render_html(filters, data):
    from datetime import datetime

    company   = filters.get("company", "")
    from_date = str(filters.get("from_date", ""))
    to_date   = str(filters.get("to_date", ""))

    def fmt(d):
        try:
            return datetime.strptime(d, "%Y-%m-%d").strftime("%d-%m-%Y")
        except Exception:
            return d

    date_range = f"{fmt(from_date)} to {fmt(to_date)}" if from_date != to_date else fmt(from_date)
    rows_html  = _pdf_rows(data)

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Stock Purchase Report – {company}</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
  @page {{ size: A4 portrait; margin: 14mm 12mm 16mm 12mm; }}
  body {{ font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #111; background: #fff; }}

  .doc-header {{ text-align: center; padding-bottom: 6px; border-bottom: 2px solid #1a3a6a; margin-bottom: 8px; }}
  .doc-header .company-name {{ font-size: 17pt; font-weight: bold; letter-spacing: 3px; text-transform: uppercase; color: #1a3a6a; }}
  .doc-header .report-title {{ font-size: 11pt; margin-top: 2px; color: #444; }}

  table {{ width: 100%; border-collapse: collapse; table-layout: fixed; }}
  col.c-code  {{ width: 22%; }}
  col.c-grp   {{ width: 18%; }}
  col.c-cnt   {{ width: 14%; }}
  col.c-qty   {{ width: 20%; }}
  col.c-amt   {{ width: 26%; }}

  thead th {{
    background: #1a3a6a; color: #fff; border: 1px solid #2a5298;
    padding: 5px 7px; font-size: 10pt; font-weight: bold;
    text-align: left;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }}
  thead th.r {{ text-align: right; }}

  tbody td {{
    border: 1px solid #cbd5e1; padding: 3.5px 7px; font-size: 10pt; vertical-align: middle;
  }}
  tbody td.r {{ text-align: right; }}

  tr.data-row:nth-child(even) td {{ background: #f0f6ff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}

  tr.grand-total td {{
    background: #1e3a8a; color: #fff; border: 2px solid #1e3a8a;
    font-weight: bold; font-size: 11pt; padding: 5px 7px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }}

  .print-btn-bar {{ text-align: right; margin-bottom: 8px; }}
  .print-btn {{ padding: 7px 20px; background: #1a73e8; color: #fff; border: none; border-radius: 4px; font-size: 10pt; cursor: pointer; }}

  @media print {{ .no-print {{ display: none; }} }}
</style>
</head>
<body>
<div class="print-btn-bar no-print">
  <button class="print-btn" onclick="window.print()">&#128438; Print / Save as PDF</button>
</div>
<div class="doc-header">
  <div class="company-name">{company}</div>
  <div class="report-title">Stock Purchase Report &nbsp;—&nbsp; {date_range}</div>
</div>
<table>
  <colgroup>
    <col class="c-code"><col class="c-grp"><col class="c-cnt">
    <col class="c-qty"><col class="c-amt">
  </colgroup>
  <thead>
    <tr>
      <th>ITEM CODE</th><th>ITEM GROUP</th>
      <th class="r">RECEIPTS</th><th class="r">TOTAL QTY (KGS)</th>
      <th class="r">TOTAL AMOUNT (₹)</th>
    </tr>
  </thead>
  <tbody>{rows_html}</tbody>
</table>
</body></html>"""


def _pdf_rows(data):
    html = ""
    for row in data:
        rtype = row.get("row_type", "data")
        if rtype == "data":
            html += (
                f'<tr class="data-row">'
                f'<td>{row.get("item_code","")}</td>'
                f'<td>{row.get("item_group","")}</td>'
                f'<td class="r">{row.get("receipt_count","")}</td>'
                f'<td class="r"><strong>{row.get("total_qty",0):.3f}</strong></td>'
                f'<td class="r">{row.get("total_amount",0):,.2f}</td>'
                f'</tr>\n'
            )
        elif rtype == "grand_total":
            html += (
                f'<tr class="grand-total">'
                f'<td><strong>{row.get("item_code","")}</strong></td>'
                f'<td></td>'
                f'<td class="r"><strong>{row.get("receipt_count","")}</strong></td>'
                f'<td class="r"><strong>{row.get("total_qty",0):.3f}</strong></td>'
                f'<td class="r"><strong>{row.get("total_amount",0):,.2f}</strong></td>'
                f'</tr>\n'
            )
    return html
