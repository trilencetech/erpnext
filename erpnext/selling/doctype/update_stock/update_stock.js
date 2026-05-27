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
