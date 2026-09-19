// Copyright (c) 2026, TriLence Tech and contributors
// Payment Collection Report — Script Report

frappe.query_reports["Payment Collection Report"] = {

	// ── FILTERS ──────────────────────────────────────────────────────────────

	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			reqd: 1,
			default: frappe.defaults.get_user_default("Company"),
		},
		{
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
			// Optional — leave blank to show all customers
			on_change: function () { frappe.query_report.refresh(); },
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			reqd: 1,
			// First day of 2 months before the current month
			default: frappe.datetime.add_months(frappe.datetime.month_start(), -2),
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			reqd: 1,
			// Last day of 2 months before the current month
			default: frappe.datetime.add_days(
				frappe.datetime.add_months(frappe.datetime.month_start(), -1), -1
			),
		},
	],

	// ── FORMATTER ────────────────────────────────────────────────────────────

	formatter: function (value, row, column, data, default_formatter) {
		if (!data) return default_formatter(value, row, column, data);

		// Grand total header row
		if (data._row_type === "grand_total") {
			var fv = default_formatter(value, row, column, data);
			if (column.fieldname === "particular")
				return `<span style="color:#1a56db;font-weight:700;font-size:13.5px;">${fv}</span>`;
			if (column.fieldname === "outstanding")
				return `<span style="color:#dc2626;font-weight:700;font-size:14px;">${fv}</span>`;
			if (column.fieldname === "paid_amount")
				return `<span style="color:#16a34a;font-weight:700;">${fv}</span>`;
			return `<span style="font-weight:700;color:#1a56db;">${fv}</span>`;
		}

		// Blank rows — render nothing
		if (data._row_type === "blank") return "";

		// Customer header row — bold clickable customer name
		if (data._row_type === "customer_header") {
			if (column.fieldname === "particular")
				return `<a href="/app/customer/${encodeURIComponent(data._customer)}" target="_blank"
					style="color:#1e3a5f;font-weight:700;font-size:13px;text-decoration:none;
					       letter-spacing:.2px;"
					onmouseover="this.style.textDecoration='underline'"
					onmouseout="this.style.textDecoration='none'">
					${value || data._customer}
				</a>`;
			return "";
		}

		// Opening balance row
		if (data._row_type === "opening") {
			var fv2 = default_formatter(value, row, column, data);
			if (column.fieldname === "particular")
				return `<span style="color:#92400e;font-style:italic;padding-left:16px;">${fv2}</span>`;
			if (column.fieldname === "outstanding" && flt(data.outstanding) > 0)
				return `<span style="color:#d97706;font-weight:600;">${fv2}</span>`;
			return fv2;
		}

		// Invoice rows
		if (data._row_type === "invoice") {
			if (column.fieldname === "particular" && data._invoice)
				return `<a href="/app/sales-invoice/${data._invoice}" target="_blank"
					style="color:#1a56db;font-weight:600;text-decoration:none;padding-left:16px;"
					onmouseover="this.style.textDecoration='underline'"
					onmouseout="this.style.textDecoration='none'">
					${data._invoice}
				</a>`;

			if (column.fieldname === "paid_amount" && flt(data.paid_amount) > 0)
				return `<span style="color:#16a34a;font-weight:600;">
					${default_formatter(value, row, column, data)}</span>`;

			if (column.fieldname === "outstanding") {
				var out = flt(data.outstanding);
				var fv3 = default_formatter(value, row, column, data);
				var clr = out > 0 ? "#dc2626" : "#16a34a";
				var lbl = out === 0 ? "✓ " : "";
				return `<span style="color:${clr};font-weight:${out > 0 ? '600' : 'normal'};">${lbl}${fv3}</span>`;
			}

			if (column.fieldname === "status" && data.status) {
				var badge_map = {
					"Paid":        { bg: "#d1fae5", color: "#065f46", border: "#6ee7b7" },
					"Unpaid":      { bg: "#fef2f2", color: "#991b1b", border: "#fca5a5" },
					"Overdue":     { bg: "#fff7ed", color: "#92400e", border: "#fdba74" },
					"Partly Paid": { bg: "#eff6ff", color: "#1e40af", border: "#93c5fd" },
					"Draft":       { bg: "#f9fafb", color: "#374151", border: "#d1d5db" },
				};
				var b = badge_map[data.status] || { bg: "#f9fafb", color: "#374151", border: "#d1d5db" };
				return `<span style="background:${b.bg};color:${b.color};border:1px solid ${b.border};
					border-radius:10px;padding:2px 10px;font-size:11px;font-weight:600;
					white-space:nowrap;">${data.status}</span>`;
			}
		}

		// Credit note rows
		if (data._row_type === "credit_note") {
			if (column.fieldname === "particular" && data._invoice)
				return `<a href="/app/sales-invoice/${data._invoice}" target="_blank"
					style="color:#d97706;font-weight:600;text-decoration:none;padding-left:16px;"
					onmouseover="this.style.textDecoration='underline'"
					onmouseout="this.style.textDecoration='none'">
					🔁 ${data._invoice}
				</a>`;
			if (column.fieldname === "credit_note")
				return `<span style="color:#d97706;font-weight:600;">
					(${default_formatter(value, row, column, data)})</span>`;
			if (column.fieldname === "status")
				return `<span style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;
					border-radius:10px;padding:2px 10px;font-size:11px;font-weight:600;">Credit Note</span>`;
		}

		// Customer total row
		if (data._row_type === "customer_total") {
			var fv4 = default_formatter(value, row, column, data);
			if (column.fieldname === "particular")
				return `<span style="color:#374151;font-weight:700;padding-left:8px;font-size:12px;">
					${fv4}</span>`;
			if (column.fieldname === "outstanding") {
				var out2 = flt(data.outstanding);
				var clr2 = out2 > 0 ? "#dc2626" : "#16a34a";
				return `<span style="color:${clr2};font-weight:700;">${fv4}</span>`;
			}
			if (column.fieldname === "paid_amount" && flt(data.paid_amount) > 0)
				return `<span style="color:#16a34a;font-weight:700;">${fv4}</span>`;
			if (column.fieldname === "credit_note" && flt(data.credit_note) > 0)
				return `<span style="color:#d97706;font-weight:700;">${fv4}</span>`;
			return `<span style="font-weight:700;">${fv4}</span>`;
		}

		return default_formatter(value, row, column, data);
	},

	// ── ON LOAD ───────────────────────────────────────────────────────────────

	onload: function (_report) {
		// Full-width layout
		setTimeout(function () {
			$(".layout-main-section-wrapper").css("max-width", "none");
			$(".layout-main-section").css("max-width", "none");
			$(".page-content .container").first().css({ "max-width": "none", "width": "100%" });
		}, 200);

		// PDF export toolbar button
		frappe.query_report.page.add_inner_button(__("🖨️ Export PDF"), function () {
			_pcr_export_pdf();
		});
	},
};


