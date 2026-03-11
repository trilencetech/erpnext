// ============================================================
// Delivery Note — Client Script
// Features:
//   1. Top menu button  → browse ALL available stock (existing)
//   2. item_code field  → type/select an item → auto-shows
//                         matching stock entries as a mini picker
// ============================================================

frappe.provide("gajanand.stock_selector");

// ─────────────────────────────────────────────────────────────
// FORM EVENTS
// ─────────────────────────────────────────────────────────────
frappe.ui.form.on("Delivery Note", {


    refresh: function (frm) {
        // Top-menu "Browse Stock" button (existing behaviour)
        frm.add_custom_button(__("🗄️ Browse Stock"), function () {
            gajanand.stock_selector.show_stock_dialog(frm);
        });

        // Filter item_code dropdown to only items with available stock
        frm.set_query("item_code", "items", function () {
            return {
                query: "erpnext.accounts.doctype.sales_invoice.quick_credit_note.get_items_in_stock",
                filters: { company: frm.doc.company }
            };
        });

        // Load full stock list once into cache — all item_code selections
        // will filter from this in-memory list (no repeated API calls)
        gj_load_stock_cache(frm);
    }
});

// ─────────────────────────────────────────────────────────────
// CHILD TABLE EVENTS — item_code change triggers mini picker
// ─────────────────────────────────────────────────────────────
frappe.ui.form.on("Delivery Note Item", {
    item_code: function (frm, cdt, cdn) {
        // Guard: skip if row is being filled programmatically by the picker
        if (frm._gj_filling) return;

        var row = locals[cdt][cdn];
        if (!row.item_code) return;

        if (!frm.doc.customer) {
            frappe.msgprint("Please select a Customer first.");
            locals[cdt][cdn].item_code = "";
            frm.refresh_field("items");
            return;
        }

        // Use cached stock list — loaded once on refresh, no API call here
        var cache = frm._gj_stock_cache;

        if (!cache) {
            // Cache not ready yet — reload then retry
            gj_load_stock_cache(frm, function () {
                frappe.ui.form.trigger("Delivery Note Item", "item_code", cdt, cdn);
            });
            return;
        }

        var matches = cache.stock.filter(function (s) {
            return s.item_code === row.item_code;
        });

        if (matches.length === 0) {
            frappe.msgprint({
                title: "No Stock Found",
                message: "No available stock for <b>" + row.item_code + "</b>.",
                indicator: "orange"
            });
            frm.get_field("items").grid.grid_rows_by_docname[cdn].remove();
            frm.refresh_field("items");
            return;
        }


        gj_show_mini_picker(frm, cdt, cdn, matches, cache.abbr, cache.income_account);

    }
});

// ─────────────────────────────────────────────────────────────
// STOCK CACHE — loaded once on refresh, reused for all rows
// ─────────────────────────────────────────────────────────────
function gj_load_stock_cache(frm, callback) {
    if (!frm.doc.company) return;

    frappe.db.get_value("Company",
        { name: frm.doc.company },
        ["default_income_account", "abbr"],
        function (co) {
            var abbr = (co && co.abbr) || "";
            var income_account = (co && co.default_income_account) || "";

            frappe.call({
                method: "erpnext.selling.doctype.sales_order.sales_order.get_individual_stock_entries",
                args: {
                    customer: frm.doc.customer || "",
                    company: frm.doc.company
                },
                callback: function (r) {
                    frm._gj_stock_cache = {
                        stock: r.message || [],
                        abbr: abbr,
                        income_account: income_account
                    };
                    frappe.show_alert({
                        message: "📦 " + (r.message || []).length + " stock entries loaded",
                        indicator: "blue"
                    }, 3);
                    if (callback) callback();
                }
            });
        }
    );
}

