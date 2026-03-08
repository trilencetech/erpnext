// File location: your_app/public/js/gj_dashboard.js
// This loads on every page via hooks.py — we check for
// workspace route before running dashboard logic

frappe.provide('gajanand.dashboard');

gajanand.dashboard = {

    LOW_STOCK_THRESHOLD: 50,

    init: function () {
        console.log('Gajanand Dashboard init called');

        // Wait for #gj-dash to exist in DOM
        var self = this;
        var tries = 0;
        var check = setInterval(function () {
            tries++;
            if ($('#gj-dash').length > 0) {
                clearInterval(check);
                console.log('gj-dash found after ' + tries + ' tries');
                self.load_all();
            }
            if (tries > 30) {
                clearInterval(check);
                console.warn('gj-dash not found after 30 tries — widget may not be on this workspace');
            }
        }, 200);
    },

    load_all: function () {
        this.set_header();
        this.load_today_sales();
        this.load_ar();
        this.load_po();
        this.load_stock();
        this.load_invoices();
    },

    // ── Helpers ─────────────────────────────────────────────────
    fmt_inr: function (val) {
        val = parseFloat(val) || 0;
        if (val >= 10000000) return '₹' + (val / 10000000).toFixed(2) + ' Cr';
        if (val >= 100000) return '₹' + (val / 100000).toFixed(2) + ' L';
        return '₹' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0 }).format(val);
    },

    fmt_full: function (val) {
        return '₹' + new Intl.NumberFormat('en-IN', {
            minimumFractionDigits: 2, maximumFractionDigits: 2
        }).format(parseFloat(val) || 0);
    },

    today: function () {
        return frappe.datetime.get_today();
    },

    set_el: function (id, html) {
        $('#' + id).html(html);
    },

    set_txt: function (id, txt) {
        $('#' + id).text(txt);
    },

    greeting: function () {
        var h = new Date().getHours();
        return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
    },

    date_str: function () {
        return new Date().toLocaleDateString('en-IN', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });
    },

    badge: function (status) {
        var map = {
            'Paid': 'badge-green', 'Unpaid': 'badge-orange', 'Overdue': 'badge-red',
            'Submitted': 'badge-blue', 'Draft': 'badge-gray', 'To Bill': 'badge-purple',
            'Billed': 'badge-green', 'To Receive': 'badge-orange', 'Received': 'badge-green',
            'To Pay': 'badge-purple', 'Cancelled': 'badge-red'
        };
        return '<span class="gj-badge ' + (map[status] || 'badge-gray') + '">' + status + '</span>';
    },

    inv_status: function (doc) {
        if (doc.docstatus === 2) return 'Cancelled';
        if (doc.docstatus === 0) return 'Draft';
        if ((doc.outstanding_amount || 0) <= 0) return 'Paid';
        if (doc.due_date && doc.due_date < this.today()) return 'Overdue';
        return 'Unpaid';
    },

    // ── Header ──────────────────────────────────────────────────
    set_header: function () {
        this.set_txt('gj-greeting', this.greeting() + ' 👋');
        this.set_txt('gj-date-str', this.date_str() + ' · Gajanand House');
    },

    // ── Today Sales ─────────────────────────────────────────────
    load_today_sales: function () {
        var self = this;
        frappe.db.get_list('Sales Invoice', {
            filters: [['posting_date', '=', self.today()], ['docstatus', '=', 1]],
            fields: ['name', 'grand_total'],
            limit: 500
        }).then(function (docs) {
            var total = docs.reduce(function (s, d) { return s + (d.grand_total || 0); }, 0);
            self.set_txt('kpi-today-sales', self.fmt_inr(total));
            self.set_el('kpi-today-count',
                '▲ ' + docs.length + ' invoice' + (docs.length !== 1 ? 's' : '') + ' today');
        }).catch(function (e) {
            console.error('today_sales error', e);
            self.set_txt('kpi-today-sales', '—');
        });
    },

    // ── Outstanding AR ───────────────────────────────────────────
    load_ar: function () {
        var self = this;
        frappe.db.get_list('Sales Invoice', {
            filters: [['docstatus', '=', 1], ['outstanding_amount', '>', 0]],
            fields: ['name', 'outstanding_amount', 'due_date'],
            limit: 500
        }).then(function (docs) {
            var total = docs.reduce(function (s, d) { return s + (d.outstanding_amount || 0); }, 0);
            var overdue = docs.filter(function (d) {
                return d.due_date && d.due_date < self.today();
            }).length;
            self.set_txt('kpi-ar', self.fmt_inr(total));
            self.set_el('kpi-ar-sub', overdue > 0 ? '⚠️ ' + overdue + ' overdue' : '✅ All on time');
            self.set_txt('stat-unpaid', docs.length + ' invoices');
            self.set_txt('stat-overdue', overdue + ' invoices');
        }).catch(function (e) {
            console.error('ar error', e);
            self.set_txt('kpi-ar', '—');
        });
    },

    // ── Purchase Orders ──────────────────────────────────────────
    load_po: function () {
        var self = this;
        frappe.db.get_list('Purchase Order', {
            filters: [['docstatus', '=', 1], ['per_received', '<', 100]],
            fields: ['name', 'grand_total'],
            limit: 200
        }).then(function (docs) {
            var total = docs.reduce(function (s, d) { return s + (d.grand_total || 0); }, 0);
            self.set_txt('kpi-po', docs.length + ' orders');
            self.set_el('kpi-po-sub', 'Value: ' + self.fmt_inr(total));
        }).catch(function (e) {
            console.error('po error', e);
            self.set_txt('kpi-po', '—');
        });
    },

    // ── Stock Alerts ─────────────────────────────────────────────
    load_stock: function () {
        var self = this;
        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Bin',
                filters: [['actual_qty', '<=', self.LOW_STOCK_THRESHOLD]],
                fields: ['item_code', 'warehouse', 'actual_qty', 'stock_uom'],
                limit: 50,
                order_by: 'actual_qty asc'
            },
            callback: function (r) {
                var docs = (r && r.message) || [];
                var out = docs.filter(function (d) { return (d.actual_qty || 0) <= 0; }).length;
                var low = docs.length - out;
                self.set_txt('kpi-stock', (out + low) + ' items');
                self.set_el('kpi-stock-sub',
                    out > 0 ? '🔴 ' + out + ' out of stock' : '🟡 ' + low + ' low stock');
                self.render_stock(docs.slice(0, 6));
            }
        });
    },

    // ── Recent Invoices ──────────────────────────────────────────
    load_invoices: function () {
        var self = this;
        frappe.db.get_list('Sales Invoice', {
            filters: [['docstatus', '=', 1]],
            fields: ['name', 'customer', 'posting_date', 'grand_total', 'outstanding_amount', 'due_date'],
            limit: 6,
            order_by: 'modified desc'
        }).then(function (docs) {
            if (!docs || !docs.length) {
                self.set_el('gj-sinv-list', '<div class="gj-empty">No invoices found</div>');
                return;
            }
            var html = docs.map(function (doc) {
                var st = self.inv_status(doc);
                return '<div class="gj-inv-row">'
                    + '<div class="gj-inv-icon">🧾</div>'
                    + '<div class="gj-inv-info">'
                    + '<span class="gj-inv-name" onclick="frappe.set_route(\'Form/Sales Invoice/'
                    + doc.name + '\')">' + doc.name + '</span>'
                    + '<div class="gj-inv-party">' + doc.customer
                    + ' · ' + frappe.datetime.str_to_user(doc.posting_date) + '</div>'
                    + '</div>'
                    + '<div class="gj-inv-right">'
                    + '<div class="gj-inv-amount">' + self.fmt_full(doc.grand_total) + '</div>'
                    + '<div style="margin-top:4px">' + self.badge(st) + '</div>'
                    + '</div></div>';
            }).join('');
            self.set_el('gj-sinv-list', html);
        }).catch(function (e) {
            console.error('invoices error', e);
            self.set_el('gj-sinv-list', '<div class="gj-empty">Could not load</div>');
        });
    },

    // ── Stock Render ─────────────────────────────────────────────
    render_stock: function (docs) {
        var self = this;
        frappe.db.get_list('Purchase Receipt', {
            filters: [['docstatus', '=', 1], ['per_billed', '<', 100]],
            fields: ['name'], limit: 100
        }).then(function (prs) {
            self.set_txt('stat-pr-unbilled', (prs.length || 0) + ' receipts');
        }).catch(function () { });

        if (!docs || !docs.length) {
            self.set_el('gj-stock-list', '<div class="gj-empty">✅ No stock alerts</div>');
            return;
        }
        var html = docs.map(function (doc) {
            var qty = parseFloat(doc.actual_qty) || 0;
            var isOut = qty <= 0;
            var pct = isOut ? 0 : Math.min(100, Math.round((qty / self.LOW_STOCK_THRESHOLD) * 100));
            var color = isOut ? '#ef4444' : '#f59e0b';
            return '<div class="gj-stock-row">'
                + '<div class="gj-stock-top">'
                + '<div class="gj-stock-item">' + doc.item_code + '</div>'
                + '<span class="gj-badge ' + (isOut ? 'badge-red' : 'badge-orange') + '">'
                + (isOut ? 'Out of Stock' : 'Low Stock') + '</span>'
                + '</div>'
                + '<div class="gj-stock-meta">' + qty.toFixed(3)
                + ' ' + (doc.stock_uom || 'KG') + ' · ' + doc.warehouse + '</div>'
                + '<div class="gj-prog-wrap">'
                + '<div class="gj-prog-bar" style="width:' + pct + '%;background:' + color + '"></div>'
                + '</div></div>';
        }).join('');
        self.set_el('gj-stock-list', html);
    }
};

// ── Route listener — run on workspace page load ──────────────
// 'Gajanand House' is the workspace name — adjust if different
frappe.router.on('change', function () {
    var route = frappe.get_route();
    // route[0] = 'Workspaces', route[1] = workspace slug
    if (route && route[0] === 'Workspaces') {
        // small delay to let Vue finish rendering widgets
        setTimeout(function () {
            gajanand.dashboard.init();
        }, 500);
    }
});

// Also expose global refresh for the ↻ button in HTML
window.gjDashInit = function () {
    gajanand.dashboard.load_all();
};