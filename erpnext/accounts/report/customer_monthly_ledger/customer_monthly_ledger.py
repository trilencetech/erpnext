# Copyright (c) 2026, TriLence Tech and contributors
# Customer Monthly Ledger — Script Report

import frappe
from frappe import _
from frappe.utils import flt, formatdate, get_first_day, get_last_day, getdate


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
            "width": 160,
        },
        {
            "label": _("Credit Note"),
            "fieldname": "credit_note",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 140,
        },
        {
            "label": _("Paid"),
            "fieldname": "paid_amount",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 140,
        },
        {
            "label": _("Outstanding"),
            "fieldname": "outstanding",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 160,
        },
        # Hidden helper fields for JS drilldown
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

    company_currency = frappe.get_cached_value(
        "Company", company, "default_currency") or "INR"

    params = {
        "customer": customer,
        "company":  company,
        "from_date": from_date,
        "to_date":   to_date,
    }

    # ── Forward (regular) invoices ────────────────────────────────────────────
    invoices = frappe.db.sql(
        """
        SELECT posting_date, grand_total, outstanding_amount
        FROM `tabSales Invoice`
        WHERE docstatus = 1
            AND is_return = 0
            AND customer  = %(customer)s
            AND company   = %(company)s
            AND posting_date BETWEEN %(from_date)s AND %(to_date)s
        ORDER BY posting_date
        """,
        params, as_dict=True,
    )

    # ── Return invoices / credit notes ────────────────────────────────────────
    returns = frappe.db.sql(
        """
        SELECT posting_date, grand_total, outstanding_amount
        FROM `tabSales Invoice`
        WHERE docstatus = 1
            AND is_return = 1
            AND customer  = %(customer)s
            AND company   = %(company)s
            AND posting_date BETWEEN %(from_date)s AND %(to_date)s
        ORDER BY posting_date
        """,
        params, as_dict=True,
    )

    # ── Group by month ────────────────────────────────────────────────────────
    month_data = {}

    def _ensure_month(dt):
        key = dt.strftime("%Y-%m")
        label = dt.strftime("%B %Y")
        if key not in month_data:
            month_data[key] = {
                "period":        label,
                "invoice_amount": 0.0,
                "credit_note":   0.0,
                "paid_amount":   0.0,
                "outstanding":   0.0,
                "_fwd_out":      0.0,  # forward outstanding (intermediate)
                # return outstanding  (intermediate, ≤ 0)
                "_ret_out":      0.0,
                "month_start":   get_first_day(dt).strftime("%Y-%m-%d"),
                "month_end":     get_last_day(dt).strftime("%Y-%m-%d"),
                "_row_type":     "month",
                "currency":      company_currency,
            }
        return key

    for inv in invoices:
        key = _ensure_month(inv.posting_date)
        month_data[key]["invoice_amount"] += flt(inv.grand_total, 2)
        month_data[key]["_fwd_out"] += flt(inv.outstanding_amount, 2)

    for ret in returns:
        key = _ensure_month(ret.posting_date)
        # grand_total is negative for returns; ABS gives the credit note face value
        month_data[key]["credit_note"] += flt(abs(ret.grand_total), 2)
        # outstanding_amount is 0 (fully allocated) or negative (unallocated credit)
        month_data[key]["_ret_out"] += flt(ret.outstanding_amount, 2)

    if not month_data:
        return []

    # ── Derive paid_amount and net outstanding per month ──────────────────────
    #
    #   net_outstanding = forward_outstanding + return_outstanding
    #     (return_outstanding is 0 or negative, so it reduces the net)
    #   paid_cash       = invoice_amount − credit_note − net_outstanding
    #
    #   This correctly separates actual cash receipts from credit-note offsets
    #   regardless of whether the credit note is allocated or still pending.
    for m in month_data.values():
        net_out = flt(m["_fwd_out"] + m["_ret_out"], 2)
        net_out = max(0.0, net_out)
        paid_cash = flt(m["invoice_amount"] - m["credit_note"] - net_out, 2)
        paid_cash = max(0.0, paid_cash)

        m["outstanding"] = net_out
        m["paid_amount"] = paid_cash
        del m["_fwd_out"]
        del m["_ret_out"]

    # ── Period totals ─────────────────────────────────────────────────────────
    total_invoice = flt(sum(m["invoice_amount"]
                        for m in month_data.values()), 2)
    total_credit_note = flt(sum(m["credit_note"]
                            for m in month_data.values()), 2)
    total_paid = flt(sum(m["paid_amount"] for m in month_data.values()), 2)
    total_outstanding = flt(sum(m["outstanding"]
                            for m in month_data.values()), 2)

    rows = []

    # Top summary row
    rows.append({
        "period":         frappe.bold("Outstanding Balance as on {}".format(formatdate(to_date))),
        "invoice_amount": total_invoice,
        "credit_note":    total_credit_note,
        "paid_amount":    total_paid,
        "outstanding":    total_outstanding,
        "month_start":    "",
        "month_end":      "",
        "_row_type":      "total",
        "currency":       company_currency,
    })

    # Blank separator
    rows.append({
        "period":         "",
        "invoice_amount": None,
        "credit_note":    None,
        "paid_amount":    None,
        "outstanding":    None,
        "month_start":    "",
        "month_end":      "",
        "_row_type":      "blank",
        "currency":       company_currency,
    })

    # Month rows (chronological)
    for month_key in sorted(month_data.keys()):
        m = month_data[month_key]
        m["invoice_amount"] = flt(m["invoice_amount"], 2)
        m["credit_note"] = flt(m["credit_note"],    2)
        m["paid_amount"] = flt(m["paid_amount"],    2)
        m["outstanding"] = flt(m["outstanding"],    2)
        rows.append(m)

    return rows


