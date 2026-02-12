# GST Monthly CA Summary – Script Report for ERPNext
# -----------------------------------------------------------------------
# Works with standard ERPNext tables (no India Compliance dependency)
# Reads from: Sales Invoice, Purchase Invoice + their tax child tables
# -----------------------------------------------------------------------

import frappe
from frappe.utils import getdate, flt


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
            "fieldtype": "Data",     "width": 240},
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

    # Current period
    sales = get_sales_gst(company, from_date, to_date)
    purch = get_purchase_gst(company, from_date, to_date)

    # Previous period carry-forward
    prev_sales_igst, prev_sales_cgst, prev_sales_sgst = get_previous_sales_due(
        company, from_date)
    prev_itc_igst,   prev_itc_cgst,   prev_itc_sgst = get_previous_itc(
        company, from_date)

    # Sales totals
    total_sales_taxable = flt(sales.get("taxable_amt"), 2)
    total_sales_igst = flt(sales.get("igst"), 2) + flt(prev_sales_igst, 2)
    total_sales_cgst = flt(sales.get("cgst"), 2) + flt(prev_sales_cgst, 2)
    total_sales_sgst = flt(sales.get("sgst"), 2) + flt(prev_sales_sgst, 2)
    total_sales_gst = flt(
        total_sales_igst + total_sales_cgst + total_sales_sgst, 2)
    prev_sales_total = flt(
        prev_sales_igst + prev_sales_cgst + prev_sales_sgst, 2)
    cur_sales_gst = flt(sales.get("igst", 0) +
                        sales.get("cgst", 0) + sales.get("sgst", 0), 2)

    # Purchase totals
    total_purch_taxable = flt(purch.get("taxable_amt"), 2)
    total_itc_igst = flt(purch.get("igst"), 2) + flt(prev_itc_igst, 2)
    total_itc_cgst = flt(purch.get("cgst"), 2) + flt(prev_itc_cgst, 2)
    total_itc_sgst = flt(purch.get("sgst"), 2) + flt(prev_itc_sgst, 2)
    total_itc_gst = flt(total_itc_igst + total_itc_cgst + total_itc_sgst, 2)
    prev_itc_total = flt(prev_itc_igst + prev_itc_cgst + prev_itc_sgst, 2)
    cur_purch_gst = flt(purch.get("igst", 0) +
                        purch.get("cgst", 0) + purch.get("sgst", 0), 2)

    # Surplus
    surplus_igst = flt(total_itc_igst - total_sales_igst, 2)
    surplus_cgst = flt(total_itc_cgst - total_sales_cgst, 2)
    surplus_sgst = flt(total_itc_sgst - total_sales_sgst, 2)
    net_surplus = flt(surplus_igst + surplus_cgst + surplus_sgst, 2)

    # Utilisation
    util = calculate_utilisation(
        total_sales_igst, total_sales_cgst, total_sales_sgst,
        total_itc_igst,   total_itc_cgst,   total_itc_sgst
    )

    # Carry forward
    carry_igst = flt(max(0, total_itc_igst - util["igst_used"]), 2)
    carry_cgst = flt(max(0, total_itc_cgst - util["cgst_used"]), 2)
    carry_sgst = flt(max(0, total_itc_sgst - util["sgst_used"]), 2)
    carry_total = flt(carry_igst + carry_cgst + carry_sgst, 2)

    tax_rate = str(flt(sales.get("tax_rate", 18.0), 2))

    rows = []

    # SECTION A: SALES LIABILITY
    rows.append(make_section("SALES LIABILITY"))
    rows.append(make_row("Previous Due",
                         0, flt(prev_sales_igst, 2), flt(prev_sales_cgst, 2), flt(prev_sales_sgst, 2), prev_sales_total))
    rows.append(make_row("Sales @ " + tax_rate + "%",
                         total_sales_taxable, flt(sales.get("igst"), 2),
                         flt(sales.get("cgst"), 2), flt(sales.get("sgst"), 2), cur_sales_gst))
    rows.append(make_total("TOTAL LIABILITY",
                           total_sales_taxable, total_sales_igst, total_sales_cgst, total_sales_sgst, total_sales_gst))
    rows.append(make_blank())

    # SECTION B: PURCHASE ITC
    rows.append(make_section("PURCHASE ITC"))
    rows.append(make_row("Previous ITC",
                         0, flt(prev_itc_igst, 2), flt(prev_itc_cgst, 2), flt(prev_itc_sgst, 2), prev_itc_total))
    rows.append(make_row("Purchase @ " + tax_rate + "%",
                         total_purch_taxable, flt(purch.get("igst"), 2),
                         flt(purch.get("cgst"), 2), flt(purch.get("sgst"), 2), cur_purch_gst))
    rows.append(make_total("TOTAL AVAILABLE ITC",
                           total_purch_taxable, total_itc_igst, total_itc_cgst, total_itc_sgst, total_itc_gst))
    rows.append(make_blank())

    # SECTION C: POSITION BEFORE UTILISATION
    rows.append(make_section("GST POSITION BEFORE UTILISATION"))
    rows.append(make_row("GST Payable (Before Utilisation)",
                         0, total_sales_igst, total_sales_cgst, total_sales_sgst, total_sales_gst))
    rows.append(make_row("GST Available ITC",
                         0, total_itc_igst, total_itc_cgst, total_itc_sgst, total_itc_gst))
    rows.append(make_total("NET GST AVAILABLE (SURPLUS)",
                           0, surplus_igst, surplus_cgst, surplus_sgst, net_surplus))
    rows.append(make_blank())

    # SECTION D: UTILISATION
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
    net_cash = flt(util["igst_net"] + util["cgst_net"] + util["sgst_net"], 2)
    rows.append(make_total("TOTAL GST PAYABLE (CASH)",
                           0, util["igst_net"], util["cgst_net"], util["sgst_net"], net_cash))
    rows.append(make_blank())

    # SECTION E: CARRY FORWARD
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


