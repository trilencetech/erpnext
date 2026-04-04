# GST Monthly CA Summary – Script Report for ERPNext v15
# -----------------------------------------------------------------------
# Credit Notes (Sales Invoice is_return=1) → separate row in Sales section
# Debit Notes  (Purchase Invoice is_return=1) → separate row in Purchase section
# Journal Entry entries still included for manual JV adjustments
# -----------------------------------------------------------------------

import frappe
from frappe.utils import getdate, flt
from datetime import timedelta
from erpnext.accounts.report.gst_monthly_ca_summary.get_gst_carry_forward import get_gst_carry_forward


def execute(filters=None):
    if not filters:
        filters = {}
    validate_filters(filters)
    columns = get_columns()
    data = get_report_data(filters)
    return columns, data


def validate_filters(filters):
    if not filters.get("from_date") or not filters.get("to_date"):
        frappe.throw("Please select From Date and To Date")
    if getdate(filters["from_date"]) > getdate(filters["to_date"]):
        frappe.throw("From Date cannot be greater than To Date")
    if not filters.get("company"):
        filters["company"] = frappe.defaults.get_user_default("Company")


def get_columns():
    return [
        {"label": "Particular",   "fieldname": "particular",
            "fieldtype": "Data",     "width": 260},
        {"label": "Taxable Amt.", "fieldname": "taxable_amt",
            "fieldtype": "Currency", "width": 140},
        {"label": "IGST",         "fieldname": "igst",
            "fieldtype": "Currency", "width": 120},
        {"label": "CGST",         "fieldname": "cgst",
            "fieldtype": "Currency", "width": 120},
        {"label": "SGST",         "fieldname": "sgst",
            "fieldtype": "Currency", "width": 120},
        {"label": "Total GST",    "fieldname": "total_gst",
            "fieldtype": "Currency", "width": 140},
    ]


