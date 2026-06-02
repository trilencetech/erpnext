// Copyright (c) 2026, TriLence Tech and contributors
// Stock Selling Report — drill-down mode (green theme)

// ── Indian Financial Year ─────────────────────────────────────────────────────
function _ssr_indian_fy() {
	var p = frappe.datetime.get_today().split("-");
	var y = parseInt(p[0]), m = parseInt(p[1]);
	var s = (m >= 4) ? y : y - 1;
	return { from_date: s + "-04-01", to_date: (s + 1) + "-03-31" };
}

frappe.query_reports["Stock Selling Report"] = {

	// ── FILTERS ──────────────────────────────────────────────────────────────
	filters: (function () {
		var fy = _ssr_indian_fy();
		return [
			{
				label: __("Company"), fieldname: "company",
				fieldtype: "Link", options: "Company",
				reqd: 1, default: frappe.defaults.get_default("company"),
			},
			{
				label: __("From Date"), fieldname: "from_date",
				fieldtype: "Date", reqd: 1, default: fy.from_date,
			},
			{
				label: __("To Date"), fieldname: "to_date",
				fieldtype: "Date", reqd: 1, default: fy.to_date,
			},
			{
				label: __("Customer"), fieldname: "customer",
				fieldtype: "Link", options: "Customer",
			},
			{
				label: __("Item Group"), fieldname: "item_group",
				fieldtype: "Link", options: "Item Group",
			},
			{
				label: __("Item Code"), fieldname: "item_code",
				fieldtype: "Link", options: "Item",
			},
		];
	}()),

	// ── FORMATTER ────────────────────────────────────────────────────────────
	formatter: function (value, row, column, data, default_formatter) {
		if (!data) return default_formatter(value, row, column, data);

		// Grand total
		if (data.row_type === "grand_total") {
			value = default_formatter(value, row, column, data);
			return `<strong style="color:#166534;">${value}</strong>`;
		}

		// Item Code — drill-down trigger
		if (column.fieldname === "item_code" && data.row_type === "data" && data.item_code) {
			return `<span class="ssr-drill-btn"
				data-item-code="${frappe.utils.escape_html(data.item_code)}"
				style="cursor:pointer;color:#15803d;font-weight:700;font-size:12px;
				       display:inline-flex;align-items:center;gap:6px;">
				<span style="font-size:10px;color:#16a34a;">▶</span>
				${frappe.utils.escape_html(data.item_code)}
			</span>`;
		}

		// Invoice count badge
		if (column.fieldname === "invoice_count" && data.row_type === "data") {
			var cnt = data.invoice_count || 0;
			return `<span style="display:inline-block;background:#dcfce7;color:#166534;
				border:1px solid #86efac;border-radius:10px;padding:1px 10px;
				font-weight:700;font-size:11px;">${cnt}</span>`;
		}

		// Total Qty — bold green on data rows
		if (column.fieldname === "total_qty" && data.row_type === "data") {
			value = default_formatter(value, row, column, data);
			return `<strong style="color:#15803d;">${value}</strong>`;
		}

		return default_formatter(value, row, column, data);
	},

	// ── ON LOAD ───────────────────────────────────────────────────────────────
	onload: function (report) {

		// Drill-down click (event delegation)
		$(document)
			.off("click.ssr_drill")
			.on("click.ssr_drill", ".ssr-drill-btn", function () {
				var item_code = $(this).data("item-code");
				if (!item_code) return;
				_ssr_open_drilldown(item_code);
			});

		// Print PDF toolbar button (summary)
		report.page.add_inner_button(__("Print PDF"), function () {
			var filters = frappe.query_report.get_values();
			if (!filters || !filters.company) {
				frappe.msgprint(__("Please select a Company before printing."));
				return;
			}
			frappe.call({
				method: "erpnext.accounts.report.stock_selling_report.stock_selling_report.get_print_html",
				args: { filters: JSON.stringify(filters) },
				freeze: true,
				freeze_message: __("Building report…"),
				callback: function (r) {
					if (!r.message) return;
					var blob = new Blob([r.message], { type: "text/html; charset=utf-8" });
					var url  = URL.createObjectURL(blob);
					var win  = window.open(url, "_blank");
					win && win.focus();
					win.addEventListener("load", function () {
						setTimeout(function () { win.print(); URL.revokeObjectURL(url); }, 400);
					});
				},
			});
		});
	},
};


