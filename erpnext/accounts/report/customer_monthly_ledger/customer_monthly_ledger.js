// Copyright (c) 2026, TriLence Tech and contributors
// Customer Monthly Ledger — Script Report
// Month-wise outstanding with invoice drilldown dialog

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

	// ── ROW/CELL FORMATTER ───────────────────────────────────────────────────

	formatter: function (value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);

		if (!data) return value;

		// ── Top summary row ───────────────────────────────────────────────
		if (data._row_type === "total") {
			if (column.fieldname === "period") {
				return `<span style="
					color: #1a56db;
					font-weight: 700;
					font-size: 13.5px;
					letter-spacing: 0.2px;
				">${value}</span>`;
			}
			if (column.fieldname === "outstanding") {
				return `<span style="
					color: #dc2626;
					font-weight: 700;
					font-size: 14px;
				">${value}</span>`;
			}
			return `<span style="font-weight: 700; color: #1a56db;">${value}</span>`;
		}

		// ── Month rows ───────────────────────────────────────────────────
		if (data._row_type === "month") {
			if (column.fieldname === "period") {
				// Clickable month label with drill-down icon
				return `<span
					class="cml-month-link"
					style="
						cursor: pointer;
						color: #1a56db;
						font-weight: 600;
						text-decoration: underline;
						text-underline-offset: 3px;
					"
					data-month-start="${data.month_start}"
					data-month-end="${data.month_end}"
					data-month-label="${data.period}"
				>${data.period}&nbsp;&nbsp;<i class="fa fa-search-plus" style="font-size: 11px; opacity: 0.65;"></i></span>`;
			}

			if (column.fieldname === "outstanding") {
				if (flt(data.outstanding) > 0) {
					return `<span style="color: #e65100; font-weight: 600;">${value}</span>`;
				}
				if (flt(data.outstanding) === 0) {
					return `<span style="color: #16a34a; font-weight: 600;">${value}</span>`;
				}
			}
		}

		return value;
	},

	// ── ON LOAD ──────────────────────────────────────────────────────────────

	onload: function (report) {
		// Delegate click handler for month drill-down links
		$(report.wrapper).on("click", ".cml-month-link", function () {
			var month_start = $(this).data("month-start");
			var month_end = $(this).data("month-end");
			var month_label = $(this).data("month-label");
			var customer = frappe.query_report.get_filter_value("customer");
			var company = frappe.query_report.get_filter_value("company");

			if (!customer) {
				frappe.msgprint(__("Please select a Customer first."));
				return;
			}

			_load_month_drilldown(customer, company, month_start, month_end, month_label);
		});
	},
};


// ── DRILLDOWN LOADER ─────────────────────────────────────────────────────────

function _load_month_drilldown(customer, company, month_start, month_end, month_label) {
	frappe.call({
		method: "erpnext.accounts.report.customer_monthly_ledger.customer_monthly_ledger.get_month_invoices",
		args: {
			customer: customer,
			company: company,
			month_start: month_start,
			month_end: month_end,
		},
		freeze: true,
		freeze_message: __("Loading invoices for {0}…", [month_label]),
		callback: function (r) {
			if (!r.message || r.message.length === 0) {
				frappe.msgprint({
					title: __("No Invoices"),
					message: __("No invoices found for <b>{0}</b>.", [month_label]),
					indicator: "orange",
				});
				return;
			}
			_show_invoice_dialog(r.message, month_label, customer);
		},
	});
}


// ── DRILLDOWN DIALOG ─────────────────────────────────────────────────────────

