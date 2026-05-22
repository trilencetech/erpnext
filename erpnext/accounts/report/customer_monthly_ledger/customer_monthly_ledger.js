// Copyright (c) 2026, TriLence Tech and contributors
// Customer Monthly Ledger — Script Report

frappe.query_reports["Customer Monthly Ledger"] = {

	// ── FILTERS ──────────────────────────────────────────────────────────────

	filters: [
		{
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
			reqd: 1,
			on_change: function () {
				frappe.query_report.refresh();
			},
		},
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			reqd: 1,
			default: frappe.defaults.get_user_default("Company"),
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			reqd: 1,
			default: frappe.datetime.add_months(frappe.datetime.get_today(), -6),
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			reqd: 1,
			default: frappe.datetime.get_today(),
		},
	],

	// ── ROW / CELL FORMATTER ─────────────────────────────────────────────────

	formatter: function (value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);

		if (!data) return value;

		// Top summary row — blue + outstanding in red
		if (data._row_type === "total") {
			if (column.fieldname === "period") {
				return `<span style="color:#1a56db;font-weight:700;font-size:13.5px;">${value}</span>`;
			}
			if (column.fieldname === "outstanding") {
				return `<span style="color:#dc2626;font-weight:700;font-size:14px;">${value}</span>`;
			}
			return `<span style="font-weight:700;color:#1a56db;">${value}</span>`;
		}

		// Month rows — clickable period, coloured outstanding
		if (data._row_type === "month" && data.month_start) {
			if (column.fieldname === "period") {
				return `<a class="cml-month-link" href="javascript:void(0)"
					style="cursor:pointer;color:#1a56db;font-weight:600;text-decoration:underline;text-underline-offset:3px;"
					data-month-start="${data.month_start}"
					data-month-end="${data.month_end}"
					data-month-label="${data.period}"
				>${data.period}&nbsp;&nbsp;<i class="fa fa-search-plus" style="font-size:11px;opacity:0.65;"></i></a>`;
			}
			if (column.fieldname === "outstanding") {
				var clr = flt(data.outstanding) > 0 ? "#e65100" : "#16a34a";
				return `<span style="color:${clr};font-weight:600;">${value}</span>`;
			}
		}

		return value;
	},

	// ── ON LOAD ──────────────────────────────────────────────────────────────

	onload: function (_report) {
		// "All Months PDF" button on the report header toolbar
		frappe.query_report.page.add_inner_button(__("🖨️ All Months PDF"), function () {
			_generate_all_months_pdf();
		});

		// Document-level delegation — avoids the $(report.wrapper) issue in v15
		$(document)
			.off("click.cml_drilldown")
			.on("click.cml_drilldown", ".cml-month-link", function (e) {
				e.preventDefault();
				e.stopPropagation();

				var $el = $(this);
				var customer = frappe.query_report.get_filter_value("customer");
				var company  = frappe.query_report.get_filter_value("company");

				if (!customer) {
					frappe.msgprint(__("Please select a Customer first."));
					return;
				}

				_load_month_drilldown(
					customer,
					company,
					$el.data("month-start"),
					$el.data("month-end"),
					$el.data("month-label")
				);
			});
	},
};


// ── DRILLDOWN LOADER ─────────────────────────────────────────────────────────

function _load_month_drilldown(customer, company, month_start, month_end, month_label) {
	frappe.call({
		method: "erpnext.accounts.report.customer_monthly_ledger.customer_monthly_ledger.get_month_invoices",
		args: { customer, company, month_start, month_end },
		freeze: true,
		freeze_message: __("Loading invoices for {0}…", [month_label]),
		callback: function (r) {
			if (!r.message || !r.message.length) {
				frappe.msgprint({
					title: __("No Invoices"),
					message: __("No invoices found for <b>{0}</b>.", [month_label]),
					indicator: "orange",
				});
				return;
			}
			_show_invoice_dialog(r.message, month_label, customer, company);
		},
	});
}


// ── DRILLDOWN DIALOG  (PDF = primary · CSV = secondary) ──────────────────────