// ── DRILL-DOWN LOGIC ──────────────────────────────────────────────────────────

function _ssr_open_drilldown(item_code) {
	var filters = frappe.query_report.get_values() || {};

	frappe.call({
		method: "erpnext.accounts.report.stock_selling_report.stock_selling_report.get_item_sales",
		args: { item_code: item_code, filters: JSON.stringify(filters) },
		freeze: true,
		freeze_message: __("Loading sales details…"),
		callback: function (r) {
			var rows = r.message || [];
			if (!rows.length) {
				frappe.msgprint(__("No sales invoices found for {0}.", [item_code]));
				return;
			}
			_ssr_show_dialog(item_code, rows, filters);
		},
	});
}


function _ssr_show_dialog(item_code, rows, filters) {
	var total_qty = 0, total_amount = 0;
	rows.forEach(function (r) {
		total_qty    += parseFloat(r.qty    || 0);
		total_amount += parseFloat(r.amount || 0);
	});

	var row_html = rows.map(function (r, i) {
		var bg  = i % 2 === 0 ? "#f0fdf4" : "#ffffff";
		var dt  = r.posting_date ? r.posting_date.split("-").reverse().join("-") : "";
		var si  = frappe.utils.escape_html(r.sales_invoice || "");
		var cus = frappe.utils.escape_html(r.customer || "");
		return `<tr style="background:${bg};">
			<td style="padding:5px 10px;border-bottom:1px solid #d1fae5;font-weight:700;color:#15803d;">
				<a href="/app/sales-invoice/${si}" target="_blank"
				   style="color:#15803d;text-decoration:none;"
				   onmouseover="this.style.textDecoration='underline'"
				   onmouseout="this.style.textDecoration='none'">${si}</a>
			</td>
			<td style="padding:5px 10px;border-bottom:1px solid #d1fae5;">${cus}</td>
			<td style="padding:5px 10px;border-bottom:1px solid #d1fae5;text-align:center;">${dt}</td>
			<td style="padding:5px 10px;border-bottom:1px solid #d1fae5;text-align:right;
			           font-weight:700;color:#15803d;font-size:13px;">
				${parseFloat(r.qty || 0).toFixed(3)}
			</td>
			<td style="padding:5px 10px;border-bottom:1px solid #d1fae5;text-align:right;">
				${parseFloat(r.rate || 0).toFixed(2)}
			</td>
			<td style="padding:5px 10px;border-bottom:1px solid #d1fae5;text-align:right;font-weight:600;">
				${parseFloat(r.amount || 0).toLocaleString("en-IN", {minimumFractionDigits:2})}
			</td>
		</tr>`;
	}).join("");

	var html = `
<div style="font-family:Arial,sans-serif;">

  <!-- Summary bar -->
  <div style="display:flex;gap:0;margin-bottom:14px;border:1.5px solid #86efac;
              border-radius:8px;overflow:hidden;">
    <div style="flex:1;padding:7px 14px;background:#dcfce7;border-right:1px solid #86efac;">
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Item Code</div>
      <div style="font-size:15px;font-weight:800;color:#166534;">${frappe.utils.escape_html(item_code)}</div>
    </div>
    <div style="flex:1;padding:7px 14px;background:#dcfce7;border-right:1px solid #86efac;">
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Invoices</div>
      <div style="font-size:15px;font-weight:700;color:#166534;">${rows.length}</div>
    </div>
    <div style="flex:1;padding:7px 14px;background:#dcfce7;border-right:1px solid #86efac;">
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Total Qty (Kgs)</div>
      <div style="font-size:15px;font-weight:700;color:#166534;">${total_qty.toFixed(3)}</div>
    </div>
    <div style="flex:1;padding:7px 14px;background:#dcfce7;">
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Total Amount (₹)</div>
      <div style="font-size:15px;font-weight:700;color:#166534;">
        ${total_amount.toLocaleString("en-IN", {minimumFractionDigits:2})}
      </div>
    </div>
  </div>

  <!-- Detail table -->
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead>
      <tr style="background:#166534;color:#fff;">
        <th style="padding:7px 10px;text-align:left;font-weight:700;">Sales Invoice</th>
        <th style="padding:7px 10px;text-align:left;font-weight:700;">Customer</th>
        <th style="padding:7px 10px;text-align:center;font-weight:700;">Date</th>
        <th style="padding:7px 10px;text-align:right;font-weight:700;">Qty (Kgs)</th>
        <th style="padding:7px 10px;text-align:right;font-weight:700;">Rate (₹)</th>
        <th style="padding:7px 10px;text-align:right;font-weight:700;">Amount (₹)</th>
      </tr>
    </thead>
    <tbody>${row_html}</tbody>
    <tfoot>
      <tr style="background:#bbf7d0;font-weight:700;border-top:2px solid #16a34a;">
        <td colspan="3" style="padding:6px 10px;text-align:right;color:#166534;">Total</td>
        <td style="padding:6px 10px;text-align:right;color:#166534;font-size:13px;">
          ${total_qty.toFixed(3)}
        </td>
        <td></td>
        <td style="padding:6px 10px;text-align:right;color:#166534;">
          ${total_amount.toLocaleString("en-IN", {minimumFractionDigits:2})}
        </td>
      </tr>
    </tfoot>
  </table>
</div>`;

	var d = new frappe.ui.Dialog({
		title: __("Sales History") + "  —  " + item_code,
		size:  "extra-large",
		fields: [{ fieldtype: "HTML", fieldname: "content" }],
		primary_action_label: __("🖨 Print PDF"),
		primary_action: function () {
			_ssr_print_item(item_code, rows, total_qty, total_amount, filters);
		},
	});

	d.fields_dict.content.$wrapper.html(html);
	d.show();
}


