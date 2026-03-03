
frappe.provide("gajanand.stock_selector");

gajanand.stock_selector.show_stock_dialog = function (frm) {
    income_account = ""
    abbr = ""
    if (!frm.doc.customer) {
        frappe.msgprint("Please select a Customer before choosing items from stock.");
        return;
    }

    frappe.call({
        method: "erpnext.selling.doctype.sales_order.sales_order.get_individual_stock_entries",
        args: { customer: frm.doc.customer, company: frm.doc.company },
        callback: function (r) {
            if (!r.message || r.message.length === 0) {
                frappe.msgprint("No stock available.");
                return;
            }
            frappe.call({
                method: "frappe.client.get_value",
                args: {
                    doctype: "Company",
                    filters: { name: frm.doc.company },
                    fieldname: ["default_income_account", "abbr"]
                },
                callback: function (r) {
                    income_account = r.message.default_income_account// fallback
                    abbr = r.message.abbr
                }
            })


            const items = r.message;
            const dialog = new frappe.ui.Dialog({
                title: "Select Items from Stock Ledger",
                fields: [
                    {
                        fieldtype: "Data",
                        label: "Search Item Name",
                        fieldname: "search_name",
                        setTimeout: () => filter_stock()
                    },
                    {
                        fieldtype: "Float",
                        label: "Exact Size (Inch)",
                        fieldname: "search_size",
                        setTimeout: () => filter_stock()
                    },
                    {
                        fieldtype: "Float",
                        label: "Search Weight (kg)",
                        fieldname: "search_qty",
                        setTimeout: () => filter_stock()
                    },
                    {
                        fieldtype: "HTML",
                        fieldname: "stock_table"
                    }
                ],

                primary_action_label: "Add Selected",
                primary_action() {

                    const selected = Array.from(
                        dialog.fields_dict.stock_table.$wrapper.find("input:checked")
                    ).map(input => {
                        const itemId = input.dataset.itemId;
                        return items.find(it => it.item_id === itemId);
                    });

                    selected.forEach(item => {
                        frm.add_child("items", {
                            item_code: item.item_code,
                            item_name: item.item_name,
                            qty: item.actual_qty,
                            size: item.size,
                            mm: item.mm,
                            item_id: item.item_id,
                            delivery_date: frappe.datetime.get_today(),
                            rate: parseFloat(item.item_price || 0).toFixed(2),
                            uom: item.stock_uom,
                            warehouse: "Stores - " + abbr,
                            amount: parseFloat((item.item_price * item.actual_qty) || 0).toFixed(2),
                            income_account: income_account
                        });
                    });
                    frm.doc.items = frm.doc.items.filter(row => row.item_code);
                    frm.refresh_field("items");
                    frm.trigger("calculate_taxes_and_totals");
                    if (frm.doc.doctype == 'Update Stock') {
                        calculate_totals(frm)
                    }

                    dialog.hide();
                }



            }
            );
            function filter_stock() {
                const name = (dialog.get_value("search_name") || "").toLowerCase();
                const qty = dialog.get_value("search_qty");
                const size = dialog.get_value("search_size");
                const filtered = items.filter(item => {

                    const name_match = name ? item.item_name.toLowerCase().includes(name) : true;
                    const qty_match = qty ? item.actual_qty.toString().startsWith(qty.toString()) : true;
                    const size_match = size && item.size != null ? item.size.toString().startsWith(size.toString()) : true;
                    return name_match && qty_match && size_match;
                });

                render_stock_table(filtered);
            }
            function calculate_totals(frm) {
                let total_qty = 0;
                let total_amount = 0;

                (frm.doc.items || []).forEach(row => {
                    total_qty += row.qty || 0;
                    total_amount += row.amount || (row.qty * row.rate) || 0;
                });

                frm.set_value("total_qty", total_qty);
                frm.set_value("total_amount", total_amount);
            }


            function render_stock_table(filtered) {
                const html = `
                <table class="table table-bordered">
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Item</th>
                      <th>Size (Inch)</th>
                      <th>Weight (kg)</th>
                      <th>Price (₹)</th>
                      <th>Purchase Date</th>
                      <th>Supplier Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${filtered.map((item, i) => `
                      <tr>
                        <td><input type="checkbox" data-item-id="${item.item_id}"></td>
                        <td>${item.item_name}</td>
                        <td>${item.size}</td>
                        <td>${item.actual_qty}</td>
                        <td>${parseFloat(item.item_price || 0).toFixed(2)}</td>
                        <td>${item.posting_date} </td>
                        <td>${item.supplier_name}</td>

                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              `;
                dialog.fields_dict.stock_table.$wrapper.html(html);
                let debounceTimer;

                dialog.fields_dict.search_name.$wrapper.find("input").on("input", function () {
                    const value = this.value;

                    if (value.length >= 2) {
                        clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(() => {
                            filter_stock();
                        }, 1000); // 1 second pause
                    }
                });
                dialog.fields_dict.search_qty.$wrapper.find("input").on("input", function () {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        filter_stock();
                    }, 1000);
                });

                dialog.fields_dict.search_size.$wrapper.find("input").on("input", function () {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        filter_stock();
                    }, 1000);
                });
            }

            dialog.show();
            render_stock_table(items);



        }
    });

}

