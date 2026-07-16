"""
pf_billing_api.py  –  PrintFlow Structured Billing → ERPNext Sales Invoice

All endpoints always return a JSON dict — no exceptions raised to the caller:

    responseCode  int   200 = success
                        400 = bad request / missing field / invalid data
                        404 = record not found (SI, Company, Customer)
                        409 = conflict (SI is Submitted or Cancelled)
                        500 = unexpected server error
    action        str   "created" | "updated" | "existing" | "skipped" |
                        "found" | "not_found" | "error"
    message       str   human-readable result
    si            str   SI document name (when applicable)
    url           str   /app/sales-invoice/<si> (when applicable)
"""

import frappe
from frappe import _
from frappe.utils import today, flt, cstr

from erpnext.accounts.doctype.sales_invoice.gpp_import import _ensure_printing_item

GPP_COMPANY = "Gajanand Paper Print"


class _BillingError(Exception):
    def __init__(self, code, message):
        self.code = code
        self.message = message
        super().__init__(message)


def _validate_company(company):
    if not frappe.db.exists("Company", company):
        raise _BillingError(404, f"Company '{company}' not found in ERPNext")


def _validate_customer(customer):
    if not frappe.db.exists("Customer", customer):
        raise _BillingError(404, f"Customer '{customer}' not found in ERPNext")


def _check_duplicate(source_name):
    return frappe.db.get_value(
        "Sales Invoice",
        {"remarks": ["like", f"%{source_name}%"], "docstatus": ["!=", 2]},
        "name",
    )


def _make_si(customer, company, posting_date, remarks, item_rows,
             pf_source_type, pf_source_name,
             pf_job_no=None, pf_job_description=None,
             pf_challan_no=None, pf_print_specs=None, pf_period=None):
    si = frappe.new_doc("Sales Invoice")
    si.company        = company
    si.customer       = customer
    si.set_posting_time = 1
    si.posting_date   = posting_date
    si.remarks        = remarks
    si.pf_source_type = pf_source_type
    si.pf_source_name = pf_source_name
    if pf_job_no:          si.pf_job_no          = pf_job_no
    if pf_job_description: si.pf_job_description = pf_job_description
    if pf_challan_no:      si.pf_challan_no      = pf_challan_no
    if pf_print_specs:     si.pf_print_specs     = pf_print_specs
    if pf_period:          si.pf_period          = pf_period
    for r in item_rows:
        si.append("items", {
            "item_code":   r["item_code"],
            "item_name":   r["item_code"],
            "description": r["description"],
            "qty":         r["qty"],
            "rate":        r["rate"],
            "uom":         "Nos",
        })
    si.set_missing_values()
    si.calculate_taxes_and_totals()
    si.insert(ignore_permissions=True)
    # Force posting_date — validate() may reset it to today if set_posting_time is ignored
    frappe.db.set_value("Sales Invoice", si.name, "posting_date", posting_date, update_modified=False)
    frappe.db.commit()
    return si.name


# ─────────────────────────────────────────────────────────────────────────────
# Status check
# ─────────────────────────────────────────────────────────────────────────────

_DOCSTATUS_MAP = {0: "Draft", 1: "Submitted", 2: "Cancelled"}