// ─────────────────────────────────────────────────────────────
// MINI PICKER DIALOG
// ─────────────────────────────────────────────────────────────
function gj_show_mini_picker(frm, cdt, cdn, entries, abbr, income_account) {
    var row = locals[cdt][cdn];

    var d = new frappe.ui.Dialog({
        title: "📦 Select Stock — " + row.item_code,
        size: "large",
        fields: [
            {
                fieldtype: "HTML",
                fieldname: "picker_table",
                options: gj_picker_html(entries)
            }
        ],
        primary_action_label: "✅ Add Selected",
        primary_action: function () {
            var selected = [];
            d.$wrapper.find(".gj-stock-cb:checked").each(function () {
                var idx = parseInt($(this).data("idx"));
                selected.push(entries[idx]);
            });

            if (!selected.length) {
                frappe.msgprint({ title: "Nothing selected", message: "Please check at least one row.", indicator: "orange" });
                return;
            }

            // Set guard BEFORE any locals writes — stays true until all rows done
            frm._gj_filling = true;

            // First entry fills the current row
            gj_fill_row_sync(frm, cdt, cdn, selected[0], abbr, income_account);

            // Additional entries get new rows — all synchronous, no async inside
            selected.slice(1).forEach(function (item) {
                var new_row = frm.add_child("items");
                gj_fill_row_sync(frm, new_row.doctype, new_row.name, item, abbr, income_account);
            });

            frm.refresh_field("items");
            frm._gj_filling = false;

            d.hide();
        }
    });

    d.show();
}

