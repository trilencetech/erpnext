# Place this file at:
# apps/gajanand/gajanand/api/quick_credit_note.py
#
# Then add to hooks.py:
#   (no hooks needed — called directly via frappe.call with full method path)

import frappe
from frappe.utils import flt
from datetime import datetime, timedelta
import erpnext.controllers.sales_and_purchase_return as _ret_module


@frappe.whitelist()
def create_quick_credit_note(return_against, posting_date, credit_amount, reason):
    """
    Create and submit a Quick Credit Note (Sales Invoice return) for
    rate difference adjustment using CR ADJUST item.

    Bypasses return item validation so CR ADJUST (not in original invoice)
    is accepted. Sets posting_date and set_posting_time=1 so date is
    never overridden by ERPNext.
    """

    # ── Fetch original invoice ────────────────────────────────
    orig = frappe.get_doc('Sales Invoice', return_against)

    if orig.docstatus != 1:
        frappe.throw(
            'Original invoice must be submitted before creating a Credit Note.')

    credit_amount = flt(credit_amount)
    if credit_amount <= 0:
        frappe.throw('Credit amount must be greater than zero.')

    # ── Build taxes from original invoice rows ────────────────
    taxes = []
    for t in orig.taxes:
        taxes.append({
            'charge_type':            t.charge_type,
            'account_head':           t.account_head,
            'rate':                   t.rate,
            'description':            t.description,
            'cost_center':            t.cost_center or orig.cost_center,
            'included_in_print_rate': t.included_in_print_rate or 0,
        })

    # ── Build item row ────────────────────────────────────────
    first_item = orig.items[0] if orig.items else frappe._dict()
    items = [{
        'item_code':      'CR ADJUST',
        'item_name':      'RATE DIFFERENCE',
        'description':    reason,
        'qty': -1,
        'rate':           credit_amount,
        'uom':            'Nos',
        'income_account': first_item.get('income_account', ''),
        'cost_center':    first_item.get('cost_center', orig.cost_center or ''),
        'warehouse':      first_item.get('warehouse', ''),
    }]

    # ── Calculate posting_time = original invoice time + 1 minute ────
    # ERPNext requires credit note timestamp to be strictly after original invoice
    orig_time_str = str(orig.posting_time or '00:00:00')
    try:
        orig_time = datetime.strptime(orig_time_str.split('.')[0], '%H:%M:%S')
        cn_time = orig_time + timedelta(minutes=1)
        posting_time = cn_time.strftime('%H:%M:%S')
    except Exception:
        posting_time = '00:01:00'

    # ── Create doc ────────────────────────────────────────────
    cn = frappe.new_doc('Sales Invoice')

    cn.update({
        'is_return':           1,
        'return_against':      return_against,
        'customer':            orig.customer,
        'set_posting_time':    1,          # prevent ERPNext from overriding date/time
        'posting_date':        posting_date,
        'posting_time':        posting_time,
        'company':             orig.company,
        'currency':            orig.currency,
        'conversion_rate':     orig.conversion_rate or 1,
        'taxes_and_charges':   orig.taxes_and_charges,
        'remarks':             reason,
        'debit_to':            orig.debit_to,
        'selling_price_list':  orig.selling_price_list,
        'price_list_currency': orig.price_list_currency,
        'plc_conversion_rate': orig.plc_conversion_rate or 1,
        'cost_center':         orig.cost_center,
        'territory':           orig.territory,
        'customer_address':    orig.customer_address,
        'contact_person':      orig.contact_person,
        'tc_name':             orig.tc_name,
        'delivery_challan':    orig.get('delivery_challan') or '',
        'items':               items,
        'taxes':               taxes,
    })

    # ── FIX 1: bypass validate_returned_items ────────────────────────
    # ERPNext v15 calls _ret_module.validate_returned_items() during validate.
    # No flag exists to skip it — temporarily replace with a no-op for the
    # duration of insert+submit, then restore.
    _original_validate = _ret_module.validate_returned_items

    def _noop(*args, **kwargs):
        pass

    _ret_module.validate_returned_items = _noop

    try:
        cn.insert(ignore_permissions=False)

        # Re-affirm posting_date and posting_time after insert (belt-and-suspenders)
        frappe.db.set_value('Sales Invoice', cn.name, {
            'posting_date':     posting_date,
            'posting_time':     posting_time,
            'set_posting_time': 1,
        })
        frappe.db.commit()

        # ── Submit ────────────────────────────────────────────────
        cn.reload()
        cn.submit()

    finally:
        # Always restore — even if insert/submit throws
        _ret_module.validate_returned_items = _original_validate

    return cn.name


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_items_in_stock(doctype, txt, searchfield, start, page_len, filters):
    """
    Link field query — returns only item codes that have
    actual stock available in the given company.
    Called from Delivery Challan Item → item_code get_query.
    """
    company = (filters or {}).get(
        "company") or frappe.defaults.get_user_default("Company")

    return frappe.db.sql("""
        SELECT DISTINCT
            sle.item_code,
            item.item_name
        FROM `tabStock Ledger Entry` sle
        JOIN `tabItem` item ON item.name = sle.item_code
        WHERE
            sle.company    = %(company)s
            AND sle.is_cancelled = '0'
            AND sle.docstatus    = 1
            AND sle.display_stock != 1
            AND (sle.item_code LIKE %(txt)s OR item.item_name LIKE %(txt)s)
        GROUP BY sle.item_code
        HAVING SUM(sle.actual_qty) > 0
        ORDER BY sle.item_code
        LIMIT %(start)s, %(page_len)s
    """, {
        "company":  company,
        "txt":      "%" + txt + "%",
        "start":    start,
        "page_len": page_len
    })
