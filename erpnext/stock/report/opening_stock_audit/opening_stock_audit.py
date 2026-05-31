from collections import OrderedDict
from frappe import _
import frappe
import json


def execute(filters=None):
    columns = get_columns()
    data    = get_data(filters)
    return columns, data


# ── COLUMNS ───────────────────────────────────────────────────────────────────

def get_columns():
    return [
        {
            "label": _("Item Code"), "fieldname": "item_code",
            "fieldtype": "Link", "options": "Item", "width": 180,
        },
        {
            "label": _("Item Group"), "fieldname": "item_group",
            "fieldtype": "Data", "width": 150,
        },
        {
            "label": _("Stock Entry"), "fieldname": "stock_entry",
            "fieldtype": "Link", "options": "Stock Entry", "width": 180,
        },
        {
            "label": _("Date"), "fieldname": "posting_date",
            "fieldtype": "Date", "width": 100,
        },
        {
            "label": _("Qty (Kgs)"), "fieldname": "qty",
            "fieldtype": "Float", "width": 120, "precision": 3,
        },
        {
            "label": _("Warehouse"), "fieldname": "warehouse",
            "fieldtype": "Link", "options": "Warehouse", "width": 220,
        },
    ]


# ── DATA ──────────────────────────────────────────────────────────────────────

def get_data(filters):
    conditions = ["se.docstatus = 1"]
    values     = {}

    if filters.get("company"):
        conditions.append("se.company = %(company)s")
        values["company"] = filters["company"]

    if filters.get("from_date"):
        conditions.append("se.posting_date >= %(from_date)s")
        values["from_date"] = filters["from_date"]

    if filters.get("to_date"):
        conditions.append("se.posting_date <= %(to_date)s")
        values["to_date"] = filters["to_date"]

    if filters.get("stock_entry_type"):
        conditions.append("se.stock_entry_type = %(stock_entry_type)s")
        values["stock_entry_type"] = filters["stock_entry_type"]

    where = "WHERE " + " AND ".join(conditions)

    rows = frappe.db.sql(
        f"""
        SELECT
            sed.item_code                           AS item_code,
            item.item_group                         AS item_group,
            sed.parent                              AS stock_entry,
            se.posting_date                         AS posting_date,
            sed.qty                                 AS qty,
            COALESCE(sed.t_warehouse, sed.s_warehouse) AS warehouse
        FROM `tabStock Entry Detail` sed
        JOIN `tabStock Entry`  se   ON se.name   = sed.parent
        JOIN `tabItem`         item ON item.name  = sed.item_code
        {where}
        ORDER BY item.item_group, sed.item_code, se.posting_date, se.name
        """,
        values,
        as_dict=True,
    )

    return _build_grouped_rows(rows)


def _build_grouped_rows(raw_data):
    # ── Pass 1: group entries by item_code ────────────────────────────────────
    items = OrderedDict()   # {item_code: {"item_group": str, "entries": [...]}}

    for row in raw_data:
        code = row.item_code or ""
        if code not in items:
            items[code] = {"item_group": row.item_group or "", "entries": []}
        items[code]["entries"].append({
            "stock_entry":  row.stock_entry,
            "posting_date": row.posting_date,
            "qty":          round(float(row.qty or 0), 3),
            "warehouse":    row.warehouse or "",
        })

    # ── Pass 2: build display rows ────────────────────────────────────────────
    result      = []
    grand_qty   = 0.0
    grand_count = 0

    for code, info in items.items():
        entries     = info["entries"]
        entry_count = len(entries)
        total_qty   = round(sum(e["qty"] for e in entries), 3)

        # Group header row — item_code acts as the clickable link
        result.append({
            "item_code":    code,
            "item_group":   info["item_group"],
            "stock_entry":  "",
            "posting_date": None,
            "qty":          None,
            "warehouse":    "",
            "bold":         1,
            "row_type":     "group_header",
            "entry_count":  entry_count,
        })

        # Individual stock entry lines (sub-rows for drill-down)
        for entry in entries:
            result.append({
                "item_code":    "",
                "item_group":   "",
                "stock_entry":  entry["stock_entry"],
                "posting_date": entry["posting_date"],
                "qty":          entry["qty"],
                "warehouse":    entry["warehouse"],
                "row_type":     "data",
                "entry_count":  entry_count,
            })

        # Subtotal per item_code
        result.append({
            "item_code":    "",
            "item_group":   "",
            "stock_entry":  f"{'⚠ Multiple entries — ' if entry_count > 1 else ''}{entry_count} {'entry' if entry_count == 1 else 'entries'}",
            "posting_date": None,
            "qty":          total_qty,
            "warehouse":    "",
            "bold":         1,
            "row_type":     "subtotal",
            "entry_count":  entry_count,
        })

        grand_qty   += total_qty
        grand_count += entry_count

    # Grand Total
    result.append({
        "item_code":    "Grand Total",
        "item_group":   f"{len(items)} item(s)  |  {grand_count} entries",
        "stock_entry":  "",
        "posting_date": None,
        "qty":          round(grand_qty, 3),
        "warehouse":    "",
        "bold":         1,
        "row_type":     "grand_total",
    })

    return result


