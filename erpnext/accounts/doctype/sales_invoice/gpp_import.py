"""
gpp_import.py  –  PrintFlow → ERPNext import for Gajanand Paper Print

Public API
----------
create_from_excel(file_url)
    Reads an uploaded .xlsx file (PrintFlow Job Billing Report format),
    creates a Delivery Note + Sales Invoice for every "Unbilled" row,
    and returns a list of result dicts.

create_from_printflow_billing(billing_data)
    Single-row import (used by the manual dialog / PrintFlow direct call).

Expected Excel columns (case-insensitive, any order)
-----------------------------------------------------
Bill No | Party | Job No | Description | Sheets | Paper Size | Print Size |
Print Type | Print Charge | Lamination | Min Charge | Other Charges |
Other Amt | Total | Status | Date
"""

import frappe
from frappe import _
from frappe.utils import today, flt, cstr
import openpyxl


# ── column name normalisation map ────────────────────────────────────────────
_COL_MAP = {
    "bill no":              "bill_no",
    "party":                "party",
    "job no":               "job_no",
    "description":          "description",
    "sheets":               "sheets",
    "sheet qty":            "sheets",
    "paper size":           "paper_size",
    "print size":           "print_size",
    "printing size":        "print_size",     # alternate header
    "print type":           "print_type",
    "printing type":        "print_type",    # alternate header
    "print charge":         "print_charge",
    "total print charge":   "print_charge",  # alternate header
    "printing charge":      "print_charge",  # alternate header
    "lamination":           "lamination",
    "plate cancellation":   "plate_cancellation",
    "other charges":        "other_charges",
    "other charge title":   "other_charges",  # alternate header
    "other amt":            "other_amt",
    "other charges amount": "other_amt",      # alternate header
    "total":                "total",
    "status":               "status",
    "date":         "posting_date",
}

GPP_COMPANY = "Gajanand Paper Print"


# ─────────────────────────────────────────────────────────────────────────────
# Public: Excel bulk import
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def create_from_excel(file_url):
    rows = _parse_excel(file_url)
    results = []
    for row in rows:
        status = cstr(row.get("status", "")).strip().lower()
        if status == "billed":
            results.append({
                "bill_no": row.get("bill_no", ""),
                "party":   row.get("party", ""),
                "job_no":  row.get("job_no", ""),
                "skipped": True,
                "reason":  "Already billed",
            })
            continue
        try:
            si_name = _create_si(row)
            results.append({
                "bill_no":  row.get("bill_no", ""),
                "party":    row.get("party", ""),
                "job_no":   row.get("job_no", ""),
                "si":       si_name,
                "skipped":  False,
            })
        except Exception as e:
            frappe.log_error(frappe.get_traceback(),
                             f"GPP Import error – {row.get('bill_no', '?')}")
            results.append({
                "bill_no": row.get("bill_no", ""),
                "party":   row.get("party", ""),
                "job_no":  row.get("job_no", ""),
                "skipped": True,
                "reason":  str(e),
            })
    return results


