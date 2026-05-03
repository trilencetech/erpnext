from frappe import _
import frappe
import json


def execute(filters=None):
    columns = get_columns()
    data = get_data(filters)
    return columns, data


def get_columns():
    return [
        {"label": _("Group Name"), "fieldname": "group_name", "fieldtype": "Data", "width": 180},
        {"label": _("Code"),       "fieldname": "code",       "fieldtype": "Data", "width": 130},
        {"label": _("Item Name"),  "fieldname": "item_name",  "fieldtype": "Data", "width": 400},
        {"label": _("NOS."),       "fieldname": "nos",        "fieldtype": "Int",  "width": 80},
        {"label": _("KGS."),       "fieldname": "kgs",        "fieldtype": "Float","width": 130},
    ]


def get_data(filters):
    inner_conditions = [
        "sle.display_stock != 1",
        "sle.is_cancelled = 0",
        "sle.docstatus = 1",
    ]
    values = {}

    if filters.get("company"):
        inner_conditions.append("sle.company = %(company)s")
        values["company"] = filters["company"]

    if filters.get("as_of_date"):
        inner_conditions.append("sle.posting_date <= %(as_of_date)s")
        values["as_of_date"] = filters["as_of_date"]

    if filters.get("item_group"):
        inner_conditions.append("item.item_group = %(item_group)s")
        values["item_group"] = filters["item_group"]

    if filters.get("item_name"):
        inner_conditions.append("item.item_name LIKE %(item_name)s")
        values["item_name"] = f"%{filters['item_name']}%"

    where_clause = "WHERE " + " AND ".join(inner_conditions)

    # Inner query: one row per roll (item_id) with positive net stock.
    # Outer query: COUNT(*) = NOS (rolls), SUM = KGS (weight).
    query = f"""
        SELECT
            item.item_group  AS group_name,
            rolls.item_code  AS code,
            item.item_name,
            COUNT(*)            AS nos,
            SUM(rolls.roll_qty) AS kgs
        FROM (
            SELECT
                sle.item_id,
                sle.item_code,
                SUM(sle.actual_qty) AS roll_qty
            FROM `tabStock Ledger Entry` sle
            JOIN `tabItem` item ON sle.item_code = item.name
            {where_clause}
            GROUP BY sle.item_id, sle.item_code
            HAVING SUM(sle.actual_qty) > 0
        ) AS rolls
        JOIN `tabItem` item ON rolls.item_code = item.name
        GROUP BY item.item_group, rolls.item_code
        ORDER BY item.item_group, rolls.item_code
    """

    raw_data = frappe.db.sql(query, values, as_dict=True)
    return _build_grouped_rows(raw_data)