// ─────────────────────────────────────────────────────────────
// BUILD PICKER HTML
// ─────────────────────────────────────────────────────────────
function gj_picker_html(entries) {
    var rows = entries.map(function (item, i) {
        var price = parseFloat(item.item_price || 0).toFixed(2);
        var qty = parseFloat(item.actual_qty || 0).toFixed(3);
        var size = item.size != null ? item.size : "—";
        var mm = item.mm != null ? item.mm : "—";
        var date = item.posting_date || "—";
        var supp = item.supplier_name || "—";

        return `
        <tr class="gj-stock-row" data-idx="${i}" data-qty="${item.actual_qty}">
            <td style="text-align:center">
                <input type="checkbox" class="gj-stock-cb" data-idx="${i}"
                    style="width:16px;height:16px;cursor:pointer;accent-color:#3b82f6">
            </td>
            <td><b>${item.item_name || item.item_code}</b></td>
            <td style="text-align:right">${size}"</td>
            <td style="text-align:right">${mm} mm</td>
            <td style="text-align:right;font-weight:600;color:#16a34a">${qty} kg</td>
            <td style="text-align:right">₹ ${price}</td>
            <td style="color:#6b7280;font-size:12px">${date}</td>
            <td style="color:#6b7280;font-size:12px">${supp}</td>
        </tr>`;
    }).join("");

    return `
    <style>
        .gj-stock-row:hover td { background: #eff6ff !important; }
        .gj-stock-row.gj-checked td { background: #dbeafe !important; }
        .gj-stock-row.gj-hidden { display: none; }
        .gj-picker-table th {
            background: #f1f5f9;
            font-size: 11px;
            letter-spacing: .5px;
            text-transform: uppercase;
            color: #64748b;
            padding: 8px 10px;
            border-bottom: 2px solid #e2e8f0;
        }
        .gj-picker-table td {
            padding: 9px 10px;
            border-bottom: 1px solid #f1f5f9;
            vertical-align: middle;
            font-size: 13px;
        }
        .gj-pick-hint {
            text-align:center;
            padding: 8px;
            font-size: 12px;
            color: #94a3b8;
            background: #f8faff;
            border-radius: 6px;
            margin-bottom: 10px;
        }
        .gj-filter-bar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 4px 10px;
        }
        .gj-filter-bar label {
            font-size: 12px;
            color: #64748b;
            white-space: nowrap;
        }
        .gj-filter-bar input {
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 5px 10px;
            font-size: 13px;
            width: 130px;
            outline: none;
        }
        .gj-filter-bar input:focus { border-color: #3b82f6; }
        .gj-filter-bar .gj-filter-clear {
            font-size: 11px;
            color: #94a3b8;
            cursor: pointer;
            text-decoration: underline;
        }
        .gj-no-results {
            text-align: center;
            padding: 18px;
            color: #94a3b8;
            font-size: 13px;
            display: none;
        }
    </style>
    <div class="gj-pick-hint">☑️ Check one or more rows, then click <b>Add Selected</b></div>
    <div class="gj-filter-bar">
        <label>⚖️ Filter by Weight (kg):</label>
        <input type="number" id="gj-weight-filter" placeholder="e.g. 25.5" min="0" step="0.001">
        <span class="gj-filter-clear" id="gj-weight-clear" style="display:none">✕ Clear</span>
        <span id="gj-match-count" style="font-size:12px;color:#64748b;margin-left:auto"></span>
    </div>
    <div style="max-height:340px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;">
        <table class="table gj-picker-table" style="margin:0;table-layout:fixed;width:100%">
            <thead>
                <tr>
                    <th style="width:44px;text-align:center">
                        <input type="checkbox" id="gj-select-all"
                            style="width:15px;height:15px;accent-color:#3b82f6"
                            title="Select all">
                    </th>
                    <th>Item</th>
                    <th style="width:70px;text-align:right">Size</th>
                    <th style="width:70px;text-align:right">MM</th>
                    <th style="width:90px;text-align:right">Weight/Quantity (KG/Nos)</th>
                    <th style="width:90px;text-align:right">Price (₹)</th>
                    <th style="width:100px">Date</th>
                    <th>Supplier</th>
                </tr>
            </thead>
            <tbody id="gj-stock-tbody">${rows}</tbody>
        </table>
        <div class="gj-no-results" id="gj-no-results">No entries match this weight filter.</div>
    </div>
    <script>
        (function () {
            // ── Weight filter ──────────────────────────────────────────
            var filterInput = document.getElementById("gj-weight-filter");
            var clearBtn    = document.getElementById("gj-weight-clear");
            var matchCount  = document.getElementById("gj-match-count");
            var noResults   = document.getElementById("gj-no-results");

            function apply_filter() {
                var val = parseFloat(filterInput.value);
                var rows = document.querySelectorAll("#gj-stock-tbody .gj-stock-row");
                var visible = 0;

                rows.forEach(function (row) {
                    if (isNaN(val)) {
                        row.classList.remove("gj-hidden");
                        visible++;
                    } else {
                        var rowQty = parseFloat(row.dataset.qty || 0);
                        // Match rows whose weight starts with the typed digits
                        var matches = rowQty.toFixed(3).startsWith(val.toString())
                                   || rowQty === val;
                        row.classList.toggle("gj-hidden", !matches);
                        if (matches) visible++;
                    }
                });

                clearBtn.style.display  = isNaN(val) ? "none" : "inline";
                noResults.style.display = (visible === 0) ? "block" : "none";
                matchCount.textContent  = isNaN(val) ? "" : visible + " match" + (visible !== 1 ? "es" : "");
            }

            filterInput.addEventListener("input", apply_filter);

            clearBtn.addEventListener("click", function () {
                filterInput.value = "";
                apply_filter();
            });

            // ── Select-all (only visible rows) ────────────────────────
            document.getElementById("gj-select-all").addEventListener("change", function () {
                var checked = this.checked;
                document.querySelectorAll("#gj-stock-tbody .gj-stock-row:not(.gj-hidden) .gj-stock-cb")
                    .forEach(function (cb) {
                        cb.checked = checked;
                        cb.closest("tr").classList.toggle("gj-checked", checked);
                    });
            });

            // ── Row highlight on individual checkbox ──────────────────
            document.querySelectorAll(".gj-stock-cb").forEach(function (cb) {
                cb.addEventListener("change", function () {
                    this.closest("tr").classList.toggle("gj-checked", this.checked);
                });
            });
        })();
    </script>`;
}

