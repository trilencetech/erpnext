# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

# import frappe
from erpnext.stock.stock_ledger import update_entries_after
from frappe.utils import flt, today, nowtime
import frappe
from frappe.model.document import Document


class PurchaseDiscrepancy(Document):
    # begin: auto-generated types
    # This code is auto-generated. Do not modify anything in this block.

    from typing import TYPE_CHECKING

    if TYPE_CHECKING:
        from frappe.types import DF

    # end: auto-generated types
    # ============================================================
# Place at: apps/gajanand/gajanand/api/purchase_discrepancy.py
# ============================================================
#
# Also create DocType: Purchase Discrepancy
# Fields:
#   purchase_receipt    Link → Purchase Receipt
#   pr_item_code        Link → Item
#   pr_item_name        Data
#   pr_qty              Float
#   pr_uom              Data
#   actual_item_code    Link → Item
#   actual_qty          Float
#   qty_difference      Float
#   item_mismatch       Check
#   warehouse           Link → Warehouse
#   valuation_rate      Currency
#   stock_entry         Link → Stock Entry
#   discrepancy_note    Small Text
#   status              Select (Open / Billed)
#   posting_date        Date
# ============================================================

# ============================================================
# apps/gajanand/gajanand/api/purchase_discrepancy.py
# ============================================================
# Direct SLE manipulation — no Stock Entry, no accounting entry
# ============================================================