# ─────────────────────────────────────────────────────────────────────────────
# DATA QUERIES — Standard ERPNext tables
# ─────────────────────────────────────────────────────────────────────────────

def get_sales_gst(company, from_date, to_date):
    """
    Query Sales Invoice + Sales Taxes and Charges child table.
    Identifies IGST/CGST/SGST by account head description.
    """
    # Get taxable amount
    taxable = frappe.db.sql("""
        SELECT SUM(base_net_total) AS taxable_amt
        FROM `tabSales Invoice`
        WHERE
            docstatus    = 1
            AND company  = %(company)s
            AND posting_date BETWEEN %(from_date)s AND %(to_date)s
            AND is_return = 0
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    # Get tax amounts by type
    taxes = frappe.db.sql("""
        SELECT
            SUM(CASE
                WHEN (stc.description LIKE '%%IGST%%'
                  OR  stc.account_head LIKE '%%IGST%%'
                  OR  stc.description LIKE '%%Integrated%%')
                THEN stc.base_tax_amount ELSE 0 END) AS igst,
            SUM(CASE
                WHEN (stc.description LIKE '%%CGST%%'
                  OR  stc.account_head LIKE '%%CGST%%'
                  OR  stc.description LIKE '%%Central%%')
                THEN stc.base_tax_amount ELSE 0 END) AS cgst,
            SUM(CASE
                WHEN (stc.description LIKE '%%SGST%%'
                  OR  stc.account_head LIKE '%%SGST%%'
                  OR  stc.description LIKE '%%State%%'
                  OR  stc.description LIKE '%%UTGST%%')
                THEN stc.base_tax_amount ELSE 0 END) AS sgst
        FROM `tabSales Taxes and Charges` stc
        INNER JOIN `tabSales Invoice` si ON si.name = stc.parent
        WHERE
            si.docstatus    = 1
            AND si.company  = %(company)s
            AND si.posting_date BETWEEN %(from_date)s AND %(to_date)s
            AND si.is_return = 0
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    t = taxable[0] if taxable else {}
    x = taxes[0] if taxes else {}

    igst = flt(x.get("igst"), 2)
    cgst = flt(x.get("cgst"), 2)
    sgst = flt(x.get("sgst"), 2)

    # Auto-detect tax rate
    rate_result = frappe.db.sql("""
        SELECT stc.rate
        FROM `tabSales Taxes and Charges` stc
        INNER JOIN `tabSales Invoice` si ON si.name = stc.parent
        WHERE
            si.company      = %(company)s
            AND si.posting_date BETWEEN %(from_date)s AND %(to_date)s
            AND si.docstatus = 1
            AND stc.rate     > 0
        ORDER BY stc.rate DESC
        LIMIT 1
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    tax_rate = flt(rate_result[0]["rate"], 2) if rate_result and rate_result[0].get(
        "rate") else 18.0

    return {
        "taxable_amt": flt(t.get("taxable_amt"), 2),
        "igst": igst, "cgst": cgst, "sgst": sgst,
        "total_gst": flt(igst + cgst + sgst, 2),
        "tax_rate": tax_rate
    }


def get_purchase_gst(company, from_date, to_date):
    """Query Purchase Invoice + Purchase Taxes and Charges."""
    taxable = frappe.db.sql("""
        SELECT SUM(base_net_total) AS taxable_amt
        FROM `tabPurchase Invoice`
        WHERE
            docstatus    = 1
            AND company  = %(company)s
            AND posting_date BETWEEN %(from_date)s AND %(to_date)s
            AND is_return = 0
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    taxes = frappe.db.sql("""
        SELECT
            SUM(CASE
                WHEN (ptc.description LIKE '%%IGST%%'
                  OR  ptc.account_head LIKE '%%IGST%%'
                  OR  ptc.description LIKE '%%Integrated%%')
                THEN ptc.base_tax_amount ELSE 0 END) AS igst,
            SUM(CASE
                WHEN (ptc.description LIKE '%%CGST%%'
                  OR  ptc.account_head LIKE '%%CGST%%'
                  OR  ptc.description LIKE '%%Central%%')
                THEN ptc.base_tax_amount ELSE 0 END) AS cgst,
            SUM(CASE
                WHEN (ptc.description LIKE '%%SGST%%'
                  OR  ptc.account_head LIKE '%%SGST%%'
                  OR  ptc.description LIKE '%%State%%'
                  OR  ptc.description LIKE '%%UTGST%%')
                THEN ptc.base_tax_amount ELSE 0 END) AS sgst
        FROM `tabPurchase Taxes and Charges` ptc
        INNER JOIN `tabPurchase Invoice` pi ON pi.name = ptc.parent
        WHERE
            pi.docstatus    = 1
            AND pi.company  = %(company)s
            AND pi.posting_date BETWEEN %(from_date)s AND %(to_date)s
            AND pi.is_return = 0
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    t = taxable[0] if taxable else {}
    x = taxes[0] if taxes else {}

    igst = flt(x.get("igst"), 2)
    cgst = flt(x.get("cgst"), 2)
    sgst = flt(x.get("sgst"), 2)

    rate_result = frappe.db.sql("""
        SELECT ptc.rate
        FROM `tabPurchase Taxes and Charges` ptc
        INNER JOIN `tabPurchase Invoice` pi ON pi.name = ptc.parent
        WHERE
            pi.company      = %(company)s
            AND pi.posting_date BETWEEN %(from_date)s AND %(to_date)s
            AND pi.docstatus = 1
            AND ptc.rate     > 0
        ORDER BY ptc.rate DESC
        LIMIT 1
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    tax_rate = flt(rate_result[0]["rate"], 2) if rate_result and rate_result[0].get(
        "rate") else 18.0

    return {
        "taxable_amt": flt(t.get("taxable_amt"), 2),
        "igst": igst, "cgst": cgst, "sgst": sgst,
        "total_gst": flt(igst + cgst + sgst, 2),
        "tax_rate": tax_rate
    }


def get_previous_sales_due(company, current_from_date):
    """Get unpaid sales GST from before this period."""
    result = frappe.db.sql("""
        SELECT
            SUM(CASE
                WHEN (stc.description LIKE '%%IGST%%'
                  OR  stc.account_head LIKE '%%IGST%%'
                  OR  stc.description LIKE '%%Integrated%%')
                THEN stc.base_tax_amount ELSE 0 END) AS igst,
            SUM(CASE
                WHEN (stc.description LIKE '%%CGST%%'
                  OR  stc.account_head LIKE '%%CGST%%'
                  OR  stc.description LIKE '%%Central%%')
                THEN stc.base_tax_amount ELSE 0 END) AS cgst,
            SUM(CASE
                WHEN (stc.description LIKE '%%SGST%%'
                  OR  stc.account_head LIKE '%%SGST%%'
                  OR  stc.description LIKE '%%State%%'
                  OR  stc.description LIKE '%%UTGST%%')
                THEN stc.base_tax_amount ELSE 0 END) AS sgst
        FROM `tabSales Taxes and Charges` stc
        INNER JOIN `tabSales Invoice` si ON si.name = stc.parent
        WHERE
            si.company       = %(company)s
            AND si.posting_date < %(from_date)s
            AND si.docstatus = 1
            AND si.is_return  = 0
    """, {"company": company, "from_date": current_from_date}, as_dict=True)

    r = result[0] if result else {}
    return flt(r.get("igst"), 2), flt(r.get("cgst"), 2), flt(r.get("sgst"), 2)


def get_previous_itc(company, current_from_date):
    """Get unused purchase ITC from before this period."""
    result = frappe.db.sql("""
        SELECT
            SUM(CASE
                WHEN (ptc.description LIKE '%%IGST%%'
                  OR  ptc.account_head LIKE '%%IGST%%'
                  OR  ptc.description LIKE '%%Integrated%%')
                THEN ptc.base_tax_amount ELSE 0 END) AS igst,
            SUM(CASE
                WHEN (ptc.description LIKE '%%CGST%%'
                  OR  ptc.account_head LIKE '%%CGST%%'
                  OR  ptc.description LIKE '%%Central%%')
                THEN ptc.base_tax_amount ELSE 0 END) AS cgst,
            SUM(CASE
                WHEN (ptc.description LIKE '%%SGST%%'
                  OR  ptc.account_head LIKE '%%SGST%%'
                  OR  ptc.description LIKE '%%State%%'
                  OR  ptc.description LIKE '%%UTGST%%')
                THEN ptc.base_tax_amount ELSE 0 END) AS sgst
        FROM `tabPurchase Taxes and Charges` ptc
        INNER JOIN `tabPurchase Invoice` pi ON pi.name = ptc.parent
        WHERE
            pi.company       = %(company)s
            AND pi.posting_date < %(from_date)s
            AND pi.docstatus = 1
            AND pi.is_return  = 0
    """, {"company": company, "from_date": current_from_date}, as_dict=True)

    r = result[0] if result else {}
    return flt(r.get("igst"), 2), flt(r.get("cgst"), 2), flt(r.get("sgst"), 2)


# ─────────────────────────────────────────────────────────────────────────────
# UTILISATION
# ─────────────────────────────────────────────────────────────────────────────

def calculate_utilisation(pay_igst, pay_cgst, pay_sgst,
                          avl_igst, avl_cgst, avl_sgst):
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


# ─────────────────────────────────────────────────────────────────────────────
# ROW HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def make_row(particular, taxable_amt, igst, cgst, sgst, total_gst):
    return {
        "particular":  particular,
        "taxable_amt": flt(taxable_amt, 2),
        "igst":        flt(igst, 2),
        "cgst":        flt(cgst, 2),
        "sgst":        flt(sgst, 2),
        "total_gst":   flt(total_gst, 2),
    }


def make_total(particular, taxable_amt, igst, cgst, sgst, total_gst):
    return {
        "particular":  frappe.bold(particular),
        "taxable_amt": flt(taxable_amt, 2),
        "igst":        flt(igst, 2),
        "cgst":        flt(cgst, 2),
        "sgst":        flt(sgst, 2),
        "total_gst":   flt(total_gst, 2),
    }


def make_section(label):
    return {
        "particular":  frappe.bold(label),
        "taxable_amt": None,
        "igst":        None,
        "cgst":        None,
        "sgst":        None,
        "total_gst":   None,
    }


def make_blank():
    return {
        "particular":  "",
        "taxable_amt": None,
        "igst":        None,
        "cgst":        None,
        "sgst":        None,
        "total_gst":   None,
    }
