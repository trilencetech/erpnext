from collections import OrderedDict
from frappe import _
import frappe
import json


def execute(filters=None):
    columns = get_columns()
    data = get_data(filters)
    return columns, data


def get_columns():
    return [
        {"label": _("Group Name"),      "fieldname": "group_name",  "fieldtype": "Data", "width": 180},
        {"label": _("Code"),            "fieldname": "code",        "fieldtype": "Data", "width": 160},
        {"label": _("NOS."),            "fieldname": "nos",         "fieldtype": "Int",  "width": 70},
        # Data (not Float) — holds space-separated individual roll weights
        {"label": _("Roll Wt. (Kgs)"), "fieldname": "roll_weight", "fieldtype": "Data", "width": 420},
        {"label": _("KGS."),            "fieldname": "kgs",         "fieldtype": "Float","width": 120, "precision": 3},
    ]


def get_data(filters):
    conditions = [
        "sle.display_stock != 1",
        "sle.is_cancelled = 0",
        "sle.docstatus = 1",
    ]
    values = {}

    if filters.get("company"):
        conditions.append("sle.company = %(company)s")
        values["company"] = filters["company"]

    if filters.get("as_of_date"):
        conditions.append("sle.posting_date <= %(as_of_date)s")
        values["as_of_date"] = filters["as_of_date"]

    if filters.get("item_group"):
        conditions.append("item.item_group = %(item_group)s")
        values["item_group"] = filters["item_group"]

    if filters.get("item_name"):
        conditions.append("item.item_name LIKE %(item_name)s")
        values["item_name"] = f"%{filters['item_name']}%"

    where_clause = "WHERE " + " AND ".join(conditions)

    # One row per physical roll (item_id). Aggregation into one-row-per-code
    # happens in Python so we can collect individual weights into a list.
    query = f"""
        SELECT
            item.item_group     AS group_name,
            sle.item_code       AS code,
            SUM(sle.actual_qty) AS roll_weight
        FROM `tabStock Ledger Entry` sle
        JOIN `tabItem` item ON sle.item_code = item.name
        {where_clause}
        GROUP BY sle.item_id, sle.item_code, item.item_group
        HAVING SUM(sle.actual_qty) > 0
        ORDER BY item.item_group, sle.item_code
    """

    raw_data = frappe.db.sql(query, values, as_dict=True)
    return _build_grouped_rows(raw_data)