@frappe.whitelist()
def apply_discrepancy(
    purchase_receipt,
    pr_item_code,
    pr_item_name,
    pr_qty,
    pr_uom,
    pr_warehouse,
    pr_rate,
    pr_sle_name,        # PR child row name — used to find exact SLE
    actual_item_code,
    actual_qty,
    discrepancy_note=""
):
    """
    1. Find and cancel the original SLE for the wrong item
    2. Insert new SLE for the correct actual item
    3. Repost qty_after_transaction for both items
    4. Save Purchase Discrepancy record
    No Stock Entry / no accounting entry created.
    """

    company = frappe.defaults.get_user_default("Company")
    pr_qty = flt(pr_qty)
    actual_qty = flt(actual_qty)
    pr_rate = flt(pr_rate)

    # ── Validate PR ───────────────────────────────────────────
    pr_doc = frappe.get_doc("Purchase Receipt", purchase_receipt)
    if pr_doc.docstatus != 1:
        frappe.throw("Purchase Receipt must be submitted.")

    # ── Find exact SLE for this PR row ───────────────────────
    # Match by voucher_no + item_code + actual_qty to get exact row
    sle_list = frappe.db.sql("""
        SELECT name, item_code, warehouse, actual_qty,
               qty_after_transaction, posting_date, posting_time,
               valuation_rate, stock_value_difference,
               voucher_detail_no
        FROM `tabStock Ledger Entry`
        WHERE voucher_type  = 'Purchase Receipt'
          AND voucher_no    = %(pr)s
          AND item_code     = %(item)s
          AND is_cancelled  = 0
          AND docstatus     = 1
        ORDER BY creation DESC
    """, {"pr": purchase_receipt, "item": pr_item_code}, as_dict=True)

    if not sle_list:
        frappe.throw(
            f"No active Stock Ledger Entry found for item <b>{pr_item_code}</b> "
            f"in Purchase Receipt <b>{purchase_receipt}</b>."
        )

    # If multiple SLE rows for same item, match by qty closest to pr_qty
    if len(sle_list) > 1:
        sle_list.sort(key=lambda x: abs(flt(x.actual_qty) - pr_qty))

    sle = sle_list[0]
    warehouse = sle.warehouse
    posting_date = sle.posting_date
    posting_time = sle.posting_time
    val_rate = flt(sle.valuation_rate) or pr_rate

    # ── Step 1: Cancel the original SLE ──────────────────────
    # Mark is_cancelled = 1, docstatus = 2
    frappe.db.sql("""
        UPDATE `tabStock Ledger Entry`
        SET    is_cancelled = 1,
               docstatus    = 2
        WHERE  name = %(sle_name)s
    """, {"sle_name": sle.name})

    frappe.db.commit()

    # ── Step 2: Insert new SLE for actual item ────────────────
    new_sle = frappe.new_doc("Stock Ledger Entry")
    new_sle.update({
        "item_code":              actual_item_code,
        "warehouse":              warehouse,
        "posting_date":           posting_date,
        "posting_time":           posting_time,
        "voucher_type":           "Purchase Receipt",
        "voucher_no":             purchase_receipt,
        "voucher_detail_no":      sle.voucher_detail_no or sle.name,
        "actual_qty":             actual_qty,
        "qty_after_transaction":  0,       # will be set by repost
        "valuation_rate":         val_rate,
        "stock_value_difference": flt(actual_qty * val_rate, 2),
        "company":                company,
        "is_cancelled":           0,
        "docstatus":              1,
        "incoming_rate":          val_rate,
    })
    new_sle.flags.ignore_permissions = True
    new_sle.flags.ignore_validate = True
    new_sle.flags.ignore_links = True
    new_sle.insert(ignore_permissions=True)

    frappe.db.commit()

    # ── Step 3: Repost qty_after_transaction ──────────────────
    # Repost original item (to reflect removal)
    try:
        update_entries_after({
            "item_code":    pr_item_code,
            "warehouse":    warehouse,
            "posting_date": posting_date,
            "posting_time": posting_time,
        }, allow_negative_stock=True)
        frappe.db.commit()
    except Exception as e:
        frappe.logger().warning(
            f"[Discrepancy] Repost failed for {pr_item_code}: {e}")

    # Repost new item
    try:
        update_entries_after({
            "item_code":    actual_item_code,
            "warehouse":    warehouse,
            "posting_date": posting_date,
            "posting_time": posting_time,
        }, allow_negative_stock=True)
        frappe.db.commit()
    except Exception as e:
        frappe.logger().warning(
            f"[Discrepancy] Repost failed for {actual_item_code}: {e}")

    # Also update Bin for both items
    for item_code, qty_change in [
        (pr_item_code,     -pr_qty),
        (actual_item_code,  actual_qty)
    ]:
        frappe.db.sql("""
            UPDATE `tabBin`
            SET actual_qty = actual_qty + %(delta)s
            WHERE item_code = %(item)s
              AND warehouse  = %(wh)s
        """, {"delta": qty_change, "item": item_code, "wh": warehouse})

    frappe.db.commit()

    # ── Step 4: Save Discrepancy Record ──────────────────────
    disc = frappe.new_doc("Purchase Discrepancy")
    disc.update({
        "purchase_receipt":   purchase_receipt,
        "posting_date":       today(),
        "company":            company,
        "pr_item_code":       pr_item_code,
        "pr_item_name":       pr_item_name,
        "pr_qty":             pr_qty,
        "pr_uom":             pr_uom,
        "actual_item_code":   actual_item_code,
        "actual_qty":         actual_qty,
        "qty_difference":     flt(actual_qty - pr_qty, 3),
        "item_mismatch":      0 if pr_item_code == actual_item_code else 1,
        "warehouse":          warehouse,
        "valuation_rate":     val_rate,
        "sle_cancelled":      sle.name,
        "sle_inserted":       new_sle.name,
        "discrepancy_note":   discrepancy_note,
        "status":             "Open",
    })
    disc.flags.ignore_permissions = True
    disc.insert()
    frappe.db.commit()

    return {
        "discrepancy":    disc.name,
        "sle_cancelled":  sle.name,
        "sle_inserted":   new_sle.name,
        "qty_difference": flt(actual_qty - pr_qty, 3),
    }


@frappe.whitelist()
def get_open_discrepancies(company=None):
    """Fetch open discrepancies for B2B billing."""
    filters = {"status": "Open"}
    if company:
        filters["company"] = company
    return frappe.db.get_all(
        "Purchase Discrepancy",
        filters=filters,
        fields=[
            "name", "posting_date", "purchase_receipt",
            "pr_item_code", "pr_qty", "actual_item_code",
            "actual_qty", "qty_difference", "item_mismatch",
            "warehouse", "discrepancy_note"
        ],
        order_by="posting_date desc"
    )