// ─────────────────────────────────────────────────────────────
// FILL THE CHILD TABLE ROW — synchronous, writes directly to
// locals[] so NO form events are fired (prevents picker re-open)
// ─────────────────────────────────────────────────────────────
function gj_fill_row_sync(frm, cdt, cdn, item, abbr, income_account) {
    var r = locals[cdt][cdn];

    r.item_code = item.item_code;
    r.item_name = item.item_name;
    r.qty = item.actual_qty;
    r.size = item.size;
    r.mm = item.mm;
    r.item_id = item.item_id;
    r.delivery_date = frappe.datetime.get_today();
    r.rate = parseFloat(item.item_price || 0);
    r.uom = item.stock_uom;
    r.warehouse = "Stores - " + abbr;
    r.amount = parseFloat((item.item_price * item.actual_qty) || 0);
    r.income_account = income_account;

    frappe.show_alert({
        message: "✅ <b>" + item.item_name + "</b> — "
            + item.actual_qty + " kg @ ₹" + parseFloat(item.item_price || 0).toFixed(2),
        indicator: "green"
    }, 4);
}

// ─────────────────────────────────────────────────────────────
// EXISTING FULL BROWSE DIALOG (unchanged)
// ─────────────────────────────────────────────────────────────
gajanand.stock_selector.show_stock_dialog = function (frm) {
    if (!frm.doc.customer) {
        frappe.msgprint("Please select a Customer before choosing items from stock.");
        return;
    }

    // Use cache if available, otherwise fetch fresh
    function open_dialog(stock, abbr, income_account) {
        if (!stock || stock.length === 0) {
            frappe.msgprint("No stock available.");
            return;
        }
        const items = stock;
        var income_account = income_account;
        var abbr = abbr;
        const dialog = new frappe.ui.Dialog({
            title: "Select Items from Stock Ledger",
            fields: [
                {
                    fieldtype: "Data",
                    label: "Search Item Name",
                    fieldname: "search_name",
                },
                {
                    fieldtype: "Float",
                    label: "Exact Size (Inch)",
                    fieldname: "search_size",
                },
                {
                    fieldtype: "Float",
                    label: "Search Weight (kg)",
                    fieldname: "search_qty",
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
                if (frm.doc.doctype === "Update Stock") {
                    calculate_totals(frm);
                }
                dialog.hide();
            }
        });

        function filter_stock() {
            const name = (dialog.get_value("search_name") || "").toLowerCase();
            const qty = dialog.get_value("search_qty");
            const size = dialog.get_value("search_size");
            const filtered = items.filter(item => {
                const name_match = name ? item.item_name.toLowerCase().includes(name) : true;
                const qty_match = qty ? item.actual_qty.toString().startsWith(qty.toString()) : true;
                const size_match = size && item.size != null
                    ? item.size.toString().startsWith(size.toString()) : true;
                return name_match && qty_match && size_match;
            });
            render_stock_table(filtered);
        }

        function calculate_totals(frm) {
            let total_qty = 0, total_amount = 0;
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
                    ${filtered.map((item) => `
                      <tr>
                        <td><input type="checkbox" data-item-id="${item.item_id}"></td>
                        <td>${item.item_name}</td>
                        <td>${item.size}</td>
                        <td>${item.actual_qty}</td>
                        <td>${parseFloat(item.item_price || 0).toFixed(2)}</td>
                        <td>${item.posting_date}</td>
                        <td>${item.supplier_name}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>`;
            dialog.fields_dict.stock_table.$wrapper.html(html);

            let debounceTimer;
            dialog.fields_dict.search_name.$wrapper.find("input").on("input", function () {
                if (this.value.length >= 2) {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(filter_stock, 1000);
                }
            });
            dialog.fields_dict.search_qty.$wrapper.find("input").on("input", function () {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(filter_stock, 1000);
            });
            dialog.fields_dict.search_size.$wrapper.find("input").on("input", function () {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(filter_stock, 1000);
            });
        }

        dialog.show();
        render_stock_table(items);
    }


    if (frm._gj_stock_cache && frm._gj_stock_cache.stock.length) {
        open_dialog(
            frm._gj_stock_cache.stock,
            frm._gj_stock_cache.abbr,
            frm._gj_stock_cache.income_account
        );
    } else {
        frappe.call({
            method: "erpnext.selling.doctype.sales_order.sales_order.get_individual_stock_entries",
            args: { customer: frm.doc.customer, company: frm.doc.company },
            callback: function (r) {
                var co = frappe.get_doc("Company", frm.doc.company) || {};
                open_dialog(r.message, co.abbr || "", co.default_income_account || "");
            }
        });
    }
};