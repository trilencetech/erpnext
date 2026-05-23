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
			on_change: function () { frappe.query_report.refresh(); },
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

	// ── FORMATTER ────────────────────────────────────────────────────────────

	formatter: function (value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (!data) return value;

		// ── Top summary row ───────────────────────────────────────────────
		if (data._row_type === "total") {
			if (column.fieldname === "period")
				return `<span style="color:#1a56db;font-weight:700;font-size:13.5px;">${value}</span>`;
			if (column.fieldname === "outstanding")
				return `<span style="color:#dc2626;font-weight:700;font-size:14px;">${value}</span>`;
			if (column.fieldname === "credit_note" && flt(data.credit_note) > 0)
				return `<span style="color:#d97706;font-weight:700;">${value}</span>`;
			return `<span style="font-weight:700;color:#1a56db;">${value}</span>`;
		}

		// ── Month rows ────────────────────────────────────────────────────
		if (data._row_type === "month" && data.month_start) {
			if (column.fieldname === "period")
				return `<a class="cml-month-link" href="javascript:void(0)"
					style="cursor:pointer;color:#1a56db;font-weight:600;
					       text-decoration:underline;text-underline-offset:3px;"
					data-month-start="${data.month_start}"
					data-month-end="${data.month_end}"
					data-month-label="${data.period}"
				>${data.period}&nbsp;<i class="fa fa-search-plus" style="font-size:11px;opacity:.65;"></i></a>`;

			if (column.fieldname === "credit_note" && flt(data.credit_note) > 0)
				return `<span style="color:#d97706;font-weight:600;">${value}</span>`;

			if (column.fieldname === "outstanding") {
				var clr = flt(data.outstanding) > 0 ? "#e65100" : "#16a34a";
				return `<span style="color:${clr};font-weight:600;">${value}</span>`;
			}
		}

		return value;
	},

	// ── ON LOAD ───────────────────────────────────────────────────────────────

	onload: function (_report) {
		frappe.query_report.page.add_inner_button(__("🖨️ All Months PDF"), function () {
			_generate_all_months_pdf();
		});

		$(document)
			.off("click.cml_drilldown")
			.on("click.cml_drilldown", ".cml-month-link", function (e) {
				e.preventDefault();
				e.stopPropagation();

				var $el = $(this);
				var customer = frappe.query_report.get_filter_value("customer");
				var company = frappe.query_report.get_filter_value("company");
				if (!customer) { frappe.msgprint(__("Please select a Customer first.")); return; }

				_load_month_drilldown(
					customer, company,
					$el.data("month-start"), $el.data("month-end"), $el.data("month-label")
				);
			});
	},
};


// ── DRILLDOWN LOADER ──────────────────────────────────────────────────────────

function _load_month_drilldown(customer, company, month_start, month_end, month_label) {
	frappe.call({
		method: "erpnext.accounts.report.customer_monthly_ledger.customer_monthly_ledger.get_month_invoices",
		args: { customer, company, month_start, month_end },
		freeze: true,
		freeze_message: __("Loading invoices for {0}…", [month_label]),
		callback: function (r) {
			var data = r.message || {};
			var invoices = data.invoices || [];
			var credit_notes = data.credit_notes || [];
			if (!invoices.length && !credit_notes.length) {
				frappe.msgprint({
					title: __("No Invoices"),
					message: __("No invoices found for <b>{0}</b>.", [month_label]),
					indicator: "orange",
				});
				return;
			}
			_show_invoice_dialog(data, month_label, customer, company);
		},
	});
}


// ── DRILLDOWN DIALOG ──────────────────────────────────────────────────────────

