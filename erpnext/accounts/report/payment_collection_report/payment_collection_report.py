# Copyright (c) 2026, TriLence Tech and contributors
# Payment Collection Report — Script Report
#
# Shows all invoices, payments, and credit notes for every customer in the
# selected period (default: two months before the current month), with opening
# outstanding and a closing balance per customer.

import frappe
from frappe import _
from frappe.utils import flt, formatdate, getdate


def execute(filters=None):
    filters = frappe._dict(filters or {})
    _validate(filters)
    return _columns(), _data(filters)


# ── VALIDATION ────────────────────────────────────────────────────────────────

def _validate(filters):
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

def _columns():
    return [
        {"label": _("Particular"),       "fieldname": "particular",     "fieldtype": "Data",     "width": 265},
        {"label": _("Date"),             "fieldname": "posting_date",   "fieldtype": "Date",     "width": 105},
        {"label": _("Invoice Amount"),   "fieldname": "invoice_amount", "fieldtype": "Currency", "options": "currency", "width": 145},
        {"label": _("Paid / Collected"), "fieldname": "paid_amount",    "fieldtype": "Currency", "options": "currency", "width": 145},
        {"label": _("Credit Note"),      "fieldname": "credit_note",    "fieldtype": "Currency", "options": "currency", "width": 120},
        {"label": _("Outstanding"),      "fieldname": "outstanding",    "fieldtype": "Currency", "options": "currency", "width": 145},
        {"label": _("Status"),           "fieldname": "status",         "fieldtype": "Data",     "width": 100},
        {"label": _("Row Type"),   "fieldname": "_row_type", "fieldtype": "Data", "hidden": 1, "width": 0},
        {"label": _("Customer ID"), "fieldname": "_customer", "fieldtype": "Data", "hidden": 1, "width": 0},
        {"label": _("Invoice"),    "fieldname": "_invoice",  "fieldtype": "Data", "hidden": 1, "width": 0},
    ]


# ── DATA ──────────────────────────────────────────────────────────────────────

