/* ============================================================
   ERPNext v15 - Client Script: DELIVERY NOTE FORM
   Settings → Client Script → New
   Script Name : DN Form Enhancements
   Document Type: Form
   Applies To  : Delivery Note
   Enabled     : Yes
   ============================================================ */

frappe.ui.form.on('Delivery Note', {

    onload: function (frm) {
        apply_dn_form_style(frm);
    },

    refresh: function (frm) {
        apply_dn_form_style(frm);
        apply_dn_status_banner(frm);
        add_dn_action_buttons(frm);
    },

    custom_is_intercompany_transfer: function (frm) {
        if (frm.doc.custom_is_intercompany_transfer) {
            frm.set_value('selling_price_list', 'Buying and Selling');
            frm.set_value('naming_series', 'DN-TR-.YYYY.-.####');
            frappe.show_alert({
                message: '🔁 Inter Company Transfer mode enabled. Naming series set to DN-TR and price list set to Buying and Selling.',
                indicator: 'blue'
            }, 5);
        } else {
            frm.set_value('selling_price_list', 'Standard Selling');
            frm.set_value('naming_series', 'DN-GE-.YYYY.-.####');
            frappe.show_alert({
                message: '✅ Normal Delivery Note mode. Naming series reset.',
                indicator: 'green'
            }, 3);
        }
    },

    customer: function (frm) {
        if (frm.doc.customer) {
            highlight_field(frm, 'customer');
        }
    }
});

function apply_dn_form_style(frm) {
    $(frm.wrapper).addClass('trilence-form-enhanced');

    const section_icons = {
        'Customer': '👤',
        'Delivery Details': '🚚',
        'Address and Contact': '📍',
        'Items': '📦',
        'Packing Details': '📦',
        'Taxes and Charges': '🧾',
        'Transporter Info': '🚛',
        'Accounting': '📊',
        'Print Settings': '🖨️',
    };

    frm.fields.forEach(function (field) {
        if (field.df.fieldtype === 'Section Break' && field.df.label) {
            const icon = section_icons[field.df.label] || '⚡';
            const heading = $(field.wrapper).find('.section-head');
            if (heading.length && !heading.data('icon-added')) {
                heading.prepend(`<span style="margin-right:6px">${icon}</span>`);
                heading.data('icon-added', true);
            }
        }
    });

    // Highlight inter company transfer checkbox if checked
    if (frm.doc.custom_is_intercompany_transfer) {
        const field = frm.get_field('custom_is_intercompany_transfer');
        if (field) {
            $(field.wrapper).css({
                'background': '#eff6ff',
                'border': '1.5px solid #3b82f6',
                'border-radius': '8px',
                'padding': '8px 12px'
            });
        }
    }
}