function _show_invoice_dialog(data, month_label, customer, company) {
	var invoices = data.invoices || [];
	var credit_notes = data.credit_notes || [];
	var s = data.summary || {};

	var invoice_total = flt(s.invoice_total || 0, 2);
	var paid_cash = flt(s.paid_cash || 0, 2);
	var month_outstanding = flt(s.month_outstanding || 0, 2);
	var opening_outstanding = flt(s.opening_outstanding || 0, 2);
	var total_outstanding = flt(s.total_outstanding || 0, 2);

	// ── Opening Outstanding box ───────────────────────────────────────────────
	var opening_html = "";
	if (opening_outstanding > 0) {
		opening_html = `
		<div style="
			display:flex; justify-content:space-between; align-items:center;
			background:#fff7ed; border:2px solid #f59e0b; border-radius:6px;
			padding:12px 16px; margin-bottom:14px;
		">
			<div>
				<div style="font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.5px;">
					⏳ Opening Outstanding
				</div>
				<div style="font-size:11.5px;color:#78350f;margin-top:3px;">
					Unpaid invoices raised before <strong>${month_label}</strong>
				</div>
			</div>
			<div style="font-size:22px;font-weight:700;color:#d97706;">${_fmt(opening_outstanding)}</div>
		</div>`;
	}

	// ── Invoice rows ──────────────────────────────────────────────────────────
	var inv_tbody = "";
	invoices.forEach(function (inv) {
		var inv_amt  = flt(inv.invoice_amount, 2);
		var paid_amt = flt(inv.paid_amount,    2);
		var out_amt  = flt(inv.outstanding,    2);
		var out_col  = out_amt > 0 ? "#dc2626" : "#16a34a";
		var out_ico  = out_amt > 0 ? "⏳" : "✓";

		inv_tbody += `
		<tr style="border-bottom:1px solid #f3f4f6;"
			onmouseover="this.style.background='#f9fafb'"
			onmouseout="this.style.background=''">
			<td style="padding:8px 12px;">
				<a href="/app/sales-invoice/${inv.sales_invoice}" target="_blank"
				   style="color:#1a56db;font-weight:600;text-decoration:none;font-size:12.5px;"
				>${inv.sales_invoice}</a>
			</td>
			<td style="padding:8px 12px;color:#4b5563;font-size:12.5px;">
				${frappe.datetime.str_to_user(inv.posting_date)}
			</td>
			<td style="padding:8px 12px;text-align:right;font-size:12.5px;">${_fmt(inv_amt)}</td>
			<td style="padding:8px 12px;text-align:right;color:#16a34a;font-size:12.5px;">${_fmt(paid_amt)}</td>
			<td style="padding:8px 12px;text-align:right;color:${out_col};font-weight:${out_amt > 0 ? '600' : 'normal'};font-size:12.5px;">
				${out_ico} ${_fmt(out_amt)}
			</td>
		</tr>`;
	});

	// ── Credit note rows ──────────────────────────────────────────────────────
	var cn_section = "";
	if (credit_notes.length) {
		var cn_tbody = "";
		credit_notes.forEach(function (cn) {
			var ref = cn.return_against ? `against ${cn.return_against}` : "unlinked";
			cn_tbody += `
			<tr style="border-bottom:1px solid #fef3c7;background:#fffbeb;">
				<td style="padding:8px 12px;">
					<a href="/app/sales-invoice/${cn.sales_invoice}" target="_blank"
					   style="color:#d97706;font-weight:600;text-decoration:none;font-size:12.5px;"
					>${cn.sales_invoice}</a>
					<span style="font-size:11px;color:#92400e;margin-left:6px;">(${ref})</span>
				</td>
				<td style="padding:8px 12px;color:#78350f;font-size:12.5px;">
					${frappe.datetime.str_to_user(cn.posting_date)}
				</td>
				<td style="padding:8px 12px;text-align:right;color:#d97706;font-weight:600;font-size:12.5px;">
					(${_fmt(flt(cn.credit_amount, 2))})
				</td>
			</tr>`;
		});

		cn_section = `
		<div style="margin-top:12px;">
			<div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;
				letter-spacing:.5px;padding:6px 12px;background:#fef3c7;border-radius:4px 4px 0 0;">
				🔁 Credit Notes / Returns
			</div>
			<div style="border:1px solid #fde68a;border-top:none;border-radius:0 0 4px 4px;overflow:hidden;">
				<table style="width:100%;border-collapse:collapse;font-family:var(--font-stack);">
					<thead>
						<tr style="background:#fffbeb;">
							<th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:#92400e;text-transform:uppercase;letter-spacing:.3px;">Credit Note No</th>
							<th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:#92400e;text-transform:uppercase;letter-spacing:.3px;">Date</th>
							<th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:600;color:#92400e;text-transform:uppercase;letter-spacing:.3px;">Credit Amount</th>
						</tr>
					</thead>
					<tbody>${cn_tbody}</tbody>
				</table>
			</div>
		</div>`;
	}

	// ── Total / summary footer ────────────────────────────────────────────────
	var all_clear = total_outstanding === 0;
	var tot_bg = all_clear ? "linear-gradient(135deg,#d1fae5,#a7f3d0)" : "linear-gradient(135deg,#fef3c7,#fde68a)";
	var tot_border = all_clear ? "#34d399" : "#f59e0b";
	var tot_label = all_clear ? "#065f46" : "#92400e";
	var tot_out = all_clear ? "#065f46" : "#dc2626";

	// Build summary lines
	var sum_rows = `
		<tr>
			<td style="padding:6px 12px;font-size:12.5px;color:#374151;">Invoice Total</td>
			<td style="padding:6px 12px;text-align:right;font-size:12.5px;color:#374151;">${_fmt(invoice_total)}</td>
		</tr>`;

	if (paid_cash > 0) {
		sum_rows += `
		<tr>
			<td style="padding:6px 12px;font-size:12.5px;color:#16a34a;">(-) Paid / Adjusted <span style="font-size:10.5px;color:#6b7280;">(cash + credit notes applied)</span></td>
			<td style="padding:6px 12px;text-align:right;font-size:12.5px;color:#16a34a;">(${_fmt(paid_cash)})</td>
		</tr>`;
	}

	sum_rows += `
		<tr style="border-top:1px solid #e5e7eb;">
			<td style="padding:7px 12px;font-size:12.5px;font-weight:700;color:#374151;">Month Outstanding (${month_label})</td>
			<td style="padding:7px 12px;text-align:right;font-size:12.5px;font-weight:700;color:#e65100;">${_fmt(month_outstanding)}</td>
		</tr>`;

	if (opening_outstanding > 0) {
		sum_rows += `
		<tr>
			<td style="padding:6px 12px;font-size:12.5px;color:#d97706;">(+) Opening Outstanding (before ${month_label})</td>
			<td style="padding:6px 12px;text-align:right;font-size:12.5px;color:#d97706;">${_fmt(opening_outstanding)}</td>
		</tr>`;
	}

	var total_section = `
	<div style="margin-top:14px;background:${tot_bg};border:2px solid ${tot_border};border-radius:6px;overflow:hidden;">
		<table style="width:100%;border-collapse:collapse;">
			<tbody>${sum_rows}</tbody>
		</table>
		<div style="display:flex;justify-content:space-between;align-items:center;
			padding:10px 12px;border-top:2px solid ${tot_border};">
			<span style="font-size:13.5px;font-weight:700;color:${tot_label};">
				📊 ${all_clear ? "Fully Cleared" : "Total Outstanding"}
				${opening_outstanding > 0 ? "(Month + Opening)" : ""}
			</span>
			<span style="font-size:18px;font-weight:700;color:${tot_out};">${_fmt(total_outstanding)}</span>
		</div>
	</div>`;

	// ── Invoice table ─────────────────────────────────────────────────────────
	var header_bar = `
	<div style="display:flex;justify-content:space-between;align-items:center;
		background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;
		padding:10px 14px;margin-bottom:14px;font-size:12.5px;">
		<div><span style="color:#6b7280;">Customer:&nbsp;</span><strong style="color:#1e40af;">${customer}</strong></div>
		<div><span style="color:#6b7280;">Period:&nbsp;</span><strong style="color:#1a56db;">${month_label}</strong></div>
		<div style="background:#dbeafe;color:#1e40af;border-radius:12px;padding:2px 10px;font-weight:600;font-size:11.5px;">
			${invoices.length} invoice${invoices.length === 1 ? "" : "s"}${credit_notes.length ? " · " + credit_notes.length + " credit note" + (credit_notes.length === 1 ? "" : "s") : ""}
		</div>
	</div>`;

	var inv_table = `
	<div style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
		<table style="width:100%;border-collapse:collapse;font-family:var(--font-stack);">
			<thead>
				<tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
					<th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;">Invoice No</th>
					<th style="padding:9px 12px;text-align:left;font-size:11px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;">Date</th>
					<th style="padding:9px 12px;text-align:right;font-size:11px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;">Invoice Amount</th>
					<th style="padding:9px 12px;text-align:right;font-size:11px;font-weight:600;color:#16a34a;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;">Paid Amount</th>
					<th style="padding:9px 12px;text-align:right;font-size:11px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;">Outstanding</th>
				</tr>
			</thead>
			<tbody>${inv_tbody}</tbody>
		</table>
	</div>`;

	var full_html = `<div style="max-height:65vh;overflow-y:auto;padding-right:2px;">` +
		header_bar + opening_html + inv_table + cn_section + total_section +
		`</div>`;

	var d = new frappe.ui.Dialog({
		title: "📅 " + month_label + " — Invoice Details",
		size: "large",
		fields: [{ fieldtype: "HTML", fieldname: "invoice_table", options: full_html }],
		primary_action_label: "🖨️ Export PDF",
		primary_action: function () {
			_generate_month_pdf(data, month_label, customer, company);
		},
		secondary_action_label: "📥 Export CSV",
		secondary_action: function () {
			_export_csv(invoices, credit_notes, month_label);
		},
	});
	d.show();
}