function _show_invoice_dialog(invoices, month_label, customer, company) {
	var total_invoice = 0, total_paid = 0, total_outstanding = 0;
	var tbody = "";

	invoices.forEach(function (inv) {
		var inv_amt = flt(inv.invoice_amount, 2);
		var paid_amt = flt(inv.paid_amount, 2);
		var out_amt  = flt(inv.outstanding,  2);

		total_invoice     += inv_amt;
		total_paid        += paid_amt;
		total_outstanding += out_amt;

		var out_color  = out_amt > 0 ? "#dc2626" : "#16a34a";
		var out_icon   = out_amt > 0 ? "⏳" : "✓";
		var out_weight = out_amt > 0 ? "600" : "normal";

		tbody += `
			<tr style="border-bottom:1px solid #f3f4f6;"
				onmouseover="this.style.background='#f9fafb'"
				onmouseout="this.style.background=''">
				<td style="padding:9px 12px;">
					<a href="/app/sales-invoice/${inv.sales_invoice}" target="_blank"
					   style="color:#1a56db;font-weight:600;text-decoration:none;font-size:12.5px;"
					>${inv.sales_invoice}</a>
				</td>
				<td style="padding:9px 12px;color:#4b5563;font-size:12.5px;">
					${frappe.datetime.str_to_user(inv.posting_date)}
				</td>
				<td style="padding:9px 12px;text-align:right;font-size:12.5px;">
					${_fmt(inv_amt)}
				</td>
				<td style="padding:9px 12px;text-align:right;color:#16a34a;font-size:12.5px;">
					${_fmt(paid_amt)}
				</td>
				<td style="padding:9px 12px;text-align:right;color:${out_color};font-weight:${out_weight};font-size:12.5px;">
					${out_icon} ${_fmt(out_amt)}
				</td>
			</tr>`;
	});

	// Total row — amber if outstanding, green if all clear
	var all_clear = total_outstanding === 0;
	var tot_bg     = all_clear ? "linear-gradient(135deg,#d1fae5,#a7f3d0)" : "linear-gradient(135deg,#fef3c7,#fde68a)";
	var tot_border = all_clear ? "#34d399" : "#f59e0b";
	var tot_label_color = all_clear ? "#065f46" : "#92400e";
	var tot_out_color   = all_clear ? "#065f46" : "#dc2626";

	tbody += `
		<tr style="background:${tot_bg};border-top:2px solid ${tot_border};font-weight:700;">
			<td colspan="2" style="padding:11px 12px;color:${tot_label_color};font-size:13px;">
				📊&nbsp;${all_clear ? "All Cleared" : "Total Outstanding"} — ${month_label}
			</td>
			<td style="padding:11px 12px;text-align:right;color:#1e40af;font-size:13px;">${_fmt(total_invoice)}</td>
			<td style="padding:11px 12px;text-align:right;color:#16a34a;font-size:13px;">${_fmt(total_paid)}</td>
			<td style="padding:11px 12px;text-align:right;color:${tot_out_color};font-size:14px;">${_fmt(total_outstanding)}</td>
		</tr>`;

	var header_bar = `
		<div style="display:flex;justify-content:space-between;align-items:center;
			background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;
			padding:10px 14px;margin-bottom:14px;font-size:12.5px;">
			<div><span style="color:#6b7280;">Customer:&nbsp;</span>
				<strong style="color:#1e40af;">${customer}</strong></div>
			<div><span style="color:#6b7280;">Period:&nbsp;</span>
				<strong style="color:#1a56db;">${month_label}</strong></div>
			<div style="background:#dbeafe;color:#1e40af;border-radius:12px;
				padding:2px 10px;font-weight:600;font-size:11.5px;">
				${invoices.length} invoice${invoices.length === 1 ? "" : "s"}
			</div>
		</div>`;

	var table_area = `
		<div style="max-height:58vh;overflow-y:auto;border:1px solid #e5e7eb;border-radius:6px;">
			<table style="width:100%;border-collapse:collapse;font-family:var(--font-stack);">
				<thead>
					<tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;position:sticky;top:0;z-index:2;">
						<th style="padding:10px 12px;text-align:left;font-size:11.5px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;">Invoice No</th>
						<th style="padding:10px 12px;text-align:left;font-size:11.5px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;">Date</th>
						<th style="padding:10px 12px;text-align:right;font-size:11.5px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;">Invoice Amount</th>
						<th style="padding:10px 12px;text-align:right;font-size:11.5px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;">Paid Amount</th>
						<th style="padding:10px 12px;text-align:right;font-size:11.5px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;">Outstanding</th>
					</tr>
				</thead>
				<tbody>${tbody}</tbody>
			</table>
		</div>`;

	var d = new frappe.ui.Dialog({
		title: "📅 " + month_label + " — Invoice Details",
		size: "large",
		fields: [{ fieldtype: "HTML", fieldname: "invoice_table", options: header_bar + table_area }],
		primary_action_label: "🖨️ Export PDF",
		primary_action: function () {
			_generate_month_pdf(invoices, month_label, customer, company);
		},
		secondary_action_label: "📥 Export CSV",
		secondary_action: function () {
			_export_csv(invoices, month_label);
		},
	});

	d.show();
}