// ── PDF EXPORT ────────────────────────────────────────────────────────────────

function _pcr_export_pdf() {
	var data = frappe.query_report.data || [];
	if (!data.length) {
		frappe.msgprint(__("No data to export. Run the report first."));
		return;
	}

	var company   = frappe.query_report.get_filter_value("company");
	var from_date = frappe.query_report.get_filter_value("from_date");
	var to_date   = frappe.query_report.get_filter_value("to_date");

	// Count invoices (exclude headers/totals/blanks)
	var inv_count = data.filter(function (r) { return r._row_type === "invoice"; }).length;
	if (!inv_count) {
		frappe.msgprint(__("No invoices found in report data.")); return;
	}

	var html = _pcr_build_pdf_html(data, company, from_date, to_date);
	_pcr_open_html(html);
}

function _pcr_open_html(html) {
	var blob = new Blob([html], { type: "text/html;charset=utf-8;" });
	var url  = URL.createObjectURL(blob);
	window.open(url, "_blank");
	setTimeout(function () { URL.revokeObjectURL(url); }, 12000);
}


// ── PDF BUILDER ───────────────────────────────────────────────────────────────

function _pcr_build_pdf_html(rows, company, from_date, to_date) {
	var grand_row  = rows.find(function (r) { return r._row_type === "grand_total"; }) || {};
	var today_str  = _pcr_date(frappe.datetime.get_today());
	var from_disp  = _pcr_date(from_date);
	var to_disp    = _pcr_date(to_date);

	// ── Derive period label from to_date ──────────────────────────────────────
	var period_label = "";
	if (to_date) {
		var td = new Date(to_date);
		var _MONTHS = ["January","February","March","April","May","June",
			"July","August","September","October","November","December"];
		period_label = _MONTHS[td.getMonth()] + " " + td.getFullYear();
	}

	// ── Group rows by customer section ────────────────────────────────────────
	var sections = [];
	var cur_sec  = null;

	rows.forEach(function (r) {
		if (r._row_type === "customer_header") {
			cur_sec = { header: r, detail: [] };
			sections.push(cur_sec);
		} else if (cur_sec && r._row_type !== "blank" && r._row_type !== "grand_total") {
			cur_sec.detail.push(r);
		}
	});

	// ── Build per-customer HTML sections ──────────────────────────────────────
	var cust_sections_html = sections.map(function (sec) {
		var cust_name = sec.header.particular || sec.header._customer;
		var opening_row    = sec.detail.find(function (r) { return r._row_type === "opening"; });
		var invoice_rows   = sec.detail.filter(function (r) { return r._row_type === "invoice"; });
		var cn_rows        = sec.detail.filter(function (r) { return r._row_type === "credit_note"; });
		var total_row      = sec.detail.find(function (r) { return r._row_type === "customer_total"; }) || {};

		var closing = flt(total_row.outstanding || 0, 2);
		var all_clear = closing === 0;

		// Opening box
		var opening_html = "";
		if (opening_row && flt(opening_row.outstanding) > 0) {
			opening_html = `<div class="opening-box">
				<div class="opening-box-label"> Opening Outstanding (before ${from_disp})</div>
				<div class="opening-box-amount">${_pcr_inr(flt(opening_row.outstanding))}</div>
			</div>`;
		}

		// Invoice table body
		var inv_tbody = invoice_rows.map(function (inv) {
			var inv_amt  = flt(inv.invoice_amount, 2);
			var paid_amt = flt(inv.paid_amount,    2);
			var out_amt  = flt(inv.outstanding,    2);
			var out_col  = out_amt > 0 ? "#dc2626" : "#16a34a";
			var out_icon = out_amt === 0 ? "✓ " : "";
			return `<tr>
				<td>${inv._invoice}</td>
				<td>${_pcr_date(inv.posting_date)}</td>
				<td>${_pcr_inr(inv_amt)}</td>
				<td style="color:#16a34a;">${_pcr_inr(paid_amt)}</td>
				<td style="color:${out_col};font-weight:${out_amt > 0 ? '600' : 'normal'};">
					${out_icon}${_pcr_inr(out_amt)}
				</td>
				<td>${_pcr_status_badge(inv.status)}</td>
			</tr>`;
		}).join("");

		// Credit note rows
		var cn_section = "";
		if (cn_rows.length) {
			var cn_tbody = cn_rows.map(function (cn) {
				return `<tr class="cn-row">
					<td>${cn._invoice}</td>
					<td>${_pcr_date(cn.posting_date)}</td>
					<td style="color:#d97706;font-weight:600;">(${_pcr_inr(flt(cn.credit_note))})</td>
				</tr>`;
			}).join("");
			cn_section = `
			<div class="cn-hdr">🔁 Credit Notes</div>
			<table><thead><tr>
				<th style="text-align:left;">Credit Note No</th>
				<th style="text-align:left;">Date</th>
				<th>Credit Amount</th>
			</tr></thead><tbody>${cn_tbody}</tbody></table>`;
		}

		// Customer summary bar
		var out_bg  = all_clear ? "#f0fdf4" : "#fef2f2";
		var out_bd  = all_clear ? "#22c55e" : "#dc2626";
		var out_clr = all_clear ? "#15803d" : "#dc2626";
		var cust_summary = `
		<div style="display:flex;justify-content:space-between;align-items:center;
			background:${out_bg};border:1.5px solid ${out_bd};border-radius:4px;
			padding:8px 14px;margin-top:8px;">
			<div style="font-size:11.5px;font-weight:700;color:${out_clr};">
				${all_clear ? "✅ Fully Cleared" : "Closing Outstanding"}
			</div>
			<div style="font-size:17px;font-weight:700;color:${out_clr};">${_pcr_inr(closing)}</div>
		</div>`;

		var invoice_part = "";
		if (invoice_rows.length) {
			invoice_part = `<table><thead><tr>
				<th style="text-align:left;">Invoice No</th>
				<th style="text-align:left;">Date</th>
				<th>Invoice Amount</th><th>Paid Amount</th><th>Outstanding</th><th>Status</th>
			</tr></thead><tbody>${inv_tbody}</tbody></table>`;
		}

		return `<div class="month-sec">
			<div class="month-hdr">${cust_name}</div>
			${opening_html}
			${invoice_part}
			${cn_section}
			${cust_summary}
		</div>`;
	}).join("");

	// ── Grand outstanding box ─────────────────────────────────────────────────
	var grand_out = flt(grand_row.outstanding || 0, 2);
	var grand_html = `
	<div class="out-box">
		<div class="out-box-label">Total Outstanding Balance as on ${to_disp}</div>
		<div class="out-box-amount">${_pcr_inr(grand_out)}</div>
	</div>`;

	// ── Grand summary table ───────────────────────────────────────────────────
	var grand_inv  = flt(grand_row.invoice_amount || 0, 2);
	var grand_paid = flt(grand_row.paid_amount    || 0, 2);
	var grand_cn   = flt(grand_row.credit_note    || 0, 2);

	var grand_sum_rows = `<tr><td>Total Invoiced</td><td>${_pcr_inr(grand_inv)}</td></tr>`;
	if (grand_paid > 0)
		grand_sum_rows += `<tr><td style="color:#16a34a;">(-) Paid / Collected</td><td style="color:#16a34a;">(${_pcr_inr(grand_paid)})</td></tr>`;
	if (grand_cn > 0)
		grand_sum_rows += `<tr><td style="color:#d97706;">(-) Credit Notes</td><td style="color:#d97706;">(${_pcr_inr(grand_cn)})</td></tr>`;
	grand_sum_rows += `<tr class="tot-row"><td>Total Outstanding</td><td class="neg">${_pcr_inr(grand_out)}</td></tr>`;

	var grand_summary = `
	<div class="grand-box">
		<table class="summary-tbl"><tbody>${grand_sum_rows}</tbody></table>
	</div>`;

	return `<!DOCTYPE html><html><head>
	<meta charset="UTF-8">
	<title>${company} — Payment Collection Report — ${period_label}</title>
	<style>${_pcr_css()}</style>
	</head><body><div class="page">
	<div class="hdr">
		<div class="hdr-company">${company}</div>
		<div class="hdr-title">Payment Collection Report</div>
		<div class="hdr-meta">
			<span>Period: <strong>${from_disp} – ${to_disp}</strong></span>
			<span>${period_label}</span>
			<span>Printed: <strong>${today_str}</strong></span>
		</div>
	</div>
	${grand_html}
	${cust_sections_html}
	${grand_summary}
	<div class="footer">
		<span>${company} · Payment Collection Report · ${period_label}</span>
		<span>Printed on ${today_str}</span>
	</div>
	<div class="print-wrap">
		<button class="print-btn" onclick="window.print()">🖨️&nbsp; Print / Save as PDF</button>
	</div>
	</div></body></html>`;
}