function apply_dn_status_banner(frm) {
    $(frm.wrapper).find('.trilence-dn-banner').remove();

    if (!frm.doc.posting_date) return;

    const is_intercompany = frm.doc.custom_is_intercompany_transfer;

    const status_config = {
        0: { label: 'DRAFT', bg: '#fef9c3', color: '#b45309', border: '#fde68a' },
        1: { label: 'SUBMITTED', bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe' },
        2: { label: 'CANCELLED', bg: '#fee2e2', color: '#dc2626', border: '#fecdd3' },
    };

    const config = status_config[frm.doc.docstatus] || status_config[0];

    const total_qty = (frm.doc.items || []).reduce((sum, row) => sum + (row.qty || 0), 0);

    const banner = $(`
        <div class="trilence-dn-banner" style="
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 20px; margin-bottom: 16px;
            background: ${config.bg}; border: 1px solid ${config.border};
            border-radius: 10px;
        ">
            <div style="display:flex; align-items:center; gap:12px;">
                <span style="
                    padding: 3px 12px; border-radius: 20px;
                    background: ${config.color}22; color: ${config.color};
                    font-size: 11px; font-weight: 800; letter-spacing: 1px;
                ">${config.label}</span>
                ${is_intercompany ? `<span style="
                    padding: 3px 12px; border-radius: 20px;
                    background: #dbeafe; color: #1d4ed8;
                    font-size: 11px; font-weight: 800; letter-spacing: 1px;
                ">🔁 INTER COMPANY</span>` : ''}
                <span style="font-size:13px; color:#7b8db0;">
                    ${frm.doc.customer || ''}
                    ${frm.doc.posting_date ? '· ' + frappe.datetime.str_to_user(frm.doc.posting_date) : ''}
                </span>
            </div>
            <div style="display:flex; gap:20px; align-items:center;">
                <span style="font-size:13px; color:#7b8db0;">
                    Total Qty: <strong style="color:#1a2340;">${total_qty.toFixed(3)} ${(frm.doc.items && frm.doc.items[0]) ? frm.doc.items[0].uom || '' : ''}</strong>
                </span>
                ${frm.doc.lr_no ? `<span style="font-size:13px; color:#7b8db0;">LR: <strong style="color:#1a2340;">${frm.doc.lr_no}</strong></span>` : ''}
            </div>
        </div>
    `);

    $(frm.wrapper).find('.page-form').prepend(banner);
}

function add_dn_action_buttons(frm) {
    if (frm.doc.docstatus === 1) {

        // WhatsApp dispatch notification
        frm.add_custom_button('📱 WhatsApp Dispatch', function () {
            const total_qty = (frm.doc.items || []).reduce((sum, r) => sum + (r.qty || 0), 0);
            const msg = encodeURIComponent(
                `Dear ${frm.doc.customer},\n\nYour order has been dispatched!\n\nDelivery Note: ${frm.doc.name}\nDate: ${frappe.datetime.str_to_user(frm.doc.posting_date)}\nQty: ${total_qty.toFixed(2)} KG\n${frm.doc.lr_no ? 'LR No: ' + frm.doc.lr_no : ''}\n\nThank you,\nGajanand Enterprise`
            );
            window.open(`https://wa.me/?text=${msg}`, '_blank');
        }, 'Notify');

        // Copy DN number
        frm.add_custom_button('📋 Copy DN No', function () {
            navigator.clipboard.writeText(frm.doc.name);
            frappe.show_alert({ message: 'DN number copied!', indicator: 'green' }, 2);
        }, 'Notify');

        // Inter company transfer: show link to create Purchase Receipt
        if (frm.doc.custom_is_intercompany_transfer) {
            frm.add_custom_button('📥 Create Purchase Receipt (GE)', function () {
                frappe.msgprint({
                    title: 'Next Step',
                    indicator: 'blue',
                    message: `Go to <b>Gajanand Enterprise</b> and create a <b>Purchase Receipt</b> with:<br><br>
                    Supplier: Gajanand Polyfilms (Internal)<br>
                    Inter Company Reference: <b>${frm.doc.name}</b><br>
                    Posting Date: <b>${frappe.datetime.str_to_user(frm.doc.posting_date)}</b><br>
                    Posting Time: After <b>${frm.doc.posting_time || 'this DN time'}</b><br><br>
                    <i>Enter Basic Rate manually matching Polyfilms valuation rate.</i>`
                });
            }, 'Inter Company');
        }
    }
}

function highlight_field(frm, fieldname) {
    const field = frm.get_field(fieldname);
    if (field) {
        $(field.wrapper).find('.form-control')
            .css('border-color', '#4e8cff')
            .css('background', '#eef4ff')
            .css('font-weight', '600');
    }
}


/* ============================================================
   ERPNext v15 - Client Script: DELIVERY NOTE LIST VIEW
   Settings → Client Script → New
   Script Name : DN List Enhancements
   Document Type: List
   Applies To  : Delivery Note
   Enabled     : Yes
   ============================================================ */

frappe.listview_settings['Delivery Note'] = {

    get_indicator: function (doc) {
        if (doc.docstatus === 2) return ['Cancelled', 'red', 'docstatus,=,2'];
        if (doc.docstatus === 0) return ['Draft', 'orange', 'docstatus,=,0'];
        if (doc.custom_is_intercompany_transfer) return ['Inter Company', 'blue', 'custom_is_intercompany_transfer,=,1'];
        if (doc.per_billed >= 100) return ['Fully Billed', 'green', 'per_billed,=,100'];
        if (doc.per_billed > 0) return ['Partly Billed', 'orange', 'per_billed,>,0'];
        return ['To Bill', 'yellow', 'per_billed,=,0'];
    },

    onload: function (listview) {
        // Highlight inter company rows
        $('<style>').text(`
            .list-row[data-name*="DN-TR"] .list-row-col {
                background: #eff6ff !important;
            }
            .list-row[data-name*="DN-TR"] .list-id a {
                color: #1d4ed8 !important;
                font-weight: 800 !important;
            }
        `).appendTo('head');
    },

    formatters: {
        name: function (value) {
            const is_transfer = value && value.includes('DN-TR');
            return `<span style="
                color: ${is_transfer ? '#1d4ed8' : '#4e8cff'};
                font-weight: 700;
                ${is_transfer ? 'background:#dbeafe; padding:2px 6px; border-radius:4px;' : ''}
            ">${value}</span>`;
        },
        customer: function (value) {
            return `<span style="font-weight:600; color:#1a2340;">${value}</span>`;
        },
        total_qty: function (value, df, doc) {
            return `<span style="font-weight:700; color:#1a2340;">${parseFloat(value || 0).toFixed(3)}</span>`;
        }
    }
};