// ── ITEM-LEVEL PDF ────────────────────────────────────────────────────────────

function _ssr_print_item(item_code, rows, total_qty, total_amount, filters) {
	var company   = (filters && filters.company)   || "";
	var from_date = (filters && filters.from_date) || "";
	var to_date   = (filters && filters.to_date)   || "";

	function fdate(d) {
		if (!d) return "";
		var p = d.split("-");
		return p.length === 3 ? p[2] + "-" + p[1] + "-" + p[0] : d;
	}
	var period = (from_date !== to_date)
		? fdate(from_date) + " to " + fdate(to_date)
		: fdate(from_date);

	var row_html = rows.map(function (r, i) {
		var bg = i % 2 === 0 ? "#f0fdf4" : "#ffffff";
		return `<tr style="background:${bg};">
			<td>${frappe.utils.escape_html(r.sales_invoice || "")}</td>
			<td>${frappe.utils.escape_html(r.customer || "")}</td>
			<td style="text-align:center;">${fdate(r.posting_date)}</td>
			<td style="text-align:right;font-weight:700;color:#15803d;">
				${parseFloat(r.qty || 0).toFixed(3)}
			</td>
			<td style="text-align:right;">${parseFloat(r.rate || 0).toFixed(2)}</td>
			<td style="text-align:right;font-weight:600;">
				${parseFloat(r.amount || 0).toLocaleString("en-IN", {minimumFractionDigits:2})}
			</td>
		</tr>`;
	}).join("");

	var html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Sales History – ${frappe.utils.escape_html(item_code)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4 portrait; margin: 14mm 12mm 16mm 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #111; background: #fff; }

  .doc-header { text-align: center; padding-bottom: 6px; border-bottom: 2px solid #166534; margin-bottom: 10px; }
  .company-name { font-size: 17pt; font-weight: bold; letter-spacing: 3px; text-transform: uppercase; color: #166534; }
  .report-title { font-size: 11pt; margin-top: 3px; color: #444; }
  .item-badge {
    display: inline-block; background: #dcfce7; color: #166534;
    border: 1px solid #86efac; border-radius: 6px; padding: 3px 14px;
    font-size: 13pt; font-weight: 800; letter-spacing: 1px; margin: 8px 0 4px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .summary-bar {
    display: flex; gap: 0; border: 1.5px solid #86efac; border-radius: 8px;
    overflow: hidden; margin-bottom: 12px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sum-cell {
    flex: 1; padding: 7px 12px; background: #dcfce7; border-right: 1px solid #86efac;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sum-cell:last-child { border-right: none; }
  .sum-label { font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: .5px; }
  .sum-value { font-size: 13pt; font-weight: 800; color: #166534; }

  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  col.c-si  { width: 22%; } col.c-cus { width: 26%; } col.c-dt  { width: 12%; }
  col.c-qty { width: 14%; } col.c-rt  { width: 12%; } col.c-amt { width: 14%; }

  thead th {
    background: #166534; color: #fff; padding: 6px 8px; font-size: 10pt; font-weight: bold;
    text-align: left; border: 1px solid #15803d;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  thead th.r { text-align: right; }
  tbody td { border: 1px solid #bbf7d0; padding: 4px 8px; font-size: 10pt; vertical-align: middle; }
  tfoot td {
    background: #bbf7d0; font-weight: bold; padding: 5px 8px;
    border-top: 2px solid #16a34a; border-bottom: 2px solid #16a34a;
    border-left: 1px solid #bbf7d0; border-right: 1px solid #bbf7d0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .print-btn-bar { text-align: right; margin-bottom: 8px; }
  .print-btn { padding: 7px 20px; background: #16a34a; color: #fff; border: none; border-radius: 4px; font-size: 10pt; cursor: pointer; }
  @media print { .no-print { display: none; } }
</style>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},500);});</script>
</head><body>

<div class="print-btn-bar no-print">
  <button class="print-btn" onclick="window.print()">&#128438; Print / Save as PDF</button>
</div>

<div class="doc-header">
  <div class="company-name">${frappe.utils.escape_html(company)}</div>
  <div class="report-title">Stock Selling Report &nbsp;—&nbsp; ${period}</div>
  <div class="item-badge">${frappe.utils.escape_html(item_code)}</div>
</div>

<div class="summary-bar">
  <div class="sum-cell">
    <div class="sum-label">Invoices</div>
    <div class="sum-value">${rows.length}</div>
  </div>
  <div class="sum-cell">
    <div class="sum-label">Total Qty (Kgs)</div>
    <div class="sum-value">${total_qty.toFixed(3)}</div>
  </div>
  <div class="sum-cell">
    <div class="sum-label">Total Amount (₹)</div>
    <div class="sum-value">${total_amount.toLocaleString("en-IN",{minimumFractionDigits:2})}</div>
  </div>
</div>

<table>
  <colgroup>
    <col class="c-si"><col class="c-cus"><col class="c-dt">
    <col class="c-qty"><col class="c-rt"><col class="c-amt">
  </colgroup>
  <thead>
    <tr>
      <th>Sales Invoice</th><th>Customer</th>
      <th style="text-align:center;">Date</th>
      <th class="r">Qty (Kgs)</th><th class="r">Rate (₹)</th><th class="r">Amount (₹)</th>
    </tr>
  </thead>
  <tbody>${row_html}</tbody>
  <tfoot>
    <tr>
      <td colspan="3" style="text-align:right;color:#166534;">Total</td>
      <td style="text-align:right;color:#166534;">${total_qty.toFixed(3)}</td>
      <td></td>
      <td style="text-align:right;color:#166534;">
        ${total_amount.toLocaleString("en-IN",{minimumFractionDigits:2})}
      </td>
    </tr>
  </tfoot>
</table>
</body></html>`;

	var blob = new Blob([html], { type: "text/html; charset=utf-8" });
	var url  = URL.createObjectURL(blob);
	var win  = window.open(url, "_blank");
	win && win.focus();
	setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
}
