// Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors

frappe.ui.form.on("Update Stock", {
    refresh(frm) {
        if (frm.doc.docstatus === 1) {
            frm.add_custom_button(__("Delivery Challan"), function () {
                _open_print(frm, "Update Stock - Delivery Challan");
            }, __("🖨️ Print"));

            frm.add_custom_button(__("Sales Invoice"), function () {
                _open_print(frm, "Update Stock - Cash Bill");
            }, __("🖨️ Print"));
        }
    },
});

frappe.ui.form.on("Update Stock Item", {
    rate(frm, cdt, cdn) {
        _calc_row(frm, cdt, cdn);
    },
    qty(frm, cdt, cdn) {
        _calc_row(frm, cdt, cdn);
    },
});

function _calc_row(frm, cdt, cdn) {
    var row = locals[cdt][cdn];
    frappe.model.set_value(cdt, cdn, "amount", flt(flt(row.qty) * flt(row.rate), 2));
    _update_totals(frm);
}

function _update_totals(frm) {
    var total_qty = 0, total_amount = 0;
    (frm.doc.items || []).forEach(function (row) {
        total_qty += flt(row.qty);
        total_amount += flt(row.amount);
    });
    frm.set_value("total_qty", flt(total_qty, 3));
    frm.set_value("total_amount", flt(total_amount, 2));
}

function _open_print(frm, format_name) {
    var url = frappe.urllib.get_full_url(
        "/printview?" + $.param({
            doctype: frm.doctype,
            name: frm.docname,
            format: format_name,
            no_letterhead: 1,
            trigger_print: 0,
            _lang: frappe.boot.lang || "en",
        })
    );
    window.open(url, "_blank");
}
