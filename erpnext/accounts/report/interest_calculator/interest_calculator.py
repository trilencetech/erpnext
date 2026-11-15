# Copyright (c) 2026, TriLence Tech and contributors
# Interest Calculator — Script Report
# Handles variable principal + 31-March annual interest capitalization

import frappe
from frappe import _
from frappe.utils import flt, getdate, date_diff


def execute(filters=None):
    filters = frappe._dict(filters or {})
    _validate(filters)
    return _columns(), _data(filters)


# ── VALIDATION ────────────────────────────────────────────────────────────────

def _validate(filters):
    if not filters.company:
        frappe.throw(_("Please select a Company"))
    if not filters.account:
        frappe.throw(_("Please select an Account"))
    if not filters.to_date:
        frappe.throw(_("Please select To Date"))


# ── COLUMNS ───────────────────────────────────────────────────────────────────

def _columns():
    return [
        {
            "label":     _("Description"),
            "fieldname": "description",
            "fieldtype": "Data",
            "width":     260,
        },
        {
            "label":     _("Working Principal"),
            "fieldname": "principal",
            "fieldtype": "Currency",
            "options":   "currency",
            "width":     160,
        },
        {
            "label":     _("Rate (% p.a.)"),
            "fieldname": "rate",
            "fieldtype": "Float",
            "width":     110,
        },
        {
            "label":     _("From Date"),
            "fieldname": "from_date",
            "fieldtype": "Date",
            "width":     110,
        },
        {
            "label":     _("To Date"),
            "fieldname": "to_date",
            "fieldtype": "Date",
            "width":     110,
        },
        {
            "label":     _("Days"),
            "fieldname": "days",
            "fieldtype": "Int",
            "width":     70,
        },
        {
            "label":     _("Interest Amount"),
            "fieldname": "interest_amount",
            "fieldtype": "Currency",
            "options":   "currency",
            "width":     150,
        },
        {
            "label":     _("Total Payable"),
            "fieldname": "total_payable",
            "fieldtype": "Currency",
            "options":   "currency",
            "width":     160,
        },
    ]


# ── DATA ──────────────────────────────────────────────────────────────────────

def _data(filters):
    currency = (
        frappe.get_cached_value("Company", filters.company, "default_currency") or "INR"
    )
    to_date = getdate(filters.to_date)
    rate    = flt(filters.get("rate") or 12, 4)

    detail_rows, state = _build_schedule(
        filters.account, filters.company, to_date, rate, currency
    )

    if not detail_rows:
        return []

    total_payable = flt(state["gl_balance"] + state["cap_interest"] + state["year_interest"], 2)

    summary = {
        "description":    filters.account,
        "principal":      state["opening_principal"],
        "rate":           rate,
        "from_date":      state["first_credit"],
        "to_date":        to_date,
        "days":           date_diff(to_date, state["first_credit"]) + 1,
        "interest_amount": state["grand_interest"],
        "total_payable":  total_payable,
        "currency":       currency,
        "_row_type":      "result",
    }

    return [summary] + detail_rows


# ── SCHEDULE BUILDER ─────────────────────────────────────────────────────────

