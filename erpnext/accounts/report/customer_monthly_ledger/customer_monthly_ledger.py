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
            "label": _("Opening Outstanding"),
            "fieldname": "opening_outstanding",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 160,
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


# ── RETURN INVOICE HELPER ─────────────────────────────────────────────────────

def _get_return_invoice_set(company, customers, from_date, to_date):
    """Names of return Sales Invoices posted in [from_date, to_date] for given customers."""
    if not customers:
        return set()
    rows = frappe.db.get_all(
        "Sales Invoice",
        filters={
            "docstatus": 1,
            "is_return":  1,
            "company":    company,
            "customer":   ["in", list(customers)],
            "posting_date": ["between", [from_date, to_date]],
        },
        pluck="name",
    )
    return set(rows)


# ── CUSTOMER LIST (no customer filter) ────────────────────────────────────────
#
# Uses GL Entry debit/credit movements — same source-of-truth as
# customer_ledger_summary report.  Segregates:
#   debit > credit  → invoiced
#   credit > debit, voucher is return invoice → credit note
#   credit > debit, other               → paid / adjusted
# Opening = GL balance before from_date (or is_opening = Yes).

def _get_customer_list(filters):
    company   = filters.company
    from_date = getdate(filters.from_date)
    to_date   = getdate(filters.to_date)

    company_currency = frappe.get_cached_value(
        "Company", company, "default_currency") or "INR"

    # All customer GL party entries up to to_date
    gl_entries = frappe.db.sql(
        """
        SELECT party, posting_date, debit, credit, voucher_no, is_opening
        FROM   `tabGL Entry`
        WHERE  docstatus < 2 AND is_cancelled = 0
          AND  company    = %(company)s
          AND  party_type = 'Customer'
          AND  IFNULL(party, '') != ''
          AND  posting_date <= %(to_date)s
        ORDER  BY posting_date, name
        """,
        {"company": company, "to_date": to_date},
        as_dict=True,
    )

    if not gl_entries:
        return []

    parties = list({g.party for g in gl_entries})
    return_invoices = _get_return_invoice_set(company, parties, from_date, to_date)

    cust_name_map = {
        r.name: r.customer_name
        for r in frappe.db.get_all(
            "Customer", filters={"name": ["in", parties]},
            fields=["name", "customer_name"],
        )
    }

    per_cust = {}
    for gle in gl_entries:
        p = gle.party
        if p not in per_cust:
            per_cust[p] = {"opening": 0.0, "invoiced": 0.0, "credit_note": 0.0, "paid": 0.0}
        amount = flt(gle.debit) - flt(gle.credit)
        if gle.posting_date < from_date or gle.is_opening == "Yes":
            per_cust[p]["opening"] += amount
        else:
            if amount > 0:
                per_cust[p]["invoiced"] += amount
            elif gle.voucher_no in return_invoices:
                per_cust[p]["credit_note"] -= amount   # make positive
            else:
                per_cust[p]["paid"] -= amount          # make positive

    rows = []
    grand_opening = grand_inv = grand_cn = grand_paid = grand_out = 0.0

    for cust in sorted(per_cust.keys(), key=lambda c: cust_name_map.get(c, c)):
        d        = per_cust[cust]
        opening  = flt(d["opening"],     2)
        invoiced = flt(d["invoiced"],    2)
        cn       = flt(d["credit_note"], 2)
        paid     = flt(d["paid"],        2)
        closing  = flt(opening + invoiced - cn - paid, 2)

        grand_opening += opening
        grand_inv     += invoiced
        grand_cn      += cn
        grand_paid    += paid
        grand_out     += closing

        rows.append({
            "period":              cust_name_map.get(cust, cust),
            "opening_outstanding": opening,
            "invoice_amount":      invoiced,
            "credit_note":         cn,
            "paid_amount":         paid,
            "outstanding":         closing,
            "_row_type":           "customer",
            "_customer":           cust,
            "currency":            company_currency,
        })

    if not rows:
        return []

    total_row = [{
        "period":              frappe.bold(
            "Total Outstanding as on {}".format(formatdate(to_date))),
        "opening_outstanding": flt(grand_opening, 2),
        "invoice_amount":      flt(grand_inv,     2),
        "credit_note":         flt(grand_cn,      2),
        "paid_amount":         flt(grand_paid,    2),
        "outstanding":         flt(grand_out,     2),
        "_row_type":           "total",
        "_customer":           "",
        "currency":            company_currency,
    }, {
        "period": "", "opening_outstanding": None, "invoice_amount": None,
        "credit_note": None, "paid_amount": None, "outstanding": None,
        "_row_type": "blank", "_customer": "", "currency": company_currency,
    }]

    return total_row + rows