def _data(filters):
    company      = filters.company
    from_date    = getdate(filters.from_date)
    to_date      = getdate(filters.to_date)
    cust_filter  = filters.get("customer")

    company_currency = frappe.get_cached_value(
        "Company", company, "default_currency") or "INR"

    def _row(particular, row_type, customer="", invoice="", **kw):
        return {
            "particular":     particular,
            "posting_date":   kw.get("posting_date"),
            "invoice_amount": kw.get("invoice_amount"),
            "paid_amount":    kw.get("paid_amount"),
            "credit_note":    kw.get("credit_note"),
            "outstanding":    kw.get("outstanding"),
            "status":         kw.get("status"),
            "_row_type":      row_type,
            "_customer":      customer,
            "_invoice":       invoice,
            "currency":       company_currency,
        }

    params = {"company": company, "from_date": from_date, "to_date": to_date}
    cust_cond = ""
    if cust_filter:
        params["customer"] = cust_filter
        cust_cond = "AND customer = %(customer)s"

    # ── Invoices in period ────────────────────────────────────────────────────
    invoices = frappe.db.sql(
        """
        SELECT customer, name AS sales_invoice, posting_date,
               rounded_total                        AS invoice_amount,
               (rounded_total - outstanding_amount) AS paid_amount,
               outstanding_amount                   AS outstanding,
               status
        FROM `tabSales Invoice`
        WHERE docstatus = 1 AND is_return = 0
          AND company      = %(company)s
          AND posting_date BETWEEN %(from_date)s AND %(to_date)s
          {cust_cond}
        ORDER BY customer, posting_date, name
        """.format(cust_cond=cust_cond),
        params, as_dict=True,
    )

    # ── Credit notes in period ────────────────────────────────────────────────
    credit_notes = frappe.db.sql(
        """
        SELECT customer, name AS sales_invoice, posting_date,
               ABS(rounded_total)           AS credit_amount,
               COALESCE(return_against, '') AS return_against,
               ABS(outstanding_amount)      AS cn_outstanding,
               status
        FROM `tabSales Invoice`
        WHERE docstatus = 1 AND is_return = 1
          AND company      = %(company)s
          AND posting_date BETWEEN %(from_date)s AND %(to_date)s
          {cust_cond}
        ORDER BY customer, posting_date, name
        """.format(cust_cond=cust_cond),
        params, as_dict=True,
    )

    if not invoices and not credit_notes:
        return []

    # ── Group by customer ─────────────────────────────────────────────────────
    from collections import defaultdict
    inv_by_cust = defaultdict(list)
    cn_by_cust  = defaultdict(list)
    for inv in invoices:
        inv_by_cust[inv.customer].append(inv)
    for cn in credit_notes:
        cn_by_cust[cn.customer].append(cn)

    all_customers = sorted(set(list(inv_by_cust) + list(cn_by_cust)))
    if not all_customers:
        return []

    # ── Customer display names ─────────────────────────────────────────────────
    name_map = {
        r.name: r.customer_name
        for r in frappe.db.get_all(
            "Customer",
            filters={"name": ["in", all_customers]},
            fields=["name", "customer_name"],
        )
    }

    # ── Opening outstanding (batch) ────────────────────────────────────────────
    opening_map = {}
    op_rows = frappe.db.sql(
        """
        SELECT customer, COALESCE(SUM(outstanding_amount), 0) AS opening_out
        FROM `tabSales Invoice`
        WHERE docstatus = 1 AND is_return = 0
          AND company      = %(company)s
          AND posting_date < %(from_date)s
          AND outstanding_amount > 0
          AND customer IN %(customers)s
        GROUP BY customer
        """,
        {"company": company, "from_date": from_date,
         "customers": tuple(all_customers)},
        as_dict=True,
    )
    for r in op_rows:
        opening_map[r.customer] = flt(r.opening_out, 2)

    # ── Build rows ─────────────────────────────────────────────────────────────
    detail_rows = []
    grand_inv = grand_paid = grand_cn = grand_out = 0.0

    for cust in all_customers:
        cust_name = name_map.get(cust, cust)
        opening   = opening_map.get(cust, 0.0)
        invs      = inv_by_cust.get(cust, [])
        cns       = cn_by_cust.get(cust, [])

        cust_inv  = flt(sum(flt(i.invoice_amount) for i in invs), 2)
        cust_paid = flt(sum(flt(i.paid_amount)    for i in invs), 2)
        cust_cn   = flt(sum(flt(c.credit_amount)  for c in cns),  2)
        closing   = flt(opening + cust_inv - cust_paid - cust_cn, 2)

        # Customer header
        detail_rows.append(_row(cust_name, "customer_header", customer=cust))

        # Opening balance
        if opening > 0:
            detail_rows.append(_row(
                "Opening Outstanding (before {})".format(formatdate(from_date)),
                "opening", customer=cust,
                outstanding=opening,
            ))

        # Invoice rows
        for inv in invs:
            detail_rows.append(_row(
                inv.sales_invoice, "invoice",
                customer=cust, invoice=inv.sales_invoice,
                posting_date=inv.posting_date,
                invoice_amount=flt(inv.invoice_amount, 2),
                paid_amount=flt(inv.paid_amount, 2),
                outstanding=flt(inv.outstanding, 2),
                status=inv.status,
            ))

        # Credit note rows
        for cn in cns:
            detail_rows.append(_row(
                cn.sales_invoice, "credit_note",
                customer=cust, invoice=cn.sales_invoice,
                posting_date=cn.posting_date,
                credit_note=flt(cn.credit_amount, 2),
                status="Credit Note",
            ))

        # Customer subtotal
        detail_rows.append(_row(
            "Total — {}".format(cust_name), "customer_total",
            customer=cust,
            invoice_amount=cust_inv  if cust_inv  else None,
            paid_amount=cust_paid if cust_paid else None,
            credit_note=cust_cn   if cust_cn   else None,
            outstanding=closing,
        ))

        # Blank separator
        detail_rows.append(_row("", "blank"))

        grand_inv  += cust_inv
        grand_paid += cust_paid
        grand_cn   += cust_cn
        grand_out  += closing

    if not detail_rows:
        return []

    header = [
        _row(
            frappe.bold("Total Outstanding as on {}".format(formatdate(to_date))),
            "grand_total",
            invoice_amount=flt(grand_inv,  2),
            paid_amount=flt(grand_paid, 2),
            credit_note=flt(grand_cn,   2) if grand_cn else None,
            outstanding=flt(grand_out,  2),
        ),
        _row("", "blank"),
    ]

    return header + detail_rows