def _build_grouped_rows(raw_data):
    result = []
    current_group = None
    group_nos = 0
    group_kgs = 0.0
    total_nos = 0
    total_kgs = 0.0

    for row in raw_data:
        if row.group_name != current_group:
            # Close previous group with subtotal + blank spacer
            if current_group is not None:
                result.append({
                    "group_name": "", "code": "", "item_name": "",
                    "nos": group_nos, "kgs": round(group_kgs, 3),
                    "bold": 1, "row_type": "subtotal",
                })
                result.append({
                    "group_name": "", "code": "", "item_name": "",
                    "nos": None, "kgs": None, "row_type": "spacer",
                })

            current_group = row.group_name
            group_nos = 0
            group_kgs = 0.0

            result.append({
                "group_name": row.group_name, "code": "", "item_name": "",
                "nos": None, "kgs": None,
                "bold": 1, "row_type": "group_header",
            })

        result.append({
            "group_name": "", "code": row.code,
            "item_name": row.item_name,
            "nos": row.nos or 0, "kgs": round(row.kgs or 0, 3),
            "row_type": "data",
        })

        group_nos += row.nos or 0
        group_kgs += row.kgs or 0
        total_nos += row.nos or 0
        total_kgs += row.kgs or 0

    # Last group subtotal
    if current_group is not None:
        result.append({
            "group_name": "", "code": "", "item_name": "",
            "nos": group_nos, "kgs": round(group_kgs, 3),
            "bold": 1, "row_type": "subtotal",
        })

    result.append({"group_name": "", "code": "", "item_name": "", "nos": None, "kgs": None, "row_type": "spacer"})
    result.append({
        "group_name": "Grand Total", "code": "", "item_name": "",
        "nos": total_nos, "kgs": round(total_kgs, 3),
        "bold": 1, "row_type": "grand_total",
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

    company = filters.get("company", "")
    as_of_date = str(filters.get("as_of_date", ""))
    try:
        date_display = datetime.strptime(as_of_date, "%Y-%m-%d").strftime("%d-%m-%Y")
    except Exception:
        date_display = as_of_date

    rows_html = _build_table_rows(data)

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Stock Statement – {company} – {date_display}</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

  @page {{
    size: A4 portrait;
    margin: 14mm 12mm 16mm 12mm;
  }}

  body {{
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8.5pt;
    color: #111;
    background: #fff;
  }}

  /* ── Page header (repeats via position:running in some engines; in browser
        it just sits at the top of the first page) ── */
  .doc-header {{
    text-align: center;
    padding-bottom: 6px;
    border-bottom: 2px solid #222;
    margin-bottom: 6px;
  }}
  .doc-header .company-name {{
    font-size: 15pt;
    font-weight: bold;
    letter-spacing: 3px;
    text-transform: uppercase;
  }}
  .doc-header .report-title {{
    font-size: 9.5pt;
    margin-top: 2px;
    color: #333;
  }}

  /* ── Table ── */
  table {{
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }}

  /* column widths */
  col.c-group  {{ width: 14%; }}
  col.c-code   {{ width: 11%; }}
  col.c-name   {{ width: 49%; }}
  col.c-nos    {{ width:  9%; }}
  col.c-kgs    {{ width: 17%; }}

  thead th {{
    background: #e4e4e4;
    border: 1px solid #555;
    padding: 4px 5px;
    font-size: 8.5pt;
    font-weight: bold;
    text-align: left;
  }}
  thead th.r {{ text-align: right; }}

  /* generic cell */
  tbody td {{
    border-left:  1px solid #bbb;
    border-right: 1px solid #bbb;
    padding: 1.5px 5px;
    font-size: 8.5pt;
    vertical-align: middle;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }}
  tbody td.r {{ text-align: right; }}

  /* group header row */
  tr.grp-hdr td {{
    background: #d8e8f5;
    border-top:    1px solid #3a6ea5;
    border-bottom: 1px solid #3a6ea5;
    font-weight: bold;
    font-size: 8.5pt;
    padding: 3px 5px;
    color: #1a3a6a;
  }}

  /* subtotal row */
  tr.subtotal td {{
    border-top:    1.5px solid #555;
    border-bottom: 2px solid #555;
    font-weight: bold;
    background: #f5f5f5;
    padding: 2.5px 5px;
  }}

  /* spacer between groups */
  tr.spacer td {{
    border: none;
    height: 5px;
    background: transparent;
  }}

  /* grand total */
  tr.grand-total td {{
    background: #c8d8ee;
    border: 1.5px solid #1a3a6a;
    font-weight: bold;
    font-size: 9pt;
    padding: 4px 5px;
  }}

  /* ── Print tweaks ── */
  @media print {{
    thead {{ display: table-header-group; }}
    tr.grp-hdr  {{ page-break-after:  avoid; }}
    tr.subtotal {{ page-break-before: avoid; }}
    .no-print   {{ display: none; }}
  }}

  /* ── Screen-only print button ── */
  .print-btn-bar {{
    text-align: right;
    margin-bottom: 8px;
  }}
  .print-btn {{
    padding: 6px 18px;
    background: #1a73e8;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 9pt;
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
  <div class="report-title">Stock Statement &nbsp;as on&nbsp; {date_display}</div>
</div>

<table>
  <colgroup>
    <col class="c-group">
    <col class="c-code">
    <col class="c-name">
    <col class="c-nos">
    <col class="c-kgs">
  </colgroup>
  <thead>
    <tr>
      <th>GROUP NAME</th>
      <th>CODE</th>
      <th>ITEM NAME</th>
      <th class="r">NOS.</th>
      <th class="r">KGS.</th>
    </tr>
  </thead>
  <tbody>
    {rows_html}
  </tbody>
</table>

</body>
</html>"""


def _build_table_rows(data):
    html = ""
    for row in data:
        rtype = row.get("row_type", "data")

        if rtype == "group_header":
            html += (
                f'<tr class="grp-hdr">'
                f'<td colspan="5">{row.get("group_name", "")}</td>'
                f'</tr>\n'
            )

        elif rtype == "data":
            nos = row.get("nos") if row.get("nos") is not None else ""
            kgs = f"{row.get('kgs', 0):.3f}" if row.get("kgs") is not None else ""
            html += (
                f'<tr>'
                f'<td></td>'
                f'<td>{row.get("code", "")}</td>'
                f'<td>{row.get("item_name", "")}</td>'
                f'<td class="r">{nos}</td>'
                f'<td class="r">{kgs}</td>'
                f'</tr>\n'
            )

        elif rtype == "subtotal":
            nos = row.get("nos") if row.get("nos") is not None else ""
            kgs = f"{row.get('kgs', 0):.3f}" if row.get("kgs") is not None else ""
            html += (
                f'<tr class="subtotal">'
                f'<td colspan="3"></td>'
                f'<td class="r">{nos}</td>'
                f'<td class="r">{kgs}</td>'
                f'</tr>\n'
            )

        elif rtype == "spacer":
            html += '<tr class="spacer"><td colspan="5"></td></tr>\n'

        elif rtype == "grand_total":
            nos = row.get("nos") if row.get("nos") is not None else ""
            kgs = f"{row.get('kgs', 0):.3f}" if row.get("kgs") is not None else ""
            html += (
                f'<tr class="grand-total">'
                f'<td colspan="3">Grand Total</td>'
                f'<td class="r">{nos}</td>'
                f'<td class="r">{kgs}</td>'
                f'</tr>\n'
            )

    return html