/* ============================================================
   ERPNext v15 - Client Script: PURCHASE ORDER FORM
   Settings → Client Script → New
   Script Name : PO Form Enhancements
   Document Type: Form
   Applies To  : Purchase Order
   Enabled     : Yes
   ============================================================ */

frappe.ui.form.on('Purchase Order', {

    onload: function (frm) {
        apply_po_form_style(frm);
    },

    refresh: function (frm) {
        apply_po_form_style(frm);
        apply_po_status_banner(frm);
        add_po_action_buttons(frm);
    },

    supplier: function (frm) {
        if (frm.doc.supplier) highlight_field(frm, 'supplier');
    }
});

function apply_po_form_style(frm) {
    $(frm.wrapper).addClass('trilence-form-enhanced');

    const section_icons = {
        'Supplier and Purchase Details': '🏭',
        'Currency and Price List': '💱',
        'Address': '📍',
        'Contact': '📞',
        'Items': '📦',
        'Taxes and Charges': '🧾',
        'Additional Charges': '➕',
        'Terms': '📝',
        'Supplier Address': '📍',
        'Accounting': '📊',
    };

    frm.fields.forEach(function (field) {
        if (field.df.fieldtype === 'Section Break' && field.df.label) {
            const icon = section_icons[field.df.label] || '⚡';
            const heading = $(field.wrapper).find('.section-head');
            if (heading.length && !heading.data('icon-added')) {
                heading.prepend(`<span style="margin-right:6px">${icon}</span>`);
                heading.data('icon-added', true);
            }
        }
    });
}