def _build_grouped_rows(raw_data):
    # ── Pass 1: collect individual roll weights per (item_group, item_code) ──
    # Using OrderedDict to preserve DB ordering
    groups = OrderedDict()   # {group_name: OrderedDict({code: [weight, ...]})}

    for row in raw_data:
        grp  = row.group_name or ""
        code = row.code or ""
        wt   = round(float(row.roll_weight or 0), 3)

        if grp not in groups:
            groups[grp] = OrderedDict()
        if code not in groups[grp]:
            groups[grp][code] = []
        groups[grp][code].append(wt)

    # ── Pass 2: build display rows ─────────────────────────────────────────────
    result = []
    total_nos = 0
    total_kgs = 0.0

    for grp, codes in groups.items():
        group_nos = 0
        group_kgs = 0.0

        result.append({
            "group_name": grp, "code": "",
            "nos": None, "roll_weight": "", "kgs": None,
            "bold": 1, "row_type": "group_header",
        })

        for code, weights in codes.items():
            nos = len(weights)
            kgs = round(sum(weights), 3)
            # Space-separated string — formatter/PDF renders each as a styled token
            roll_weight_str = "  ".join(f"{w:.3f}" for w in weights)

            result.append({
                "group_name": "", "code": code,
                "nos": nos,
                "roll_weight": roll_weight_str,
                "kgs": kgs,
                "row_type": "data",
            })

            group_nos += nos
            group_kgs += kgs

        result.append({
            "group_name": "", "code": "",
            "nos": group_nos, "roll_weight": "", "kgs": round(group_kgs, 3),
            "bold": 1, "row_type": "subtotal",
        })
        result.append({
            "group_name": "", "code": "",
            "nos": None, "roll_weight": "", "kgs": None, "row_type": "spacer",
        })

        total_nos += group_nos
        total_kgs += group_kgs

    result.append({
        "group_name": "Grand Total", "code": "",
        "nos": total_nos, "roll_weight": "", "kgs": round(total_kgs, 3),
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

    company    = filters.get("company", "")
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
<title>Stock Match Report – {company} – {date_display}</title>
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

  .doc-header {{
    text-align: center;
    padding-bottom: 6px;
    border-bottom: 2px solid #222;
    margin-bottom: 6px;
  }}
  .doc-header .company-name {{
    font-size: 17pt;
    font-weight: bold;
    letter-spacing: 3px;
    text-transform: uppercase;
  }}
  .doc-header .report-title {{
    font-size: 11pt;
    margin-top: 2px;
    color: #333;
  }}

  table {{
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }}

  col.c-group {{ width: 14%; }}
  col.c-code  {{ width: 13%; }}
  col.c-nos   {{ width:  7%; }}
  col.c-rwt   {{ width: 44%; }}
  col.c-kgs   {{ width: 22%; }}

  thead th {{
    background: #e4e4e4;
    border: 1.5px solid #444;
    padding: 5px 6px;
    font-size: 10pt;
    font-weight: bold;
    text-align: left;
  }}
  thead th.r {{ text-align: right; }}
  thead th.rwt-h {{
    background: #d0e8ff;
    color: #1a3a6a;
    text-align: left;
  }}

  tbody td {{
    border: 1px solid #bbb;
    padding: 3px 6px;
    font-size: 10pt;
    vertical-align: middle;
  }}
  tbody td.r {{ text-align: right; }}

  /* Roll Weight cell — allow wrapping, prominent display */
  tbody td.rwt {{
    background: #eef6ff;
    white-space: normal;
    word-break: break-word;
    line-height: 1.8;
  }}
  /* Each individual weight token — pill badge matching screen display */
  .wt-token {{
    display: inline-block;
    font-size: 11.5pt;
    font-weight: 700;
    color: #1a3a6a;
    background: #eef6ff;
    border: 1px solid #93c5fd;
    border-radius: 4px;
    padding: 1px 7px;
    margin: 1px 3px 1px 0;
    letter-spacing: 0.4px;
    white-space: nowrap;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }}

  tr.grp-hdr td {{
    background: #d8e8f5;
    border: 1.5px solid #3a6ea5;
    font-weight: bold;
    font-size: 10.5pt;
    padding: 4px 6px;
    color: #1a3a6a;
  }}

  tr.subtotal td {{
    border-top:    2px solid #444;
    border-bottom: 2px solid #444;
    border-left:   1px solid #bbb;
    border-right:  1px solid #bbb;
    font-weight: bold;
    background: #f0f0f0;
    padding: 3px 6px;
    font-size: 10pt;
  }}

  tr.spacer td {{
    border: none;
    height: 6px;
    background: transparent;
  }}

  tr.grand-total td {{
    background: #c8d8ee;
    border: 2px solid #1a3a6a;
    font-weight: bold;
    font-size: 11pt;
    padding: 5px 6px;
  }}

  @media print {{
    thead    {{ display: table-header-group; }}
    tr.grp-hdr  {{ page-break-after:  avoid; }}
    tr.subtotal {{ page-break-before: avoid; }}
    .no-print   {{ display: none; }}
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
  <div class="report-title">Stock Match Report &nbsp;as on&nbsp; {date_display}</div>
</div>

<table>
  <colgroup>
    <col class="c-group">
    <col class="c-code">
    <col class="c-nos">
    <col class="c-rwt">
    <col class="c-kgs">
  </colgroup>
  <thead>
    <tr>
      <th>GROUP NAME</th>
      <th>CODE</th>
      <th class="r">NOS.</th>
      <th class="rwt-h">ROLL WT. (KGS) — individual weights</th>
      <th class="r">TOTAL KGS.</th>
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

            # Render each weight as a styled token
            raw_wts = (row.get("roll_weight") or "").strip()
            if raw_wts:
                wt_html = "".join(
                    f'<span class="wt-token">{w}</span>'
                    for w in raw_wts.split() if w
                )
            else:
                wt_html = ""

            html += (
                f'<tr>'
                f'<td></td>'
                f'<td>{row.get("code", "")}</td>'
                f'<td class="r">{nos}</td>'
                f'<td class="rwt">{wt_html}</td>'
                f'<td class="r">{kgs}</td>'
                f'</tr>\n'
            )

        elif rtype == "subtotal":
            nos = row.get("nos") if row.get("nos") is not None else ""
            kgs = f"{row.get('kgs', 0):.3f}" if row.get("kgs") is not None else ""
            html += (
                f'<tr class="subtotal">'
                f'<td colspan="2"></td>'
                f'<td class="r">{nos}</td>'
                f'<td></td>'
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
                f'<td colspan="2">Grand Total</td>'
                f'<td class="r">{nos}</td>'
                f'<td></td>'
                f'<td class="r">{kgs}</td>'
                f'</tr>\n'
            )

    return html
