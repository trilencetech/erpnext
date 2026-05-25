# Copyright (c) 2026, TriLence Tech and contributors
# Customer Monthly Ledger — Script Report

import frappe
from frappe import _
from frappe.utils import flt, formatdate, get_first_day, get_last_day, getdate


def execute(filters=None):
    filters = frappe._dict(filters or {})
    _validate_filters(filters)
    columns = _get_columns(filters)
    data = _get_data(filters)
    return columns, data


# ── VALIDATION ────────────────────────────────────────────────────────────────

def _validate_filters(filters):
    # customer is optional — omitting it shows the all-customer summary list
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

def _get_columns(filters=None):
    """Return customer-list columns when no customer filter, else monthly columns."""
    if filters and filters.get("customer"):
        return _monthly_columns()
    return _customer_list_columns()


def _customer_list_columns():
    return [
        {
            "label": _("Customer"),
            "fieldname": "period",
            "fieldtype": "Data",
            "width": 300,
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
            "label": _("Paid / Adjusted"),
            "fieldname": "paid_amount",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 160,
        },
        {
            "label": _("Outstanding"),
            "fieldname": "outstanding",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 160,
        },
        {"label": _("Row Type"),   "fieldname": "_row_type", "fieldtype": "Data", "hidden": 1, "width": 0},
        {"label": _("Customer ID"), "fieldname": "_customer", "fieldtype": "Data", "hidden": 1, "width": 0},
    ]


def _monthly_columns():
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
            "label": _("Paid / Adjusted"),
            "fieldname": "paid_amount",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 160,
        },
        {
            "label": _("Outstanding"),
            "fieldname": "outstanding",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 160,
        },
        {"label": _("Month Start"), "fieldname": "month_start", "fieldtype": "Date",  "hidden": 1, "width": 0},
        {"label": _("Month End"),   "fieldname": "month_end",   "fieldtype": "Date",  "hidden": 1, "width": 0},
        {"label": _("Row Type"),    "fieldname": "_row_type",   "fieldtype": "Data",  "hidden": 1, "width": 0},
        {"label": _("Customer ID"), "fieldname": "_customer",   "fieldtype": "Data",  "hidden": 1, "width": 0},
    ]


# ── DATA ROUTER ───────────────────────────────────────────────────────────────

def _get_data(filters):
    if filters.get("customer"):
        return _get_monthly_data(filters)
    return _get_customer_list(filters)


# ── CUSTOMER LIST (no customer filter) ────────────────────────────────────────

def _get_customer_list(filters):
    company   = filters.company
    from_date = getdate(filters.from_date)
    to_date   = getdate(filters.to_date)

    company_currency = frappe.get_cached_value(
        "Company", company, "default_currency") or "INR"

    params = {"company": company, "from_date": from_date, "to_date": to_date}

    invoices = frappe.db.sql(
        """
        SELECT customer,
               MAX(customer_name)        AS customer_name,
               SUM(grand_total)          AS invoice_total,
               SUM(outstanding_amount)   AS fwd_out
        FROM   `tabSales Invoice`
        WHERE  docstatus = 1 AND is_return = 0
          AND  company        = %(company)s
          AND  posting_date BETWEEN %(from_date)s AND %(to_date)s
        GROUP  BY customer
        ORDER  BY customer_name
        """,
        params, as_dict=True,
    )

    returns = frappe.db.sql(
        """
        SELECT customer, SUM(ABS(grand_total)) AS cn_total
        FROM   `tabSales Invoice`
        WHERE  docstatus = 1 AND is_return = 1
          AND  company        = %(company)s
          AND  posting_date BETWEEN %(from_date)s AND %(to_date)s
        GROUP  BY customer
        """,
        params, as_dict=True,
    )

    cn_by_cust = {r.customer: flt(r.cn_total, 2) for r in returns}

    grand_inv = grand_cn = grand_paid = grand_out = 0.0
    rows = []

    for inv in invoices:
        cn      = cn_by_cust.get(inv.customer, 0.0)
        net_out = flt(max(0.0, flt(inv.fwd_out, 2)), 2)
        paid    = flt(max(0.0, flt(inv.invoice_total, 2) - net_out), 2)

        grand_inv  += flt(inv.invoice_total, 2)
        grand_cn   += cn
        grand_paid += paid
        grand_out  += net_out

        rows.append({
            "period":         inv.customer_name or inv.customer,
            "invoice_amount": flt(inv.invoice_total, 2),
            "credit_note":    cn,
            "paid_amount":    paid,
            "outstanding":    net_out,
            "_row_type":      "customer",
            "_customer":      inv.customer,
            "currency":       company_currency,
        })

    if not rows:
        return []

    # Grand total row at top
    total_row = [{
        "period":         frappe.bold(
            "Total Outstanding as on {}".format(formatdate(to_date))),
        "invoice_amount": flt(grand_inv,  2),
        "credit_note":    flt(grand_cn,   2),
        "paid_amount":    flt(grand_paid, 2),
        "outstanding":    flt(grand_out,  2),
        "_row_type":      "total",
        "_customer":      "",
        "currency":       company_currency,
    }, {
        "period": "", "invoice_amount": None, "credit_note": None,
        "paid_amount": None, "outstanding": None,
        "_row_type": "blank", "_customer": "", "currency": company_currency,
    }]

    return total_row + rows


