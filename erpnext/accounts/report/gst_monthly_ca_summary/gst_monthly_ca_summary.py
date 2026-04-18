# GST Monthly CA Summary – Script Report for ERPNext v15
# -----------------------------------------------------------------------
# Uses GL Entry (same source as India Compliance GST Balance report)
# for accurate figures — reads actual accounting entries, not tax child tables
#
# GL Entry logic:
#   Output GST accounts (CGST/SGST/IGST Output):
#     credit = GST collected on sales (liability created)
#     debit  = GST paid to govt / set off / credit notes
#     Net liability = credit - debit
#
#   Input GST accounts (CGST/SGST/IGST Input):
#     debit  = ITC received on purchases
#     credit = ITC used for set off / debit notes
#     Net ITC = debit - credit
#
#   Previous Due  = previous month closing Net Liability  (if > 0)
#   Previous ITC  = previous month closing Net ITC        (if > 0)
# -----------------------------------------------------------------------

import frappe
from frappe.utils import getdate, flt
from datetime import timedelta


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


# ── MAIN REPORT ────────────────────────────────────────────────────────────

def get_report_data(filters):
    company = filters.get("company")
    from_date = filters.get("from_date")
    to_date = filters.get("to_date")

    # ── Classify GST accounts ─────────────────────────────────────────
    accounts = get_gst_accounts_classified(company)

    # ── Current period GL balances ────────────────────────────────────
    cur_gl = get_gl_balance(company, from_date, to_date)

    # Current period Output (credit - debit on Output accounts)
    cur_out = sum_accounts(cur_gl, accounts["output"])   # {igst, cgst, sgst}

    # Current period Input ITC (debit - credit on Input accounts)
    cur_itc = sum_accounts(cur_gl, accounts["input"])    # {igst, cgst, sgst}

    # ── Taxable amounts from invoice tables (for display only) ────────
    taxable = get_taxable_amounts(company, from_date, to_date)

    # ── Previous month closing balances ───────────────────────────────
    prev_from, prev_to = get_prev_month_range(from_date)
    prev_gl_closing = get_gl_balance(company, "1900-01-01", str(prev_to))

    prev_out_closing = sum_accounts(prev_gl_closing, accounts["output"])
    prev_itc_closing = sum_accounts(prev_gl_closing, accounts["input"])

    # Previous Due  = Output net liability at end of prev month (if > 0)
    prev_sales_igst = flt(max(0, prev_out_closing["igst"]), 2)
    prev_sales_cgst = flt(max(0, prev_out_closing["cgst"]), 2)
    prev_sales_sgst = flt(max(0, prev_out_closing["sgst"]), 2)
    prev_sales_total = flt(
        prev_sales_igst + prev_sales_cgst + prev_sales_sgst, 2)

    # Previous ITC  = Input net ITC at end of prev month (if > 0)
    prev_itc_igst = flt(max(0, prev_itc_closing["igst"]), 2)
    prev_itc_cgst = flt(max(0, prev_itc_closing["cgst"]), 2)
    prev_itc_sgst = flt(max(0, prev_itc_closing["sgst"]), 2)
    prev_itc_total = flt(prev_itc_igst + prev_itc_cgst + prev_itc_sgst, 2)

    # ── Current period net values ─────────────────────────────────────
    cur_sales_igst = flt(cur_out["igst"], 2)
    cur_sales_cgst = flt(cur_out["cgst"], 2)
    cur_sales_sgst = flt(cur_out["sgst"], 2)
    cur_sales_taxable = flt(taxable.get("sales_taxable", 0), 2)
    cur_sales_gst = flt(cur_sales_igst + cur_sales_cgst + cur_sales_sgst, 2)

    cur_purch_igst = flt(cur_itc["igst"], 2)
    cur_purch_cgst = flt(cur_itc["cgst"], 2)
    cur_purch_sgst = flt(cur_itc["sgst"], 2)
    cur_purch_taxable = flt(taxable.get("purch_taxable", 0), 2)
    cur_purch_gst = flt(cur_purch_igst + cur_purch_cgst + cur_purch_sgst, 2)

    # ── Totals ────────────────────────────────────────────────────────
    total_sales_igst = flt(cur_sales_igst + prev_sales_igst, 2)
    total_sales_cgst = flt(cur_sales_cgst + prev_sales_cgst, 2)
    total_sales_sgst = flt(cur_sales_sgst + prev_sales_sgst, 2)
    total_sales_gst = flt(
        total_sales_igst + total_sales_cgst + total_sales_sgst, 2)

    total_itc_igst = flt(cur_purch_igst + prev_itc_igst, 2)
    total_itc_cgst = flt(cur_purch_cgst + prev_itc_cgst, 2)
    total_itc_sgst = flt(cur_purch_sgst + prev_itc_sgst, 2)
    total_itc_gst = flt(total_itc_igst + total_itc_cgst + total_itc_sgst, 2)

    # ── Surplus / Utilisation / Carry ─────────────────────────────────
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

    tax_rate = str(flt(taxable.get("tax_rate", 18.0), 2))

    rows = []

    # ─── SECTION A: SALES LIABILITY ──────────────────────────────────
    rows.append(make_section("SALES LIABILITY"))
    rows.append(make_row("Previous Due",
                         0, prev_sales_igst, prev_sales_cgst, prev_sales_sgst, prev_sales_total))
    rows.append(make_row("Output GST @ " + tax_rate + "% (Current Month)",
                         cur_sales_taxable, cur_sales_igst, cur_sales_cgst, cur_sales_sgst, cur_sales_gst))
    rows.append(make_total("TOTAL LIABILITY",
                           cur_sales_taxable, total_sales_igst, total_sales_cgst, total_sales_sgst, total_sales_gst))
    rows.append(make_blank())

    # ─── SECTION B: PURCHASE ITC ─────────────────────────────────────
    rows.append(make_section("PURCHASE ITC"))
    rows.append(make_row("Previous ITC",
                         0, prev_itc_igst, prev_itc_cgst, prev_itc_sgst, prev_itc_total))
    rows.append(make_row("Input ITC @ " + tax_rate + "% (Current Month)",
                         cur_purch_taxable, cur_purch_igst, cur_purch_cgst, cur_purch_sgst, cur_purch_gst))
    rows.append(make_total("TOTAL AVAILABLE ITC",
                           cur_purch_taxable, total_itc_igst, total_itc_cgst, total_itc_sgst, total_itc_gst))
    rows.append(make_blank())

    # ─── SECTION C: POSITION ─────────────────────────────────────────
    rows.append(make_section("GST POSITION BEFORE UTILISATION"))
    rows.append(make_row("GST Payable (Before Utilisation)",
                         0, total_sales_igst, total_sales_cgst, total_sales_sgst, total_sales_gst))
    rows.append(make_row("GST Available ITC",
                         0, total_itc_igst, total_itc_cgst, total_itc_sgst, total_itc_gst))
    rows.append(make_total("NET GST AVAILABLE (SURPLUS)",
                           0, surplus_igst, surplus_cgst, surplus_sgst, net_surplus))
    rows.append(make_blank())

    # ─── SECTION D: UTILISATION ──────────────────────────────────────
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

    # ─── SECTION E: CARRY FORWARD ────────────────────────────────────
    rows.append(make_section("ITC AVAILABLE FOR NEXT MONTH"))
    rows.append(make_row("Available IGST", 0, carry_igst,
                0,         0,         carry_igst))
    rows.append(make_row("Available CGST", 0, 0,
                carry_cgst, 0,         carry_cgst))
    rows.append(make_row("Available SGST", 0, 0,
                0,          carry_sgst, carry_sgst))
    rows.append(make_total("TOTAL CARRY FORWARD ITC",
                           0, carry_igst, carry_cgst, carry_sgst, carry_total))

    return rows


