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

        // Load full stock list once into cache
        gj_load_stock_cache(frm);
    },


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
            var masterRate = d.$wrapper.find("#gj-item-master-rate").val().trim();
            if (!selected.length) {
                frappe.msgprint({ title: "Nothing selected", message: "Please check at least one row.", indicator: "orange" });
                return;
            }

            // Set guard BEFORE any locals writes — stays true until all rows done
            frm._gj_filling = true;

            // First entry fills the current row
            gj_fill_row_sync(frm, cdt, cdn, selected[0], abbr, income_account, masterRate);

            // Additional entries get new rows — all synchronous, no async inside
            selected.slice(1).forEach(function (item) {
                var new_row = frm.add_child("items");
                gj_fill_row_sync(frm, new_row.doctype, new_row.name, item, abbr, income_account, masterRate);
            });

            frm.refresh_field("items");
            frm._gj_filling = false;

            d.hide();
        }
    });

    d.show();

    // Bind all picker events via jQuery AFTER dialog renders
    // (Frappe strips <script> tags from HTML fields — must bind here)
    var $w = d.$wrapper;

    function gj_apply_weight_filter() {
        var txt = $w.find("#gj-weight-filter").val().trim();
        var visible = 0;

        $w.find("#gj-stock-tbody .gj-stock-row").each(function () {
            var rowQty = $(this).data("qty").toString();
            // prefix match on raw string so "25" matches "25.500", "25.1" etc
            var show = txt === "" || rowQty.startsWith(txt);
            $(this).toggleClass("gj-hidden", !show);
            if (show) visible++;
        });

        $w.find("#gj-weight-clear").toggle(txt !== "");
        $w.find("#gj-no-results").toggle(visible === 0 && txt !== "");
        $w.find("#gj-match-count").text(txt ? visible + " match" + (visible !== 1 ? "es" : "") : "");
    }

    // Weight filter input
    $w.on("input", "#gj-weight-filter", function () {
        gj_apply_weight_filter();
    });

    // Clear button
    $w.on("click", "#gj-weight-clear", function () {
        $w.find("#gj-weight-filter").val("");
        gj_apply_weight_filter();
    });

    // Select-all — only affects visible rows
    $w.on("change", "#gj-select-all", function () {
        var checked = this.checked;
        $w.find("#gj-stock-tbody .gj-stock-row:not(.gj-hidden) .gj-stock-cb").each(function () {
            this.checked = checked;
            $(this).closest("tr").toggleClass("gj-checked", checked);
        });
    });

    // Individual checkbox row highlight
    $w.on("change", ".gj-stock-cb", function () {
        $(this).closest("tr").toggleClass("gj-checked", this.checked);
    });

    // ── Click anywhere on a data row to toggle its checkbox ──────────────────
    $w.on("click", "#gj-stock-tbody .gj-stock-row", function (e) {
        // Ignore if user actually clicked directly on the checkbox (it toggles itself)
        if ($(e.target).is(".gj-stock-cb")) return;
        var $cb = $(this).find(".gj-stock-cb");
        $cb.prop("checked", !$cb.prop("checked"));
        $(this).toggleClass("gj-checked", $cb.prop("checked"));
    });

    // ── Enter key behaviour ───────────────────────────────────────────────────
    //   • Checkbox focused  → toggle that checkbox (row highlight fires via change)
    //   • Anywhere else     → trigger "Add Selected"
    $w.on("keydown.gj_mini", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if ($(e.target).is("input[type='checkbox']")) {
            var $cb = $(e.target);
            $cb.prop("checked", !$cb.prop("checked")).trigger("change");
            return;
        }
        e.stopPropagation();
        d.get_primary_btn().trigger("click");
    });

    // ── If only one entry auto-check it; always focus the dialog ─────────────
    if (entries.length === 1) {
        $w.find(".gj-stock-cb").prop("checked", true);
        $w.find(".gj-stock-row").addClass("gj-checked");
    }
    // Focus the dialog container so Enter/keyboard work without a mouse click
    setTimeout(function () { $w.find(".modal-content").attr("tabindex", "-1").focus(); }, 150);
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
            <td style="text-align:right;font-weight:600;color:#16a34a">${qty}</td>
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
    <div class="gj-pick-hint">☑️ Click any row to select &nbsp;·&nbsp; Press <b>Enter</b> or click <b>Add Selected</b></div>
    <div class="gj-filter-bar">
        <label>⚖️ Filter by Weight (kg):</label>
        <input type="number" id="gj-weight-filter" placeholder="e.g. 25.5" min="0" step="0.001">
        <span class="gj-filter-clear" id="gj-weight-clear" style="display:none">✕ Clear</span>
        <span id="gj-match-count" style="font-size:12px;color:#64748b;margin-left:auto"></span>
        <label>Master Rate: </label>
        <input type="number" id="gj-item-master-rate" placeholder="e.g. 250" min="0" step="0.001">
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
                    <th style="width:90px;text-align:right">Weight/Qty (kg/Unit)</th>
                    <th style="width:90px;text-align:right">Price (₹)</th>
                    <th style="width:100px">Date</th>
                    <th>Supplier</th>
                </tr>
            </thead>
            <tbody id="gj-stock-tbody">${rows}</tbody>
        </table>
        <div class="gj-no-results" id="gj-no-results">No entries match this weight/unit filter.</div>
    </div>
