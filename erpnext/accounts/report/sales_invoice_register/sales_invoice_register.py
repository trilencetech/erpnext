# Copyright (c) 2026, TriLence Tech and contributors
# Sales Invoice Register — Script Report

import frappe
from frappe import _
from frappe.utils import flt, formatdate, get_first_day, get_last_day, getdate


def execute(filters=None):
    filters = frappe._dict(filters or {})
    _validate(filters)
    return _columns(), _data(filters)


# ── VALIDATION ────────────────────────────────────────────────────────────────

def _validate(filters):
    if not filters.company:
        frappe.throw(_("Please select a Company"))
    if not filters.from_date:
        frappe.throw(_("Please select From Date"))
    if not filters.to_date:
        frappe.throw(_("Please select To Date"))
    if getdate(filters.from_date) > getdate(filters.to_date):
        frappe.throw(_("From Date cannot be greater than To Date"))


# ── COLUMNS ───────────────────────────────────────────────────────────────────

def _columns():
    return [
        {
            "label": _("Invoice No"),
            "fieldname": "invoice_name",
            "fieldtype": "Link",
            "options": "Sales Invoice",
            "width": 180,
        },
        {
            "label": _("Date"),
            "fieldname": "posting_date",
            "fieldtype": "Date",
            "width": 100,
        },
        {
            "label": _("Customer"),
            "fieldname": "customer_name",
            "fieldtype": "Data",
            "width": 220,
        },
        {
            "label": _("Grand Total"),
            "fieldname": "grand_total",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 130,
        },
        {
            "label": _("Outstanding"),
            "fieldname": "outstanding_amount",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 130,
        },
        {
            "label": _("Status"),
            "fieldname": "status",
            "fieldtype": "Data",
            "width": 100,
        },
        # Hidden raw invoice name used by JS PDF button
        {
            "label": _("_name"),
            "fieldname": "_name",
            "fieldtype": "Data",
            "hidden": 1,
            "width": 0,
        },
        {
            "label": _("PDF"),
            "fieldname": "_pdf",
            "fieldtype": "Data",
            "width": 70,
        },
    ]


# ── DATA ──────────────────────────────────────────────────────────────────────

def _data(filters):
    company_currency = (
        frappe.get_cached_value(
            "Company", filters.company, "default_currency") or "INR"
    )

    conditions = [
        "docstatus = 1",
        "is_return = 0",
        "company = %(company)s",
        "posting_date BETWEEN %(from_date)s AND %(to_date)s",
    ]
    params = {
        "company":   filters.company,
        "from_date": filters.from_date,
        "to_date":   filters.to_date,
    }

    if filters.get("customer"):
        conditions.append("customer = %(customer)s")
        params["customer"] = filters.customer

    rows = frappe.db.sql(
        """
        SELECT
            name            AS invoice_name,
            posting_date,
            customer_name,
            grand_total,
            outstanding_amount,
            status
        FROM `tabSales Invoice`
        WHERE {cond} AND docstatus='1'
        ORDER BY posting_date, name
        """.format(cond=" AND ".join(conditions)),
        params,
        as_dict=True,
    )

    result = []
    grand_total_sum = 0.0

    for r in rows:
        grand_total_sum += flt(r.grand_total)
        result.append({
            "invoice_name":     r.invoice_name,
            "posting_date":     r.posting_date,
            "customer_name":    r.customer_name,
            "grand_total":      flt(r.grand_total, 2),
            "outstanding_amount": flt(r.outstanding_amount, 2),
            "status":           r.status,
            "_name":            r.invoice_name,
            "_pdf":             r.invoice_name,   # JS formatter replaces with button HTML
            "currency":         company_currency,
        })

    if result:
        result.append({
            "invoice_name":     "Total ({} invoices)".format(len(rows)),
            "posting_date":     None,
            "customer_name":    "",
            "grand_total":      flt(grand_total_sum, 2),
            "outstanding_amount": None,
            "status":           "",
            "_name":            "",
            "_pdf":             "",
            "currency":         company_currency,
            "_row_type":        "total",
        })

    return result


# ── BULK PDF API ──────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_bulk_invoice_html(company, from_date, to_date, customer=None):
    """
    Return combined printable HTML for all submitted Sales Invoices in the period.
    Uses the print format configured in Company.print_format_si.
    Each invoice gets its own page-break section.
    """
    print_format = frappe.db.get_value(
        "Company", company, "print_format_si") or "Standard"

    conditions = [
        "docstatus = 1",
        "is_return = 0",
        "company = %(company)s",
        "posting_date BETWEEN %(from_date)s AND %(to_date)s",
    ]
    params = {"company": company, "from_date": from_date, "to_date": to_date}

    if customer:
        conditions.append("customer = %(customer)s")
        params["customer"] = customer

    names = frappe.db.sql(
        "SELECT name FROM `tabSales Invoice` WHERE {} ORDER BY posting_date, name".format(
            " AND ".join(conditions)
        ),
        params,
        pluck="name",
    )

    if not names:
        frappe.throw(
            _("No submitted Sales Invoices found for the selected period."))

    pages = []
    for name in names:
        try:
            html = frappe.get_print(
                "Sales Invoice",
                name,
                print_format=print_format,
                no_letterhead=True,
            )
            pages.append(html)
        except Exception:
            # skip invoices that fail to render (permissions, missing data)
            pass

    if not pages:
        frappe.throw(
            _("Could not render any invoice. Check the print format: {0}").format(print_format))

    combined = (
        """<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @page { size: A4 portrait; margin: 0; }
  body  { margin: 0; padding: 0; background: #fff; }
  .si-page { page-break-after: always; break-after: page; }
  .si-page:last-child { page-break-after: auto; break-after: auto; }
</style>
</head><body>"""
        + "".join(
            '<div class="si-page">{}</div>'.format(p) for p in pages
        )
        + """<div style="text-align:center;margin:20px;font-family:Arial,sans-serif;">
  <button onclick="window.print()"
    style="background:#286cc6;color:#fff;border:none;padding:10px 36px;
           font-size:14px;border-radius:4px;cursor:pointer;font-weight:700;
           letter-spacing:.5px;">
    🖨️&nbsp; Print / Save as PDF
  </button>
</div>
</body></html>"""
    )

    return {"html": combined, "count": len(pages), "print_format": print_format}