# ── GL ENTRY BASED QUERIES ─────────────────────────────────────────────────

def get_gst_accounts_classified(company):
    """
    Find all GST accounts for this company and classify as:
      output: {igst: [...], cgst: [...], sgst: [...]}
      input:  {igst: [...], cgst: [...], sgst: [...]}

    Tries India Compliance first; falls back to account name pattern matching.
    """
    try:
        from india_compliance.gst_india.utils import get_all_gst_accounts
        all_accounts = get_all_gst_accounts(company)
    except Exception:
        all_accounts = []

    # If IC not available or returned empty, use pattern matching
    if not all_accounts:
        all_accounts = frappe.db.sql("""
            SELECT name FROM `tabAccount`
            WHERE company   = %(company)s
              AND account_type = 'Tax'
              AND disabled    = 0
              AND (
                   name LIKE '%%GST%%'
                OR name LIKE '%%CGST%%'
                OR name LIKE '%%SGST%%'
                OR name LIKE '%%IGST%%'
                OR name LIKE '%%UTGST%%'
              )
        """, {"company": company}, pluck="name")

    def classify(accounts, tax, side):
        """side: 'output' or 'input'"""
        result = []
        for acc in accounts:
            acc_lower = acc.lower()
            has_tax = tax.lower() in acc_lower
            is_out = "output" in acc_lower or "payable" in acc_lower
            is_inp = "input" in acc_lower or "receivable" in acc_lower or "itc" in acc_lower

            if not has_tax:
                continue
            if side == "output" and (is_out or (not is_inp)):
                result.append(acc)
            elif side == "input" and is_inp:
                result.append(acc)
        return result

    result = {
        "output": {
            "igst": classify(all_accounts, "igst", "output"),
            "cgst": classify(all_accounts, "cgst", "output"),
            "sgst": classify(all_accounts, "sgst", "output"),
        },
        "input": {
            "igst": classify(all_accounts, "igst", "input"),
            "cgst": classify(all_accounts, "cgst", "input"),
            "sgst": classify(all_accounts, "sgst", "input"),
        },
        "all_output": [],
        "all_input":  [],
    }

    result["all_output"] = (result["output"]["igst"] +
                            result["output"]["cgst"] +
                            result["output"]["sgst"])
    result["all_input"] = (result["input"]["igst"] +
                           result["input"]["cgst"] +
                           result["input"]["sgst"])
    return result