`;
}

// ============================================================
// Purchase Receipt — Client Script
// Feature: "📦 Add Rolls" button → Roll Entry Dialog
//   1. User selects Item + enters No. of Rolls
//   2. That many weight input boxes appear
//   3. Common Rate field at bottom
//   4. Add button → creates one item row per roll
// ============================================================
// Settings → Client Script → New
//   Script Type : Form
//   Apply To    : Purchase Receipt
//   Enabled     : Yes
// ============================================================


frappe.ui.form.on("Purchase Receipt", {

    refresh: function (frm) {
        if (frm.doc.docstatus === 0) {
            frm.add_custom_button(__("📦 Add Rolls"), function () {
                gj_show_roll_dialog(frm);
            });
        }
        // ── New: Record Stock Discrepancy (Submitted only) ────
        if (frm.doc.docstatus === 1) {
            frm.add_custom_button(__("📋 Stock Discrepancy"), function () {
                gj_show_discrepancy_dialog(frm);
            }, __("Actions"));
        }
    }

});


// ─────────────────────────────────────────────────────────────
// ROLL ENTRY DIALOG
// ─────────────────────────────────────────────────────────────
function gj_show_roll_dialog(frm) {


    var d = new frappe.ui.Dialog({
        title: "📦 Add Rolls to Purchase Receipt",
        size: "large",
        fields: [
            // ── Step 1: Item + Roll Count ──
            {
                fieldtype: "Section Break",
                label: "Step 1 — Select Item & Number of Rolls"
            },
            {
                fieldtype: "Link",
                fieldname: "item_code",
                label: "Item",
                options: "Item",
                reqd: 1,
                get_query: function () {
                    return {
                        filters: [["is_purchase_item", "=", 1]]
                    };
                }
            },
            { fieldtype: "Column Break" },
            {
                fieldtype: "Int",
                fieldname: "no_of_rolls",
                label: "Number of Rolls",
                reqd: 1,
                default: 0,
                description: "Enter count → weight boxes will appear below"
            },
            // ── Step 2: Weight boxes (HTML) ──
            {
                fieldtype: "Section Break",
                label: "Step 2 — Enter Weight per Roll (kg)"
            },
            {
                fieldtype: "HTML",
                fieldname: "roll_inputs",
                options: gj_empty_rolls_html()
            },
            // ── Step 3: Common Rate ──
            {
                fieldtype: "Section Break",
                label: "Step 3 — Rate & Warehouse"
            },
            {
                fieldtype: "Currency",
                fieldname: "rate",
                label: "Rate per kg (₹)",
                reqd: 1,
                description: "Same rate applied to all rolls"
            },
            { fieldtype: "Column Break" },
            {
                fieldtype: "Link",
                fieldname: "warehouse",
                label: "Warehouse",
                options: "Warehouse",
                reqd: 1,
                default: "Stores - " + frm.doc.company_short,
                get_query: function () {
                    return { filters: [["is_group", "=", 0]] };
                }
            },
            {
                fieldtype: "Section Break"
            },
            {
                fieldtype: "HTML",
                fieldname: "roll_summary",
                options: '<div id="gj-roll-summary" style="color:#6b7280;font-size:13px">Fill weights above to see summary</div>'
            }
        ],
        primary_action_label: "✅ Add All Rolls",
        primary_action: function (values) {
            gj_add_rolls(frm, d, values);
        }
    });

    d.show();

    // ── Bind events AFTER dialog renders ──────────────────────
    var $w = d.$wrapper;

    // When no_of_rolls changes → render weight boxes
    d.fields_dict.no_of_rolls.$input.on("change", function () {
        var n = parseInt($(this).val()) || 0;
        gj_render_roll_inputs($w, n);
    });

    // When item selected → auto-fill rate from last purchase
    d.fields_dict.item_code.$input.on("change", function () {
        var item = d.get_value("item_code");
        if (!item) return;
        frappe.db.get_value("Item", item,
            ["last_purchase_rate", "purchase_uom", "stock_uom"],
            function (r) {
                if (r && r.last_purchase_rate)
                    d.set_value("rate", r.last_purchase_rate);
            }
        );
    });

    // Live summary update when any weight input changes
    $w.on("input", ".gj-roll-input", function () {
        gj_update_summary($w, d);
    });

    // Enter in a roll box → move to next box; Enter in the last box → submit
    $w.on("keydown", ".gj-roll-input", function (e) {
        if (e.key !== "Enter") return;
        e.preventDefault();
        var next = parseInt($(this).data("roll")) + 1;
        var $next = $w.find(".gj-roll-input[data-roll='" + next + "']");
        if ($next.length) {
            $next.focus().select();
        } else {
            d.get_primary_btn().trigger("click");
        }
    });
}

// ─────────────────────────────────────────────────────────────
// RENDER ROLL INPUT BOXES
// ─────────────────────────────────────────────────────────────
function gj_render_roll_inputs($w, n) {
    if (n <= 0 || n > 200) {
        $w.find("[data-fieldname='roll_inputs'] .input-area").html(
            '<div style="color:#dc2626;font-size:13px;padding:8px">⚠️ Please enter a valid number (1–200)</div>'
        );
        return;
    }

    var cols = n <= 5 ? n : n <= 12 ? 4 : n <= 24 ? 6 : 8;
    var boxes = '';
    for (var i = 1; i <= n; i++) {
        boxes += `
        <div style="display:flex;flex-direction:column;gap:4px;">
            <label style="font-size:10px;font-weight:600;color:#6b7280;
                          text-transform:uppercase;letter-spacing:0.5px;
                          font-family:'Courier New',monospace">
                Roll ${i}
            </label>
            <input
                type="number"
                class="gj-roll-input"
                data-roll="${i}"
                placeholder="0.000"
                min="0" step="0.001"
                style="
                    height:42px;padding:0 10px;
                    border:1.5px solid #e5e7eb;border-radius:7px;
                    font-size:14px;font-weight:600;
                    font-family:'Courier New',monospace;
                    color:#0f1923;text-align:right;
                    width:100%;
                    transition:border-color 0.15s;
                "
                onfocus="this.style.borderColor='#2563eb'"
                onblur="this.style.borderColor='#e5e7eb'"
            />
        </div>`;
    }

    var html = `
    <div style="
        display:grid;
        grid-template-columns:repeat(${Math.min(cols, n)},1fr);
        gap:10px;padding:4px 0 12px;
    ">
        ${boxes}
    </div>`;

    $w.find("[data-fieldname='roll_inputs'] .input-area").html(html);

    // Auto-focus Roll 1 so the user can start typing immediately
    setTimeout(function () {
        $w.find(".gj-roll-input[data-roll='1']").focus().select();
    }, 50);
}

function gj_empty_rolls_html() {
    return `<div class="input-area" style="color:#9ca3af;font-size:13px;padding:8px 0">
        ← Enter number of rolls above to see weight input boxes
    </div>`;
}

// ─────────────────────────────────────────────────────────────
// LIVE SUMMARY
// ─────────────────────────────────────────────────────────────
function gj_update_summary($w, d) {
    var weights = [];
    var total = 0;
    var filled = 0;

    $w.find(".gj-roll-input").each(function () {
        var v = parseFloat($(this).val()) || 0;
        weights.push(v);
        if (v > 0) { total += v; filled++; }
    });

    var rate = parseFloat(d.get_value("rate")) || 0;
    var amount = parseFloat((total * rate).toFixed(2));
    var n = weights.length;

    var html = `
    <div style="
        display:flex;gap:16px;flex-wrap:wrap;
        background:#f8faff;border:1px solid #e0e7ff;
        border-radius:8px;padding:12px 16px;
    ">
        <div>
            <div style="font-size:10px;color:#6b7280;text-transform:uppercase;
                        letter-spacing:0.5px;font-family:'Courier New',monospace">
                Rolls Filled
            </div>
            <div style="font-size:16px;font-weight:700;color:#1e40af">
                ${filled} / ${n}
            </div>
        </div>
        <div>
            <div style="font-size:10px;color:#6b7280;text-transform:uppercase;
                        letter-spacing:0.5px;font-family:'Courier New',monospace">
                Total Weight
            </div>
            <div style="font-size:16px;font-weight:700;color:#065f46">
                ${total.toFixed(3)} kg
            </div>
        </div>
        <div>
            <div style="font-size:10px;color:#6b7280;text-transform:uppercase;
                        letter-spacing:0.5px;font-family:'Courier New',monospace">
                Rate
            </div>
            <div style="font-size:16px;font-weight:700;color:#92400e">
                ₹ ${rate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
        </div>
        <div>
            <div style="font-size:10px;color:#6b7280;text-transform:uppercase;
                        letter-spacing:0.5px;font-family:'Courier New',monospace">
                Total Amount
            </div>
            <div style="font-size:16px;font-weight:700;color:#1e40af">
                ₹ ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
        </div>
        <div>
            <div style="font-size:10px;color:#6b7280;text-transform:uppercase;
                        letter-spacing:0.5px;font-family:'Courier New',monospace">
                Avg per Roll
            </div>
            <div style="font-size:16px;font-weight:700;color:#6b7280">
                ${filled > 0 ? (total / filled).toFixed(3) : '0.000'} kg
            </div>
        </div>
    </div>`;

    $w.find("#gj-roll-summary").html(html);


}

// ─────────────────────────────────────────────────────────────
// ADD ROLLS TO PR ITEMS TABLE
// ─────────────────────────────────────────────────────────────
function gj_add_rolls(frm, d, values) {


    var item_code = values.item_code;
    var rate = parseFloat(values.rate) || 0;
    var warehouse = values.warehouse;

    // Collect weights from roll inputs
    var weights = [];
    d.$wrapper.find(".gj-roll-input").each(function () {
        var v = parseFloat($(this).val()) || 0;
        if (v > 0) weights.push(v);
    });

    // Validations
    if (!item_code) {
        frappe.msgprint({ title: "Missing Item", message: "Please select an Item.", indicator: "orange" });
        return;
    }
    if (weights.length === 0) {
        frappe.msgprint({ title: "No Weights", message: "Please enter at least one roll weight.", indicator: "orange" });
        return;
    }
    if (rate <= 0) {
        frappe.msgprint({ title: "Missing Rate", message: "Please enter a Rate per kg.", indicator: "orange" });
        return;
    }
    if (!warehouse) {
        frappe.msgprint({ title: "Missing Warehouse", message: "Please select a Warehouse.", indicator: "orange" });
        return;
    }

    // Fetch item details for UOM
    frappe.db.get_value("Item", item_code,
        ["item_name", "stock_uom", "purchase_uom"],
        function (item) {
            var item_name = (item && item.item_name) || item_code;
            var uom = (item && (item.purchase_uom || item.stock_uom)) || "Kg";

            // Remove any completely empty rows first
            frm.doc.items = (frm.doc.items || []).filter(function (r) {
                return r.item_code;
            });

            // Add one row per roll
            weights.forEach(function (weight, i) {
                var new_row = frm.add_child("items");
                new_row.item_code = item_code;
                new_row.item_name = item_name;
                new_row.qty = weight;
                new_row.received_qty = weight;
                new_row.accepted_qty = weight;
                new_row.uom = uom;
                new_row.stock_uom = uom;
                new_row.rate = rate;
                new_row.amount = parseFloat((weight * rate).toFixed(2));
                new_row.warehouse = warehouse;
                new_row.description = `Roll ${i + 1}`;
            });

            frm.refresh_field("items");

            frappe.show_alert({
                message: `✅ ${weights.length} roll(s) added — Total: ${weights.reduce((a, b) => a + b, 0).toFixed(3)} kg`,
                indicator: "green"
            }, 5);

            frm.script_manager.trigger("calculate_taxes_and_totals");
            d.hide();
        }
    );
}

// ─────────────────────────────────────────────────────────────
// FILL THE CHILD TABLE ROW — synchronous, writes directly to
// locals[] so NO form events are fired (prevents picker re-open)
// ─────────────────────────────────────────────────────────────
function gj_fill_row_sync(frm, cdt, cdn, item, abbr, income_account, masterRate) {
    var r = locals[cdt][cdn];
    if (null != masterRate && masterRate > 0) {
        item.item_price = masterRate;
    }


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
            + item.actual_qty + " kg/unit @ ₹" + parseFloat(item.item_price || 0).toFixed(2),
        indicator: "green"
    }, 4);
}

// ─────────────────────────────────────────────────────────────
// DISCREPANCY DIALOG
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// STEP 1 DIALOG — Select Item from PR
// ─────────────────────────────────────────────────────────────
function gj_show_discrepancy_dialog(frm) {

    // Build unique item list from PR
    var pr_item_codes = [...new Set(
        (frm.doc.items || []).map(function (r) { return r.item_code; })
    )];

    var d = new frappe.ui.Dialog({
        title: "📋 Record Stock Discrepancy",
        size: "large",
        fields: [
            // ── PR Item ───────────────────────────────────────
            {
                fieldtype: "Section Break",
                label: "Step 1 — Select Invoice Item"
            },
            {
                fieldtype: "Link",
                fieldname: "pr_item_code",
                label: "Invoice Item Code",
                options: "Item",
                reqd: 1,
                description: "Type to search — restricted to items in this PR",
                get_query: function () {
                    return {
                        filters: [["Item", "name", "in", pr_item_codes]]
                    };
                }
            },
            { fieldtype: "Column Break" },
            {
                fieldtype: "HTML",
                fieldname: "row_picker_html",
                options: '<div id="gj-row-picker"></div>'
            },

            // ── Actual Received ───────────────────────────────
            {
                fieldtype: "Section Break",
                label: "Step 2 — Actually Received (Physical)"
            },
            {
                fieldtype: "Link",
                fieldname: "actual_item_code",
                label: "Actual Item Received",
                options: "Item",
                reqd: 1,
                description: "Item that physically arrived"
            },
            { fieldtype: "Column Break" },
            {
                fieldtype: "Float",
                fieldname: "actual_qty",
                label: "Actual Qty / Weight (kg)",
                reqd: 1,
            },

            // ── Note ──────────────────────────────────────────
            {
                fieldtype: "Section Break",
                label: "Step 3 — Note & Summary"
            },
            {
                fieldtype: "Small Text",
                fieldname: "discrepancy_note",
                label: "Reason / Note",
                placeholder: "e.g. Supplier sent MT 28 instead of MT 19.5"
            },
            { fieldtype: "Column Break" },
            {
                fieldtype: "HTML",
                fieldname: "disc_summary",
                options: '<div id="gj-disc-summary" style="color:#9ca3af;font-size:13px">Fill fields above to see summary</div>'
            }
        ],
        primary_action_label: "✅ Apply Discrepancy",
        primary_action: function (values) {
            gj_apply_discrepancy(frm, d, values);
        }
    });

    // Selected PR row tracker
    d._selected_pr_row = null;

    d.show();

    var $w = d.$wrapper;

    // ── When item code selected → show row picker if multiple rows ──
    d.fields_dict.pr_item_code.df.onchange = function () {
        var item_code = d.get_value("pr_item_code");
        d._selected_pr_row = null;
        $w.find("#gj-row-picker").html("");

        if (!item_code) return;

        // Find all PR rows matching this item
        var matching_rows = (frm.doc.items || []).filter(function (r) {
            return r.item_code === item_code;
        });

        if (matching_rows.length === 0) {
            $w.find("#gj-row-picker").html(
                '<div style="color:#dc2626;font-size:12px">⚠️ Item not found in this PR</div>'
            );
            return;
        }

        if (matching_rows.length === 1) {
            // Only one row — auto-select it
            d._selected_pr_row = matching_rows[0];
            gj_show_selected_row($w, matching_rows[0]);
            gj_update_disc_summary($w, d);
        } else {
            // Multiple rows — show picker buttons
            gj_show_row_picker($w, d, matching_rows);
        }
    };

    // Summary refresh on actual field change
    d.fields_dict.actual_item_code.df.onchange = function () {
        gj_update_disc_summary($w, d);
    };
    $w.on("input", "[data-fieldname='actual_qty'] input", function () {
        gj_update_disc_summary($w, d);
    });
}

// ─────────────────────────────────────────────────────────────
// ROW PICKER — when same item appears multiple times in PR
// ─────────────────────────────────────────────────────────────
function gj_show_row_picker($w, d, rows) {
    var html = '<div style="margin-top:4px">' +
        '<div style="font-size:10px;color:#6b7280;font-weight:600;text-transform:uppercase;' +
        'letter-spacing:0.5px;margin-bottom:6px">Multiple rows found — select which roll:</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px">';

    rows.forEach(function (row, i) {
        html += `
        <div class="gj-pr-row-btn"
             data-row-idx="${i}"
             style="
                display:flex;align-items:center;justify-content:space-between;
                padding:8px 12px;border:1.5px solid #e5e7eb;border-radius:8px;
                cursor:pointer;transition:all 0.15s;background:white;
                font-size:12px;
             "
             onmouseover="this.style.borderColor='#2563eb';this.style.background='#eff6ff'"
             onmouseout="this.style.borderColor='#e5e7eb';this.style.background='white'"
        >
            <div>
                <span style="font-weight:700;color:#0f1923">${row.item_code}</span>
                &nbsp;·&nbsp;
                <span style="color:#374151">${row.item_name || ''}</span>
            </div>
            <div style="display:flex;gap:10px;align-items:center">
                <span style="font-family:'Courier New',monospace;font-weight:700;color:#059669">
                    ${row.qty} ${row.uom}
                </span>
                <span style="background:#f3f4f6;padding:2px 8px;border-radius:4px;color:#6b7280;font-size:11px">
                    ${row.warehouse}
                </span>
            </div>
        </div>`;
    });

    html += '</div></div>';
    $w.find("#gj-row-picker").html(html);

    // Click handler for row selection
    $w.on("click", ".gj-pr-row-btn", function () {
        var idx = parseInt($(this).data("row-idx"));
        d._selected_pr_row = rows[idx];

        // Highlight selected
        $w.find(".gj-pr-row-btn").css({
            "border-color": "#e5e7eb",
            "background": "white"
        });
        $(this).css({
            "border-color": "#2563eb",
            "background": "#eff6ff"
        });

        gj_update_disc_summary($w, d);
    });
}

// ─────────────────────────────────────────────────────────────
// SHOW SINGLE SELECTED ROW
// ─────────────────────────────────────────────────────────────
function gj_show_selected_row($w, row) {
    $w.find("#gj-row-picker").html(`
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;
                    padding:10px 14px;font-size:12px;">
            <div><b>Item:</b> ${row.item_code} — ${row.item_name || ''}</div>
            <div><b>Qty:</b> <span style="font-weight:700;color:#059669">${row.qty} ${row.uom}</span></div>
            <div><b>Warehouse:</b> ${row.warehouse}</div>
            <div><b>Rate:</b> ₹ ${row.rate}</div>
        </div>
    `);
}

// ─────────────────────────────────────────────────────────────
// LIVE DISCREPANCY SUMMARY
// ─────────────────────────────────────────────────────────────
function gj_update_disc_summary($w, d) {
    var pr_row = d._selected_pr_row;
    var act_item = d.get_value("actual_item_code") || "—";
    var act_qty = parseFloat($w.find("[data-fieldname='actual_qty'] input").val()) || 0;

    if (!pr_row) {
        $w.find("#gj-disc-summary").html(
            '<div style="color:#9ca3af;font-size:13px">← Select an invoice item row first</div>'
        );
        return;
    }

    var pr_qty = parseFloat(pr_row.qty) || 0;
    var qty_diff = parseFloat((act_qty - pr_qty).toFixed(3));
    var item_same = pr_row.item_code === act_item;
    var diff_col = qty_diff > 0 ? "#059669" : qty_diff < 0 ? "#dc2626" : "#6b7280";

    $w.find("#gj-disc-summary").html(`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">
        <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:7px;padding:10px">
            <div style="font-size:9px;color:#92400e;font-weight:700;text-transform:uppercase;
                        letter-spacing:0.5px;margin-bottom:5px">📄 SLE will be REMOVED</div>
            <div style="font-size:11.5px"><b>${pr_row.item_code}</b></div>
            <div style="font-size:11.5px;color:#374151">${pr_qty} ${pr_row.uom}</div>
            <div style="font-size:11px;color:#6b7280">${pr_row.warehouse}</div>
        </div>
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:7px;padding:10px">
            <div style="font-size:9px;color:#065f46;font-weight:700;text-transform:uppercase;
                        letter-spacing:0.5px;margin-bottom:5px">🏭 SLE will be ADDED</div>
            <div style="font-size:11.5px"><b>${act_item}</b></div>
            <div style="font-size:11.5px;color:#374151">${act_qty} kg</div>
            <div style="font-size:11px;color:#6b7280">${pr_row.warehouse}</div>
        </div>
    </div>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px;
                padding:9px 13px;display:flex;gap:16px;flex-wrap:wrap">
        <div>
            <div style="font-size:9px;color:#1e40af;font-weight:600;text-transform:uppercase">Item Match</div>
            <div style="font-size:13px;font-weight:700;color:${item_same ? '#059669' : '#dc2626'}">
                ${item_same ? '✅ Same' : '⚠️ Different'}
            </div>
        </div>
        <div>
            <div style="font-size:9px;color:#1e40af;font-weight:600;text-transform:uppercase">Qty Diff</div>
            <div style="font-size:13px;font-weight:700;color:${diff_col}">
                ${qty_diff >= 0 ? '+' : ''}${qty_diff} kg
            </div>
        </div>
        <div>
            <div style="font-size:9px;color:#1e40af;font-weight:600;text-transform:uppercase">Action</div>
            <div style="font-size:11px;color:#1e40af">
                Direct SLE update — no accounting entry
            </div>
        </div>
    </div>
    `);
}

// ─────────────────────────────────────────────────────────────
// APPLY DISCREPANCY
// ─────────────────────────────────────────────────────────────
function gj_apply_discrepancy(frm, d, values) {
    var pr_row = d._selected_pr_row;

    if (!pr_row) {
        frappe.msgprint({ title: "Missing", message: "Please select an Invoice Item row.", indicator: "orange" });
        return;
    }
    if (!values.actual_item_code) {
        frappe.msgprint({ title: "Missing", message: "Please select the Actual Item Received.", indicator: "orange" });
        return;
    }
    if (!values.actual_qty || values.actual_qty <= 0) {
        frappe.msgprint({ title: "Missing", message: "Please enter Actual Qty.", indicator: "orange" });
        return;
    }

    frappe.confirm(
        `This will directly update Stock Ledger Entries:<br><br>
        ➖ <b>Remove</b> SLE for <b>${pr_row.item_code}</b> — ${pr_row.qty} ${pr_row.uom}<br>
        ➕ <b>Insert</b> SLE for <b>${values.actual_item_code}</b> — ${values.actual_qty} kg<br>
        🔄 <b>Repost</b> qty_after_transaction for both items<br><br>
        <b>No accounting entry will be created.</b><br>
        Purchase Invoice stays unchanged.<br><br>
        Proceed?`,
        function () {
            frappe.call({
                method: "erpnext.buying.doctype.purchase_discrepancy.purchase_discrepancy.apply_discrepancy",
                args: {
                    purchase_receipt: frm.doc.name,
                    pr_item_code: pr_row.item_code,
                    pr_item_name: pr_row.item_name || pr_row.item_code,
                    pr_qty: pr_row.qty,
                    pr_uom: pr_row.uom,
                    pr_warehouse: pr_row.warehouse,
                    pr_rate: pr_row.rate,
                    pr_sle_name: pr_row.name,   // child row name to find exact SLE
                    actual_item_code: values.actual_item_code,
                    actual_qty: values.actual_qty,
                    discrepancy_note: values.discrepancy_note || ""
                },
                freeze: true,
                freeze_message: "Updating stock ledger...",
                callback: function (r) {
                    if (r.exc) return;
                    d.hide();
                    frappe.show_alert({
                        message: `✅ Stock updated. Discrepancy: <b>${r.message.discrepancy}</b>`,
                        indicator: "green"
                    }, 8);
                    frappe.msgprint({
                        title: "✅ Stock Discrepancy Applied",
                        indicator: "green",
                        message:
                            `<b>Discrepancy Record:</b> ${r.message.discrepancy}<br>
                             <b>SLE cancelled:</b> ${r.message.sle_cancelled}<br>
                             <b>SLE inserted:</b> ${r.message.sle_inserted}<br><br>
                             Available stock now shows correct physical stock.<br>
                             Purchase Invoice is unchanged.`
                    });
                    frm.reload_doc();
                }
            });
        }
    );
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
                console.log("Teststs")
                frm.script_manager.trigger("calculate_taxes_and_totals");
                calculate_totals(frm);


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