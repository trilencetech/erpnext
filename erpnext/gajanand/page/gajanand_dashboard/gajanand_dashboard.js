frappe.pages['gajanand-dashboard'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Gajanand House',
		single_column: true
	});

	// Inject Google Font
	if (!document.getElementById('gj-font-link')) {
		var link = document.createElement('link');
		link.id = 'gj-font-link';
		link.rel = 'stylesheet';
		link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap';
		document.head.appendChild(link);
	}

	// Render HTML into page body
	$(wrapper).find('.layout-main-section').html(gajanand_dashboard.get_html());

	// Run dashboard
	gajanand_dashboard.init(wrapper);
};

frappe.pages['gajanand-dashboard'].on_page_show = function (wrapper) {
	gajanand_dashboard.load_all(wrapper);
};

// ── Dashboard Namespace ───────────────────────────────────────
var gajanand_dashboard = {

	LOW: 50,
	wrapper: null,

	// ── Find element scoped to this page ─────────────────────
	el: function (id) {
		if (this.wrapper) {
			var found = $(this.wrapper).find('#' + id);
			if (found.length) return found;
		}
		return $('#' + id);
	},

	set_html: function (id, html) { this.el(id).html(html); },
	set_txt: function (id, txt) { this.el(id).text(txt); },

	// ── Init ─────────────────────────────────────────────────
	init: function (wrapper) {
		this.wrapper = wrapper;
		this.load_all(wrapper);
	},

	load_all: function (wrapper) {
		if (wrapper) this.wrapper = wrapper;
		this.set_header();
		this.load_today_sales();
		this.load_ar();
		this.load_po();
		this.load_stock();
		this.load_invoices();
	},

	// ── Helpers ──────────────────────────────────────────────
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

	today: function () { return frappe.datetime.get_today(); },

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

	skel: function () {
		return '<div class="gj-skel" style="width:80%;height:14px;margin-bottom:8px"></div>'
			+ '<div class="gj-skel" style="width:60%;height:14px;margin-bottom:8px"></div>'
			+ '<div class="gj-skel" style="width:90%;height:14px"></div>';
	},

	// ── Header ───────────────────────────────────────────────
	set_header: function () {
		this.set_txt('gj-greeting', this.greeting() + ' 👋');
		this.set_txt('gj-date-str', this.date_str() + ' · Gajanand House');
	},

	// ── Today Sales ──────────────────────────────────────────
	load_today_sales: function () {
		var self = this;
		frappe.db.get_list('Sales Invoice', {
			filters: [['posting_date', '=', self.today()], ['docstatus', '=', 1]],
			fields: ['name', 'grand_total'], limit: 500
		}).then(function (docs) {
			var total = docs.reduce(function (s, d) { return s + (d.grand_total || 0); }, 0);
			self.set_txt('kpi-today-sales', self.fmt_inr(total));
			self.set_html('kpi-today-count',
				'▲ ' + docs.length + ' invoice' + (docs.length !== 1 ? 's' : '') + ' today');
		}).catch(function (e) {
			console.error('today_sales', e);
			self.set_txt('kpi-today-sales', '—');
		});
	},

	// ── AR ────────────────────────────────────────────────────
	load_ar: function () {
		var self = this;
		frappe.db.get_list('Sales Invoice', {
			filters: [['docstatus', '=', 1], ['outstanding_amount', '>', 0]],
			fields: ['name', 'outstanding_amount', 'due_date'], limit: 500
		}).then(function (docs) {
			var total = docs.reduce(function (s, d) { return s + (d.outstanding_amount || 0); }, 0);
			var od = docs.filter(function (d) { return d.due_date && d.due_date < self.today(); }).length;
			self.set_txt('kpi-ar', self.fmt_inr(total));
			self.set_html('kpi-ar-sub', od > 0 ? '⚠️ ' + od + ' overdue' : '✅ All on time');
			self.set_txt('stat-unpaid', docs.length + ' invoices');
			self.set_txt('stat-overdue', od + ' invoices');
		}).catch(function (e) {
			console.error('ar', e); self.set_txt('kpi-ar', '—');
		});
	},

	// ── PO ────────────────────────────────────────────────────
	load_po: function () {
		var self = this;
		frappe.db.get_list('Purchase Order', {
			filters: [['docstatus', '=', 1], ['per_received', '<', 100]],
			fields: ['name', 'grand_total'], limit: 200
		}).then(function (docs) {
			var total = docs.reduce(function (s, d) { return s + (d.grand_total || 0); }, 0);
			self.set_txt('kpi-po', docs.length + ' orders');
			self.set_html('kpi-po-sub', 'Value: ' + self.fmt_inr(total));
		}).catch(function (e) {
			console.error('po', e); self.set_txt('kpi-po', '—');
		});
	},

	// ── Stock ─────────────────────────────────────────────────
	load_stock: function () {
		var self = this;
		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Bin',
				filters: [['actual_qty', '<=', self.LOW]],
				fields: ['item_code', 'warehouse', 'actual_qty', 'stock_uom'],
				limit: 50, order_by: 'actual_qty asc'
			},
			callback: function (r) {
				var docs = (r && r.message) || [];
				var out = docs.filter(function (d) { return (d.actual_qty || 0) <= 0; }).length;
				var low = docs.length - out;
				self.set_txt('kpi-stock', (out + low) + ' items');
				self.set_html('kpi-stock-sub',
					out > 0 ? '🔴 ' + out + ' out of stock' : '🟡 ' + low + ' low stock');
				self.render_stock(docs.slice(0, 6));
			}
		});
	},

	// ── Recent Invoices ───────────────────────────────────────
	load_invoices: function () {
		var self = this;
		frappe.db.get_list('Sales Invoice', {
			filters: [['docstatus', '=', 1]],
			fields: ['name', 'customer', 'posting_date', 'grand_total', 'outstanding_amount', 'due_date'],
			limit: 6, order_by: 'modified desc'
		}).then(function (docs) {
			if (!docs || !docs.length) {
				self.set_html('gj-sinv-list', '<div class="gj-empty">No invoices found</div>');
				return;
			}
			var html = docs.map(function (doc) {
				var st = self.inv_status(doc);
				return '<div class="gj-inv-row">'
					+ '<div class="gj-inv-icon">🧾</div>'
					+ '<div class="gj-inv-info">'
					+ '<span class="gj-inv-name" onclick="frappe.set_route(\'Form/Sales Invoice/'
					+ doc.name + '\')">' + doc.name + '</span>'
					+ '<div class="gj-inv-party">' + doc.customer + ' · '
					+ frappe.datetime.str_to_user(doc.posting_date) + '</div>'
					+ '</div>'
					+ '<div class="gj-inv-right">'
					+ '<div class="gj-inv-amount">' + self.fmt_full(doc.grand_total) + '</div>'
					+ '<div style="margin-top:4px">' + self.badge(st) + '</div>'
					+ '</div></div>';
			}).join('');
			self.set_html('gj-sinv-list', html);
		}).catch(function (e) {
			console.error('invoices', e);
			self.set_html('gj-sinv-list', '<div class="gj-empty">Could not load</div>');
		});
	},

	// ── Stock Render ──────────────────────────────────────────
	render_stock: function (docs) {
		var self = this;
		frappe.db.get_list('Purchase Receipt', {
			filters: [['docstatus', '=', 1], ['per_billed', '<', 100]],
			fields: ['name'], limit: 100
		}).then(function (prs) {
			self.set_txt('stat-pr-unbilled', (prs.length || 0) + ' receipts');
		}).catch(function () { });

		if (!docs || !docs.length) {
			self.set_html('gj-stock-list', '<div class="gj-empty">✅ No stock alerts</div>');
			return;
		}
		var html = docs.map(function (doc) {
			var qty = parseFloat(doc.actual_qty) || 0, isOut = qty <= 0;
			var pct = isOut ? 0 : Math.min(100, Math.round((qty / self.LOW) * 100));
			var color = isOut ? '#ef4444' : '#f59e0b';
			return '<div class="gj-stock-row">'
				+ '<div class="gj-stock-top">'
				+ '<div class="gj-stock-item">' + doc.item_code + '</div>'
				+ '<span class="gj-badge ' + (isOut ? 'badge-red' : 'badge-orange') + '">'
				+ (isOut ? 'Out of Stock' : 'Low Stock') + '</span>'
				+ '</div>'
				+ '<div class="gj-stock-meta">' + qty.toFixed(3) + ' ' + (doc.stock_uom || 'KG')
				+ ' · ' + doc.warehouse + '</div>'
				+ '<div class="gj-prog-wrap"><div class="gj-prog-bar" style="width:'
				+ pct + '%;background:' + color + '"></div></div></div>';
		}).join('');
		self.set_html('gj-stock-list', html);
	},

	// ── Full Page HTML ────────────────────────────────────────
	get_html: function () {
		return `
		<div id="gj-dash">

		  <div id="gj-hero">
		    <div id="gj-hero-left">
		      <h1 id="gj-greeting">Good Morning 👋</h1>
		      <p id="gj-date-str">Loading...</p>
		    </div>
		    <div id="gj-hero-right">
		      <div class="gj-co-badge">
		        <div class="gj-co-name">Gajanand Enterprise</div>
		        <div class="gj-co-label">Active Company</div>
		      </div>
		      <div class="gj-co-badge">
		        <div class="gj-co-name">Gajanand Polyfilms</div>
		        <div class="gj-co-label">Group Company</div>
		      </div>
		      <button id="gj-refresh" onclick="gajanand_dashboard.load_all()" title="Refresh">↻</button>
		    </div>
		  </div>

		  <div id="gj-kpis">
		    <div class="gj-kpi" style="border-top-color:#4e8cff" onclick="frappe.set_route('List/Sales Invoice')">
		      <div class="gj-kpi-icon">📈</div>
		      <div class="gj-kpi-label">Today's Sales</div>
		      <div class="gj-kpi-value" id="kpi-today-sales"><div class="gj-skel" style="width:70%"></div></div>
		      <div class="gj-kpi-sub" id="kpi-today-count" style="color:#4e8cff"></div>
		    </div>
		    <div class="gj-kpi" style="border-top-color:#f0a500" onclick="frappe.set_route('query-report/Accounts Receivable')">
		      <div class="gj-kpi-icon">💰</div>
		      <div class="gj-kpi-label">Outstanding AR</div>
		      <div class="gj-kpi-value" id="kpi-ar"><div class="gj-skel" style="width:80%"></div></div>
		      <div class="gj-kpi-sub" id="kpi-ar-sub" style="color:#f0a500"></div>
		    </div>
		    <div class="gj-kpi" style="border-top-color:#8b5cf6" onclick="frappe.set_route('List/Purchase Order')">
		      <div class="gj-kpi-icon">🛒</div>
		      <div class="gj-kpi-label">Pending Purchase Orders</div>
		      <div class="gj-kpi-value" id="kpi-po"><div class="gj-skel" style="width:50%"></div></div>
		      <div class="gj-kpi-sub" id="kpi-po-sub" style="color:#8b5cf6"></div>
		    </div>
		    <div class="gj-kpi" style="border-top-color:#ef4444" onclick="frappe.set_route('query-report/Stock Balance')">
		      <div class="gj-kpi-icon">📦</div>
		      <div class="gj-kpi-label">Low / Out of Stock</div>
		      <div class="gj-kpi-value" id="kpi-stock"><div class="gj-skel" style="width:40%"></div></div>
		      <div class="gj-kpi-sub" id="kpi-stock-sub" style="color:#ef4444"></div>
		    </div>
		  </div>

		  <div id="gj-stats">
		    <div class="gj-stat">
		      <div class="gj-stat-dot" style="background:#eff6ff">🧾</div>
		      <div><div class="gj-stat-label">Unpaid Invoices</div><div class="gj-stat-val" id="stat-unpaid">—</div></div>
		    </div>
		    <div class="gj-stat">
		      <div class="gj-stat-dot" style="background:#fef9c3">⏳</div>
		      <div><div class="gj-stat-label">Overdue Invoices</div><div class="gj-stat-val" id="stat-overdue">—</div></div>
		    </div>
		    <div class="gj-stat">
		      <div class="gj-stat-dot" style="background:#f0fdf4">📥</div>
		      <div><div class="gj-stat-label">PR Pending Billing</div><div class="gj-stat-val" id="stat-pr-unbilled">—</div></div>
		    </div>
		  </div>

		  <div class="gj-section-title">Quick Actions</div>
		  <div id="gj-actions">
		    <div class="gj-action" onclick="frappe.new_doc('Sales Invoice')"><div class="gj-action-icon" style="background:#eff6ff">🧾</div><div class="gj-action-label">New Sales Invoice</div></div>
		    <div class="gj-action" onclick="frappe.new_doc('Delivery Note')"><div class="gj-action-icon" style="background:#f0fdf4">🚚</div><div class="gj-action-label">New Delivery Note</div></div>
		    <div class="gj-action" onclick="frappe.new_doc('Purchase Order')"><div class="gj-action-icon" style="background:#fefce8">🛒</div><div class="gj-action-label">New Purchase Order</div></div>
		    <div class="gj-action" onclick="frappe.new_doc('Purchase Receipt')"><div class="gj-action-icon" style="background:#ede9fe">📥</div><div class="gj-action-label">Purchase Receipt</div></div>
		    <div class="gj-action" onclick="frappe.new_doc('Purchase Invoice')"><div class="gj-action-icon" style="background:#fff1f2">📋</div><div class="gj-action-label">Purchase Invoice</div></div>
		    <div class="gj-action" onclick="frappe.new_doc('Payment Entry')"><div class="gj-action-icon" style="background:#f0fdfa">💳</div><div class="gj-action-label">Payment Entry</div></div>
		    <div class="gj-action" onclick="frappe.set_route('query-report/Stock Balance')"><div class="gj-action-icon" style="background:#eff6ff">📊</div><div class="gj-action-label">Stock Balance</div></div>
		    <div class="gj-action" onclick="frappe.set_route('query-report/Accounts Receivable')"><div class="gj-action-icon" style="background:#fefce8">👥</div><div class="gj-action-label">Customer Ledger</div></div>
		    <div class="gj-action" onclick="frappe.set_route('query-report/GSTR-1')"><div class="gj-action-icon" style="background:#f0fdf4">📑</div><div class="gj-action-label">GSTR-1 Report</div></div>
		    <div class="gj-action" onclick="frappe.set_route('query-report/Trial Balance')"><div class="gj-action-icon" style="background:#fdf4ff">⚖️</div><div class="gj-action-label">Trial Balance</div></div>
		    <div class="gj-action" onclick="frappe.set_route('List/Journal Entry')"><div class="gj-action-icon" style="background:#eff6ff">📒</div><div class="gj-action-label">Journal Entry</div></div>
		    <div class="gj-action" onclick="frappe.set_route('query-report/Stock Ledger')"><div class="gj-action-icon" style="background:#fff7ed">🏭</div><div class="gj-action-label">Stock Ledger</div></div>
		  </div>

		  <div class="gj-section-title">Live Data</div>
		  <div id="gj-bottom">
		    <div class="gj-card">
		      <div class="gj-card-header">
		        <div class="gj-card-title">Recent Sales Invoices</div>
		        <span class="gj-card-link" onclick="frappe.set_route('List/Sales Invoice')">View All →</span>
		      </div>
		      <div id="gj-sinv-list">
		        <div class="gj-skel" style="width:100%;height:14px;margin-bottom:10px"></div>
		        <div class="gj-skel" style="width:80%;height:14px;margin-bottom:10px"></div>
		        <div class="gj-skel" style="width:100%;height:14px;margin-bottom:10px"></div>
		        <div class="gj-skel" style="width:60%;height:14px"></div>
		      </div>
		    </div>
		    <div class="gj-card">
		      <div class="gj-card-header">
		        <div class="gj-card-title">Stock Alerts</div>
		        <span class="gj-card-link" onclick="frappe.set_route('query-report/Stock Balance')">View All →</span>
		      </div>
		      <div id="gj-stock-list">
		        <div class="gj-skel" style="width:100%;height:14px;margin-bottom:10px"></div>
		        <div class="gj-skel" style="width:70%;height:14px;margin-bottom:10px"></div>
		        <div class="gj-skel" style="width:90%;height:14px"></div>
		      </div>
		    </div>
		  </div>

		</div>`;
	}
};