function _show_invoice_dialog(invoices, month_label, customer) {
	var total_invoice = 0,
		total_paid = 0,
		total_outstanding = 0;

	// Build table rows
	var tbody = "";
	invoices.forEach(function (inv) {
		var inv_amt = flt(inv.invoice_amount, 2);
		var paid_amt = flt(inv.paid_amount, 2);
		var out_amt = flt(inv.outstanding, 2);

		total_invoice += inv_amt;
		total_paid += paid_amt;
		total_outstanding += out_amt;

		var out_color = out_amt > 0 ? "#dc2626" : "#16a34a";
		var out_icon = out_amt > 0 ? "⏳" : "✓";
		var out_weight = out_amt > 0 ? "600" : "normal";

		tbody += `
			<tr style="border-bottom: 1px solid #f3f4f6; transition: background 0.15s;"
				onmouseover="this.style.background='#f9fafb'"
				onmouseout="this.style.background=''"
			>
				<td style="padding: 9px 12px; vertical-align: middle;">
					<a href="/app/sales-invoice/${inv.sales_invoice}"
					   target="_blank"
					   style="
					   		color: #1a56db;
					   		font-weight: 600;
					   		text-decoration: none;
					   		font-size: 12.5px;
					   "
					   title="Open Invoice"
					>${inv.sales_invoice}</a>
				</td>
				<td style="padding: 9px 12px; vertical-align: middle; color: #4b5563; font-size: 12.5px;">
					${frappe.datetime.str_to_user(inv.posting_date)}
				</td>
				<td style="padding: 9px 12px; text-align: right; vertical-align: middle; font-size: 12.5px;">
					${_fmt(inv_amt)}
				</td>
				<td style="padding: 9px 12px; text-align: right; vertical-align: middle; color: #16a34a; font-size: 12.5px;">
					${_fmt(paid_amt)}
				</td>
				<td style="
					padding: 9px 12px;
					text-align: right;
					vertical-align: middle;
					color: ${out_color};
					font-weight: ${out_weight};
					font-size: 12.5px;
				">
					${out_icon} ${_fmt(out_amt)}
				</td>
			</tr>`;
	});

	// Total outstanding row (amber/yellow highlight)
	var all_clear = total_outstanding === 0;
	tbody += `
		<tr style="
			background: ${all_clear ? "linear-gradient(135deg,#d1fae5,#a7f3d0)" : "linear-gradient(135deg,#fef3c7,#fde68a)"};
			border-top: 2px solid ${all_clear ? "#34d399" : "#f59e0b"};
			font-weight: 700;
		">
			<td colspan="2" style="padding: 11px 12px; color: ${all_clear ? "#065f46" : "#92400e"}; font-size: 13px;">
				📊 &nbsp;${all_clear ? "All Cleared" : "Total Outstanding"} — ${month_label}
			</td>
			<td style="padding: 11px 12px; text-align: right; color: #1e40af; font-size: 13px;">
				${_fmt(total_invoice)}
			</td>
			<td style="padding: 11px 12px; text-align: right; color: #16a34a; font-size: 13px;">
				${_fmt(total_paid)}
			</td>
			<td style="
				padding: 11px 12px;
				text-align: right;
				color: ${all_clear ? "#065f46" : "#dc2626"};
				font-size: 14px;
			">
				${_fmt(total_outstanding)}
			</td>
		</tr>`;

	// Dialog header info bar
	var header_html = `
		<div style="
			display: flex;
			justify-content: space-between;
			align-items: center;
			background: #eff6ff;
			border: 1px solid #bfdbfe;
			border-radius: 6px;
			padding: 10px 14px;
			margin-bottom: 14px;
			font-size: 12.5px;
		">
			<div>
				<span style="color: #6b7280;">Customer:&nbsp;</span>
				<strong style="color: #1e40af;">${customer}</strong>
			</div>
			<div>
				<span style="color: #6b7280;">Period:&nbsp;</span>
				<strong style="color: #1a56db;">${month_label}</strong>
			</div>
			<div style="
				background: #dbeafe;
				color: #1e40af;
				border-radius: 12px;
				padding: 2px 10px;
				font-weight: 600;
				font-size: 11.5px;
			">
				${invoices.length} invoice${invoices.length === 1 ? "" : "s"}
			</div>
		</div>`;

	// Full table HTML
	var table_html = `
		<div style="max-height: 58vh; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 6px;">
			<table style="width: 100%; border-collapse: collapse; font-family: var(--font-stack);">
				<thead>
					<tr style="
						background: #f8fafc;
						border-bottom: 2px solid #e2e8f0;
						position: sticky;
						top: 0;
						z-index: 2;
					">
						<th style="padding: 10px 12px; text-align: left; font-size: 11.5px; font-weight: 600; color: #374151; white-space: nowrap; letter-spacing: 0.3px; text-transform: uppercase;">
							Invoice No
						</th>
						<th style="padding: 10px 12px; text-align: left; font-size: 11.5px; font-weight: 600; color: #374151; white-space: nowrap; letter-spacing: 0.3px; text-transform: uppercase;">
							Date
						</th>
						<th style="padding: 10px 12px; text-align: right; font-size: 11.5px; font-weight: 600; color: #374151; white-space: nowrap; letter-spacing: 0.3px; text-transform: uppercase;">
							Invoice Amount
						</th>
						<th style="padding: 10px 12px; text-align: right; font-size: 11.5px; font-weight: 600; color: #374151; white-space: nowrap; letter-spacing: 0.3px; text-transform: uppercase;">
							Paid Amount
						</th>
						<th style="padding: 10px 12px; text-align: right; font-size: 11.5px; font-weight: 600; color: #374151; white-space: nowrap; letter-spacing: 0.3px; text-transform: uppercase;">
							Outstanding
						</th>
					</tr>
				</thead>
				<tbody>${tbody}</tbody>
			</table>
		</div>`;

	var full_html = header_html + table_html;

	var d = new frappe.ui.Dialog({
		title: "📅 " + month_label + " — Invoice Details",
		size: "large",
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "invoice_table",
				options: full_html,
			},
		],
		primary_action_label: "📥 Export CSV",
		primary_action: function () {
			_export_csv(invoices, month_label);
		},
		secondary_action_label: __("Close"),
		secondary_action: function () {
			d.hide();
		},
	});

	d.show();
}