def get_report_data(filters):
    company = filters.get("company")
    from_date = filters.get("from_date")
    to_date = filters.get("to_date")

    sales = get_sales_gst(company, from_date, to_date)
    credits = get_credit_notes_gst(company, from_date, to_date)   # NEW
    purch = get_purchase_gst(company, from_date, to_date)
    debits = get_debit_notes_gst(company, from_date, to_date)    # NEW

    current_from = getdate(from_date)
    # last day of prev month
    prev_to = current_from - timedelta(days=1)
    prev_from = prev_to.replace(day=1)
    prev_sales_igst, prev_sales_cgst, prev_sales_sgst, prev_itc_igst,   prev_itc_cgst,   prev_itc_sgst = get_gst_carry_forward(
        company, prev_from, prev_to)

    # prev_sales_igst, prev_sales_cgst, prev_sales_sgst = get_previous_sales_due(
    #   company, from_date)

    # prev_itc_igst,   prev_itc_cgst,   prev_itc_sgst = get_previous_itc(
    #   company, from_date)

    # ── Sales totals (net of credit notes) ────────────────────────────
    cur_sales_igst = flt(sales.get("igst"), 2)
    cur_sales_cgst = flt(sales.get("cgst"), 2)
    cur_sales_sgst = flt(sales.get("sgst"), 2)
    cur_sales_taxable = flt(sales.get("taxable_amt"), 2)

    cn_igst = flt(credits.get("igst"), 2)
    cn_cgst = flt(credits.get("cgst"), 2)
    cn_sgst = flt(credits.get("sgst"), 2)
    cn_taxable = flt(credits.get("taxable_amt"), 2)

    net_sales_taxable = flt(cur_sales_taxable - cn_taxable, 2)
    net_sales_igst = flt(cur_sales_igst - cn_igst, 2)
    net_sales_cgst = flt(cur_sales_cgst - cn_cgst, 2)
    net_sales_sgst = flt(cur_sales_sgst - cn_sgst, 2)

    total_sales_igst = flt(net_sales_igst + flt(prev_sales_igst, 2), 2)
    total_sales_cgst = flt(net_sales_cgst + flt(prev_sales_cgst, 2), 2)
    total_sales_sgst = flt(net_sales_sgst + flt(prev_sales_sgst, 2), 2)
    total_sales_taxable = net_sales_taxable
    total_sales_gst = flt(
        total_sales_igst + total_sales_cgst + total_sales_sgst, 2)

    prev_sales_total = flt(
        prev_sales_igst + prev_sales_cgst + prev_sales_sgst, 2)
    cur_sales_gst = flt(cur_sales_igst + cur_sales_cgst + cur_sales_sgst, 2)
    cn_gst = flt(cn_igst + cn_cgst + cn_sgst, 2)
    net_sales_gst = flt(net_sales_igst + net_sales_cgst + net_sales_sgst, 2)

    # ── Purchase totals (net of debit notes) ──────────────────────────
    cur_purch_igst = flt(purch.get("igst"), 2)
    cur_purch_cgst = flt(purch.get("cgst"), 2)
    cur_purch_sgst = flt(purch.get("sgst"), 2)
    cur_purch_taxable = flt(purch.get("taxable_amt"), 2)

    dn_igst = flt(debits.get("igst"), 2)
    dn_cgst = flt(debits.get("cgst"), 2)
    dn_sgst = flt(debits.get("sgst"), 2)
    dn_taxable = flt(debits.get("taxable_amt"), 2)

    net_purch_taxable = flt(cur_purch_taxable - dn_taxable, 2)
    net_purch_igst = flt(cur_purch_igst - dn_igst, 2)
    net_purch_cgst = flt(cur_purch_cgst - dn_cgst, 2)
    net_purch_sgst = flt(cur_purch_sgst - dn_sgst, 2)

    total_itc_igst = flt(net_purch_igst + flt(prev_itc_igst, 2), 2)
    total_itc_cgst = flt(net_purch_cgst + flt(prev_itc_cgst, 2), 2)
    total_itc_sgst = flt(net_purch_sgst + flt(prev_itc_sgst, 2), 2)
    total_purch_taxable = net_purch_taxable
    total_itc_gst = flt(total_itc_igst + total_itc_cgst + total_itc_sgst, 2)

    prev_itc_total = flt(prev_itc_igst + prev_itc_cgst + prev_itc_sgst, 2)
    cur_purch_gst = flt(cur_purch_igst + cur_purch_cgst + cur_purch_sgst, 2)
    dn_gst = flt(dn_igst + dn_cgst + dn_sgst, 2)
    net_purch_gst = flt(net_purch_igst + net_purch_cgst + net_purch_sgst, 2)

    # ── Surplus ───────────────────────────────────────────────────────
    surplus_igst = flt(total_itc_igst - total_sales_igst, 2)
    surplus_cgst = flt(total_itc_cgst - total_sales_cgst, 2)
    surplus_sgst = flt(total_itc_sgst - total_sales_sgst, 2)
    net_surplus = flt(surplus_igst + surplus_cgst + surplus_sgst, 2)

    util = calculate_utilisation(
        total_sales_igst, total_sales_cgst, total_sales_sgst,
        total_itc_igst,   total_itc_cgst,   total_itc_sgst
    )

    carry_igst = flt(max(0, total_itc_igst - util["igst_used"]), 2)
    carry_cgst = flt(max(0, total_itc_cgst - util["cgst_used"]), 2)
    carry_sgst = flt(max(0, total_itc_sgst - util["sgst_used"]), 2)
    carry_total = flt(carry_igst + carry_cgst + carry_sgst, 2)
    net_cash = flt(util["igst_net"] + util["cgst_net"] + util["sgst_net"], 2)

    tax_rate = str(flt(sales.get("tax_rate", 18.0), 2))

    rows = []

    # ─── SECTION A: SALES LIABILITY ───────────────────────────────────
    rows.append(make_section("SALES LIABILITY"))
    rows.append(make_row("Previous Due",
                         0, flt(prev_sales_igst, 2), flt(prev_sales_cgst, 2), flt(prev_sales_sgst, 2), prev_sales_total))
    rows.append(make_row("Sales @ " + tax_rate + "%",
                         cur_sales_taxable, cur_sales_igst, cur_sales_cgst, cur_sales_sgst, cur_sales_gst))
    rows.append(make_row("  (-) Credit Notes",
                         cn_taxable, cn_igst, cn_cgst, cn_sgst, cn_gst))
    rows.append(make_row("Net Sales (After Credit Notes)",
                         net_sales_taxable, net_sales_igst, net_sales_cgst, net_sales_sgst, net_sales_gst))
    rows.append(make_total("TOTAL LIABILITY",
                           total_sales_taxable, total_sales_igst, total_sales_cgst, total_sales_sgst, total_sales_gst))
    rows.append(make_blank())

    # ─── SECTION B: PURCHASE ITC ──────────────────────────────────────
    rows.append(make_section("PURCHASE ITC"))
    rows.append(make_row("Previous ITC",
                         0, flt(prev_itc_igst, 2), flt(prev_itc_cgst, 2), flt(prev_itc_sgst, 2), prev_itc_total))
    rows.append(make_row("Purchase @ " + tax_rate + "%",
                         cur_purch_taxable, cur_purch_igst, cur_purch_cgst, cur_purch_sgst, cur_purch_gst))
    rows.append(make_row("  (-) Debit Notes",
                         dn_taxable, dn_igst, dn_cgst, dn_sgst, dn_gst))
    rows.append(make_row("Net Purchase (After Debit Notes)",
                         net_purch_taxable, net_purch_igst, net_purch_cgst, net_purch_sgst, net_purch_gst))
    rows.append(make_total("TOTAL AVAILABLE ITC",
                           total_purch_taxable, total_itc_igst, total_itc_cgst, total_itc_sgst, total_itc_gst))
    rows.append(make_blank())

    # ─── SECTION C: POSITION BEFORE UTILISATION ───────────────────────
    rows.append(make_section("GST POSITION BEFORE UTILISATION"))
    rows.append(make_row("GST Payable (Before Utilisation)",
                         0, total_sales_igst, total_sales_cgst, total_sales_sgst, total_sales_gst))
    rows.append(make_row("GST Available ITC",
                         0, total_itc_igst, total_itc_cgst, total_itc_sgst, total_itc_gst))
    rows.append(make_total("NET GST AVAILABLE (SURPLUS)",
                           0, surplus_igst, surplus_cgst, surplus_sgst, net_surplus))
    rows.append(make_blank())

    # ─── SECTION D: UTILISATION ───────────────────────────────────────
    rows.append(make_section("UTILISATION (SET OFF) OF ITC"))
    rows.append(make_row("IGST Payable",   0,
                total_sales_igst, 0, 0, total_sales_igst))
    rows.append(make_row("  Paid via ITC", 0,
                util["igst_used"], 0, 0, util["igst_used"]))
    rows.append(make_row("CGST Payable",   0, 0,
                total_sales_cgst, 0, total_sales_cgst))
    rows.append(make_row("  Paid via ITC", 0, 0,
                util["cgst_used"], 0, util["cgst_used"]))
    rows.append(make_row("SGST Payable",   0, 0, 0,
                total_sales_sgst, total_sales_sgst))
    rows.append(make_row("  Paid via ITC", 0, 0, 0,
                util["sgst_used"], util["sgst_used"]))
    rows.append(make_total("TOTAL GST PAYABLE (CASH)",
                           0, util["igst_net"], util["cgst_net"], util["sgst_net"], net_cash))
    rows.append(make_blank())

    # ─── SECTION E: CARRY FORWARD ─────────────────────────────────────
    rows.append(make_section("ITC AVAILABLE FOR NEXT MONTH"))
    rows.append(make_row("Available IGST", 0, carry_igst,
                0,          0,          carry_igst))
    rows.append(make_row("Available CGST", 0, 0,
                carry_cgst, 0,          carry_cgst))
    rows.append(make_row("Available SGST", 0, 0,
                0,          carry_sgst, carry_sgst))
    rows.append(make_total("TOTAL CARRY FORWARD ITC",
                           0, carry_igst, carry_cgst, carry_sgst, carry_total))

    return rows


