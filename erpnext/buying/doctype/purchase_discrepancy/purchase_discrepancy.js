// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

// frappe.ui.form.on("Purchase Discrepancy", {
// 	refresh(frm) {

// 	},
// });
// ============================================================
// Purchase Receipt — Stock Discrepancy Feature
// Add inside refresh: function(frm) { ... }
// ============================================================

frappe.ui.form.on("Purchase Receipt", {

    refresh: function (frm) {

        // Existing: Add Rolls button (Draft only)
        if (frm.doc.docstatus === 0) {
            frm.add_custom_button(__("📦 Add Rolls"), function () {
                gj_show_roll_dialog(frm);
            });
        }

        // Discrepancy button (Submitted only)
        if (frm.doc.docstatus === 1) {
            frm.add_custom_button(__("📋 Stock Discrepancy"), function () {
                gj_show_discrepancy_dialog(frm);
            }, __("Actions"));
        }
    }
});

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
                method: "gajanand.api.purchase_discrepancy.apply_discrepancy",
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