// ── SINGLE MONTH PDF ─────────────────────────────────────────────────────────

function _generate_month_pdf(invoices, month_label, customer, company) {
	frappe.db.get_value("Customer", customer, "customer_name").then(function (r) {
		var cname = ((r || {}).message || {}).customer_name || customer;
		_open_html_tab(_build_single_month_pdf_html(invoices, month_label, cname, company));
	});
}


// ── ALL MONTHS PDF ────────────────────────────────────────────────────────────

function _generate_all_months_pdf() {
	var customer  = frappe.query_report.get_filter_value("customer");
	var company   = frappe.query_report.get_filter_value("company");
	var from_date = frappe.query_report.get_filter_value("from_date");
	var to_date   = frappe.query_report.get_filter_value("to_date");

	if (!customer || !company) {
		frappe.msgprint(__("Please select Customer and Company, then run the report."));
		return;
	}

	frappe.call({
		method: "erpnext.accounts.report.customer_monthly_ledger.customer_monthly_ledger.get_all_invoices_for_period",
		args: { customer, company, from_date, to_date },
		freeze: true,
		freeze_message: __("Preparing All Months PDF…"),
		callback: function (r) {
			if (!r.message || !r.message.length) {
				frappe.msgprint(__("No invoices found for the selected period."));
				return;
			}
			frappe.db.get_value("Customer", customer, "customer_name").then(function (res) {
				var cname = ((res || {}).message || {}).customer_name || customer;
				_open_html_tab(_build_all_months_pdf_html(r.message, cname, company, from_date, to_date));
			});
		},
	});
}

// Opens an HTML string in a new tab using a Blob URL (avoids deprecated document.write)
function _open_html_tab(html) {
	var blob = new Blob([html], { type: "text/html;charset=utf-8;" });
	var url  = URL.createObjectURL(blob);
	window.open(url, "_blank");
	// Revoke after a short delay so the tab has time to load the blob
	setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
}


// ── PDF HELPERS ───────────────────────────────────────────────────────────────

var _MONTHS = ["January","February","March","April","May","June",
               "July","August","September","October","November","December"];