# ── MONTHLY DATA (customer filter set) ────────────────────────────────────────
#
# Month buckets are keyed by the INVOICE posting date, not the payment date.
# outstanding_amount per invoice already reflects all allocated payments and
# credit notes, giving correct attribution regardless of payment timing.

def _get_monthly_data(filters):
    customer  = filters.customer
    company   = filters.company
    from_date = getdate(filters.from_date)
    to_date   = getdate(filters.to_date)

    company_currency = frappe.get_cached_value(
        "Company", company, "default_currency") or "INR"

    params = {
        "customer":  customer,
        "company":   company,
        "from_date": from_date,
        "to_date":   to_date,
    }

    invoices = frappe.db.sql(
        """
        SELECT posting_date, grand_total, outstanding_amount
        FROM   `tabSales Invoice`
        WHERE  docstatus = 1 AND is_return = 0
          AND  customer  = %(customer)s AND company = %(company)s
          AND  posting_date BETWEEN %(from_date)s AND %(to_date)s
        ORDER  BY posting_date
        """,
        params, as_dict=True,
    )

    returns = frappe.db.sql(
        """
        SELECT posting_date, grand_total
        FROM   `tabSales Invoice`
        WHERE  docstatus = 1 AND is_return = 1
          AND  customer  = %(customer)s AND company = %(company)s
          AND  posting_date BETWEEN %(from_date)s AND %(to_date)s
        ORDER  BY posting_date
        """,
        params, as_dict=True,
    )

    month_data = {}

    def _ensure_month(dt):
        key = dt.strftime("%Y-%m")
        if key not in month_data:
            month_data[key] = {
                "period":         dt.strftime("%B %Y"),
                "invoice_amount": 0.0,
                "credit_note":    0.0,
                "paid_amount":    0.0,
                "outstanding":    0.0,
                "_fwd_out":       0.0,
                "month_start":    get_first_day(dt).strftime("%Y-%m-%d"),
                "month_end":      get_last_day(dt).strftime("%Y-%m-%d"),
                "_row_type":      "month",
                "_customer":      customer,
                "currency":       company_currency,
            }
        return key

    for inv in invoices:
        key = _ensure_month(inv.posting_date)
        month_data[key]["invoice_amount"] = flt(
            month_data[key]["invoice_amount"] + flt(inv.grand_total), 2)
        month_data[key]["_fwd_out"] = flt(
            month_data[key]["_fwd_out"] + flt(inv.outstanding_amount), 2)

    for ret in returns:
        key = _ensure_month(ret.posting_date)
        month_data[key]["credit_note"] = flt(
            month_data[key]["credit_note"] + flt(abs(ret.grand_total)), 2)

    if not month_data:
        return []

    for m in month_data.values():
        net_out  = flt(max(0.0, m["_fwd_out"]), 2)
        paid_adj = flt(max(0.0, m["invoice_amount"] - net_out), 2)
        m["outstanding"] = net_out
        m["paid_amount"]  = paid_adj
        del m["_fwd_out"]

    total_invoice     = flt(sum(m["invoice_amount"] for m in month_data.values()), 2)
    total_credit_note = flt(sum(m["credit_note"]    for m in month_data.values()), 2)
    total_paid        = flt(sum(m["paid_amount"]    for m in month_data.values()), 2)
    total_outstanding = flt(sum(m["outstanding"]    for m in month_data.values()), 2)

    rows = []
    rows.append({
        "period":         frappe.bold(
            "Outstanding Balance as on {}".format(formatdate(to_date))),
        "invoice_amount": total_invoice,
        "credit_note":    total_credit_note,
        "paid_amount":    total_paid,
        "outstanding":    total_outstanding,
        "month_start":    "",
        "month_end":      "",
        "_row_type":      "total",
        "_customer":      customer,
        "currency":       company_currency,
    })
    rows.append({
        "period": "", "invoice_amount": None, "credit_note": None,
        "paid_amount": None, "outstanding": None,
        "month_start": "", "month_end": "",
        "_row_type": "blank", "_customer": customer,
        "currency": company_currency,
    })
    for key in sorted(month_data.keys()):
        rows.append(month_data[key])

    return rows