// ── CSV EXPORT ───────────────────────────────────────────────────────────────

function _export_csv(invoices, month_label) {
	var headers = ["Invoice No", "Invoice Date", "Invoice Amount", "Paid Amount", "Outstanding"];

	var rows = invoices.map(function (inv) {
		return [
			inv.sales_invoice,
			inv.posting_date,
			flt(inv.invoice_amount, 2),
			flt(inv.paid_amount, 2),
			flt(inv.outstanding, 2),
		];
	});

	// Append total row
	var t_inv = rows.reduce(function (s, r) { return s + r[2]; }, 0);
	var t_paid = rows.reduce(function (s, r) { return s + r[3]; }, 0);
	var t_out = rows.reduce(function (s, r) { return s + r[4]; }, 0);
	rows.push(["TOTAL", "", flt(t_inv, 2), flt(t_paid, 2), flt(t_out, 2)]);

	var csv = [headers]
		.concat(rows)
		.map(function (row) {
			return row
				.map(function (cell) {
					return '"' + String(cell === null || cell === undefined ? "" : cell).replace(/"/g, '""') + '"';
				})
				.join(",");
		})
		.join("\n");

	// UTF-8 BOM so Excel opens correctly
	var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
	var url = URL.createObjectURL(blob);
	var a = document.createElement("a");
	a.href = url;
	a.download = "Customer_Ledger_" + month_label.replace(/\s+/g, "_") + ".csv";
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);

	frappe.show_alert({
		message: __("{0} — CSV exported", [month_label]),
		indicator: "green",
	});
}


// ── HELPERS ──────────────────────────────────────────────────────────────────

function _fmt(value) {
	// Format as currency using the system default
	return frappe.format(flt(value, 2), { fieldtype: "Currency" });
}