def _build_schedule(account, company, to_date, rate, currency):
    """
    Walk a GL timeline and calculate simple interest with:
    - Variable principal (every debit/credit changes the base)
    - 31-March annual capitalization (interest added to principal each FY end)

    Returns (detail_rows, state_dict).
    """
    from datetime import timedelta

    first_credit = _get_first_credit_date(account, company)
    if not first_credit:
        frappe.throw(
            _("No credit entries found for account {0}. Cannot determine start date.").format(account)
        )
    if first_credit > to_date:
        frappe.throw(_("All GL entries are after the selected To Date."))

    # Net daily GL movements up to to_date
    raw = frappe.db.sql(
        """
        SELECT posting_date, SUM(credit - debit) AS net_change
        FROM   `tabGL Entry`
        WHERE  account      = %(account)s
          AND  company      = %(company)s
          AND  is_cancelled = 0
          AND  posting_date <= %(to_date)s
        GROUP  BY posting_date
        ORDER  BY posting_date
        """,
        {"account": account, "company": company, "to_date": to_date},
        as_dict=True,
    )

    movement_map = {}
    for r in raw:
        d = getdate(r.posting_date)
        movement_map[d] = flt(movement_map.get(d, 0.0) + flt(r.net_change), 2)

    # 31-March year-end dates within the period
    year_end_set = set()
    for year in range(first_credit.year, to_date.year + 1):
        ye = getdate("{:04d}-03-31".format(year))
        if first_credit <= ye <= to_date:
            year_end_set.add(ye)

    all_event_dates = sorted(
        set(list(movement_map.keys())) | year_end_set | {to_date}
    )

    # Running state
    gl_balance    = 0.0   # actual credit–debit balance from GL
    cap_interest  = 0.0   # total interest capitalised in past year-ends
    year_interest = 0.0   # interest accrued since last year-end (not yet capitalised)
    grand_interest = 0.0  # all interest ever accrued

    opening_principal = 0.0  # first deposit amount (for summary display)

    rows      = []
    seg_start = first_credit

    for ev_date in all_event_dates:
        if ev_date < first_credit:
            continue

        is_movement = ev_date in movement_map
        is_year_end = ev_date in year_end_set

        # ── NORMAL MOVEMENT (not a year-end) ──────────────────────────────
        if is_movement and not is_year_end:
            # Segment [seg_start … ev_date-1] uses current gl_balance + cap_interest
            seg_end = ev_date - timedelta(days=1)
            if seg_start <= seg_end:
                wp   = flt(gl_balance + cap_interest, 2)
                days = date_diff(seg_end, seg_start) + 1
                sint = flt(wp * rate * days / (100.0 * 365), 2) if wp > 0 else 0.0
                if sint:
                    year_interest  = flt(year_interest  + sint, 2)
                    grand_interest = flt(grand_interest + sint, 2)
                    rows.append(_seg_row("Interest period", wp, rate, seg_start, seg_end, days, sint, currency))

            # Apply movement — new balance effective from ev_date
            chg        = movement_map[ev_date]
            gl_balance = flt(gl_balance + chg, 2)
            if opening_principal == 0 and gl_balance > 0:
                opening_principal = gl_balance
            lbl = "Deposit" if chg > 0 else "Withdrawal / Return"
            rows.append(_event_row(lbl, ev_date, chg, flt(gl_balance + cap_interest, 2), currency))
            seg_start = ev_date

        # ── YEAR-END (31-March) ───────────────────────────────────────────
        elif is_year_end:
            # Segment [seg_start … 31-Mar] with current principal
            if seg_start <= ev_date:
                wp   = flt(gl_balance + cap_interest, 2)
                days = date_diff(ev_date, seg_start) + 1
                sint = flt(wp * rate * days / (100.0 * 365), 2) if wp > 0 else 0.0
                if sint:
                    year_interest  = flt(year_interest  + sint, 2)
                    grand_interest = flt(grand_interest + sint, 2)
                    rows.append(_seg_row("Interest period", wp, rate, seg_start, ev_date, days, sint, currency))

            # Capitalise year interest into principal
            if year_interest > 0:
                cap_interest = flt(cap_interest + year_interest, 2)
                new_wp       = flt(gl_balance + cap_interest, 2)
                rows.append(_year_end_row(ev_date, year_interest, new_wp, currency))
                year_interest = 0.0

            # Movement on year-end date — applied AFTER capitalisation
            if is_movement:
                chg        = movement_map[ev_date]
                gl_balance = flt(gl_balance + chg, 2)
                lbl = "Deposit" if chg > 0 else "Withdrawal / Return"
                rows.append(_event_row(lbl, ev_date, chg, flt(gl_balance + cap_interest, 2), currency))

            seg_start = ev_date + timedelta(days=1)

        # ── to_date (final segment, no year-end) ─────────────────────────
        else:
            if seg_start <= ev_date:
                wp   = flt(gl_balance + cap_interest, 2)
                days = date_diff(ev_date, seg_start) + 1
                sint = flt(wp * rate * days / (100.0 * 365), 2) if wp > 0 else 0.0
                if sint:
                    year_interest  = flt(year_interest  + sint, 2)
                    grand_interest = flt(grand_interest + sint, 2)
                    rows.append(_seg_row("Interest period", wp, rate, seg_start, ev_date, days, sint, currency))

    state = {
        "first_credit":      first_credit,
        "opening_principal": opening_principal or flt(gl_balance, 2),
        "gl_balance":        flt(gl_balance, 2),
        "cap_interest":      flt(cap_interest, 2),
        "year_interest":     flt(year_interest, 2),
        "grand_interest":    flt(grand_interest, 2),
    }
    return rows, state


# ── ROW BUILDERS ─────────────────────────────────────────────────────────────

def _seg_row(label, principal, rate, from_date, to_date, days, interest, currency):
    return {
        "description":    label,
        "principal":      principal,
        "rate":           rate,
        "from_date":      from_date,
        "to_date":        to_date,
        "days":           days,
        "interest_amount": interest,
        "total_payable":  None,
        "currency":       currency,
        "_row_type":      "segment",
    }


def _event_row(label, ev_date, change, new_wp, currency):
    return {
        "description":    "{} — {:,.2f}".format(label, abs(change)),
        "principal":      new_wp,
        "rate":           None,
        "from_date":      ev_date,
        "to_date":        ev_date,
        "days":           None,
        "interest_amount": None,
        "total_payable":  new_wp,
        "currency":       currency,
        "_row_type":      "event",
    }


def _year_end_row(ye_date, capitalised, new_wp, currency):
    return {
        "description":    "Interest Capitalised — 31 Mar {}".format(ye_date.year),
        "principal":      capitalised,
        "rate":           None,
        "from_date":      ye_date,
        "to_date":        ye_date,
        "days":           None,
        "interest_amount": capitalised,
        "total_payable":  new_wp,
        "currency":       currency,
        "_row_type":      "year_end",
    }


# ── GL HELPERS ────────────────────────────────────────────────────────────────

def _get_first_credit_date(account, company):
    result = frappe.db.sql(
        """
        SELECT MIN(posting_date) AS first_date
        FROM   `tabGL Entry`
        WHERE  account      = %(account)s
          AND  company      = %(company)s
          AND  credit       > 0
          AND  is_cancelled = 0
        """,
        {"account": account, "company": company},
        as_dict=True,
    )
    val = result[0].first_date if result else None
    return getdate(val) if val else None