function apply_po_status_banner(frm) {
    $(frm.wrapper).find('.trilence-po-banner').remove();

    if (!frm.doc.transaction_date) return;

    const status_config = {
        0: { label: 'DRAFT', bg: '#fef9c3', color: '#b45309', border: '#fde68a' },
        1: { label: 'SUBMITTED', bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe' },
        2: { label: 'CANCELLED', bg: '#fee2e2', color: '#dc2626', border: '#fecdd3' },
    };

    const config = status_config[frm.doc.docstatus] || status_config[0];
    const received_pct = frm.doc.per_received || 0;
    const billed_pct = frm.doc.per_billed || 0;

    const banner = $(`
        <div class="trilence-po-banner" style="
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 20px; margin-bottom: 16px;
            background: ${config.bg}; border: 1px solid ${config.border};
            border-radius: 10px;
        ">
            <div style="display:flex; align-items:center; gap:12px;">
                <span style="
                    padding: 3px 12px; border-radius: 20px;
                    background: ${config.color}22; color: ${config.color};
                    font-size: 11px; font-weight: 800; letter-spacing: 1px;
                ">${config.label}</span>
                <span style="font-size:13px; color:#7b8db0;">
                    ${frm.doc.supplier || ''}
                    ${frm.doc.transaction_date ? '· ' + frappe.datetime.str_to_user(frm.doc.transaction_date) : ''}
                </span>
            </div>
            <div style="display:flex; gap:20px; align-items:center;">
                <span style="font-size:12px; color:#7b8db0;">
                    Received: <strong style="color:${received_pct === 100 ? '#16a34a' : '#b45309'};">${received_pct}%</strong>
                </span>
                <span style="font-size:12px; color:#7b8db0;">
                    Billed: <strong style="color:${billed_pct === 100 ? '#16a34a' : '#b45309'};">${billed_pct}%</strong>
                </span>
                <span style="font-size:15px; font-weight:800; color:#1a2340;">
                    ₹${format_inr(frm.doc.grand_total || 0)}
                </span>
            </div>
        </div>
    `);

    $(frm.wrapper).find('.page-form').prepend(banner);
}

function add_po_action_buttons(frm) {
    if (frm.doc.docstatus === 1) {
        frm.add_custom_button('📱 WhatsApp PO', function () {
            const msg = encodeURIComponent(
                `Dear ${frm.doc.supplier},\n\nPlease find our Purchase Order details:\n\nPO No: ${frm.doc.name}\nDate: ${frappe.datetime.str_to_user(frm.doc.transaction_date)}\nRequired By: ${frappe.datetime.str_to_user(frm.doc.schedule_date)}\nAmount: ₹${format_inr(frm.doc.grand_total)}\n\nKindly confirm receipt.\n\nGajanand Enterprise`
            );
            window.open(`https://wa.me/?text=${msg}`, '_blank');
        }, 'Share');

        frm.add_custom_button('📋 Copy PO No', function () {
            navigator.clipboard.writeText(frm.doc.name);
            frappe.show_alert({ message: 'PO number copied!', indicator: 'green' }, 2);
        }, 'Share');
    }
}


/* ============================================================
   ERPNext v15 - Client Script: PURCHASE ORDER LIST VIEW
   Settings → Client Script → New
   Script Name : PO List Enhancements
   Document Type: List
   Applies To  : Purchase Order
   Enabled     : Yes
   ============================================================ */

frappe.listview_settings['Purchase Order'] = {

    get_indicator: function (doc) {
        if (doc.docstatus === 2) return ['Cancelled', 'red', 'docstatus,=,2'];
        if (doc.docstatus === 0) return ['Draft', 'orange', 'docstatus,=,0'];
        if (doc.per_received === 0) return ['To Receive', 'yellow', 'per_received,=,0'];
        if (doc.per_received < 100) return ['Partially Received', 'orange', 'per_received,<,100'];
        if (doc.per_billed < 100) return ['To Bill', 'blue', 'per_billed,<,100'];
        return ['Completed', 'green', 'per_billed,=,100'];
    },

    formatters: {
        name: function (value) {
            return `<span style="color:#4e8cff; font-weight:700;">${value}</span>`;
        },
        supplier: function (value) {
            return `<span style="font-weight:600; color:#1a2340;">${value}</span>`;
        },
        grand_total: function (value) {
            return `<span style="font-weight:700; color:#1a2340;">₹${format_inr(value)}</span>`;
        },
        per_received: function (value) {
            const pct = parseFloat(value || 0);
            const color = pct === 100 ? '#16a34a' : pct > 0 ? '#b45309' : '#dc2626';
            return `<span style="font-weight:700; color:${color};">${pct.toFixed(0)}%</span>`;
        }
    }
};


/* ============================================================
   ERPNext v15 - Client Script: PURCHASE RECEIPT FORM
   Settings → Client Script → New
   Script Name : PR Form Enhancements
   Document Type: Form
   Applies To  : Purchase Receipt
   Enabled     : Yes
   ============================================================ */

frappe.ui.form.on('Purchase Receipt', {

    onload: function (frm) {
        apply_pr_form_style(frm);
    },

    refresh: function (frm) {
        apply_pr_form_style(frm);
        apply_pr_status_banner(frm);
        add_pr_action_buttons(frm);
        check_intercompany_pr(frm);
    },

    supplier: function (frm) {
        if (frm.doc.supplier) highlight_field(frm, 'supplier');
    }
});

function apply_pr_form_style(frm) {
    $(frm.wrapper).addClass('trilence-form-enhanced');

    const section_icons = {
        'Supplier and Purchase Details': '🏭',
        'Currency and Price List': '💱',
        'Address': '📍',
        'Items': '📦',
        'Taxes and Charges': '🧾',
        'Additional Charges': '➕',
        'Accounting': '📊',
        'Quality Inspection': '✅',
        'Inspection': '✅',
    };

    frm.fields.forEach(function (field) {
        if (field.df.fieldtype === 'Section Break' && field.df.label) {
            const icon = section_icons[field.df.label] || '⚡';
            const heading = $(field.wrapper).find('.section-head');
            if (heading.length && !heading.data('icon-added')) {
                heading.prepend(`<span style="margin-right:6px">${icon}</span>`);
                heading.data('icon-added', true);
            }
        }
    });
}

function apply_pr_status_banner(frm) {
    $(frm.wrapper).find('.trilence-pr-banner').remove();

    if (!frm.doc.posting_date) return;

    const is_intercompany = frm.doc.supplier && (
        frm.doc.supplier.toLowerCase().includes('polyfilms') ||
        frm.doc.supplier.toLowerCase().includes('enterprise')
    );

    const status_config = {
        0: { label: 'DRAFT', bg: '#fef9c3', color: '#b45309', border: '#fde68a' },
        1: { label: 'SUBMITTED', bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe' },
        2: { label: 'CANCELLED', bg: '#fee2e2', color: '#dc2626', border: '#fecdd3' },
    };

    const config = status_config[frm.doc.docstatus] || status_config[0];
    const total_qty = (frm.doc.items || []).reduce((sum, r) => sum + (r.qty || 0), 0);

    const banner = $(`
        <div class="trilence-pr-banner" style="
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 20px; margin-bottom: 16px;
            background: ${config.bg}; border: 1px solid ${config.border};
            border-radius: 10px;
        ">
            <div style="display:flex; align-items:center; gap:12px;">
                <span style="
                    padding: 3px 12px; border-radius: 20px;
                    background: ${config.color}22; color: ${config.color};
                    font-size: 11px; font-weight: 800; letter-spacing: 1px;
                ">${config.label}</span>
                ${is_intercompany ? `<span style="
                    padding: 3px 12px; border-radius: 20px;
                    background: #dbeafe; color: #1d4ed8;
                    font-size: 11px; font-weight: 800;
                ">🔁 INTER COMPANY</span>` : ''}
                <span style="font-size:13px; color:#7b8db0;">
                    ${frm.doc.supplier || ''}
                    ${frm.doc.posting_date ? '· ' + frappe.datetime.str_to_user(frm.doc.posting_date) : ''}
                    · ${frm.doc.posting_time ? frm.doc.posting_time.substring(0, 8) : ''}
                </span>
            </div>
            <div style="display:flex; gap:20px; align-items:center;">
                <span style="font-size:13px; color:#7b8db0;">
                    Total Qty: <strong style="color:#1a2340;">${total_qty.toFixed(3)}</strong>
                </span>
                <span style="font-size:15px; font-weight:800; color:#1a2340;">
                    ₹${format_inr(frm.doc.grand_total || 0)}
                </span>
            </div>
        </div>
    `);

    $(frm.wrapper).find('.page-form').prepend(banner);
}

function check_intercompany_pr(frm) {
    // Show warning if this looks like inter company receipt and basic rate is zero
    if (frm.doc.docstatus === 0) {
        const items = frm.doc.items || [];
        const zero_rate_items = items.filter(r => !r.rate || r.rate === 0);
        if (zero_rate_items.length > 0) {
            const is_intercompany = frm.doc.supplier && (
                frm.doc.supplier.toLowerCase().includes('polyfilms') ||
                frm.doc.supplier.toLowerCase().includes('enterprise')
            );
            if (is_intercompany) {
                $(frm.wrapper).find('.trilence-rate-warning').remove();
                const warning = $(`
                    <div class="trilence-rate-warning" style="
                        padding: 12px 18px; margin-bottom: 14px;
                        background: #fffbeb; border: 1.5px solid #fcd34d;
                        border-radius: 10px; font-size: 13px;
                        display: flex; align-items: center; gap: 10px;
                    ">
                        <span style="font-size:18px;">⚠️</span>
                        <div>
                            <strong style="color:#92400e;">Inter Company Transfer — Basic Rate Missing</strong><br>
                            <span style="color:#78350f; font-size:12px;">
                                Please enter the Basic Rate manually in the Items table matching the valuation rate from Gajanand Polyfilms Stock Ledger before submitting.
                            </span>
                        </div>
                    </div>
                `);
                $(frm.wrapper).find('.page-form').prepend(warning);
            }
        }
    }
}

function add_pr_action_buttons(frm) {
    if (frm.doc.docstatus === 1) {
        frm.add_custom_button('📋 Copy PR No', function () {
            navigator.clipboard.writeText(frm.doc.name);
            frappe.show_alert({ message: 'PR number copied!', indicator: 'green' }, 2);
        }, 'Actions');

        // Show posting time info — useful after inter company transfer
        frm.add_custom_button('🕐 Show Posting Time', function () {
            frappe.msgprint({
                title: 'Posting Date & Time',
                indicator: 'blue',
                message: `<b>Date:</b> ${frappe.datetime.str_to_user(frm.doc.posting_date)}<br>
                          <b>Time:</b> ${frm.doc.posting_time}<br><br>
                          <i>Your Sales Invoice posting time must be <b>after</b> this time to avoid stock validation errors.</i>`
            });
        }, 'Actions');
    }
}


/* ============================================================
   ERPNext v15 - Client Script: PURCHASE RECEIPT LIST VIEW
   Settings → Client Script → New
   Script Name : PR List Enhancements
   Document Type: List
   Applies To  : Purchase Receipt
   Enabled     : Yes
   ============================================================ */

frappe.listview_settings['Purchase Receipt'] = {

    get_indicator: function (doc) {
        if (doc.docstatus === 2) return ['Cancelled', 'red', 'docstatus,=,2'];
        if (doc.docstatus === 0) return ['Draft', 'orange', 'docstatus,=,0'];
        if (doc.per_billed >= 100) return ['Billed', 'green', 'per_billed,=,100'];
        if (doc.per_billed > 0) return ['Partly Billed', 'orange', 'per_billed,>,0'];
        return ['To Bill', 'yellow', 'per_billed,=,0'];
    },

    formatters: {
        name: function (value) {
            const is_transfer = value && value.includes('PR-TR');
            return `<span style="
                color: ${is_transfer ? '#1d4ed8' : '#4e8cff'};
                font-weight: 700;
                ${is_transfer ? 'background:#dbeafe; padding:2px 6px; border-radius:4px;' : ''}
            ">${value}</span>`;
        },
        supplier: function (value) {
            return `<span style="font-weight:600; color:#1a2340;">${value}</span>`;
        },
        grand_total: function (value) {
            return `<span style="font-weight:700; color:#1a2340;">₹${format_inr(value)}</span>`;
        },
        per_billed: function (value) {
            const pct = parseFloat(value || 0);
            const color = pct === 100 ? '#16a34a' : pct > 0 ? '#b45309' : '#7c3aed';
            return `<span style="font-weight:700; color:${color};">${pct.toFixed(0)}%</span>`;
        }
    }
};


/* ============================================================
   ERPNext v15 - Client Script: PURCHASE INVOICE LIST VIEW
   Settings → Client Script → New
   Script Name : PI List Enhancements
   Document Type: List
   Applies To  : Purchase Invoice
   Enabled     : Yes
   ============================================================ */

frappe.listview_settings['Purchase Invoice'] = {

    get_indicator: function (doc) {
        if (doc.docstatus === 2) return ['Cancelled', 'red', 'docstatus,=,2'];
        if (doc.docstatus === 0) return ['Draft', 'orange', 'docstatus,=,0'];
        if (doc.outstanding_amount <= 0) return ['Paid', 'green', 'outstanding_amount,<=,0'];
        if (doc.due_date && frappe.datetime.get_diff(doc.due_date, frappe.datetime.nowdate()) < 0) {
            return ['Overdue', 'red', 'due_date,<,Today'];
        }
        return ['Unpaid', 'orange', 'outstanding_amount,>,0'];
    },

    formatters: {
        name: function (value) {
            return `<span style="color:#4e8cff; font-weight:700;">${value}</span>`;
        },
        supplier: function (value) {
            return `<span style="font-weight:600; color:#1a2340;">${value}</span>`;
        },
        grand_total: function (value) {
            return `<span style="font-weight:700; color:#1a2340;">₹${format_inr(value)}</span>`;
        },
        outstanding_amount: function (value, df, doc) {
            if (!value || value <= 0) {
                return `<span style="color:#16a34a; font-weight:700;">₹0.00</span>`;
            }
            const is_overdue = doc.due_date && frappe.datetime.get_diff(doc.due_date, frappe.datetime.nowdate()) < 0;
            return `<span style="color:${is_overdue ? '#dc2626' : '#b45309'}; font-weight:700;">₹${format_inr(value)}</span>`;
        }
    }
};


/* ============================================================
   SHARED UTILITY FUNCTION
   Add this once in any one of the scripts above
   or in a separate Global Client Script
   ============================================================ */

function format_inr(amount) {
    return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount || 0);
}


