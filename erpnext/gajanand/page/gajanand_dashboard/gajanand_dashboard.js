/* ── Page hooks ───────────────────────────────────────────────── */
frappe.pages['gajanand-dashboard'].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Gajanand House',
		single_column: true
	});

	/* Inject Google Font once */
	if (!document.getElementById('gj-font-link')) {
		var lnk = document.createElement('link');
		lnk.id   = 'gj-font-link';
		lnk.rel  = 'stylesheet';
		lnk.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap';
		document.head.appendChild(lnk);
	}

	/* Render HTML then load data */
	$(wrapper).find('.layout-main-section').html(gajanand_dashboard.get_html());
	gajanand_dashboard.init(wrapper);
};

frappe.pages['gajanand-dashboard'].on_page_show = function (wrapper) {
	gajanand_dashboard.load_all(wrapper);
};

/* ── Dashboard namespace ──────────────────────────────────────── */
var gajanand_dashboard = {

	LOW: 50,
	wrapper: null,

	/* Scoped element finder — avoids ID collisions with other pages */
	el: function (id) {
		var found = this.wrapper ? $(this.wrapper).find('#' + id) : $();
		return found.length ? found : $('#' + id);
	},

	set_html: function (id, html) { this.el(id).html(html); },
	set_txt:  function (id, txt)  { this.el(id).text(txt);  },

	/* ── Boot ─────────────────────────────────────────────────── */
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

	/* ── Helpers ──────────────────────────────────────────────── */
	fmt_inr: function (val) {
		val = parseFloat(val) || 0;
		if (val >= 10000000) return '₹' + (val / 10000000).toFixed(2) + ' Cr';
		if (val >= 100000)   return '₹' + (val / 100000).toFixed(2)   + ' L';
		return '₹' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0 }).format(val);
	},

	fmt_full: function (val) {
		return '₹' + new Intl.NumberFormat('en-IN', {
			minimumFractionDigits: 2, maximumFractionDigits: 2
		}).format(parseFloat(val) || 0);
	},

	today:    function () { return frappe.datetime.get_today(); },
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
		if (doc.docstatus === 2)                         return 'Cancelled';
		if (doc.docstatus === 0)                         return 'Draft';
		if ((doc.outstanding_amount || 0) <= 0)          return 'Paid';
		if (doc.due_date && doc.due_date < this.today()) return 'Overdue';
		return 'Unpaid';
	},

	/* ── Header + active-company badge ───────────────────────── */
	set_header: function () {
		var company = frappe.defaults.get_default('company') || '';
		this.set_txt('gj-greeting', this.greeting() + ' 👋');
		this.set_txt('gj-date-str', this.date_str() + (company ? ' · ' + company : ' · Gajanand House'));
		if (company) this.highlight_active_badge(company);
	},

	highlight_active_badge: function (activeCompany) {
		var self = this;
		/* Use wrapper scope so we target only this page's DOM */
		var $wrapper = self.wrapper ? $(self.wrapper) : $(document);
		$wrapper.find('.gj-co-badge[data-company]').each(function () {
			var $badge   = $(this);
			var $dot     = $badge.find('.gj-co-badge-dot');
			var $label   = $badge.find('.gj-co-label');
			var isActive = ($badge.data('company') || '').trim() === activeCompany.trim();

			if (isActive) {
				$badge.css({ background: 'rgba(16,185,129,0.18)', borderColor: 'rgba(16,185,129,0.45)' });
				$dot.css({ background: '#10b981', boxShadow: '0 0 10px #10b981' });
				$label.text('✓ Active');
			} else {
				$badge.css({ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)' });
				$dot.css({ background: '#6b7280', boxShadow: 'none' });
				$label.text('Click to switch');
			}
		});
	},

	/* ── KPI: Today Sales ─────────────────────────────────────── */
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
		}).catch(function () { self.set_txt('kpi-today-sales', '—'); });
	},

	/* ── KPI: AR ──────────────────────────────────────────────── */
	load_ar: function () {
		var self = this;
		frappe.db.get_list('Sales Invoice', {
			filters: [['docstatus', '=', 1], ['outstanding_amount', '>', 0]],
			fields: ['name', 'outstanding_amount', 'due_date'], limit: 500
		}).then(function (docs) {
			var total = docs.reduce(function (s, d) { return s + (d.outstanding_amount || 0); }, 0);
			var od    = docs.filter(function (d) { return d.due_date && d.due_date < self.today(); }).length;
			self.set_txt('kpi-ar', self.fmt_inr(total));
			self.set_html('kpi-ar-sub', od > 0 ? '⚠️ ' + od + ' overdue' : '✅ All on time');
			self.set_txt('stat-unpaid',  docs.length + ' invoices');
			self.set_txt('stat-overdue', od          + ' invoices');
		}).catch(function () { self.set_txt('kpi-ar', '—'); });
	},

	/* ── KPI: Purchase Orders ─────────────────────────────────── */
	load_po: function () {
		var self = this;
		frappe.db.get_list('Purchase Order', {
			filters: [['docstatus', '=', 1], ['per_received', '<', 100]],
			fields: ['name', 'grand_total'], limit: 200
		}).then(function (docs) {
			var total = docs.reduce(function (s, d) { return s + (d.grand_total || 0); }, 0);
			self.set_txt('kpi-po', docs.length + ' orders');
			self.set_html('kpi-po-sub', 'Value: ' + self.fmt_inr(total));
		}).catch(function () { self.set_txt('kpi-po', '—'); });
	},

	/* ── KPI: Stock ───────────────────────────────────────────── */
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
				var out  = docs.filter(function (d) { return (d.actual_qty || 0) <= 0; }).length;
				var low  = docs.length - out;
				self.set_txt('kpi-stock', (out + low) + ' items');
				self.set_html('kpi-stock-sub',
					out > 0 ? '🔴 ' + out + ' out of stock' : '🟡 ' + low + ' low stock');
				self.render_stock(docs.slice(0, 6));
			}
		});
	},

	/* ── Recent Invoices ──────────────────────────────────────── */
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
					+   '<span class="gj-inv-name" onclick="frappe.set_route(\'Form/Sales Invoice/'
					+   doc.name + '\')">' + doc.name + '</span>'
					+   '<div class="gj-inv-party">' + doc.customer + ' · '
					+   frappe.datetime.str_to_user(doc.posting_date) + '</div>'
					+ '</div>'
					+ '<div class="gj-inv-right">'
					+   '<div class="gj-inv-amount">' + self.fmt_full(doc.grand_total) + '</div>'
					+   '<div style="margin-top:4px">' + self.badge(st) + '</div>'
					+ '</div></div>';
			}).join('');
			self.set_html('gj-sinv-list', html);
		}).catch(function () {
			self.set_html('gj-sinv-list', '<div class="gj-empty">Could not load</div>');
		});
	},

	/* ── Stock card renderer ──────────────────────────────────── */
	render_stock: function (docs) {
		var self = this;
		frappe.db.get_list('Purchase Receipt', {
			filters: [['docstatus', '=', 1], ['per_billed', '<', 100]],
			fields: ['name'], limit: 100
		}).then(function (prs) {
			self.set_txt('stat-pr-unbilled', (prs.length || 0) + ' receipts');
		}).catch(function () {});

		if (!docs || !docs.length) {
			self.set_html('gj-stock-list', '<div class="gj-empty">✅ No stock alerts</div>');
			return;
		}
		var html = docs.map(function (doc) {
			var qty   = parseFloat(doc.actual_qty) || 0;
			var isOut = qty <= 0;
			var pct   = isOut ? 0 : Math.min(100, Math.round((qty / self.LOW) * 100));
			var color = isOut ? '#ef4444' : '#f59e0b';
			return '<div class="gj-stock-row">'
				+ '<div class="gj-stock-top">'
				+   '<div class="gj-stock-item">' + doc.item_code + '</div>'
				+   '<span class="gj-badge ' + (isOut ? 'badge-red' : 'badge-orange') + '">'
				+   (isOut ? 'Out of Stock' : 'Low Stock') + '</span>'
				+ '</div>'
				+ '<div class="gj-stock-meta">'
				+   qty.toFixed(3) + ' ' + (doc.stock_uom || 'KG') + ' · ' + doc.warehouse
				+ '</div>'
				+ '<div class="gj-prog-wrap">'
				+   '<div class="gj-prog-bar" style="width:' + pct + '%;background:' + color + '"></div>'
				+ '</div></div>';
		}).join('');
		self.set_html('gj-stock-list', html);
	},

	/* ── Full page HTML ───────────────────────────────────────── */
	get_html: function () {
		return `
<div id="gj-dash">

  <!-- Hero -->
  <div id="gj-hero">
    <!-- Decorative background film reel -->
    <svg id="gj-hero-deco" viewBox='0 0 220 220' fill='none' xmlns='http://www.w3.org/2000/svg'>
      <circle cx='110' cy='110' r='104' stroke='rgba(255,255,255,0.06)' stroke-width='4'/>
      <circle cx='110' cy='110' r='72'  stroke='rgba(255,255,255,0.06)' stroke-width='3'/>
      <circle cx='110' cy='110' r='38'  stroke='rgba(255,255,255,0.07)' stroke-width='3'/>
      <circle cx='110' cy='110' r='14'  fill='rgba(255,255,255,0.06)'/>
      <line x1='110' y1='6'   x2='110' y2='38'  stroke='rgba(255,255,255,0.1)' stroke-width='5' stroke-linecap='round'/>
      <line x1='110' y1='182' x2='110' y2='214' stroke='rgba(255,255,255,0.1)' stroke-width='5' stroke-linecap='round'/>
      <line x1='6'   y1='110' x2='38'  y2='110' stroke='rgba(255,255,255,0.1)' stroke-width='5' stroke-linecap='round'/>
      <line x1='182' y1='110' x2='214' y2='110' stroke='rgba(255,255,255,0.1)' stroke-width='5' stroke-linecap='round'/>
      <line x1='27'  y1='27'  x2='54'  y2='54'  stroke='rgba(255,255,255,0.07)' stroke-width='5' stroke-linecap='round'/>
      <line x1='166' y1='166' x2='193' y2='193' stroke='rgba(255,255,255,0.07)' stroke-width='5' stroke-linecap='round'/>
      <line x1='193' y1='27'  x2='166' y2='54'  stroke='rgba(255,255,255,0.07)' stroke-width='5' stroke-linecap='round'/>
      <line x1='27'  y1='193' x2='54'  y2='166' stroke='rgba(255,255,255,0.07)' stroke-width='5' stroke-linecap='round'/>
    </svg>

    <div id="gj-hero-left">
      <div id="gj-brand">
        <div id="gj-brand-icon">
          <svg viewBox='0 0 48 48' fill='none' width='32' height='32'>
            <circle cx='24' cy='24' r='22' stroke='rgba(255,255,255,0.5)' stroke-width='2'/>
            <circle cx='24' cy='24' r='14' stroke='rgba(255,255,255,0.35)' stroke-width='2'/>
            <circle cx='24' cy='24' r='5'  fill='rgba(255,255,255,0.3)' stroke='rgba(255,255,255,0.5)' stroke-width='1.5'/>
            <line x1='24' y1='2'  x2='24' y2='10' stroke='rgba(255,255,255,0.6)' stroke-width='2.5' stroke-linecap='round'/>
            <line x1='24' y1='38' x2='24' y2='46' stroke='rgba(255,255,255,0.6)' stroke-width='2.5' stroke-linecap='round'/>
            <line x1='2'  y1='24' x2='10' y2='24' stroke='rgba(255,255,255,0.6)' stroke-width='2.5' stroke-linecap='round'/>
            <line x1='38' y1='24' x2='46' y2='24' stroke='rgba(255,255,255,0.6)' stroke-width='2.5' stroke-linecap='round'/>
            <line x1='7'  y1='7'  x2='13' y2='13' stroke='rgba(255,255,255,0.4)' stroke-width='2.5' stroke-linecap='round'/>
            <line x1='35' y1='35' x2='41' y2='41' stroke='rgba(255,255,255,0.4)' stroke-width='2.5' stroke-linecap='round'/>
            <line x1='41' y1='7'  x2='35' y2='13' stroke='rgba(255,255,255,0.4)' stroke-width='2.5' stroke-linecap='round'/>
            <line x1='7'  y1='41' x2='13' y2='35' stroke='rgba(255,255,255,0.4)' stroke-width='2.5' stroke-linecap='round'/>
          </svg>
        </div>
        <div>
          <div id="gj-co-title">Gajanand Group</div>
          <div id="gj-co-sub">Packaging Films &amp; Solutions</div>
        </div>
      </div>
      <h1 id="gj-greeting">Good Morning 👋</h1>
      <p id="gj-date-str">Loading...</p>
    </div>

    <div id="gj-hero-right">
      <div class="gj-co-badge" data-company="Gajanand Enterprise"
           onclick="frappe.set_route('page/company-selector')" title="Switch company">
        <div class="gj-co-badge-dot"></div>
        <div>
          <div class="gj-co-name">Gajanand Enterprise</div>
          <div class="gj-co-label">Active Company</div>
        </div>
      </div>
      <div class="gj-co-badge" data-company="Gajanand Polyfilms"
           onclick="frappe.set_route('page/company-selector')" title="Switch company">
        <div class="gj-co-badge-dot"></div>
        <div>
          <div class="gj-co-name">Gajanand Polyfilms</div>
          <div class="gj-co-label">Group Company</div>
        </div>
      </div>
      <button id="gj-refresh" onclick="gajanand_dashboard.load_all()" title="Refresh">
        <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5'
             stroke-linecap='round' stroke-linejoin='round' width='16' height='16'>
          <polyline points='23 4 23 10 17 10'/>
          <path d='M20.49 15a9 9 0 11-2.12-9.36L23 10'/>
        </svg>
      </button>
    </div>
  </div>

  <!-- KPI Cards -->
  <div id="gj-kpis">
    <div class="gj-kpi" style="--kc:#4e8cff" onclick="frappe.set_route('List/Sales Invoice')">
      <div class="gj-kpi-icon-wrap" style="background:#eff6ff">
        <svg viewBox='0 0 24 24' fill='none' stroke='#4e8cff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' width='22' height='22'>
          <polyline points='22 7 13.5 15.5 8.5 10.5 2 17'/><polyline points='16 7 22 7 22 13'/>
        </svg>
      </div>
      <div class="gj-kpi-label">Today's Sales</div>
      <div class="gj-kpi-value" id="kpi-today-sales"><div class="gj-skel" style="width:80%"></div></div>
      <div class="gj-kpi-sub" id="kpi-today-count" style="color:#4e8cff"></div>
    </div>
    <div class="gj-kpi" style="--kc:#f59e0b" onclick="frappe.set_route('query-report/Accounts Receivable')">
      <div class="gj-kpi-icon-wrap" style="background:#fffbeb">
        <svg viewBox='0 0 24 24' fill='none' stroke='#f59e0b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' width='22' height='22'>
          <circle cx='12' cy='12' r='10'/><path d='M9 8h4.5a2.5 2.5 0 010 5H9m0 0h5.5M9 13v3'/>
        </svg>
      </div>
      <div class="gj-kpi-label">Outstanding AR</div>
      <div class="gj-kpi-value" id="kpi-ar"><div class="gj-skel" style="width:90%"></div></div>
      <div class="gj-kpi-sub" id="kpi-ar-sub" style="color:#f59e0b"></div>
    </div>
    <div class="gj-kpi" style="--kc:#8b5cf6" onclick="frappe.set_route('List/Purchase Order')">
      <div class="gj-kpi-icon-wrap" style="background:#f5f3ff">
        <svg viewBox='0 0 24 24' fill='none' stroke='#8b5cf6' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' width='22' height='22'>
          <path d='M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z'/>
          <line x1='3' y1='6' x2='21' y2='6'/><path d='M16 10a4 4 0 01-8 0'/>
        </svg>
      </div>
      <div class="gj-kpi-label">Pending Purchase Orders</div>
      <div class="gj-kpi-value" id="kpi-po"><div class="gj-skel" style="width:50%"></div></div>
      <div class="gj-kpi-sub" id="kpi-po-sub" style="color:#8b5cf6"></div>
    </div>
    <div class="gj-kpi" style="--kc:#ef4444" onclick="frappe.set_route('query-report/Stock Balance')">
      <div class="gj-kpi-icon-wrap" style="background:#fef2f2">
        <svg viewBox='0 0 24 24' fill='none' stroke='#ef4444' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' width='22' height='22'>
          <path d='M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z'/>
          <polyline points='3.27 6.96 12 12.01 20.73 6.96'/><line x1='12' y1='22.08' x2='12' y2='12'/>
        </svg>
      </div>
      <div class="gj-kpi-label">Low / Out of Stock</div>
      <div class="gj-kpi-value" id="kpi-stock"><div class="gj-skel" style="width:40%"></div></div>
      <div class="gj-kpi-sub" id="kpi-stock-sub" style="color:#ef4444"></div>
    </div>
  </div>

  <!-- Stat Row -->
  <div id="gj-stats">
    <div class="gj-stat">
      <div class="gj-stat-dot" style="background:#eff6ff">
        <svg viewBox='0 0 24 24' fill='none' stroke='#4e8cff' stroke-width='2' stroke-linecap='round' width='20' height='20'>
          <path d='M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z'/>
          <polyline points='14 2 14 8 20 8'/><line x1='16' y1='13' x2='8' y2='13'/><line x1='16' y1='17' x2='8' y2='17'/>
        </svg>
      </div>
      <div><div class="gj-stat-label">Unpaid Invoices</div><div class="gj-stat-val" id="stat-unpaid">—</div></div>
    </div>
    <div class="gj-stat">
      <div class="gj-stat-dot" style="background:#fffbeb">
        <svg viewBox='0 0 24 24' fill='none' stroke='#f59e0b' stroke-width='2' stroke-linecap='round' width='20' height='20'>
          <circle cx='12' cy='12' r='10'/><line x1='12' y1='8' x2='12' y2='12'/><line x1='12' y1='16' x2='12.01' y2='16'/>
        </svg>
      </div>
      <div><div class="gj-stat-label">Overdue Invoices</div><div class="gj-stat-val" id="stat-overdue">—</div></div>
    </div>
    <div class="gj-stat">
      <div class="gj-stat-dot" style="background:#f0fdf4">
        <svg viewBox='0 0 24 24' fill='none' stroke='#10b981' stroke-width='2' stroke-linecap='round' width='20' height='20'>
          <path d='M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4'/><polyline points='7 10 12 15 17 10'/><line x1='12' y1='15' x2='12' y2='3'/>
        </svg>
      </div>
      <div><div class="gj-stat-label">PR Pending Billing</div><div class="gj-stat-val" id="stat-pr-unbilled">—</div></div>
    </div>
  </div>

  <!-- Quick Actions -->
  <div class="gj-section-title">Quick Actions</div>
  <div id="gj-actions">
    <div class="gj-action" onclick="frappe.new_doc('Sales Invoice')">
      <div class="gj-action-icon" style="background:#eff6ff">
        <svg viewBox='0 0 24 24' fill='none' stroke='#4e8cff' stroke-width='2' stroke-linecap='round' width='22' height='22'>
          <path d='M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z'/><polyline points='14 2 14 8 20 8'/><line x1='16' y1='13' x2='8' y2='13'/>
        </svg>
      </div>
      <div class="gj-action-label">New Sales Invoice</div>
    </div>
    <div class="gj-action" onclick="frappe.new_doc('Delivery Note')">
      <div class="gj-action-icon" style="background:#f0fdf4">
        <svg viewBox='0 0 24 24' fill='none' stroke='#10b981' stroke-width='2' stroke-linecap='round' width='22' height='22'>
          <rect x='1' y='3' width='15' height='13'/><polygon points='16 8 20 8 23 11 23 16 16 16 16 8'/>
          <circle cx='5.5' cy='18.5' r='2.5'/><circle cx='18.5' cy='18.5' r='2.5'/>
        </svg>
      </div>
      <div class="gj-action-label">New Delivery Note</div>
    </div>
    <div class="gj-action" onclick="frappe.new_doc('Purchase Order')">
      <div class="gj-action-icon" style="background:#fefce8">
        <svg viewBox='0 0 24 24' fill='none' stroke='#ca8a04' stroke-width='2' stroke-linecap='round' width='22' height='22'>
          <path d='M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z'/><line x1='3' y1='6' x2='21' y2='6'/><path d='M16 10a4 4 0 01-8 0'/>
        </svg>
      </div>
      <div class="gj-action-label">New Purchase Order</div>
    </div>
    <div class="gj-action" onclick="frappe.new_doc('Purchase Receipt')">
      <div class="gj-action-icon" style="background:#ede9fe">
        <svg viewBox='0 0 24 24' fill='none' stroke='#7c3aed' stroke-width='2' stroke-linecap='round' width='22' height='22'>
          <path d='M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4'/><polyline points='7 10 12 15 17 10'/><line x1='12' y1='15' x2='12' y2='3'/>
        </svg>
      </div>
      <div class="gj-action-label">Purchase Receipt</div>
    </div>
    <div class="gj-action" onclick="frappe.new_doc('Purchase Invoice')">
      <div class="gj-action-icon" style="background:#fff1f2">
        <svg viewBox='0 0 24 24' fill='none' stroke='#e11d48' stroke-width='2' stroke-linecap='round' width='22' height='22'>
          <rect x='2' y='5' width='20' height='14' rx='2'/><line x1='2' y1='10' x2='22' y2='10'/>
        </svg>
      </div>
      <div class="gj-action-label">Purchase Invoice</div>
    </div>
    <div class="gj-action" onclick="frappe.new_doc('Payment Entry')">
      <div class="gj-action-icon" style="background:#f0fdfa">
        <svg viewBox='0 0 24 24' fill='none' stroke='#0d9488' stroke-width='2' stroke-linecap='round' width='22' height='22'>
          <rect x='1' y='4' width='22' height='16' rx='2'/><line x1='1' y1='10' x2='23' y2='10'/>
        </svg>
      </div>
      <div class="gj-action-label">Payment Entry</div>
    </div>
    <div class="gj-action" onclick="frappe.set_route('query-report/Stock Balance')">
      <div class="gj-action-icon" style="background:#eff6ff">
        <svg viewBox='0 0 24 24' fill='none' stroke='#2563eb' stroke-width='2' stroke-linecap='round' width='22' height='22'>
          <line x1='18' y1='20' x2='18' y2='10'/><line x1='12' y1='20' x2='12' y2='4'/><line x1='6' y1='20' x2='6' y2='14'/>
        </svg>
      </div>
      <div class="gj-action-label">Stock Balance</div>
    </div>
    <div class="gj-action" onclick="frappe.set_route('query-report/Accounts Receivable')">
      <div class="gj-action-icon" style="background:#fefce8">
        <svg viewBox='0 0 24 24' fill='none' stroke='#d97706' stroke-width='2' stroke-linecap='round' width='22' height='22'>
          <path d='M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2'/><circle cx='9' cy='7' r='4'/>
          <path d='M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75'/>
        </svg>
      </div>
      <div class="gj-action-label">Customer Ledger</div>
    </div>
    <div class="gj-action" onclick="frappe.set_route('query-report/GSTR-1')">
      <div class="gj-action-icon" style="background:#f0fdf4">
        <svg viewBox='0 0 24 24' fill='none' stroke='#16a34a' stroke-width='2' stroke-linecap='round' width='22' height='22'>
          <polyline points='22 12 18 12 15 21 9 3 6 12 2 12'/>
        </svg>
      </div>
      <div class="gj-action-label">GSTR-1 Report</div>
    </div>
    <div class="gj-action" onclick="frappe.set_route('query-report/Trial Balance')">
      <div class="gj-action-icon" style="background:#fdf4ff">
        <svg viewBox='0 0 24 24' fill='none' stroke='#9333ea' stroke-width='2' stroke-linecap='round' width='22' height='22'>
          <line x1='12' y1='3' x2='12' y2='21'/><path d='M7 8H3l2 5-2 5h4'/><path d='M17 8h4l-2 5 2 5h-4'/>
        </svg>
      </div>
      <div class="gj-action-label">Trial Balance</div>
    </div>
    <div class="gj-action" onclick="frappe.set_route('List/Journal Entry')">
      <div class="gj-action-icon" style="background:#eff6ff">
        <svg viewBox='0 0 24 24' fill='none' stroke='#3b82f6' stroke-width='2' stroke-linecap='round' width='22' height='22'>
          <path d='M4 19.5A2.5 2.5 0 016.5 17H20'/><path d='M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z'/>
        </svg>
      </div>
      <div class="gj-action-label">Journal Entry</div>
    </div>
    <div class="gj-action" onclick="frappe.set_route('query-report/Stock Ledger')">
      <div class="gj-action-icon" style="background:#fff7ed">
        <svg viewBox='0 0 24 24' fill='none' stroke='#ea580c' stroke-width='2' stroke-linecap='round' width='22' height='22'>
          <path d='M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z'/>
          <polyline points='3.27 6.96 12 12.01 20.73 6.96'/><line x1='12' y1='22.08' x2='12' y2='12'/>
        </svg>
      </div>
      <div class="gj-action-label">Stock Ledger</div>
    </div>
  </div>

  <!-- Live Data -->
  <div class="gj-section-title">Live Data</div>
  <div id="gj-bottom">
    <div class="gj-card">
      <div class="gj-card-header">
        <div class="gj-card-title">
          <svg viewBox='0 0 24 24' fill='none' stroke='#4e8cff' stroke-width='2.5' stroke-linecap='round'
               width='15' height='15' style='margin-right:7px;vertical-align:middle'>
            <path d='M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z'/><polyline points='14 2 14 8 20 8'/>
          </svg>
          Recent Sales Invoices
        </div>
        <span class="gj-card-link" onclick="frappe.set_route('List/Sales Invoice')">View All →</span>
      </div>
      <div id="gj-sinv-list">
        <div class="gj-skel" style="width:100%;height:13px;margin-bottom:10px"></div>
        <div class="gj-skel" style="width:80%;height:13px;margin-bottom:10px"></div>
        <div class="gj-skel" style="width:100%;height:13px;margin-bottom:10px"></div>
        <div class="gj-skel" style="width:60%;height:13px"></div>
      </div>
    </div>
    <div class="gj-card">
      <div class="gj-card-header">
        <div class="gj-card-title">
          <svg viewBox='0 0 24 24' fill='none' stroke='#ef4444' stroke-width='2.5' stroke-linecap='round'
               width='15' height='15' style='margin-right:7px;vertical-align:middle'>
            <path d='M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z'/>
            <polyline points='3.27 6.96 12 12.01 20.73 6.96'/><line x1='12' y1='22.08' x2='12' y2='12'/>
          </svg>
          Stock Alerts
        </div>
        <span class="gj-card-link" onclick="frappe.set_route('query-report/Stock Balance')">View All →</span>
      </div>
      <div id="gj-stock-list">
        <div class="gj-skel" style="width:100%;height:13px;margin-bottom:10px"></div>
        <div class="gj-skel" style="width:70%;height:13px;margin-bottom:10px"></div>
        <div class="gj-skel" style="width:90%;height:13px"></div>
      </div>
    </div>
  </div>

</div>`;
	}
};