// ── PDF HELPERS ───────────────────────────────────────────────────────────────

function _pcr_inr(v) {
	var n = parseFloat(v) || 0;
	return "₹ " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _pcr_date(s) {
	if (!s) return "";
	var d = new Date(s);
	if (isNaN(d.getTime())) return s;
	return String(d.getDate()).padStart(2, "0") + "/" +
		String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
}

function _pcr_status_badge(status) {
	if (!status) return "";
	var map = {
		"Paid":        { bg: "#d1fae5", color: "#065f46" },
		"Unpaid":      { bg: "#fef2f2", color: "#991b1b" },
		"Overdue":     { bg: "#fff7ed", color: "#92400e" },
		"Partly Paid": { bg: "#eff6ff", color: "#1e40af" },
		"Draft":       { bg: "#f9fafb", color: "#374151" },
	};
	var b = map[status] || { bg: "#f9fafb", color: "#374151" };
	return `<span style="background:${b.bg};color:${b.color};border-radius:8px;
		padding:2px 8px;font-size:10px;font-weight:600;white-space:nowrap;">${status}</span>`;
}

function _pcr_css() {
	return `
	* { box-sizing:border-box; margin:0; padding:0; }
	body { font-family:Arial,Helvetica,sans-serif; background:#f3f4f6; color:#111827; padding:24px; font-size:12.5px; }
	.page { background:#fff; max-width:980px; margin:0 auto; padding:40px 48px;
	        box-shadow:0 4px 24px rgba(0,0,0,.12); border-radius:4px; border-top:5px solid #1e3a5f; }
	.hdr { text-align:center; border-bottom:2px solid #1e3a5f; padding-bottom:16px; margin-bottom:22px; }
	.hdr-company { font-size:20px; font-weight:700; color:#1e3a5f; letter-spacing:2px; text-transform:uppercase; }
	.hdr-title   { font-size:12px; color:#6b7280; margin-top:4px; letter-spacing:1.2px; text-transform:uppercase; }
	.hdr-meta    { display:flex; justify-content:space-between; margin-top:12px; font-size:12px; color:#374151; }
	.hdr-meta strong { color:#1e3a5f; }
	.out-box { display:flex; justify-content:space-between; align-items:center;
	           background:#fef2f2; border:2px solid #dc2626; border-radius:6px;
	           padding:14px 20px; margin-bottom:24px; }
	.out-box-label  { font-size:13px; font-weight:700; color:#7f1d1d; }
	.out-box-amount { font-size:26px; font-weight:700; color:#dc2626; }
	.opening-box { display:flex; justify-content:space-between; align-items:center;
	               background:#fff7ed; border:2px solid #f59e0b; border-radius:6px;
	               padding:10px 16px; margin-bottom:10px; }
	.opening-box-label  { font-size:12px; font-weight:700; color:#92400e; }
	.opening-box-amount { font-size:17px; font-weight:700; color:#d97706; }
	.month-sec { margin-bottom:24px; break-inside:avoid; page-break-inside:avoid; }
	.month-hdr { background:#1e3a5f; color:#fff; padding:8px 14px;
	             font-weight:700; font-size:13px; border-radius:4px 4px 0 0; letter-spacing:.5px; }
	.cn-hdr    { background:#92400e; color:#fff; padding:5px 14px;
	             font-weight:600; font-size:11.5px; margin-top:8px; border-radius:4px 4px 0 0; }
	table { width:100%; border-collapse:collapse; font-size:12px; }
	thead tr th { background:#f1f5f9; padding:8px 10px; text-align:right;
	              font-size:11px; font-weight:700; color:#475569;
	              border-bottom:1.5px solid #cbd5e1; text-transform:uppercase; letter-spacing:.4px; }
	thead tr th:first-child, thead tr th:nth-child(2) { text-align:left; }
	tbody tr td { padding:7px 10px; text-align:right; border-bottom:1px solid #f1f5f9; color:#374151; }
	tbody tr td:first-child { text-align:left; color:#1a56db; font-weight:600; }
	tbody tr td:nth-child(2) { text-align:left; color:#4b5563; }
	.cn-row td:first-child { color:#d97706; }
	.tot-row td { background:#fef3c7; border-top:2px solid #f59e0b; font-weight:700; padding:9px 10px; }
	.tot-row td:first-child { color:#92400e; }
	.neg  { color:#dc2626; font-size:13px; }
	.zero { color:#16a34a; font-size:13px; }
	.grand-box { border:2px solid #1e3a5f; border-radius:6px; background:#eff6ff;
	             padding:16px 20px; margin-top:24px; }
	.summary-tbl { width:100%; font-size:12.5px; }
	.summary-tbl td { padding:5px 10px; }
	.summary-tbl td:last-child { text-align:right; font-weight:600; }
	.footer { margin-top:28px; border-top:1px solid #e5e7eb; padding-top:12px;
	          display:flex; justify-content:space-between; font-size:11px; color:#9ca3af; }
	.print-wrap { text-align:center; margin-top:20px; }
	.print-btn { background:#1e3a5f; color:#fff; border:none; padding:10px 36px;
	             font-size:13px; border-radius:4px; cursor:pointer; font-weight:700; letter-spacing:.5px; }
	.print-btn:hover { background:#2d4a7f; }
	@media print {
		* { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
		body { background:#fff; padding:0; }
		.page { box-shadow:none; padding:20px 28px; }
		.print-wrap { display:none; }
	}`;
}
