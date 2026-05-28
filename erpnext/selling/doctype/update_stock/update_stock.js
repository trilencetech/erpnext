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
        _recalc(frm);
    },

    total_amount(frm) { _recalc(frm); },
    freight_amount(frm) { _recalc(frm); },
    tax_rate(frm) { _recalc(frm); },
});

function _recalc(frm) {
    var freight = flt(frm.doc.freight_amount || 0);
    var tax_rate = flt(frm.doc.tax_rate != null ? frm.doc.tax_rate : 9);
    var net = flt(frm.doc.total_amount || 0) + freight;
    var tax = flt(net * tax_rate / 100, 2);
    frm.set_value("tax_amount", tax);
    frm.set_value("grand_total", flt(net + tax, 2));
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