@frappe.whitelist()
def get_si_status(si_name):
    try:
        si_name = cstr(si_name).strip()
        docstatus = frappe.db.get_value("Sales Invoice", si_name, "docstatus")
        if docstatus is None:
            return {
                "responseCode": 404,
                "action":       "not_found",
                "si":           si_name,
                "message":      f"Sales Invoice '{si_name}' does not exist.",
            }
        return {
            "responseCode": 200,
            "action":       "found",
            "si":           si_name,
            "status":       _DOCSTATUS_MAP.get(docstatus, "Unknown"),
        }
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "get_si_status error")
        return {"responseCode": 500, "action": "error", "message": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Generic items[] endpoint  (preferred for all new billing pushes)
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def create_invoice_from_billing(billing_data, si_name=None):
    """
    billing_data fields:
      source_type, source_name, customer, company, posting_date, period,
      job_no, job_description, challan_no, print_specs, items[]

    Each item: item_name, description, qty, rate OR amount
    si_name (optional): update this existing Draft SI instead of creating new
    """
    try:
        import json
        if isinstance(billing_data, str):
            billing_data = json.loads(billing_data)

        source_type = cstr(billing_data.get("source_type", "")).strip()
        source_name = cstr(billing_data.get("source_name", "")).strip()
        customer    = cstr(billing_data.get("customer",    "")).strip()
        company     = cstr(billing_data.get("company",     "")).strip() or GPP_COMPANY

        if not source_type:
            raise _BillingError(400, "source_type is required")
        if not source_name:
            raise _BillingError(400, "source_name is required")
        if not customer:
            raise _BillingError(400, "customer is required")

        _validate_company(company)
        _validate_customer(customer)

        posting_date   = cstr(billing_data.get("posting_date",    "")).strip() or today()
        pf_period      = cstr(billing_data.get("period",          "") or "").strip() or None
        pf_job_no      = cstr(billing_data.get("job_no",          "") or "").strip() or None
        pf_job_desc    = cstr(billing_data.get("job_description",  "") or "").strip() or None
        pf_challan_no  = cstr(billing_data.get("challan_no",      "") or "").strip() or None
        pf_print_specs = cstr(billing_data.get("print_specs",     "") or "").strip() or None

        raw_items = billing_data.get("items") or []
        if not raw_items:
            raise _BillingError(400, "items list is empty — invoice would have no lines.")

        item_rows = []
        for i, it in enumerate(raw_items, 1):
            item_name = cstr(it.get("item_name", "")).strip()
            if not item_name:
                raise _BillingError(400, f"items[{i}]: item_name is required")
            qty = flt(it.get("qty") or 0)
            if qty <= 0:
                raise _BillingError(400, f"items[{i}] ({item_name}): qty must be > 0")
            if it.get("rate") is not None:
                rate = flt(it["rate"])
            elif it.get("amount") is not None:
                rate = flt(flt(it["amount"]) / qty, 4)
            else:
                raise _BillingError(400, f"items[{i}] ({item_name}): provide either rate or amount")
            desc = cstr(it.get("description", "") or "").strip() or item_name
            code = _ensure_printing_item(item_name)
            item_rows.append({"item_code": code, "description": desc, "qty": qty, "rate": rate})

        remarks_parts = [f"PrintFlow {source_type}: {source_name}"]
        if pf_period:
            remarks_parts.append(f"Period: {pf_period}")
        remarks = " | ".join(remarks_parts)

        # ── Update path ───────────────────────────────────────────────────────
        si_name = cstr(si_name or "").strip()
        if si_name:
            if not frappe.db.exists("Sales Invoice", si_name):
                return {
                    "responseCode": 404,
                    "action":       "not_found",
                    "si":           si_name,
                    "message":      f"Sales Invoice '{si_name}' does not exist.",
                }
            docstatus = frappe.db.get_value("Sales Invoice", si_name, "docstatus")
            if docstatus == 1:
                return {
                    "responseCode": 409,
                    "action":       "skipped",
                    "si":           si_name,
                    "url":          f"/app/sales-invoice/{si_name}",
                    "message":      f"Sales Invoice {si_name} is already Submitted. Please update it manually in ERPNext.",
                }
            if docstatus == 2:
                return {
                    "responseCode": 409,
                    "action":       "skipped",
                    "si":           si_name,
                    "url":          f"/app/sales-invoice/{si_name}",
                    "message":      f"Sales Invoice {si_name} is Cancelled and cannot be updated.",
                }

            si = frappe.get_doc("Sales Invoice", si_name)
            si.set_posting_time = 1
            si.posting_date    = posting_date
            si.pf_source_type  = source_type
            si.pf_source_name  = source_name
            si.remarks         = remarks
            if pf_job_no:      si.pf_job_no          = pf_job_no
            if pf_job_desc:    si.pf_job_description = pf_job_desc
            if pf_challan_no:  si.pf_challan_no      = pf_challan_no
            if pf_print_specs: si.pf_print_specs     = pf_print_specs
            if pf_period:      si.pf_period          = pf_period
            si.items = []
            for r in item_rows:
                si.append("items", {
                    "item_code":   r["item_code"],
                    "item_name":   r["item_code"],
                    "description": r["description"],
                    "qty":         r["qty"],
                    "rate":        r["rate"],
                    "uom":         "Nos",
                })
            si.calculate_taxes_and_totals()
            si.save(ignore_permissions=True)
            frappe.db.set_value("Sales Invoice", si_name, "posting_date", posting_date, update_modified=False)
            frappe.db.commit()
            return {
                "responseCode": 200,
                "action":       "updated",
                "si":           si_name,
                "url":          f"/app/sales-invoice/{si_name}",
                "message":      f"Sales Invoice {si_name} updated from {source_type} {source_name}.",
            }

        # ── Create path ───────────────────────────────────────────────────────
        existing = _check_duplicate(source_name)
        if existing:
            return {
                "responseCode": 200,
                "action":       "existing",
                "si":           existing,
                "url":          f"/app/sales-invoice/{existing}",
                "message":      f"Sales Invoice {existing} already exists for {source_name}.",
            }

        si_name = _make_si(
            customer=customer, company=company,
            posting_date=posting_date, remarks=remarks,
            item_rows=item_rows,
            pf_source_type=source_type, pf_source_name=source_name,
            pf_job_no=pf_job_no, pf_job_description=pf_job_desc,
            pf_challan_no=pf_challan_no, pf_print_specs=pf_print_specs,
            pf_period=pf_period,
        )
        return {
            "responseCode": 200,
            "action":       "created",
            "si":           si_name,
            "url":          f"/app/sales-invoice/{si_name}",
            "message":      f"Sales Invoice {si_name} created from {source_type} {source_name}.",
        }

    except _BillingError as e:
        return {"responseCode": e.code, "action": "error", "message": e.message}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "create_invoice_from_billing error")
        return {"responseCode": 500, "action": "error", "message": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# 1. Party Billing → Sales Invoice  (legacy)
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def create_invoice_from_party_billing(billing_data):
    try:
        import json
        if isinstance(billing_data, str):
            billing_data = json.loads(billing_data)

        pb_name  = cstr(billing_data.get("party_billing_name", "")).strip()
        customer = cstr(billing_data.get("customer",           "")).strip()
        company  = cstr(billing_data.get("company",            "")).strip() or GPP_COMPANY

        if not pb_name:
            raise _BillingError(400, "party_billing_name is required")
        if not customer:
            raise _BillingError(400, "customer is required")

        _validate_company(company)
        _validate_customer(customer)

        existing = _check_duplicate(pb_name)
        if existing:
            return {
                "responseCode": 200,
                "action":       "existing",
                "si":           existing,
                "url":          f"/app/sales-invoice/{existing}",
                "message":      f"Sales Invoice {existing} already exists for {pb_name}.",
            }

        period_from  = cstr(billing_data.get("period_from", "")).strip()
        period_to    = cstr(billing_data.get("period_to",   "")).strip()
        pf_period    = f"{period_from} to {period_to}" if period_from and period_to else None
        posting_date = cstr(billing_data.get("billing_date", "")).strip() or today()

        remarks_parts = [f"PrintFlow Party Billing: {pb_name}"]
        if pf_period:
            remarks_parts.append(f"Period: {pf_period}")
        remarks = " | ".join(remarks_parts)

        jobs = billing_data.get("jobs") or []
        if not jobs:
            raise _BillingError(400, "Party Billing has no job rows — invoice would be empty.")

        item_rows = []
        for job in jobs:
            jb_ref       = cstr(job.get("job_billing",               "")).strip()
            jd_ref       = cstr(job.get("job_detail",                "")).strip()
            job_desc     = cstr(job.get("job_description",           "")).strip()
            print_type   = cstr(job.get("printing_type",             "")).strip() or "Printing"
            lam_type     = cstr(job.get("lamination_type",    "") or "").strip()
            print_charge = flt(job.get("total_printing_charge")    or 0)
            lam_amount   = flt(job.get("lamination_amount")         or 0)
            plate_cancel = flt(job.get("plate_cancellation_amount") or 0)
            sep_charge   = flt(job.get("separation_charge")         or 0)
            other_title  = cstr(job.get("other_charges_title", "") or "").strip()
            other_amt    = flt(job.get("other_charges_amount")      or 0)
            tag = job_desc or jb_ref or jd_ref

            if print_charge > 0:
                code = _ensure_printing_item(print_type)
                item_rows.append({"item_code": code,
                                  "description": print_type + (f" | {tag}" if tag else ""),
                                  "qty": 1, "rate": print_charge})
            if lam_amount > 0:
                lam_item = f"Lamination - {lam_type}" if lam_type else "Lamination"
                code = _ensure_printing_item(lam_item)
                item_rows.append({"item_code": code,
                                  "description": lam_item + (f" | {tag}" if tag else ""),
                                  "qty": 1, "rate": lam_amount})
            if plate_cancel > 0:
                code = _ensure_printing_item("Plate Cancellation")
                item_rows.append({"item_code": code,
                                  "description": "Plate Cancellation" + (f" | {tag}" if tag else ""),
                                  "qty": 1, "rate": plate_cancel})
            if sep_charge > 0:
                code = _ensure_printing_item("Separation Charge")
                item_rows.append({"item_code": code,
                                  "description": "Separation Charge" + (f" | {tag}" if tag else ""),
                                  "qty": 1, "rate": sep_charge})
            if other_title and other_amt > 0:
                code = _ensure_printing_item(other_title)
                item_rows.append({"item_code": code, "description": other_title,
                                  "qty": 1, "rate": other_amt})

        if not item_rows:
            raise _BillingError(400, "No charge amounts found in any job row — invoice would be empty.")

        si_name = _make_si(
            customer=customer, company=company,
            posting_date=posting_date, remarks=remarks,
            item_rows=item_rows,
            pf_source_type="Party Billing",
            pf_source_name=pb_name,
            pf_period=pf_period,
        )
        return {
            "responseCode": 200,
            "action":       "created",
            "si":           si_name,
            "url":          f"/app/sales-invoice/{si_name}",
            "message":      f"Sales Invoice {si_name} created from Party Billing {pb_name}.",
        }

    except _BillingError as e:
        return {"responseCode": e.code, "action": "error", "message": e.message}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "create_invoice_from_party_billing error")
        return {"responseCode": 500, "action": "error", "message": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# 2. Lamination Billing → Sales Invoice  (legacy)
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def create_invoice_from_lam_billing(billing_data):
    try:
        import json
        if isinstance(billing_data, str):
            billing_data = json.loads(billing_data)

        lb_name  = cstr(billing_data.get("lam_billing_name", "")).strip()
        customer = cstr(billing_data.get("customer",          "")).strip()
        company  = cstr(billing_data.get("company",           "")).strip() or GPP_COMPANY

        if not lb_name:
            raise _BillingError(400, "lam_billing_name is required")
        if not customer:
            raise _BillingError(400, "customer is required")

        _validate_company(company)
        _validate_customer(customer)

        existing = _check_duplicate(lb_name)
        if existing:
            return {
                "responseCode": 200,
                "action":       "existing",
                "si":           existing,
                "url":          f"/app/sales-invoice/{existing}",
                "message":      f"Sales Invoice {existing} already exists for {lb_name}.",
            }

        lam_type        = cstr(billing_data.get("lamination_type",   "") or "").strip()
        paper_size      = cstr(billing_data.get("paper_size",        "") or "").strip()
        sheet_qty       = flt(billing_data.get("sheet_quantity")      or 0)
        charge_per_sqin = flt(billing_data.get("charge_per_sq_inch") or 0)
        lam_amount      = flt(billing_data.get("lamination_amount")  or 0)
        job_desc        = cstr(billing_data.get("job_description",   "") or "").strip()
        challan_no      = cstr(billing_data.get("challan_no",        "") or "").strip()

        if lam_amount <= 0:
            raise _BillingError(400, "lamination_amount is zero — invoice would be empty.")

        qty      = sheet_qty if sheet_qty > 0 else 1.0
        per_rate = flt(lam_amount / qty, 4)

        lam_item = f"Lamination - {lam_type}" if lam_type else "Lamination"
        code     = _ensure_printing_item(lam_item)

        desc_parts = [lam_type or "Lamination"]
        if paper_size:      desc_parts.append(f"Size: {paper_size}")
        if charge_per_sqin: desc_parts.append(f"Rate/sq.in: {charge_per_sqin}")

        specs_parts = []
        if sheet_qty:  specs_parts.append(f"Sheets: {int(sheet_qty)}")
        if paper_size: specs_parts.append(f"Paper: {paper_size}")
        if lam_type:   specs_parts.append(f"Lam: {lam_type}")

        posting_date = cstr(billing_data.get("date", "")).strip() or today()

        si_name = _make_si(
            customer=customer, company=company,
            posting_date=posting_date,
            remarks=f"PrintFlow Lam Billing: {lb_name}",
            item_rows=[{"item_code": code,
                        "description": " | ".join(desc_parts),
                        "qty": qty, "rate": per_rate}],
            pf_source_type="Lamination Billing",
            pf_source_name=lb_name,
            pf_job_description=job_desc   or None,
            pf_challan_no=challan_no      or None,
            pf_print_specs=" | ".join(specs_parts) or None,
        )
        return {
            "responseCode": 200,
            "action":       "created",
            "si":           si_name,
            "url":          f"/app/sales-invoice/{si_name}",
            "message":      f"Sales Invoice {si_name} created from Lamination Billing {lb_name}.",
        }

    except _BillingError as e:
        return {"responseCode": e.code, "action": "error", "message": e.message}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "create_invoice_from_lam_billing error")
        return {"responseCode": 500, "action": "error", "message": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# 3. Party Lamination Billing → Sales Invoice  (legacy)
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def create_invoice_from_party_lam_billing(billing_data):
    try:
        import json
        if isinstance(billing_data, str):
            billing_data = json.loads(billing_data)

        plb_name = cstr(billing_data.get("party_lam_billing_name", "")).strip()
        customer = cstr(billing_data.get("customer",                "")).strip()
        company  = cstr(billing_data.get("company",                 "")).strip() or GPP_COMPANY

        if not plb_name:
            raise _BillingError(400, "party_lam_billing_name is required")
        if not customer:
            raise _BillingError(400, "customer is required")

        _validate_company(company)
        _validate_customer(customer)

        existing = _check_duplicate(plb_name)
        if existing:
            return {
                "responseCode": 200,
                "action":       "existing",
                "si":           existing,
                "url":          f"/app/sales-invoice/{existing}",
                "message":      f"Sales Invoice {existing} already exists for {plb_name}.",
            }

        period_from  = cstr(billing_data.get("period_from",  "")).strip()
        period_to    = cstr(billing_data.get("period_to",    "")).strip()
        pf_period    = f"{period_from} to {period_to}" if period_from and period_to else None
        posting_date = cstr(billing_data.get("billing_date", "")).strip() or today()

        remarks_parts = [f"PrintFlow Party Lam Billing: {plb_name}"]
        if pf_period:
            remarks_parts.append(f"Period: {pf_period}")
        remarks = " | ".join(remarks_parts)

        jobs = billing_data.get("jobs") or []
        if not jobs:
            raise _BillingError(400, "Party Lamination Billing has no rows — invoice would be empty.")

        item_rows = []
        for job in jobs:
            lam_billing     = cstr(job.get("lam_billing",        "")).strip()
            lam_type        = cstr(job.get("lamination_type",    "") or "").strip()
            paper_size      = cstr(job.get("paper_size",         "") or "").strip()
            sheet_qty       = flt(job.get("sheet_quantity")       or 0)
            charge_per_sqin = flt(job.get("charge_per_sq_inch")  or 0)
            lam_amount      = flt(job.get("lamination_amount")   or 0)

            if lam_amount <= 0:
                continue

            qty      = sheet_qty if sheet_qty > 0 else 1.0
            per_rate = flt(lam_amount / qty, 4)

            lam_item = f"Lamination - {lam_type}" if lam_type else "Lamination"
            code     = _ensure_printing_item(lam_item)

            desc_parts = []
            if lam_billing:     desc_parts.append(f"Ref: {lam_billing}")
            if paper_size:      desc_parts.append(f"Size: {paper_size}")
            if charge_per_sqin: desc_parts.append(f"Rate/sq.in: {charge_per_sqin}")
            item_rows.append({"item_code": code,
                              "description": " | ".join(desc_parts) if desc_parts else lam_item,
                              "qty": qty, "rate": per_rate})

        if not item_rows:
            raise _BillingError(400, "No lamination amounts found — invoice would be empty.")

        si_name = _make_si(
            customer=customer, company=company,
            posting_date=posting_date, remarks=remarks,
            item_rows=item_rows,
            pf_source_type="Party Lam Billing",
            pf_source_name=plb_name,
            pf_period=pf_period,
        )
        return {
            "responseCode": 200,
            "action":       "created",
            "si":           si_name,
            "url":          f"/app/sales-invoice/{si_name}",
            "message":      f"Sales Invoice {si_name} created from Party Lam Billing {plb_name}.",
        }

    except _BillingError as e:
        return {"responseCode": e.code, "action": "error", "message": e.message}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "create_invoice_from_party_lam_billing error")
        return {"responseCode": 500, "action": "error", "message": str(e)}