function _pdf_inr(v) {
	var n = parseFloat(v) || 0;
	return "₹ " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _pdf_date(s) {
	if (!s) return "";
	var d = new Date(s);
	return String(d.getDate()).padStart(2,"0") + "/" +
	       String(d.getMonth()+1).padStart(2,"0") + "/" +
	       d.getFullYear();
}

function _pdf_css() {
	return `
		* { box-sizing:border-box; margin:0; padding:0; }
		body {
			font-family: Arial, Helvetica, sans-serif;
			background: #f3f4f6;
			color: #111827;
			padding: 24px;
			font-size: 12.5px;
		}
		.page {
			background: #fff;
			max-width: 960px;
			margin: 0 auto;
			padding: 40px 48px;
			box-shadow: 0 4px 24px rgba(0,0,0,.12);
			border-radius: 4px;
			border-top: 5px solid #1e3a5f;
		}

		/* ── HEADER ── */
		.hdr { text-align:center; border-bottom:2px solid #1e3a5f; padding-bottom:16px; margin-bottom:22px; }
		.hdr-company { font-size:20px; font-weight:700; color:#1e3a5f; letter-spacing:2px; text-transform:uppercase; }
		.hdr-title   { font-size:12px; color:#6b7280; margin-top:4px; letter-spacing:1.2px; text-transform:uppercase; }
		.hdr-meta    { display:flex; justify-content:space-between; margin-top:12px; font-size:12px; color:#374151; }
		.hdr-meta strong { color:#1e3a5f; }

		/* ── OUTSTANDING SUMMARY BOX ── */
		.out-box {
			display:flex; justify-content:space-between; align-items:center;
			background:#fef2f2; border:2px solid #dc2626; border-radius:6px;
			padding:14px 20px; margin-bottom:28px;
		}
		.out-box-label  { font-size:13px; font-weight:700; color:#7f1d1d; }
		.out-box-amount { font-size:26px; font-weight:700; color:#dc2626; }

		/* ── MONTH SECTION ── */
		.month-sec { margin-bottom:26px; break-inside:avoid; page-break-inside:avoid; }
		.month-hdr {
			background:#1e3a5f; color:#fff;
			padding:8px 14px; font-weight:700; font-size:13px;
			border-radius:4px 4px 0 0; letter-spacing:.5px;
		}

		/* ── TABLE ── */
		table { width:100%; border-collapse:collapse; font-size:12px; }
		thead tr th {
			background:#f1f5f9; padding:8px 10px; text-align:right;
			font-size:11px; font-weight:700; color:#475569;
			border-bottom:1.5px solid #cbd5e1; text-transform:uppercase; letter-spacing:.4px;
		}
		thead tr th:first-child, thead tr th:nth-child(2) { text-align:left; }
		tbody tr td { padding:8px 10px; text-align:right; border-bottom:1px solid #f1f5f9; color:#374151; }
		tbody tr td:first-child { text-align:left; color:#1a56db; font-weight:600; }
		tbody tr td:nth-child(2) { text-align:left; color:#4b5563; }

		/* ── TOTAL ROW (amber) ── */
		tr.tot td {
			background:#fef3c7; border-top:2px solid #f59e0b;
			font-weight:700; padding:10px 10px;
		}
		tr.tot td:first-child { color:#92400e; }
		tr.tot .neg { color:#dc2626; font-size:13px; }
		tr.tot .zero { color:#16a34a; font-size:13px; }

		/* ── GRAND TOTAL BOX ── */
		.grand-box {
			display:flex; justify-content:space-between; align-items:center;
			border:2px solid #1e3a5f; border-radius:6px;
			background:#eff6ff; padding:16px 20px; margin-top:24px;
		}
		.grand-box-label  { font-size:14px; font-weight:700; color:#1e3a5f; }
		.grand-box-amount { font-size:22px; font-weight:700; color:#dc2626; }

		/* ── FOOTER ── */
		.footer {
			margin-top:28px; border-top:1px solid #e5e7eb; padding-top:12px;
			display:flex; justify-content:space-between;
			font-size:11px; color:#9ca3af;
		}

		/* ── PRINT BUTTON ── */
		.print-wrap { text-align:center; margin-top:20px; }
		.print-btn  {
			background:#1e3a5f; color:#fff; border:none;
			padding:10px 36px; font-size:13px; border-radius:4px;
			cursor:pointer; font-weight:700; letter-spacing:.5px;
		}
		.print-btn:hover { background:#2d4a7f; }

		@media print {
			body { background:#fff; padding:0; }
			.page { box-shadow:none; padding:20px 28px; }
			.print-wrap { display:none; }
			.out-box-amount { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
			tr.tot td, .out-box, .grand-box, .month-hdr { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
		}`;
}

function _pdf_invoice_rows_html(invoices) {
	return invoices.map(function (inv) {
		var inv_amt  = parseFloat(inv.invoice_amount) || 0;
		var paid_amt = parseFloat(inv.paid_amount)    || 0;
		var out_amt  = parseFloat(inv.outstanding)    || 0;
		var out_col  = out_amt > 0 ? "#dc2626" : "#16a34a";
		var out_icon = out_amt > 0 ? "⏳ " : "✓ ";
		return `<tr>
			<td>${inv.sales_invoice}</td>
			<td>${_pdf_date(inv.posting_date)}</td>
			<td>${_pdf_inr(inv_amt)}</td>
			<td style="color:#16a34a;">${_pdf_inr(paid_amt)}</td>
			<td style="color:${out_col};font-weight:${out_amt > 0 ? '600' : 'normal'};">${out_icon}${_pdf_inr(out_amt)}</td>
		</tr>`;
	}).join("");
}

function _pdf_total_row_html(total_inv, total_paid, total_out, label) {
	var cls = total_out === 0 ? "zero" : "neg";
	return `<tr class="tot">
		<td colspan="2">Total Outstanding — ${label}</td>
		<td>${_pdf_inr(total_inv)}</td>
		<td style="color:#16a34a;">${_pdf_inr(total_paid)}</td>
		<td class="${cls}">${_pdf_inr(total_out)}</td>
	</tr>`;
}

function _pdf_table_html(invoices, label) {
	var total_inv = 0, total_paid = 0, total_out = 0;
	invoices.forEach(function (inv) {
		total_inv  += parseFloat(inv.invoice_amount) || 0;
		total_paid += parseFloat(inv.paid_amount)    || 0;
		total_out  += parseFloat(inv.outstanding)    || 0;
	});
	return `<table>
		<thead><tr>
			<th>Invoice No</th><th>Date</th>
			<th>Invoice Amount</th><th>Paid Amount</th><th>Outstanding</th>
		</tr></thead>
		<tbody>
			${_pdf_invoice_rows_html(invoices)}
			${_pdf_total_row_html(total_inv, total_paid, total_out, label)}
		</tbody>
	</table>`;
}


// ── SINGLE MONTH PDF BUILDER ──────────────────────────────────────────────────

function _build_single_month_pdf_html(invoices, month_label, customer_name, company) {
	var total_out = invoices.reduce(function (s, inv) { return s + (parseFloat(inv.outstanding) || 0); }, 0);
	var today_str = _pdf_date(frappe.datetime.get_today());

	return `<!DOCTYPE html><html><head>
		<meta charset="UTF-8">
		<title>${company} — ${month_label}</title>
		<style>${_pdf_css()}</style>
	</head><body><div class="page">

		<div class="hdr">
			<div class="hdr-company">${company}</div>
			<div class="hdr-title">Customer Monthly Ledger</div>
			<div class="hdr-meta">
				<span>Customer: <strong>${customer_name}</strong></span>
				<span>Period: <strong>${month_label}</strong></span>
				<span>Printed: <strong>${today_str}</strong></span>
			</div>
		</div>

		<div class="out-box">
			<div class="out-box-label">Outstanding Balance — ${month_label}</div>
			<div class="out-box-amount">${_pdf_inr(total_out)}</div>
		</div>

		<div class="month-sec">
			<div class="month-hdr">Invoice Details — ${month_label}</div>
			${_pdf_table_html(invoices, month_label)}
		</div>

		<div class="footer">
			<span>${company} · Customer Monthly Ledger</span>
			<span>Printed on ${today_str}</span>
		</div>

		<div class="print-wrap">
			<button class="print-btn" onclick="window.print()">🖨️&nbsp; Print / Save as PDF</button>
		</div>

	</div></body></html>`;
}


// ── ALL MONTHS PDF BUILDER ────────────────────────────────────────────────────

function _build_all_months_pdf_html(invoices, customer_name, company, from_date, to_date) {
	// Group by year-month key
	var order  = [];
	var groups = {};
	var grand_inv = 0, grand_paid = 0, grand_out = 0;

	invoices.forEach(function (inv) {
		var d   = new Date(inv.posting_date);
		var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
		var lbl = _MONTHS[d.getMonth()] + " " + d.getFullYear();

		if (!groups[key]) { groups[key] = { label: lbl, rows: [] }; order.push(key); }
		groups[key].rows.push(inv);

		grand_inv  += parseFloat(inv.invoice_amount) || 0;
		grand_paid += parseFloat(inv.paid_amount)    || 0;
		grand_out  += parseFloat(inv.outstanding)    || 0;
	});

	var sections = order.sort().map(function (key) {
		var g = groups[key];
		return `<div class="month-sec">
			<div class="month-hdr">${g.label}</div>
			${_pdf_table_html(g.rows, g.label)}
		</div>`;
	}).join("");

	var from_disp  = _pdf_date(from_date)  || from_date;
	var to_disp    = _pdf_date(to_date)    || to_date;
	var today_str  = _pdf_date(frappe.datetime.get_today());

	return `<!DOCTYPE html><html><head>
		<meta charset="UTF-8">
		<title>${company} — Customer Monthly Ledger</title>
		<style>${_pdf_css()}</style>
	</head><body><div class="page">

		<div class="hdr">
			<div class="hdr-company">${company}</div>
			<div class="hdr-title">Customer Monthly Ledger</div>
			<div class="hdr-meta">
				<span>Customer: <strong>${customer_name}</strong></span>
				<span>Period: <strong>${from_disp} – ${to_disp}</strong></span>
				<span>Printed: <strong>${today_str}</strong></span>
			</div>
		</div>

		<div class="out-box">
			<div class="out-box-label">Total Outstanding Balance as on ${to_disp}</div>
			<div class="out-box-amount">${_pdf_inr(grand_out)}</div>
		</div>

		${sections}

		<div class="grand-box">
			<div class="grand-box-label">Grand Total Outstanding (${from_disp} – ${to_disp})</div>
			<div class="grand-box-amount">${_pdf_inr(grand_out)}</div>
		</div>

		<div class="footer">
			<span>${company} · Customer Monthly Ledger</span>
			<span>Printed on ${today_str}</span>
		</div>

		<div class="print-wrap">
			<button class="print-btn" onclick="window.print()">🖨️&nbsp; Print / Save as PDF</button>
		</div>

	</div></body></html>`;
}


// ── CSV EXPORT ────────────────────────────────────────────────────────────────

function _export_csv(invoices, month_label) {
	var headers = ["Invoice No", "Invoice Date", "Invoice Amount", "Paid Amount", "Outstanding"];

	var rows = invoices.map(function (inv) {
		return [inv.sales_invoice, inv.posting_date,
		        flt(inv.invoice_amount, 2), flt(inv.paid_amount, 2), flt(inv.outstanding, 2)];
	});

	var t_inv  = rows.reduce(function (s, r) { return s + r[2]; }, 0);
	var t_paid = rows.reduce(function (s, r) { return s + r[3]; }, 0);
	var t_out  = rows.reduce(function (s, r) { return s + r[4]; }, 0);
	rows.push(["TOTAL", "", flt(t_inv, 2), flt(t_paid, 2), flt(t_out, 2)]);

	var csv = [headers].concat(rows).map(function (row) {
		return row.map(function (cell) {
			return '"' + String(cell == null ? "" : cell).replace(/"/g, '""') + '"';
		}).join(",");
	}).join("\n");

	var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
	var url  = URL.createObjectURL(blob);
	var a    = document.createElement("a");
	a.href = url;
	a.download = "Customer_Ledger_" + month_label.replace(/\s+/g, "_") + ".csv";
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);

	frappe.show_alert({ message: __("{0} — CSV exported", [month_label]), indicator: "green" });
}


// ── HELPERS ───────────────────────────────────────────────────────────────────

function _fmt(value) {
	return frappe.format(flt(value, 2), { fieldtype: "Currency" });
}
