# Copyright (c) 2026, TriLence Tech and contributors
# Customer Monthly Ledger — Script Report
# Shows month-wise outstanding balance for a customer with invoice drilldown.

import frappe
from frappe import _
from frappe.utils import flt, formatdate, get_first_day, get_last_day, getdate, nowdate


def execute(filters=None):
    filters = frappe._dict(filters or {})
    _validate_filters(filters)
    columns = _get_columns()
    data = _get_data(filters)
    return columns, data


# ── VALIDATION ────────────────────────────────────────────────────────────────

def _validate_filters(filters):
    if not filters.get("customer"):
        frappe.throw(_("Please select a Customer"))

    if not filters.get("company"):
        filters["company"] = frappe.defaults.get_user_default("Company")
        if not filters["company"]:
            frappe.throw(_("Please select a Company"))

    if not filters.get("from_date"):
        frappe.throw(_("Please select From Date"))

    if not filters.get("to_date"):
        frappe.throw(_("Please select To Date"))

    if getdate(filters.from_date) > getdate(filters.to_date):
        frappe.throw(_("From Date cannot be greater than To Date"))


# ── COLUMNS ───────────────────────────────────────────────────────────────────

def _get_columns():
    return [
        {
            "label": _("Period"),
            "fieldname": "period",
            "fieldtype": "Data",
            "width": 220,
        },
        {
            "label": _("Invoice Amount"),
            "fieldname": "invoice_amount",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 170,
        },
        {
            "label": _("Paid Amount"),
            "fieldname": "paid_amount",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 170,
        },
        {
            "label": _("Outstanding"),
            "fieldname": "outstanding",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 170,
        },
        # Hidden helper fields used by JS drilldown
        {
            "label": _("Month Start"),
            "fieldname": "month_start",
            "fieldtype": "Date",
            "hidden": 1,
            "width": 0,
        },
        {
            "label": _("Month End"),
            "fieldname": "month_end",
            "fieldtype": "Date",
            "hidden": 1,
            "width": 0,
        },
        {
            "label": _("Row Type"),
            "fieldname": "_row_type",
            "fieldtype": "Data",
            "hidden": 1,
            "width": 0,
        },
    ]


# ── DATA ──────────────────────────────────────────────────────────────────────

def _get_data(filters):
    customer = filters.customer
    company = filters.company
    from_date = getdate(filters.from_date)
    to_date = getdate(filters.to_date)

    company_currency = frappe.get_cached_value("Company", company, "default_currency") or "INR"

    invoices = frappe.db.sql(
        """
        SELECT
            name,
            posting_date,
            grand_total,
            outstanding_amount
        FROM `tabSales Invoice`
        WHERE docstatus = 1
            AND is_return = 0
            AND customer = %(customer)s
            AND company = %(company)s
            AND posting_date BETWEEN %(from_date)s AND %(to_date)s
        ORDER BY posting_date
        """,
        {
            "customer": customer,
            "company": company,
            "from_date": from_date,
            "to_date": to_date,
        },
        as_dict=True,
    )

    # Group invoices by month
    month_data = {}

    for inv in invoices:
        month_key = inv.posting_date.strftime("%Y-%m")
        month_label = inv.posting_date.strftime("%B %Y")
        m_start = get_first_day(inv.posting_date)
        m_end = get_last_day(inv.posting_date)

        if month_key not in month_data:
            month_data[month_key] = {
                "period": month_label,
                "invoice_amount": 0.0,
                "paid_amount": 0.0,
                "outstanding": 0.0,
                "month_start": m_start.strftime("%Y-%m-%d"),
                "month_end": m_end.strftime("%Y-%m-%d"),
                "_row_type": "month",
                "currency": company_currency,
            }

        inv_amount = flt(inv.grand_total, 2)
        outstanding = flt(inv.outstanding_amount, 2)
        paid = flt(inv_amount - outstanding, 2)

        month_data[month_key]["invoice_amount"] += inv_amount
        month_data[month_key]["paid_amount"] += paid
        month_data[month_key]["outstanding"] += outstanding

    if not month_data:
        return []

    # Period totals (as on to_date)
    total_invoice = flt(sum(m["invoice_amount"] for m in month_data.values()), 2)
    total_paid = flt(sum(m["paid_amount"] for m in month_data.values()), 2)
    total_outstanding = flt(sum(m["outstanding"] for m in month_data.values()), 2)

    rows = []

    # ── Top summary row (highlighted) ────────────────────────────────────────
    rows.append(
        {
            "period": frappe.bold(
                "Outstanding Balance as on {}".format(formatdate(to_date))
            ),
            "invoice_amount": total_invoice,
            "paid_amount": total_paid,
            "outstanding": total_outstanding,
            "month_start": "",
            "month_end": "",
            "_row_type": "total",
            "currency": company_currency,
        }
    )

    # Blank separator row
    rows.append(
        {
            "period": "",
            "invoice_amount": None,
            "paid_amount": None,
            "outstanding": None,
            "month_start": "",
            "month_end": "",
            "_row_type": "blank",
            "currency": company_currency,
        }
    )

    # ── Month rows (sorted chronologically) ──────────────────────────────────
    for month_key in sorted(month_data.keys()):
        row = month_data[month_key]
        row["invoice_amount"] = flt(row["invoice_amount"], 2)
        row["paid_amount"] = flt(row["paid_amount"], 2)
        row["outstanding"] = flt(row["outstanding"], 2)
        rows.append(row)

    return rows


# ── DRILLDOWN API (called by JS dialog) ───────────────────────────────────────

@frappe.whitelist()
def get_month_invoices(customer, company, month_start, month_end):
    """Return invoice-level details for the selected month (used in drilldown dialog)."""
    invoices = frappe.db.sql(
        """
        SELECT
            name               AS sales_invoice,
            posting_date,
            grand_total        AS invoice_amount,
            outstanding_amount AS outstanding,
            (grand_total - outstanding_amount) AS paid_amount,
            status
        FROM `tabSales Invoice`
        WHERE docstatus = 1
            AND is_return = 0
            AND customer  = %(customer)s
            AND company   = %(company)s
            AND posting_date BETWEEN %(month_start)s AND %(month_end)s
        ORDER BY posting_date, name
        """,
        {
            "customer": customer,
            "company": company,
            "month_start": month_start,
            "month_end": month_end,
        },
        as_dict=True,
    )
    return invoices


@frappe.whitelist()
def get_all_invoices_for_period(customer, company, from_date, to_date):
    """Return every invoice for the full date range (used by All Months PDF export)."""
    invoices = frappe.db.sql(
        """
        SELECT
            name               AS sales_invoice,
            posting_date,
            grand_total        AS invoice_amount,
            outstanding_amount AS outstanding,
            (grand_total - outstanding_amount) AS paid_amount,
            status
        FROM `tabSales Invoice`
        WHERE docstatus = 1
            AND is_return = 0
            AND customer  = %(customer)s
            AND company   = %(company)s
            AND posting_date BETWEEN %(from_date)s AND %(to_date)s
        ORDER BY posting_date, name
        """,
        {
            "customer": customer,
            "company": company,
            "from_date": from_date,
            "to_date": to_date,
        },
        as_dict=True,
    )
    return invoices