# ── MONTHLY DATA (customer filter set) ────────────────────────────────────────
#
# Sales Invoice based — same source-of-truth as get_month_invoices drilldown.
# paid_amount per invoice = grand_total - outstanding_amount, attributed to the
# invoice's own posting month regardless of when the payment was received.
# outstanding per month   = running closing balance at end of that month.

def _get_monthly_data(filters):
    customer  = filters.customer
    company   = filters.company
    from_date = getdate(filters.from_date)
    to_date   = getdate(filters.to_date)

    company_currency = frappe.get_cached_value(
        "Company", company, "default_currency") or "INR"

    params = {
        "company":    company,
        "customer":   customer,
        "from_date":  from_date,
        "to_date":    to_date,
    }

    # Opening balance — invoices before from_date that still have outstanding
    opening_row = frappe.db.sql(
        """
        SELECT COALESCE(SUM(outstanding_amount), 0) AS val
        FROM   `tabSales Invoice`
        WHERE  docstatus = 1 AND is_return = 0
          AND  customer  = %(customer)s AND company = %(company)s
          AND  posting_date < %(from_date)s
          AND  outstanding_amount > 0
        """,
        params, as_dict=True,
    )
    opening_balance = flt((opening_row[0].val if opening_row else 0), 2)

    # Invoices in period
    invoices = frappe.db.sql(
        """
        SELECT
            posting_date,
            grand_total                        AS invoice_amount,
            (grand_total - outstanding_amount) AS paid_amount
        FROM   `tabSales Invoice`
        WHERE  docstatus = 1 AND is_return = 0
          AND  customer  = %(customer)s AND company = %(company)s
          AND  posting_date BETWEEN %(from_date)s AND %(to_date)s
        ORDER  BY posting_date
        """,
        params, as_dict=True,
    )

    # Credit notes in period.
    # Use ABS(outstanding_amount) not ABS(grand_total): a fully-applied credit note
    # has outstanding_amount = 0 and its effect is already captured in the original
    # invoice's paid_amount (grand_total - outstanding_amount). Only the unapplied
    # portion should be deducted here to avoid double-counting.
    credit_notes = frappe.db.sql(
        """
        SELECT
            posting_date,
            ABS(outstanding_amount) AS credit_amount
        FROM   `tabSales Invoice`
        WHERE  docstatus = 1 AND is_return = 1
          AND  customer  = %(customer)s AND company = %(company)s
          AND  posting_date BETWEEN %(from_date)s AND %(to_date)s
        ORDER  BY posting_date
        """,
        params, as_dict=True,
    )

    if not invoices and not credit_notes:
        return []

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
                "month_start":    get_first_day(dt).strftime("%Y-%m-%d"),
                "month_end":      get_last_day(dt).strftime("%Y-%m-%d"),
                "_row_type":      "month",
                "_customer":      customer,
                "currency":       company_currency,
            }
        return key

    for inv in invoices:
        key = _ensure_month(getdate(inv.posting_date))
        month_data[key]["invoice_amount"] += flt(inv.invoice_amount)
        month_data[key]["paid_amount"]    += flt(inv.paid_amount)

    for cn in credit_notes:
        key = _ensure_month(getdate(cn.posting_date))
        month_data[key]["credit_note"] += flt(cn.credit_amount)

    if not month_data:
        return []

    # Round monthly figures and compute closing balance as running total from opening
    running = opening_balance
    for key in sorted(month_data.keys()):
        m = month_data[key]
        m["invoice_amount"] = flt(m["invoice_amount"], 2)
        m["credit_note"]    = flt(m["credit_note"],    2)
        m["paid_amount"]    = flt(m["paid_amount"],    2)
        running += m["invoice_amount"] - m["credit_note"] - m["paid_amount"]
        m["outstanding"]    = flt(running, 2)

    total_invoice = flt(sum(m["invoice_amount"] for m in month_data.values()), 2)
    total_cn      = flt(sum(m["credit_note"]    for m in month_data.values()), 2)
    total_paid    = flt(sum(m["paid_amount"]    for m in month_data.values()), 2)
    total_out     = flt(opening_balance + total_invoice - total_cn - total_paid, 2)

    rows = [{
        "period":         frappe.bold(
            "Outstanding Balance as on {}".format(formatdate(to_date))),
        "invoice_amount": total_invoice,
        "credit_note":    total_cn,
        "paid_amount":    total_paid,
        "outstanding":    total_out,
        "month_start":    "",
        "month_end":      "",
        "_row_type":      "total",
        "_customer":      customer,
        "currency":       company_currency,
    }, {
        "period": "", "invoice_amount": None, "credit_note": None,
        "paid_amount": None, "outstanding": None,
        "month_start": "", "month_end": "",
        "_row_type": "blank", "_customer": customer,
        "currency": company_currency,
    }]

    for key in sorted(month_data.keys()):
        rows.append(month_data[key])

    return rows