# ── DRILLDOWN API — single month ──────────────────────────────────────────────

@frappe.whitelist()
def get_month_invoices(customer, company, month_start, month_end):
    """
    Return structured data for the drilldown dialog:
      • opening_outstanding  – unpaid balance from invoices before month_start
      • invoices             – forward invoices raised in the month
      • credit_notes         – return invoices raised in the month
      • summary              – pre-computed totals for the JS dialog footer
    """
    params = {
        "customer":    customer,
        "company":     company,
        "month_start": month_start,
        "month_end":   month_end,
    }

    # Opening outstanding = current unpaid balance on invoices before this month
    opening_row = frappe.db.sql(
        """
        SELECT COALESCE(SUM(outstanding_amount), 0) AS val
        FROM `tabSales Invoice`
        WHERE docstatus = 1
            AND is_return = 0
            AND customer  = %(customer)s
            AND company   = %(company)s
            AND posting_date < %(month_start)s
            AND outstanding_amount > 0
        """,
        params, as_dict=True,
    )
    opening_outstanding = flt((opening_row[0].val if opening_row else 0), 2)

    # Forward invoices for the month
    invoices = frappe.db.sql(
        """
        SELECT
            name                                        AS sales_invoice,
            posting_date,
            grand_total                                 AS invoice_amount,
            (grand_total - outstanding_amount)          AS paid_amount,
            outstanding_amount                          AS outstanding,
            status
        FROM `tabSales Invoice`
        WHERE docstatus = 1
            AND is_return = 0
            AND customer  = %(customer)s
            AND company   = %(company)s
            AND posting_date BETWEEN %(month_start)s AND %(month_end)s
        ORDER BY posting_date, name
        """,
        params, as_dict=True,
    )

    # Credit notes / return invoices for the month
    credit_notes = frappe.db.sql(
        """
        SELECT
            name              AS sales_invoice,
            posting_date,
            ABS(grand_total)  AS credit_amount,
            COALESCE(return_against, '') AS return_against,
            outstanding_amount,
            status
        FROM `tabSales Invoice`
        WHERE docstatus = 1
            AND is_return = 1
            AND customer  = %(customer)s
            AND company   = %(company)s
            AND posting_date BETWEEN %(month_start)s AND %(month_end)s
        ORDER BY posting_date, name
        """,
        params, as_dict=True,
    )

    # Pre-compute summary so JS doesn't need to re-derive it
    inv_total = flt(sum(flt(i.invoice_amount) for i in invoices), 2)
    cn_total = flt(sum(flt(c.credit_amount) for c in credit_notes), 2)
    fwd_out = flt(sum(flt(i.outstanding) for i in invoices), 2)
    ret_out = flt(sum(flt(c.outstanding_amount)
                  for c in credit_notes), 2)  # ≤ 0
    month_out = flt(max(0.0, fwd_out + ret_out), 2)
    paid_cash = flt(max(0.0, inv_total - cn_total - month_out), 2)
    total_out = flt(month_out + opening_outstanding, 2)

    return {
        "opening_outstanding": opening_outstanding,
        "invoices":            invoices,
        "credit_notes":        credit_notes,
        "summary": {
            "invoice_total":      inv_total,
            "credit_total":       cn_total,
            "paid_cash":          paid_cash,
            "month_outstanding":  month_out,
            "opening_outstanding": opening_outstanding,
            "total_outstanding":  total_out,
        },
    }


# ── DRILLDOWN API — full period (All Months PDF) ──────────────────────────────

@frappe.whitelist()
def get_all_invoices_for_period(customer, company, from_date, to_date):
    """Return all invoices + credit notes for the period, plus opening balance."""
    params = {
        "customer":  customer,
        "company":   company,
        "from_date": from_date,
        "to_date":   to_date,
    }

    opening_row = frappe.db.sql(
        """
        SELECT COALESCE(SUM(outstanding_amount), 0) AS val
        FROM `tabSales Invoice`
        WHERE docstatus = 1
            AND is_return = 0
            AND customer  = %(customer)s
            AND company   = %(company)s
            AND posting_date < %(from_date)s
            AND outstanding_amount > 0
        """,
        params, as_dict=True,
    )
    opening_outstanding = flt((opening_row[0].val if opening_row else 0), 2)

    invoices = frappe.db.sql(
        """
        SELECT
            name                                    AS sales_invoice,
            posting_date,
            grand_total                             AS invoice_amount,
            (grand_total - outstanding_amount)      AS paid_amount,
            outstanding_amount                      AS outstanding,
            status
        FROM `tabSales Invoice`
        WHERE docstatus = 1
            AND is_return = 0
            AND customer  = %(customer)s
            AND company   = %(company)s
            AND posting_date BETWEEN %(from_date)s AND %(to_date)s
        ORDER BY posting_date, name
        """,
        params, as_dict=True,
    )

    credit_notes = frappe.db.sql(
        """
        SELECT
            name              AS sales_invoice,
            posting_date,
            ABS(grand_total)  AS credit_amount,
            COALESCE(return_against, '') AS return_against,
            outstanding_amount,
            status
        FROM `tabSales Invoice`
        WHERE docstatus = 1
            AND is_return = 1
            AND customer  = %(customer)s
            AND company   = %(company)s
            AND posting_date BETWEEN %(from_date)s AND %(to_date)s
        ORDER BY posting_date, name
        """,
        params, as_dict=True,
    )

    return {
        "opening_outstanding": opening_outstanding,
        "invoices":            invoices,
        "credit_notes":        credit_notes,
    }