# ─────────────────────────────────────────────────────────────────────────────
# Public: single-row import (manual dialog / PrintFlow direct call)
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def create_from_printflow_billing(billing_data, sales_invoice=None):
    """
    Create or update a Sales Invoice from a PrintFlow billing row.

    Always returns a JSON dict with responseCode, action, si, message.
    Never raises an exception to the caller.
    """
    try:
        import json
        if isinstance(billing_data, str):
            billing_data = json.loads(billing_data)

        # ── Update path ──────────────────────────────────────────────────────
        if sales_invoice:
            if not frappe.db.exists("Sales Invoice", sales_invoice):
                return {
                    "responseCode": 404,
                    "si":           sales_invoice,
                    "action":       "not_found",
                    "message":      f"Sales Invoice {sales_invoice} does not exist.",
                }

            docstatus = frappe.db.get_value(
                "Sales Invoice", sales_invoice, "docstatus")

            if docstatus == 1:
                return {
                    "responseCode": 409,
                    "si":           sales_invoice,
                    "action":       "skipped",
                    "message":      (
                        f"Sales Invoice {sales_invoice} is already Submitted. "
                        "Please login to ERPNext and update it manually."
                    ),
                }

            if docstatus == 2:
                return {
                    "responseCode": 409,
                    "si":           sales_invoice,
                    "action":       "skipped",
                    "message":      f"Sales Invoice {sales_invoice} is Cancelled and cannot be updated.",
                }

            _update_si(sales_invoice, billing_data)
            return {
                "responseCode": 200,
                "si":           sales_invoice,
                "action":       "updated",
                "message":      f"Sales Invoice {sales_invoice} updated successfully.",
            }

        # ── Create path ───────────────────────────────────────────────────────
        si_name = _create_si(billing_data)
        return {
            "responseCode": 200,
            "si":           si_name,
            "action":       "created",
            "message":      f"Sales Invoice {si_name} created successfully.",
        }

    except Exception as e:
        frappe.log_error(frappe.get_traceback(),
                         "create_from_printflow_billing error")
        return {"responseCode": 500, "action": "error", "message": str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _parse_excel(file_url):
    """Download the uploaded file and return a list of row dicts."""
    file_doc = frappe.get_doc("File", {"file_url": file_url})
    file_path = file_doc.get_full_path()

    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    ws = wb.active

    rows_iter = iter(ws.iter_rows(values_only=True))

    # Find header row (first non-empty row)
    headers = None
    for raw in rows_iter:
        stripped = [cstr(c).strip() for c in raw]
        if any(stripped):
            headers = stripped
            break

    if not headers:
        frappe.throw(_("Excel file appears to be empty"))

    col_idx = {}
    for i, h in enumerate(headers):
        key = _COL_MAP.get(h.lower())
        if key:
            col_idx[key] = i

    results = []
    for raw in rows_iter:
        if not any(c for c in raw if c not in (None, "")):
            continue
        row = {}
        for key, i in col_idx.items():
            row[key] = raw[i] if i < len(raw) else None
        if row.get("party"):
            results.append(row)

    wb.close()
    return results


def _build_item_rows_from_items(row):
    """Return list of {item_code, description, qty, rate, uom, sheets} using the items
    array sent directly by PrintFlow — rate and amount are used as-is."""
    raw_items = row.get("items") or []
    if not raw_items:
        frappe.throw(
            _(f"No items found in billing data for: {row.get('bill_no', '?')}"))

    # Top-level sheets fallback (PrintFlow may send sheets once at row level)
    top_level_sheets = row.get("sheets")

    result = []
    for r in raw_items:
        item_name = cstr(r.get("item_name") or r.get(
            "item_code") or "").strip()
        if not item_name:
            continue
        item_code = _ensure_printing_item(item_name)

        # Prefer item-level sheets; fall back to top-level sheets from billing row
        sheets_raw = r.get("sheets")

        if sheets_raw in (None, ""):
            sheets_raw = top_level_sheets
        sheets_val = flt(sheets_raw) if sheets_raw not in (None, "") else None

        result.append({
            "item_code":   item_code,
            "description": cstr(r.get("description") or item_name).strip(),
            "qty":         flt(r.get("qty") or 1),
            "rate":        flt(r.get("rate") or 0),
            "uom":         cstr(r.get("uom") or "Nos").strip() or "Nos",
            "sheets":      sheets_val,
        })

    if not result:
        frappe.throw(
            _(f"No valid items in billing data for: {row.get('bill_no', '?')}"))

    return result


def _create_si(row):
    """Create a Sales Invoice (draft) for one billing row."""
    party = cstr(row.get("party", "")).strip()
    job_no = cstr(row.get("job_no", "")).strip()
    description = cstr(row.get("description", "")).strip()
    bill_no = cstr(row.get("bill_no", "")).strip()
    posting_date = cstr(row.get("posting_date", "") or row.get(
        "date", "") or today()).strip() or today()

    sheets_raw = row.get("sheets")
    sheets = cstr(sheets_raw).strip() if sheets_raw not in (None, "") else ""
    paper_size = cstr(row.get("paper_size", "") or "").strip()
    print_size = cstr(row.get("print_size", "") or "").strip()

    specs_parts = []
    if sheets:
        specs_parts.append(f"Sheets: {sheets}")
    if paper_size:
        specs_parts.append(f"Paper: {paper_size}")
    if print_size:
        specs_parts.append(f"Print Size: {print_size}")
    specs_line = " | ".join(specs_parts)

    item_rows = _build_item_rows_from_items(row)
    remarks = f"PrintFlow Bill No: {bill_no}" if bill_no else ""

    si = frappe.new_doc("Sales Invoice")
    si.company = GPP_COMPANY
    si.customer = party
    si.set_posting_time = 1
    si.posting_date = posting_date
    si.gpp_job_id = job_no
    si.gpp_job_description = description
    si.gpp_print_specs = specs_line
    if remarks:
        si.remarks = remarks

    for r in item_rows:
        row_data = {
            "item_code":   r["item_code"],
            "item_name":   r["item_code"],
            "description": r["description"],
            "qty":         r["qty"],
            "rate":        r["rate"],
            "uom":         r["uom"],
        }
        if r.get("sheets"):
            row_data["gpp_sheets"] = r["sheets"]
        si.append("items", row_data)

    si.set_missing_values()
    si.calculate_taxes_and_totals()
    si.insert(ignore_permissions=True)
    frappe.db.set_value("Sales Invoice", si.name,
                        "posting_date", posting_date, update_modified=False)
    frappe.db.commit()

    return si.name


def _update_si(si_name, row):
    """Update an existing Draft Sales Invoice with fresh billing data."""
    party = cstr(row.get("party", "")).strip()
    job_no = cstr(row.get("job_no", "")).strip()
    description = cstr(row.get("description", "")).strip()
    bill_no = cstr(row.get("bill_no", "")).strip()
    posting_date = cstr(row.get("posting_date", "") or row.get(
        "date", "") or today()).strip() or today()

    sheets_raw = row.get("sheets")
    sheets = cstr(sheets_raw).strip() if sheets_raw not in (None, "") else ""
    paper_size = cstr(row.get("paper_size", "") or "").strip()
    print_size = cstr(row.get("print_size", "") or "").strip()

    specs_parts = []
    if sheets:
        specs_parts.append(f"Sheets: {sheets}")
    if paper_size:
        specs_parts.append(f"Paper: {paper_size}")
    if print_size:
        specs_parts.append(f"Print Size: {print_size}")
    specs_line = " | ".join(specs_parts)

    item_rows = _build_item_rows_from_items(row)
    remarks = f"PrintFlow Bill No: {bill_no}" if bill_no else ""

    si = frappe.get_doc("Sales Invoice", si_name)

    # Update header fields
    if party:
        si.customer = party
    if posting_date:
        si.set_posting_time = 1
        si.posting_date = posting_date
    if job_no:
        si.gpp_job_id = job_no
    si.gpp_job_description = description
    si.gpp_print_specs = specs_line
    if remarks:
        si.remarks = remarks

    # Replace items completely with fresh data
    si.items = []
    for r in item_rows:
        row_data = {
            "item_code":   r["item_code"],
            "item_name":   r["item_code"],
            "description": r["description"],
            "qty":         r["qty"],
            "rate":        r["rate"],
            "uom":         r["uom"],
        }
        if r.get("sheets"):
            row_data["gpp_sheets"] = r["sheets"]
        si.append("items", row_data)

    # Don't call set_missing_values() here — it re-fetches customer party details
    # and throws if payment terms are missing on the customer. The existing doc
    # already has all required fields; just recalculate totals and save.
    si.calculate_taxes_and_totals()
    si.save(ignore_permissions=True)
    frappe.db.set_value("Sales Invoice", si_name,
                        "posting_date", posting_date, update_modified=False)
    frappe.db.commit()


_GPP_HSN = "998912"


def _ensure_printing_item(item_name):
    """Return item_code, creating the item under Printing Group if it doesn't exist."""
    item_code = item_name.strip()
    abbr = frappe.db.get_value("Company", GPP_COMPANY, "abbr") or ""
    item_tax_template = f"GST 18% - {abbr}"

    if not frappe.db.exists("Item", item_code):
        item = frappe.new_doc("Item")
        item.item_code = item_code
        item.item_name = item_code
        item.item_group = "Printing Group"
        item.stock_uom = "Nos"
        item.is_stock_item = 0
        item.is_sales_item = 1
        item.is_purchase_item = 0
        item.gst_hsn_code = _GPP_HSN
        if frappe.db.exists("Item Tax Template", item_tax_template):
            item.append("taxes", {"item_tax_template": item_tax_template})
        item.insert(ignore_permissions=True)
    else:
        updates = {}
        if not frappe.db.get_value("Item", item_code, "gst_hsn_code"):
            updates["gst_hsn_code"] = _GPP_HSN
        if updates:
            frappe.db.set_value("Item", item_code, updates,
                                update_modified=False)
        # Backfill item tax template if missing
        has_tax = frappe.db.exists(
            "Item Tax", {"parent": item_code, "item_tax_template": item_tax_template})
        if not has_tax and frappe.db.exists("Item Tax Template", item_tax_template):
            item = frappe.get_doc("Item", item_code)
            if not item.taxes:
                item.append("taxes", {"item_tax_template": item_tax_template})
                item.save(ignore_permissions=True)
    return item_code