# ── DRILLDOWN API — customer monthly (for all-customer list drilldown) ────────

@frappe.whitelist()
def get_customer_monthly_ledger(customer, company, from_date, to_date):
    """Return monthly rows + opening outstanding for the customer drilldown dialog."""
    filters = frappe._dict({
        "customer":  customer,
        "company":   company,
        "from_date": from_date,
        "to_date":   to_date,
    })
    rows = _get_monthly_data(filters)

    # Opening = SI outstanding before from_date (same logic as _get_monthly_data)
    opening_row = frappe.db.sql(
        """
        SELECT COALESCE(SUM(outstanding_amount), 0) AS val
        FROM   `tabSales Invoice`
        WHERE  docstatus = 1 AND is_return = 0
          AND  customer  = %(customer)s AND company = %(company)s
          AND  posting_date < %(from_date)s
          AND  outstanding_amount > 0
        """,
        {"company": company, "customer": customer, "from_date": getdate(from_date)},
        as_dict=True,
    )
    opening_outstanding = flt((opening_row[0].val if opening_row else 0), 2)

    return {"rows": rows, "opening_outstanding": opening_outstanding}


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
    # cn_deductible: only the unapplied portion (outstanding_amount < 0 means still open)
    # A fully-applied CN has outstanding_amount = 0, so it contributes nothing here —
    # its effect is already reflected in the original invoice's outstanding_amount.
    cn_deductible = flt(sum(abs(flt(c.outstanding_amount)) for c in credit_notes), 2)
    fwd_out   = flt(sum(flt(i.outstanding)    for i in invoices), 2)
    month_out = flt(max(0.0, fwd_out), 2)
    paid_adj  = flt(max(0.0, inv_total - month_out), 2)
    total_out = flt(max(0.0, month_out + opening_outstanding - cn_deductible), 2)

    return {
        "opening_outstanding": opening_outstanding,
        "invoices":            invoices,
        "credit_notes":        credit_notes,
        "summary": {
            "invoice_total":       inv_total,
            "credit_total":        cn_deductible,   # unapplied portion only
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