// ── SINGLE MONTH PDF ──────────────────────────────────────────────────────────

function _generate_month_pdf(data, month_label, customer, company) {
	frappe.db.get_value("Customer", customer, "customer_name").then(function (r) {
		var cname = ((r || {}).message || {}).customer_name || customer;
		_open_html_tab(_build_single_month_pdf_html(data, month_label, cname, company));
	});
}


// ── ALL MONTHS PDF ────────────────────────────────────────────────────────────

function _generate_all_months_pdf() {
	var customer = frappe.query_report.get_filter_value("customer");
	var company = frappe.query_report.get_filter_value("company");
	var from_date = frappe.query_report.get_filter_value("from_date");
	var to_date = frappe.query_report.get_filter_value("to_date");

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
			var data = r.message || {};
			var invoices = data.invoices || [];
			var credit_notes = data.credit_notes || [];
			var month_summaries = data.month_summaries || {};
			if (!invoices.length && !credit_notes.length && !Object.keys(month_summaries).length) {
				frappe.msgprint(__("No invoices found for the selected period."));
				return;
			}
			frappe.db.get_value("Customer", customer, "customer_name").then(function (res) {
				var cname = ((res || {}).message || {}).customer_name || customer;
				_open_html_tab(_build_all_months_pdf_html(data, cname, company, from_date, to_date));
			});
		},
	});
}