# ── DRILLDOWN API — customer monthly (for all-customer list drilldown) ────────

@frappe.whitelist()
def get_customer_monthly_ledger(customer, company, from_date, to_date):
    """Return monthly rows for one customer (called by the JS customer drilldown dialog)."""
    filters = frappe._dict({
        "customer":  customer,
        "company":   company,
        "from_date": from_date,
        "to_date":   to_date,
    })
    return _get_monthly_data(filters)


# ── DRILLDOWN API — single month ──────────────────────────────────────────────

@frappe.whitelist()
def get_month_invoices(customer, company, month_start, month_end):
    """
    Drilldown for one month.  Summary derived from Sales Invoice
    outstanding_amount — paid amount attributed to invoice month.
    """
    params = {
        "customer":    customer,
        "company":     company,
        "month_start": month_start,
        "month_end":   month_end,
    }

    opening_row = frappe.db.sql(
        """
        SELECT COALESCE(SUM(outstanding_amount), 0) AS val
        FROM `tabSales Invoice`
        WHERE docstatus = 1 AND is_return = 0
          AND customer  = %(customer)s AND company = %(company)s
          AND posting_date < %(month_start)s
          AND outstanding_amount > 0
        """,
        params, as_dict=True,
    )
    opening_outstanding = flt((opening_row[0].val if opening_row else 0), 2)

    invoices = frappe.db.sql(
        """
        SELECT
            name                               AS sales_invoice,
            posting_date,
            grand_total                        AS invoice_amount,
            (grand_total - outstanding_amount) AS paid_amount,
            outstanding_amount                 AS outstanding,
            status
        FROM `tabSales Invoice`
        WHERE docstatus = 1 AND is_return = 0
          AND customer  = %(customer)s AND company = %(company)s
          AND posting_date BETWEEN %(month_start)s AND %(month_end)s
        ORDER BY posting_date, name
        """,
        params, as_dict=True,
    )

    credit_notes = frappe.db.sql(
        """
        SELECT
            name                                    AS sales_invoice,
            posting_date,
            ABS(grand_total)                        AS credit_amount,
            COALESCE(return_against, '')            AS return_against,
            outstanding_amount,
            status
        FROM `tabSales Invoice`
        WHERE docstatus = 1 AND is_return = 1
          AND customer  = %(customer)s AND company = %(company)s
          AND posting_date BETWEEN %(month_start)s AND %(month_end)s
        ORDER BY posting_date, name
        """,
        params, as_dict=True,
    )

    inv_total = flt(sum(flt(i.invoice_amount) for i in invoices), 2)
    cn_total  = flt(sum(flt(c.credit_amount)  for c in credit_notes), 2)
    fwd_out   = flt(sum(flt(i.outstanding)    for i in invoices), 2)
    month_out = flt(max(0.0, fwd_out), 2)
    paid_adj  = flt(max(0.0, inv_total - month_out), 2)
    total_out = flt(month_out + opening_outstanding, 2)

    return {
        "opening_outstanding": opening_outstanding,
        "invoices":            invoices,
        "credit_notes":        credit_notes,
        "summary": {
            "invoice_total":       inv_total,
            "credit_total":        cn_total,
            "paid_cash":           paid_adj,
            "month_outstanding":   month_out,
            "opening_outstanding": opening_outstanding,
            "total_outstanding":   total_out,
        },
    }