def get_gl_balance(company, from_date, to_date):
    """
    Get sum of debit and credit from GL Entry for each account
    in the given date range (inclusive).

    Returns: {account_name: {debit: x, credit: y}, ...}
    """
    if not from_date or not to_date:
        return {}

    result = frappe.db.sql("""
        SELECT
            account,
            SUM(debit)  AS debit,
            SUM(credit) AS credit
        FROM `tabGL Entry`
        WHERE company      = %(company)s
          AND posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND is_cancelled = 0
          AND (
               account LIKE '%%CGST%%'
            OR account LIKE '%%SGST%%'
            OR account LIKE '%%IGST%%'
            OR account LIKE '%%UTGST%%'
            OR account LIKE '%%GST%%'
          )
        GROUP BY account
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    return {row.account: row for row in result}


def sum_accounts(gl_data, account_group):
    """
    Sum GL debit/credit for each tax type across multiple accounts.

    For Output accounts: net = credit - debit (liability)
    For Input accounts:  net = debit - credit (ITC)

    account_group = {"igst": [...accounts], "cgst": [...], "sgst": [...]}
    Returns: {"igst": float, "cgst": float, "sgst": float}
    """
    result = {"igst": 0.0, "cgst": 0.0, "sgst": 0.0}

    for tax_type, accounts in account_group.items():
        if tax_type not in result:
            continue
        for acc in accounts:
            row = gl_data.get(acc, {})
            dr = flt(row.get("debit",  0))
            cr = flt(row.get("credit", 0))

            # Determine if this is an output or input account by name
            acc_lower = acc.lower()
            is_input = "input" in acc_lower or "itc" in acc_lower

            if is_input:
                # Net ITC = debit - credit
                result[tax_type] += flt(dr - cr, 2)
            else:
                # Net liability = credit - debit
                result[tax_type] += flt(cr - dr, 2)

    return {k: flt(v, 2) for k, v in result.items()}


def get_taxable_amounts(company, from_date, to_date):
    """
    Get taxable base amounts and tax rate from invoice tables (for display).
    This is purely for the Taxable Amt. column — the GST figures come from GL Entry.
    """
    sales = frappe.db.sql("""
        SELECT SUM(base_net_total) AS taxable_amt
        FROM `tabSales Invoice`
        WHERE docstatus = 1 AND company = %(company)s
          AND posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND is_return = 0
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    purch = frappe.db.sql("""
        SELECT SUM(base_net_total) AS taxable_amt
        FROM `tabPurchase Invoice`
        WHERE docstatus = 1 AND company = %(company)s
          AND posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND is_return = 0
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    rate_result = frappe.db.sql("""
        SELECT stc.rate FROM `tabSales Taxes and Charges` stc
        INNER JOIN `tabSales Invoice` si ON si.name = stc.parent
        WHERE si.company = %(company)s
          AND si.posting_date BETWEEN %(from_date)s AND %(to_date)s
          AND si.docstatus = 1 AND si.is_return = 0 AND stc.rate > 0
        ORDER BY stc.rate DESC LIMIT 1
    """, {"company": company, "from_date": from_date, "to_date": to_date}, as_dict=True)

    return {
        "sales_taxable": flt((sales[0].taxable_amt if sales else 0), 2),
        "purch_taxable": flt((purch[0].taxable_amt if purch else 0), 2),
        "tax_rate": flt(rate_result[0]["rate"] if rate_result else 18.0, 2),
    }


def get_prev_month_range(from_date):
    """Return (first_day, last_day) of the month before from_date."""
    current_from = getdate(from_date)
    prev_to = current_from - timedelta(days=1)
    prev_from = prev_to.replace(day=1)
    return prev_from, prev_to


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
            "igst": flt(igst, 2), "cgst": flt(cgst, 2),
            "sgst": flt(sgst, 2), "total_gst": flt(total_gst, 2)}


def make_total(particular, taxable_amt, igst, cgst, sgst, total_gst):
    return {"particular": frappe.bold(particular), "taxable_amt": flt(taxable_amt, 2),
            "igst": flt(igst, 2), "cgst": flt(cgst, 2),
            "sgst": flt(sgst, 2), "total_gst": flt(total_gst, 2)}


def make_section(label):
    return {"particular": frappe.bold(label),
            "taxable_amt": None, "igst": None, "cgst": None, "sgst": None, "total_gst": None}


def make_blank():
    return {"particular": "", "taxable_amt": None, "igst": None,
            "cgst": None, "sgst": None, "total_gst": None}