// Open HTML in a new tab via Blob URL (avoids deprecated document.write)
function _open_html_tab(html) {
	var blob = new Blob([html], { type: "text/html;charset=utf-8;" });
	var url = URL.createObjectURL(blob);
	window.open(url, "_blank");
	setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
}


// ── PDF HELPERS ───────────────────────────────────────────────────────────────

var _MONTHS = ["January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December"];

function _pdf_inr(v) {
	var n = parseFloat(v) || 0;
	return "₹ " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _pdf_date(s) {
	if (!s) return "";
	var d = new Date(s);
	return String(d.getDate()).padStart(2, "0") + "/" +
		String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
}

function _pdf_css() {
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
	           padding:14px 20px; margin-bottom:28px; }
	.out-box-label  { font-size:13px; font-weight:700; color:#7f1d1d; }
	.out-box-amount { font-size:26px; font-weight:700; color:#dc2626; }
	.opening-box { display:flex; justify-content:space-between; align-items:center;
	               background:#fff7ed; border:2px solid #f59e0b; border-radius:6px;
	               padding:12px 18px; margin-bottom:16px; }
	.opening-box-label  { font-size:12px; font-weight:700; color:#92400e; }
	.opening-box-amount { font-size:18px; font-weight:700; color:#d97706; }
	.month-sec { margin-bottom:26px; break-inside:avoid; page-break-inside:avoid; }
	.month-hdr { background:#1e3a5f; color:#fff; padding:8px 14px;
	             font-weight:700; font-size:13px; border-radius:4px 4px 0 0; letter-spacing:.5px; }
	.cn-hdr    { background:#92400e; color:#fff; padding:6px 14px;
	             font-weight:600; font-size:12px; margin-top:8px; border-radius:4px 4px 0 0; }
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
	.grand-box { display:flex; justify-content:space-between; align-items:center;
	             border:2px solid #1e3a5f; border-radius:6px;
	             background:#eff6ff; padding:16px 20px; margin-top:24px; }
	.grand-box-label  { font-size:14px; font-weight:700; color:#1e3a5f; }
	.grand-box-amount { font-size:22px; font-weight:700; color:#dc2626; }
	.summary-tbl { width:100%; margin-top:10px; font-size:12.5px; }
	.summary-tbl td { padding:5px 10px; }
	.summary-tbl td:last-child { text-align:right; font-weight:600; }
	.footer { margin-top:28px; border-top:1px solid #e5e7eb; padding-top:12px;
	          display:flex; justify-content:space-between; font-size:11px; color:#9ca3af; }
	.print-wrap { text-align:center; margin-top:20px; }
	.print-btn { background:#1e3a5f; color:#fff; border:none; padding:10px 36px;
	             font-size:13px; border-radius:4px; cursor:pointer; font-weight:700; letter-spacing:.5px; }
	.print-btn:hover { background:#2d4a7f; }
	@media print {
		body { background:#fff; padding:0; }
		.page { box-shadow:none; padding:20px 28px; }
		.print-wrap { display:none; }
		.out-box, .opening-box, .grand-box, .month-hdr, .cn-hdr, .tot-row td {
			-webkit-print-color-adjust:exact; print-color-adjust:exact; }
	}`;
}

function _pdf_inv_rows(invoices) {
	return invoices.map(function (inv) {
		var inv_amt  = parseFloat(inv.invoice_amount) || 0;
		var paid_amt = parseFloat(inv.paid_amount)    || 0;
		var out_amt  = parseFloat(inv.outstanding)    || 0;
		var out_col  = out_amt > 0 ? "#dc2626" : "#16a34a";
		return `<tr>
			<td>${inv.sales_invoice}</td>
			<td>${_pdf_date(inv.posting_date)}</td>
			<td>${_pdf_inr(inv_amt)}</td>
			<td style="color:#16a34a;">${_pdf_inr(paid_amt)}</td>
			<td style="color:${out_col};font-weight:${out_amt > 0 ? '600' : 'normal'};">
				${out_amt > 0 ? "⏳ " : "✓ "}${_pdf_inr(out_amt)}
			</td>
		</tr>`;
	}).join("");
}

function _pdf_cn_rows(credit_notes) {
	if (!credit_notes.length) return "";
	var rows = credit_notes.map(function (cn) {
		var ref = cn.return_against ? "against " + cn.return_against : "unlinked";
		return `<tr class="cn-row">
			<td>${cn.sales_invoice} <span style="font-size:10px;color:#92400e;">(${ref})</span></td>
			<td>${_pdf_date(cn.posting_date)}</td>
			<td style="color:#d97706;font-weight:600;">(${_pdf_inr(parseFloat(cn.credit_amount) || 0)})</td>
		</tr>`;
	}).join("");
	return rows;
}

function _pdf_summary_section(s, month_label) {
	var rows = `<tr><td>Invoice Total</td><td>${_pdf_inr(s.invoice_total)}</td></tr>`;
	if (s.paid_cash > 0)
		rows += `<tr><td style="color:#16a34a;">(-) Paid / Adjusted <span style="font-size:10px;color:#6b7280;">(cash + credit applied)</span></td><td style="color:#16a34a;">(${_pdf_inr(s.paid_cash)})</td></tr>`;
	rows += `<tr style="border-top:1px solid #e5e7eb;">
		<td style="font-weight:700;color:#374151;">Month Outstanding (${month_label})</td>
		<td style="font-weight:700;color:#e65100;">${_pdf_inr(s.month_outstanding)}</td>
	</tr>`;
	if (s.opening_outstanding > 0)
		rows += `<tr>
			<td style="color:#d97706;">(+) Opening Outstanding</td>
			<td style="color:#d97706;">${_pdf_inr(s.opening_outstanding)}</td>
		</tr>`;
	return `<table class="summary-tbl"><tbody>${rows}</tbody></table>`;
}


// ── SINGLE MONTH PDF BUILDER ──────────────────────────────────────────────────

function _build_single_month_pdf_html(data, month_label, customer_name, company) {
	var invoices = data.invoices || [];
	var credit_notes = data.credit_notes || [];
	var s = data.summary || {};
	var today_str = _pdf_date(frappe.datetime.get_today());

	var cn_section = "";
	if (credit_notes.length) {
		cn_section = `
		<div class="cn-hdr">🔁 Credit Notes / Returns</div>
		<table><thead><tr>
			<th>Credit Note No</th><th>Date</th><th>Credit Amount</th>
		</tr></thead><tbody>${_pdf_cn_rows(credit_notes)}</tbody></table>`;
	}

	var opening_html = "";
	if (s.opening_outstanding > 0) {
		opening_html = `
		<div class="opening-box">
			<div class="opening-box-label">⏳ Opening Outstanding (before ${month_label})</div>
			<div class="opening-box-amount">${_pdf_inr(s.opening_outstanding)}</div>
		</div>`;
	}

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
		<div class="out-box-label">Total Outstanding — ${month_label}</div>
		<div class="out-box-amount">${_pdf_inr(s.total_outstanding || 0)}</div>
	</div>
	${opening_html}
	<div class="month-sec">
		<div class="month-hdr">Invoice Details — ${month_label}</div>
		<table><thead><tr>
			<th>Invoice No</th><th>Date</th><th>Invoice Amount</th><th>Paid Amount</th><th>Outstanding</th>
		</tr></thead><tbody>${_pdf_inv_rows(invoices)}</tbody></table>
		${cn_section}
	</div>
	${_pdf_summary_section(s, month_label)}
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

function _build_all_months_pdf_html(data, customer_name, company, from_date, to_date) {
	var all_invoices    = data.invoices       || [];
	var all_credit_notes = data.credit_notes  || [];
	var opening_out     = flt(data.opening_outstanding || 0, 2);
	var month_summaries = data.month_summaries || {};   // GL-based per-month summaries
	var total_summary   = data.total_summary   || {};   // GL-based grand totals

	// Build per-invoice/CN row groups keyed by YYYY-MM
	var groups = {};

	function _ensure_group(key_or_dt) {
		var d, key;
		if (/^\d{4}-\d{2}$/.test(key_or_dt)) {
			key = key_or_dt;
			d   = new Date(key + "-01");
		} else {
			d   = new Date(key_or_dt);
			key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
		}
		if (!groups[key]) {
			groups[key] = { label: _MONTHS[d.getMonth()] + " " + d.getFullYear(), invoices: [], credit_notes: [] };
		}
		return key;
	}

	all_invoices.forEach(function (inv) { groups[_ensure_group(inv.posting_date)].invoices.push(inv); });
	all_credit_notes.forEach(function (cn) { groups[_ensure_group(cn.posting_date)].credit_notes.push(cn); });

	// Ensure months with only GL movements (e.g. payment-only) are included
	Object.keys(month_summaries).forEach(function (key) { _ensure_group(key); });

	var sections = Object.keys(groups).sort().map(function (key) {
		var g  = groups[key];
		var ms = month_summaries[key] || {};

		// Use figures from backend — accurate to the report date range
		var m_inv  = flt(ms.invoice_total     || 0, 2);
		var m_paid = flt(ms.paid_cash         || 0, 2);
		var m_out  = flt(ms.month_outstanding || 0, 2);

		var inv_part = "";
		if (g.invoices.length) {
			inv_part = `<table><thead><tr>
				<th>Invoice No</th><th>Date</th><th>Invoice Amount</th><th>Paid Amount</th><th>Outstanding</th>
			</tr></thead><tbody>${_pdf_inv_rows(g.invoices)}</tbody></table>`;
		}

		var cn_part = "";
		if (g.credit_notes.length) {
			cn_part = `<div class="cn-hdr">🔁 Credit Notes</div>
			<table><thead><tr>
				<th>Credit Note No</th><th>Date</th><th>Credit Amount</th>
			</tr></thead><tbody>${_pdf_cn_rows(g.credit_notes)}</tbody></table>`;
		}

		var m_sum_rows = `<tr><td>Invoice Total</td><td>${_pdf_inr(m_inv)}</td></tr>`;
		if (m_paid > 0) m_sum_rows += `<tr><td style="color:#16a34a;">(-) Paid / Adjusted <span style="font-size:10px;color:#6b7280;">(cash + credit applied)</span></td><td style="color:#16a34a;">(${_pdf_inr(m_paid)})</td></tr>`;
		var cls = m_out === 0 ? "zero" : "neg";
		m_sum_rows += `<tr class="tot-row"><td>Month Outstanding</td><td class="${cls}">${_pdf_inr(m_out)}</td></tr>`;

		return `<div class="month-sec">
			<div class="month-hdr">${g.label}</div>
			${inv_part}
			${cn_part}
			<table class="summary-tbl" style="margin-top:6px;"><tbody>${m_sum_rows}</tbody></table>
		</div>`;
	}).join("");

	// Grand total comes from the GL closing balance (accurate, not a sum of per-month outstandings)
	var total_out = flt(total_summary.outstanding || 0, 2);
	var from_disp = _pdf_date(from_date) || from_date;
	var to_disp   = _pdf_date(to_date)   || to_date;
	var today_str = _pdf_date(frappe.datetime.get_today());

	var opening_html = "";
	if (opening_out > 0) {
		opening_html = `
		<div class="opening-box">
			<div class="opening-box-label">⏳ Opening Outstanding (before ${from_disp})</div>
			<div class="opening-box-amount">${_pdf_inr(opening_out)}</div>
		</div>`;
	}

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
		<div class="out-box-amount">${_pdf_inr(total_out)}</div>
	</div>
	${opening_html}
	${sections}
	<div class="grand-box">
		<div class="grand-box-label">Grand Total Outstanding (${from_disp} – ${to_disp})</div>
		<div class="grand-box-amount">${_pdf_inr(total_out)}</div>
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

function _export_csv(invoices, credit_notes, month_label) {
	var headers = ["Type", "Invoice/CN No", "Date", "Invoice Amount", "Paid Amount", "Credit Amount", "Outstanding"];

	var rows = invoices.map(function (inv) {
		return ["Invoice", inv.sales_invoice, inv.posting_date,
			flt(inv.invoice_amount, 2), flt(inv.paid_amount, 2), 0, flt(inv.outstanding, 2)];
	});

	credit_notes.forEach(function (cn) {
		rows.push(["Credit Note", cn.sales_invoice, cn.posting_date,
			0, 0, flt(cn.credit_amount, 2), 0]);
	});

	var t_inv = rows.reduce(function (s, r) { return s + r[3]; }, 0);
	var t_paid = rows.reduce(function (s, r) { return s + r[4]; }, 0);
	var t_cn   = rows.reduce(function (s, r) { return s + r[5]; }, 0);
	var t_out  = rows.reduce(function (s, r) { return s + r[6]; }, 0);
	rows.push(["TOTAL", "", "", flt(t_inv, 2), flt(t_paid, 2), flt(t_cn, 2), flt(t_out, 2)]);

	var csv = [headers].concat(rows).map(function (row) {
		return row.map(function (c) {
			return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"';
		}).join(",");
	}).join("\n");

	var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
	var url = URL.createObjectURL(blob);
	var a = document.createElement("a");
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