# ── DRILLDOWN API — full period (All Months PDF) ──────────────────────────────

@frappe.whitelist()
def get_all_invoices_for_period(customer, company, from_date, to_date):
    """All invoices + credit notes with GL-based month summaries for the PDF builder."""
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
        WHERE docstatus = 1 AND is_return = 0
          AND customer  = %(customer)s AND company = %(company)s
          AND posting_date < %(from_date)s
          AND outstanding_amount > 0
        """,
        params, as_dict=True,
    )
    opening_outstanding = flt((opening_row[0].val if opening_row else 0), 2)

    invoices = frappe.db.sql(
        """
        SELECT
            name                               AS sales_invoice,
            posting_date,
            grand_total                        AS invoice_amount,
            (grand_total - outstanding_amount) AS paid_amount,
            outstanding_amount                 AS outstanding,
            status
        FROM `tabSales Invoice`
        WHERE docstatus = 1 AND is_return = 0
          AND customer  = %(customer)s AND company = %(company)s
          AND posting_date BETWEEN %(from_date)s AND %(to_date)s
        ORDER BY posting_date, name
        """,
        params, as_dict=True,
    )

    credit_notes = frappe.db.sql(
        """
        SELECT
            name                         AS sales_invoice,
            posting_date,
            ABS(grand_total)             AS credit_amount,
            COALESCE(return_against, '') AS return_against,
            outstanding_amount,
            status
        FROM `tabSales Invoice`
        WHERE docstatus = 1 AND is_return = 1
          AND customer  = %(customer)s AND company = %(company)s
          AND posting_date BETWEEN %(from_date)s AND %(to_date)s
        ORDER BY posting_date, name
        """,
        params, as_dict=True,
    )

    buckets = {}

    for inv in invoices:
        key = getdate(inv.posting_date).strftime("%Y-%m")
        if key not in buckets:
            buckets[key] = {"invoice_total": 0.0, "credit_total": 0.0, "_fwd_out": 0.0}
        buckets[key]["invoice_total"] = flt(
            buckets[key]["invoice_total"] + flt(inv.invoice_amount), 2)
        buckets[key]["_fwd_out"] = flt(
            buckets[key]["_fwd_out"] + flt(inv.outstanding), 2)

    for cn in credit_notes:
        key = getdate(cn.posting_date).strftime("%Y-%m")
        if key not in buckets:
            buckets[key] = {"invoice_total": 0.0, "credit_total": 0.0, "_fwd_out": 0.0}
        buckets[key]["credit_total"] = flt(
            buckets[key]["credit_total"] + flt(cn.credit_amount), 2)

    month_summaries = {}
    for key, b in buckets.items():
        m_out  = flt(max(0.0, b["_fwd_out"]), 2)
        m_paid = flt(max(0.0, b["invoice_total"] - m_out), 2)
        month_summaries[key] = {
            "invoice_total":     b["invoice_total"],
            "credit_total":      b["credit_total"],
            "paid_cash":         m_paid,
            "month_outstanding": m_out,
        }

    total_inv  = flt(sum(ms["invoice_total"]     for ms in month_summaries.values()), 2)
    total_cn   = flt(sum(ms["credit_total"]      for ms in month_summaries.values()), 2)
    total_paid = flt(sum(ms["paid_cash"]         for ms in month_summaries.values()), 2)
    total_out  = flt(sum(ms["month_outstanding"] for ms in month_summaries.values()), 2)

    return {
        "opening_outstanding": opening_outstanding,
        "invoices":            invoices,
        "credit_notes":        credit_notes,
        "month_summaries":     month_summaries,
        "total_summary": {
            "invoice_total":       total_inv,
            "credit_total":        total_cn,
            "paid_cash":           total_paid,
            "outstanding":         total_out,
            "opening_outstanding": opening_outstanding,
        },
    }