# ── PDF / Print ────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_print_html(filters):
    if isinstance(filters, str):
        filters = json.loads(filters)
    _, data = execute(filters)
    return _render_html(filters, data)


def _render_html(filters, data):
    from datetime import datetime

    company    = filters.get("company", "")
    from_date  = str(filters.get("from_date", ""))
    to_date    = str(filters.get("to_date", ""))

    def fmt(d):
        try:
            return datetime.strptime(d, "%Y-%m-%d").strftime("%d-%m-%Y")
        except Exception:
            return d

    date_range = f"{fmt(from_date)} to {fmt(to_date)}" if from_date != to_date else fmt(from_date)
    rows_html  = _build_table_rows(data)

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Opening Stock Audit – {company}</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

  @page {{
    size: A4 portrait;
    margin: 14mm 12mm 16mm 12mm;
  }}

  body {{
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10pt;
    color: #111;
    background: #fff;
  }}

  /* ── Header ── */
  .doc-header {{
    text-align: center;
    padding-bottom: 6px;
    border-bottom: 2px solid #222;
    margin-bottom: 6px;
  }}
  .doc-header .company-name {{
    font-size: 16pt;
    font-weight: bold;
    letter-spacing: 3px;
    text-transform: uppercase;
  }}
  .doc-header .report-title {{
    font-size: 11pt;
    margin-top: 2px;
    color: #333;
  }}

  /* ── Table ── */
  table {{
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }}

  col.c-code  {{ width: 17%; }}
  col.c-grp   {{ width: 14%; }}
  col.c-se    {{ width: 19%; }}
  col.c-date  {{ width: 11%; }}
  col.c-qty   {{ width: 13%; }}
  col.c-wh    {{ width: 26%; }}

  thead th {{
    background: #1a3a6a;
    color: #fff;
    border: 1px solid #2a4a8a;
    padding: 5px 6px;
    font-size: 10pt;
    font-weight: bold;
    text-align: left;
  }}
  thead th.r {{ text-align: right; }}

  tbody td {{
    border: 1px solid #ccc;
    padding: 3px 6px;
    font-size: 10pt;
    vertical-align: middle;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }}
  tbody td.r {{ text-align: right; }}

  /* ── Single entry group header — green ── */
  tr.grp-ok td {{
    background: #d1fae5;
    border: 1.5px solid #6ee7b7;
    font-weight: bold;
    font-size: 10.5pt;
    color: #064e3b;
    padding: 4px 6px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }}

  /* ── Multi entry group header — orange warning ── */
  tr.grp-warn td {{
    background: #fef3c7;
    border: 1.5px solid #fbbf24;
    font-weight: bold;
    font-size: 10.5pt;
    color: #92400e;
    padding: 4px 6px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }}
  tr.grp-warn td.badge-cell::after {{
    content: "⚠ " attr(data-count) " entries";
    display: inline-block;
    background: #fbbf24;
    color: #7c2d12;
    border-radius: 8px;
    font-size: 8pt;
    font-weight: 700;
    padding: 1px 7px;
    margin-left: 8px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }}

  /* ── Data rows ── */
  tr.data-ok td {{
    background: #f0fdf4;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }}
  tr.data-warn td {{
    background: #fffbeb;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }}

  /* ── Subtotal ── */
  tr.subtotal-ok td {{
    background: #dcfce7;
    border-top: 2px solid #4ade80;
    border-bottom: 2px solid #4ade80;
    font-weight: bold;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }}
  tr.subtotal-warn td {{
    background: #fde68a;
    border-top: 2px solid #f59e0b;
    border-bottom: 2px solid #f59e0b;
    font-weight: bold;
    color: #92400e;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }}

  /* ── Grand total ── */
  tr.grand-total td {{
    background: #1a3a6a;
    color: #fff;
    border: 2px solid #1a3a6a;
    font-weight: bold;
    font-size: 11pt;
    padding: 5px 6px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }}

  /* ── Print tweaks ── */
  @media print {{
    thead {{ display: table-header-group; }}
    tr.grp-ok, tr.grp-warn {{ page-break-after: avoid; }}
    tr.subtotal-ok, tr.subtotal-warn {{ page-break-before: avoid; }}
    .no-print {{ display: none; }}
  }}

  .print-btn-bar {{ text-align: right; margin-bottom: 8px; }}
  .print-btn {{
    padding: 7px 20px;
    background: #1a73e8;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 10pt;
    cursor: pointer;
  }}
  .print-btn:hover {{ background: #1558b0; }}
</style>
</head>
<body>

<div class="print-btn-bar no-print">
  <button class="print-btn" onclick="window.print()">&#128438; Print / Save as PDF</button>
</div>

<div class="doc-header">
  <div class="company-name">{company}</div>
  <div class="report-title">Opening Stock Audit &nbsp;—&nbsp; {date_range}</div>
</div>

<table>
  <colgroup>
    <col class="c-code">
    <col class="c-grp">
    <col class="c-se">
    <col class="c-date">
    <col class="c-qty">
    <col class="c-wh">
  </colgroup>
  <thead>
    <tr>
      <th>ITEM CODE</th>
      <th>ITEM GROUP</th>
      <th>STOCK ENTRY</th>
      <th>DATE</th>
      <th class="r">QTY (KGS)</th>
      <th>WAREHOUSE</th>
    </tr>
  </thead>
  <tbody>
    {rows_html}
  </tbody>
</table>

</body>
</html>"""


def _build_table_rows(data):
    from datetime import datetime

    def fdate(d):
        if not d:
            return ""
        try:
            return datetime.strptime(str(d), "%Y-%m-%d").strftime("%d-%m-%Y")
        except Exception:
            return str(d)

    html = ""
    for row in data:
        rtype = row.get("row_type", "data")
        multi = (row.get("entry_count") or 1) > 1

        if rtype == "group_header":
            tr_cls = "grp-warn" if multi else "grp-ok"
            badge  = (f'<span style="background:#f59e0b;color:#7c2d12;border-radius:8px;'
                      f'font-size:8pt;font-weight:700;padding:1px 7px;margin-left:8px;'
                      f'-webkit-print-color-adjust:exact;print-color-adjust:exact;">'
                      f'⚠ {row["entry_count"]} entries</span>') if multi else ""
            html += (
                f'<tr class="{tr_cls}">'
                f'<td><strong>{row.get("item_code","")}</strong></td>'
                f'<td>{row.get("item_group","")}{badge}</td>'
                f'<td></td><td></td><td></td><td></td>'
                f'</tr>\n'
            )

        elif rtype == "data":
            tr_cls = "data-warn" if multi else "data-ok"
            qty    = f'{row.get("qty",0):.3f}' if row.get("qty") is not None else ""
            html += (
                f'<tr class="{tr_cls}">'
                f'<td></td>'
                f'<td></td>'
                f'<td>{row.get("stock_entry","")}</td>'
                f'<td>{fdate(row.get("posting_date"))}</td>'
                f'<td class="r"><strong>{qty}</strong></td>'
                f'<td>{row.get("warehouse","")}</td>'
                f'</tr>\n'
            )

        elif rtype == "subtotal":
            tr_cls = "subtotal-warn" if multi else "subtotal-ok"
            qty    = f'{row.get("qty",0):.3f}' if row.get("qty") is not None else ""
            label  = row.get("stock_entry", "")
            html += (
                f'<tr class="{tr_cls}">'
                f'<td colspan="3" style="text-align:right;padding-right:8px">{label}</td>'
                f'<td></td>'
                f'<td class="r">{qty}</td>'
                f'<td></td>'
                f'</tr>\n'
            )

        elif rtype == "grand_total":
            qty = f'{row.get("qty",0):.3f}' if row.get("qty") is not None else ""
            html += (
                f'<tr class="grand-total">'
                f'<td><strong>{row.get("item_code","")}</strong></td>'
                f'<td colspan="3">{row.get("item_group","")}</td>'
                f'<td class="r"><strong>{qty}</strong></td>'
                f'<td></td>'
                f'</tr>\n'
            )

    return html
