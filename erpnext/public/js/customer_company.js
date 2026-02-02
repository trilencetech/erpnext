

function apply_company_filters(frm) {
    if (frm.doc.company) {
        // Customer filter
        frm.set_query("customer", () => {
            return {
                query: "erpnext.controllers.customer_query.customer_query",
                filters: { company: frm.doc.company }
            };
        });
        // Supplier filter
        if (frm.fields_dict.supplier) {
            frm.set_query("supplier", () => {
                return {
                    query: "erpnext.controllers.customer_query.supplier_query",
                    filters: { company: frm.doc.company }
                };
            });
        }
    }
}

// Attach to multiple doctypes
["Sales Order", "Sales Invoice", "Delivery Note", "Purchase Order", "Purchase Invoice"].forEach(function (doctype) {
    frappe.ui.form.on(doctype, {
        company: function (frm) {
            frm.set_value("customer", null);
            apply_company_filters(frm);
        },
        onload: function (frm) {
            apply_company_filters(frm);
        }
    });
});