# ── DATA QUERIES ───────────────────────────────────────────────────────────

def get_sales_gst(company, from_date, to_date):
    """Normal Sales Invoices only (is_return=0). JE credits still included."""

    si_taxable = frappe.db.sql("""
        SELECT SUM(base_net_total) AS taxable_amt
        FROM `tabSales Invoice`
        WHERE docstatus = 1 AND company = %(company)s
          AND posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND is_return = 0
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    si_taxes = frappe.db.sql("""
        SELECT
            SUM(CASE WHEN (stc.description LIKE '%%IGST%%' OR stc.account_head LIKE '%%IGST%%'
                       OR stc.description LIKE '%%Integrated%%')
                THEN stc.base_tax_amount ELSE 0 END) AS igst,
            SUM(CASE WHEN (stc.description LIKE '%%CGST%%' OR stc.account_head LIKE '%%CGST%%'
                       OR stc.description LIKE '%%Central%%')
                THEN stc.base_tax_amount ELSE 0 END) AS cgst,
            SUM(CASE WHEN (stc.description LIKE '%%SGST%%' OR stc.account_head LIKE '%%SGST%%'
                       OR stc.description LIKE '%%State%%' OR stc.description LIKE '%%UTGST%%')
                THEN stc.base_tax_amount ELSE 0 END) AS sgst
        FROM `tabSales Taxes and Charges` stc
        INNER JOIN `tabSales Invoice` si ON si.name = stc.parent
        WHERE si.docstatus = 1 AND si.company = %(company)s
          AND si.posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND si.is_return = 0
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    # JE manual adjustments (still included for non-SI adjustments)
    je_taxes = frappe.db.sql("""
        SELECT
            SUM(CASE WHEN (jea.account LIKE '%%Output%%Tax%%IGST%%' OR jea.account LIKE '%%IGST%%Output%%')
                THEN jea.credit_in_account_currency - jea.debit_in_account_currency ELSE 0 END) AS igst,
            SUM(CASE WHEN (jea.account LIKE '%%Output%%Tax%%CGST%%' OR jea.account LIKE '%%CGST%%Output%%')
                THEN jea.credit_in_account_currency - jea.debit_in_account_currency ELSE 0 END) AS cgst,
            SUM(CASE WHEN (jea.account LIKE '%%Output%%Tax%%SGST%%' OR jea.account LIKE '%%SGST%%Output%%'
                       OR jea.account LIKE '%%Output%%Tax%%UTGST%%')
                THEN jea.credit_in_account_currency - jea.debit_in_account_currency ELSE 0 END) AS sgst,
            SUM(CASE WHEN jea.account LIKE '%%Sales%%'
                THEN jea.debit_in_account_currency - jea.credit_in_account_currency ELSE 0 END) AS sales_amt
        FROM `tabJournal Entry Account` jea
        INNER JOIN `tabJournal Entry` je ON je.name = jea.parent
        WHERE je.docstatus = 1 AND je.company = %(company)s
          AND je.posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND je.voucher_type IN ('Credit Note', 'Debit Note', 'Journal Entry')
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    si_t = si_taxable[0] if si_taxable else {}
    si_x = si_taxes[0] if si_taxes else {}
    je_x = je_taxes[0] if je_taxes else {}

    total_taxable = flt(si_t.get("taxable_amt"), 2) - \
        flt(je_x.get("sales_amt"), 2)
    total_igst = flt(si_x.get("igst"), 2) + flt(je_x.get("igst"), 2)
    total_cgst = flt(si_x.get("cgst"), 2) + flt(je_x.get("cgst"), 2)
    total_sgst = flt(si_x.get("sgst"), 2) + flt(je_x.get("sgst"), 2)

    rate_result = frappe.db.sql("""
        SELECT stc.rate FROM `tabSales Taxes and Charges` stc
        INNER JOIN `tabSales Invoice` si ON si.name = stc.parent
        WHERE si.company = %(company)s AND si.posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND si.docstatus = 1 AND si.is_return = 0 AND stc.rate > 0
        ORDER BY stc.rate DESC LIMIT 1
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    tax_rate = flt(rate_result[0]["rate"], 2) if rate_result and rate_result[0].get(
        "rate") else 18.0

    return {
        "taxable_amt": flt(total_taxable, 2),
        "igst": flt(total_igst, 2), "cgst": flt(total_cgst, 2), "sgst": flt(total_sgst, 2),
        "total_gst": flt(total_igst + total_cgst + total_sgst, 2),
        "tax_rate": tax_rate
    }


def get_credit_notes_gst(company, from_date, to_date):
    """Credit Notes — Sales Invoice with is_return=1."""

    cn_taxable = frappe.db.sql("""
        SELECT SUM(ABS(base_net_total)) AS taxable_amt
        FROM `tabSales Invoice`
        WHERE docstatus = 1 AND company = %(company)s
          AND posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND is_return = 1
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    cn_taxes = frappe.db.sql("""
        SELECT
            SUM(CASE WHEN (stc.description LIKE '%%IGST%%' OR stc.account_head LIKE '%%IGST%%'
                       OR stc.description LIKE '%%Integrated%%')
                THEN ABS(stc.base_tax_amount) ELSE 0 END) AS igst,
            SUM(CASE WHEN (stc.description LIKE '%%CGST%%' OR stc.account_head LIKE '%%CGST%%'
                       OR stc.description LIKE '%%Central%%')
                THEN ABS(stc.base_tax_amount) ELSE 0 END) AS cgst,
            SUM(CASE WHEN (stc.description LIKE '%%SGST%%' OR stc.account_head LIKE '%%SGST%%'
                       OR stc.description LIKE '%%State%%' OR stc.description LIKE '%%UTGST%%')
                THEN ABS(stc.base_tax_amount) ELSE 0 END) AS sgst
        FROM `tabSales Taxes and Charges` stc
        INNER JOIN `tabSales Invoice` si ON si.name = stc.parent
        WHERE si.docstatus = 1 AND si.company = %(company)s
          AND si.posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND si.is_return = 1
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    cn_t = cn_taxable[0] if cn_taxable else {}
    cn_x = cn_taxes[0] if cn_taxes else {}

    igst = flt(cn_x.get("igst"), 2)
    cgst = flt(cn_x.get("cgst"), 2)
    sgst = flt(cn_x.get("sgst"), 2)

    return {
        "taxable_amt": flt(cn_t.get("taxable_amt"), 2),
        "igst": igst, "cgst": cgst, "sgst": sgst,
        "total_gst": flt(igst + cgst + sgst, 2)
    }


def get_purchase_gst(company, from_date, to_date):
    """Normal Purchase Invoices only (is_return=0). JE debits still included."""

    pi_taxable = frappe.db.sql("""
        SELECT SUM(base_net_total) AS taxable_amt
        FROM `tabPurchase Invoice`
        WHERE docstatus = 1 AND company = %(company)s
          AND posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND is_return = 0
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    pi_taxes = frappe.db.sql("""
        SELECT
            SUM(CASE WHEN (ptc.description LIKE '%%IGST%%' OR ptc.account_head LIKE '%%IGST%%'
                       OR ptc.description LIKE '%%Integrated%%')
                THEN ptc.base_tax_amount ELSE 0 END) AS igst,
            SUM(CASE WHEN (ptc.description LIKE '%%CGST%%' OR ptc.account_head LIKE '%%CGST%%'
                       OR ptc.description LIKE '%%Central%%')
                THEN ptc.base_tax_amount ELSE 0 END) AS cgst,
            SUM(CASE WHEN (ptc.description LIKE '%%SGST%%' OR ptc.account_head LIKE '%%SGST%%'
                       OR ptc.description LIKE '%%State%%' OR ptc.description LIKE '%%UTGST%%')
                THEN ptc.base_tax_amount ELSE 0 END) AS sgst
        FROM `tabPurchase Taxes and Charges` ptc
        INNER JOIN `tabPurchase Invoice` pi ON pi.name = ptc.parent
        WHERE pi.docstatus = 1 AND pi.company = %(company)s
          AND pi.posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND pi.is_return = 0
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    je_taxes = frappe.db.sql("""
        SELECT
            SUM(CASE WHEN (jea.account LIKE '%%Input%%Tax%%IGST%%' OR jea.account LIKE '%%IGST%%Input%%')
                THEN jea.debit_in_account_currency - jea.credit_in_account_currency ELSE 0 END) AS igst,
            SUM(CASE WHEN (jea.account LIKE '%%Input%%Tax%%CGST%%' OR jea.account LIKE '%%CGST%%Input%%')
                THEN jea.debit_in_account_currency - jea.credit_in_account_currency ELSE 0 END) AS cgst,
            SUM(CASE WHEN (jea.account LIKE '%%Input%%Tax%%SGST%%' OR jea.account LIKE '%%SGST%%Input%%'
                       OR jea.account LIKE '%%Input%%Tax%%UTGST%%')
                THEN jea.debit_in_account_currency - jea.credit_in_account_currency ELSE 0 END) AS sgst
        FROM `tabJournal Entry Account` jea
        INNER JOIN `tabJournal Entry` je ON je.name = jea.parent
        WHERE je.docstatus = 1 AND je.company = %(company)s
          AND je.posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND je.voucher_type IN ('Credit Note', 'Debit Note', 'Journal Entry')
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    pi_t = pi_taxable[0] if pi_taxable else {}
    pi_x = pi_taxes[0] if pi_taxes else {}
    je_x = je_taxes[0] if je_taxes else {}

    total_taxable = flt(pi_t.get("taxable_amt"), 2)
    total_igst = flt(pi_x.get("igst"), 2) + flt(je_x.get("igst"), 2)
    total_cgst = flt(pi_x.get("cgst"), 2) + flt(je_x.get("cgst"), 2)
    total_sgst = flt(pi_x.get("sgst"), 2) + flt(je_x.get("sgst"), 2)

    rate_result = frappe.db.sql("""
        SELECT ptc.rate FROM `tabPurchase Taxes and Charges` ptc
        INNER JOIN `tabPurchase Invoice` pi ON pi.name = ptc.parent
        WHERE pi.company = %(company)s AND pi.posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND pi.docstatus = 1 AND pi.is_return = 0 AND ptc.rate > 0
        ORDER BY ptc.rate DESC LIMIT 1
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    tax_rate = flt(rate_result[0]["rate"], 2) if rate_result and rate_result[0].get(
        "rate") else 18.0

    return {
        "taxable_amt": flt(total_taxable, 2),
        "igst": flt(total_igst, 2), "cgst": flt(total_cgst, 2), "sgst": flt(total_sgst, 2),
        "total_gst": flt(total_igst + total_cgst + total_sgst, 2),
        "tax_rate": tax_rate
    }


def get_debit_notes_gst(company, from_date, to_date):
    """Debit Notes — Purchase Invoice with is_return=1."""

    dn_taxable = frappe.db.sql("""
        SELECT SUM(ABS(base_net_total)) AS taxable_amt
        FROM `tabPurchase Invoice`
        WHERE docstatus = 1 AND company = %(company)s
          AND posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND is_return = 1
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    dn_taxes = frappe.db.sql("""
        SELECT
            SUM(CASE WHEN (ptc.description LIKE '%%IGST%%' OR ptc.account_head LIKE '%%IGST%%'
                       OR ptc.description LIKE '%%Integrated%%')
                THEN ABS(ptc.base_tax_amount) ELSE 0 END) AS igst,
            SUM(CASE WHEN (ptc.description LIKE '%%CGST%%' OR ptc.account_head LIKE '%%CGST%%'
                       OR ptc.description LIKE '%%Central%%')
                THEN ABS(ptc.base_tax_amount) ELSE 0 END) AS cgst,
            SUM(CASE WHEN (ptc.description LIKE '%%SGST%%' OR ptc.account_head LIKE '%%SGST%%'
                       OR ptc.description LIKE '%%State%%' OR ptc.description LIKE '%%UTGST%%')
                THEN ABS(ptc.base_tax_amount) ELSE 0 END) AS sgst
        FROM `tabPurchase Taxes and Charges` ptc
        INNER JOIN `tabPurchase Invoice` pi ON pi.name = ptc.parent
        WHERE pi.docstatus = 1 AND pi.company = %(company)s
          AND pi.posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND pi.is_return = 1
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    dn_t = dn_taxable[0] if dn_taxable else {}
    dn_x = dn_taxes[0] if dn_taxes else {}

    igst = flt(dn_x.get("igst"), 2)
    cgst = flt(dn_x.get("cgst"), 2)
    sgst = flt(dn_x.get("sgst"), 2)

    return {
        "taxable_amt": flt(dn_t.get("taxable_amt"), 2),
        "igst": igst, "cgst": cgst, "sgst": sgst,
        "total_gst": flt(igst + cgst + sgst, 2)
    }


def get_previous_sales_due(company, current_from_date):
    si_result = frappe.db.sql("""
        SELECT
            SUM(CASE WHEN (stc.description LIKE '%%IGST%%' OR stc.account_head LIKE '%%IGST%%'
                       OR stc.description LIKE '%%Integrated%%')
                THEN stc.base_tax_amount ELSE 0 END) AS igst,
            SUM(CASE WHEN (stc.description LIKE '%%CGST%%' OR stc.account_head LIKE '%%CGST%%'
                       OR stc.description LIKE '%%Central%%')
                THEN stc.base_tax_amount ELSE 0 END) AS cgst,
            SUM(CASE WHEN (stc.description LIKE '%%SGST%%' OR stc.account_head LIKE '%%SGST%%'
                       OR stc.description LIKE '%%State%%' OR stc.description LIKE '%%UTGST%%')
                THEN stc.base_tax_amount ELSE 0 END) AS sgst
        FROM `tabSales Taxes and Charges` stc
        INNER JOIN `tabSales Invoice` si ON si.name = stc.parent
        WHERE si.company = %(company)s AND si.posting_date < %(from_date)s
          AND si.docstatus = 1 AND si.is_return = 0 
    """, {"company": company, "from_date": current_from_date}, as_dict=True)

    je_result = frappe.db.sql("""
        SELECT
            SUM(CASE WHEN (jea.account LIKE '%%Output%%Tax%%IGST%%' OR jea.account LIKE '%%IGST%%Output%%')
                THEN jea.credit_in_account_currency - jea.debit_in_account_currency ELSE 0 END) AS igst,
            SUM(CASE WHEN (jea.account LIKE '%%Output%%Tax%%CGST%%' OR jea.account LIKE '%%CGST%%Output%%')
                THEN jea.credit_in_account_currency - jea.debit_in_account_currency ELSE 0 END) AS cgst,
            SUM(CASE WHEN (jea.account LIKE '%%Output%%Tax%%SGST%%' OR jea.account LIKE '%%SGST%%Output%%'
                       OR jea.account LIKE '%%Output%%Tax%%UTGST%%')
                THEN jea.credit_in_account_currency - jea.debit_in_account_currency ELSE 0 END) AS sgst
        FROM `tabJournal Entry Account` jea
        INNER JOIN `tabJournal Entry` je ON je.name = jea.parent
        WHERE je.company = %(company)s AND je.posting_date < %(from_date)s AND je.docstatus = 1
    """, {"company": company, "from_date": current_from_date}, as_dict=True)

    si_r = si_result[0] if si_result else {}
    je_r = je_result[0] if je_result else {}
    return (
        flt(flt(si_r.get("igst"), 2) + flt(je_r.get("igst"), 2), 2),
        flt(flt(si_r.get("cgst"), 2) + flt(je_r.get("cgst"), 2), 2),
        flt(flt(si_r.get("sgst"), 2) + flt(je_r.get("sgst"), 2), 2)
    )


def get_previous_itc(company, current_from_date):
    pi_result = frappe.db.sql("""
        SELECT
            SUM(CASE WHEN (ptc.description LIKE '%%IGST%%' OR ptc.account_head LIKE '%%IGST%%'
                       OR ptc.description LIKE '%%Integrated%%')
                THEN ptc.base_tax_amount ELSE 0 END) AS igst,
            SUM(CASE WHEN (ptc.description LIKE '%%CGST%%' OR ptc.account_head LIKE '%%CGST%%'
                       OR ptc.description LIKE '%%Central%%')
                THEN ptc.base_tax_amount ELSE 0 END) AS cgst,
            SUM(CASE WHEN (ptc.description LIKE '%%SGST%%' OR ptc.account_head LIKE '%%SGST%%'
                       OR ptc.description LIKE '%%State%%' OR ptc.description LIKE '%%UTGST%%')
                THEN ptc.base_tax_amount ELSE 0 END) AS sgst
        FROM `tabPurchase Taxes and Charges` ptc
        INNER JOIN `tabPurchase Invoice` pi ON pi.name = ptc.parent
        WHERE pi.company = %(company)s AND pi.posting_date < %(from_date)s
          AND pi.docstatus = 1 AND pi.is_return = 0
    """, {"company": company, "from_date": current_from_date}, as_dict=True)

    je_result = frappe.db.sql("""
        SELECT
            SUM(CASE WHEN (jea.account LIKE '%%Input%%Tax%%IGST%%' OR jea.account LIKE '%%IGST%%Input%%')
                THEN jea.debit_in_account_currency - jea.credit_in_account_currency ELSE 0 END) AS igst,
            SUM(CASE WHEN (jea.account LIKE '%%Input%%Tax%%CGST%%' OR jea.account LIKE '%%CGST%%Input%%')
                THEN jea.debit_in_account_currency - jea.credit_in_account_currency ELSE 0 END) AS cgst,
            SUM(CASE WHEN (jea.account LIKE '%%Input%%Tax%%SGST%%' OR jea.account LIKE '%%SGST%%Input%%'
                       OR jea.account LIKE '%%Input%%Tax%%UTGST%%')
                THEN jea.debit_in_account_currency - jea.credit_in_account_currency ELSE 0 END) AS sgst
        FROM `tabJournal Entry Account` jea
        INNER JOIN `tabJournal Entry` je ON je.name = jea.parent
        WHERE je.company = %(company)s AND je.posting_date < %(from_date)s AND je.docstatus = 1
    """, {"company": company, "from_date": current_from_date}, as_dict=True)

    pi_r = pi_result[0] if pi_result else {}
    je_r = je_result[0] if je_result else {}
    return (
        flt(flt(pi_r.get("igst"), 2) + flt(je_r.get("igst"), 2), 2),
        flt(flt(pi_r.get("cgst"), 2) + flt(je_r.get("cgst"), 2), 2),
        flt(flt(pi_r.get("sgst"), 2) + flt(je_r.get("sgst"), 2), 2)
    )


# ── UTILISATION ────────────────────────────────────────────────────────────

def calculate_utilisation(pay_igst, pay_cgst, pay_sgst, avl_igst, avl_cgst, avl_sgst):
    rem_igst = flt(avl_igst, 2)
    rem_cgst = flt(avl_cgst, 2)
    rem_sgst = flt(avl_sgst, 2)

    u_ig_ig = min(pay_igst, rem_igst)
    rem_igst -= u_ig_ig
    igst_due = flt(pay_igst - u_ig_ig, 2)
    u_ig_cg = min(pay_cgst, rem_igst)
    rem_igst -= u_ig_cg
    cgst_due = flt(pay_cgst - u_ig_cg, 2)
    u_ig_sg = min(pay_sgst, rem_igst)
    rem_igst -= u_ig_sg
    sgst_due = flt(pay_sgst - u_ig_sg, 2)
    u_cg_ig = min(igst_due, rem_cgst)
    rem_cgst -= u_cg_ig
    igst_due = flt(igst_due - u_cg_ig, 2)
    u_cg_cg = min(cgst_due, rem_cgst)
    rem_cgst -= u_cg_cg
    cgst_due = flt(cgst_due - u_cg_cg, 2)
    u_sg_ig = min(igst_due, rem_sgst)
    rem_sgst -= u_sg_ig
    igst_due = flt(igst_due - u_sg_ig, 2)
    u_sg_sg = min(sgst_due, rem_sgst)
    rem_sgst -= u_sg_sg
    sgst_due = flt(sgst_due - u_sg_sg, 2)

    return {
        "igst_used": flt(u_ig_ig + u_ig_cg + u_ig_sg, 2),
        "cgst_used": flt(u_cg_ig + u_cg_cg, 2),
        "sgst_used": flt(u_sg_ig + u_sg_sg, 2),
        "igst_net":  flt(igst_due, 2),
        "cgst_net":  flt(cgst_due, 2),
        "sgst_net":  flt(sgst_due, 2),
    }


# ── ROW HELPERS ────────────────────────────────────────────────────────────

def make_row(particular, taxable_amt, igst, cgst, sgst, total_gst):
    return {"particular": particular, "taxable_amt": flt(taxable_amt, 2),
            "igst": flt(igst, 2), "cgst": flt(cgst, 2), "sgst": flt(sgst, 2), "total_gst": flt(total_gst, 2)}


def make_total(particular, taxable_amt, igst, cgst, sgst, total_gst):
    return {"particular": frappe.bold(particular), "taxable_amt": flt(taxable_amt, 2),
            "igst": flt(igst, 2), "cgst": flt(cgst, 2), "sgst": flt(sgst, 2), "total_gst": flt(total_gst, 2)}


def make_section(label):
    return {"particular": frappe.bold(label),
            "taxable_amt": None, "igst": None, "cgst": None, "sgst": None, "total_gst": None}


def make_blank():
    return {"particular": "", "taxable_amt": None, "igst": None, "cgst": None, "sgst": None, "total_gst": None}
