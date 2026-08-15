// Copyright (c) 2026, TriLence Tech and contributors
// Sales Invoice Register — Script Report

frappe.query_reports["Sales Invoice Register"] = {

	// ── FILTERS ──────────────────────────────────────────────────────────────

	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			reqd: 1,
			default: frappe.defaults.get_user_default("Company"),
			on_change: function () { frappe.query_report.refresh(); },
		},
		{
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
			on_change: function () { frappe.query_report.refresh(); },
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			reqd: 1,
			default: frappe.datetime.add_months(frappe.datetime.month_start(), -1),
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			reqd: 1,
			default: frappe.datetime.add_days(frappe.datetime.month_start(), -1),
		},
	],

	// ── FORMATTER ────────────────────────────────────────────────────────────

	formatter: function (value, row, column, data, default_formatter) {
		if (!data) return default_formatter(value, row, column, data);

		// Total row — handle BEFORE default_formatter so invoice_name doesn't become a link
		if (data._row_type === "total") {
			if (column.fieldname === "invoice_name")
				return `<span style="color:#1a56db;font-weight:700;">${value || ""}</span>`;
			var fv = default_formatter(value, row, column, data);
			if (column.fieldname === "grand_total")
				return `<span style="color:#1a56db;font-weight:700;">${fv}</span>`;
			return `<span style="font-weight:700;">${fv}</span>`;
		}

		value = default_formatter(value, row, column, data);

		// Invoice No — clickable link
		if (column.fieldname === "invoice_name" && data.invoice_name) {
			return `<a href="/app/sales-invoice/${data.invoice_name}" target="_blank"
				style="color:#1a56db;font-weight:600;text-decoration:none;"
				onmouseover="this.style.textDecoration='underline'"
				onmouseout="this.style.textDecoration='none'">
				${data.invoice_name}
			</a>`;
		}

		// Outstanding — red if > 0, green if cleared
		if (column.fieldname === "outstanding_amount" && data.outstanding_amount != null) {
			var out = flt(data.outstanding_amount);
			var clr = out > 0 ? "#dc2626" : "#16a34a";
			return `<span style="color:${clr};font-weight:${out > 0 ? '600' : 'normal'};">${value}</span>`;
		}

		// Status badge
		if (column.fieldname === "status" && data.status) {
			var badge_map = {
				"Paid": { bg: "#d1fae5", color: "#065f46", border: "#6ee7b7" },
				"Unpaid": { bg: "#fef2f2", color: "#991b1b", border: "#fca5a5" },
				"Overdue": { bg: "#fff7ed", color: "#92400e", border: "#fdba74" },
				"Partly Paid": { bg: "#eff6ff", color: "#1e40af", border: "#93c5fd" },
				"Draft": { bg: "#f9fafb", color: "#374151", border: "#d1d5db" },
			};
			var b = badge_map[data.status] || { bg: "#f9fafb", color: "#374151", border: "#d1d5db" };
			return `<span style="background:${b.bg};color:${b.color};border:1px solid ${b.border};
				border-radius:10px;padding:2px 10px;font-size:11px;font-weight:600;
				white-space:nowrap;">${data.status}</span>`;
		}

		// PDF button column
		if (column.fieldname === "_pdf" && data._name) {
			return `<button class="sir-pdf-btn btn btn-xs"
				data-invoice="${data._name}"
				style="background:#286cc6;color:#fff;border:none;padding:3px 10px;
				       border-radius:3px;cursor:pointer;font-size:11px;font-weight:600;
				       letter-spacing:.3px;white-space:nowrap;">
				🖨 PDF
			</button>`;
		}

		return value;
	},

	// ── ON LOAD ───────────────────────────────────────────────────────────────

	onload: function (_report) {
		// Full-width layout
		setTimeout(function () {
			$(".layout-main-section-wrapper").css("max-width", "none");
			$(".layout-main-section").css("max-width", "none");
			$(".page-content .container").first().css({ "max-width": "none", "width": "100%" });
		}, 200);

		// "Export All PDFs" toolbar button
		frappe.query_report.page.add_inner_button(__("🖨️ Export All PDFs"), function () {
			_sir_export_all_pdfs();
		});

		// "Export All PDFs (No BG)" toolbar button
		frappe.query_report.page.add_inner_button(__("🖨️ Export All PDFs (No BG)"), function () {
			_sir_export_all_pdfs_no_bg();
		});

		// Per-row PDF button click
		$(document)
			.off("click.sir_pdf")
			.on("click.sir_pdf", ".sir-pdf-btn", function () {
				var invoice = $(this).data("invoice");
				if (!invoice) return;
				_sir_open_invoice_pdf(invoice);
			});
	},
};


// ── INDIVIDUAL INVOICE PDF ────────────────────────────────────────────────────

function _sir_open_invoice_pdf(invoice_name) {
	var company = frappe.query_report.get_filter_value("company");
	if (!company) { frappe.msgprint(__("Please select a Company.")); return; }

	frappe.call({
		method: "erpnext.accounts.report.sales_invoice_register.sales_invoice_register.get_single_invoice_html",
		args: { invoice_name: invoice_name, company: company },
		freeze: true,
		freeze_message: __("Preparing invoice PDF…"),
		callback: function (r) {
			var res = r.message || {};
			if (!res.html) { frappe.msgprint(__("Could not generate PDF.")); return; }
			_sir_open_blob(res.html);
		},
	});
}

function _sir_open_blob(html) {
	var blob = new Blob([html], { type: "text/html;charset=utf-8;" });
	var url  = URL.createObjectURL(blob);
	window.open(url, "_blank");
	setTimeout(function () { URL.revokeObjectURL(url); }, 15000);
}


// ── BULK PDF (ALL INVOICES) ───────────────────────────────────────────────────

function _sir_export_all_pdfs_no_bg() {
	var company   = frappe.query_report.get_filter_value("company");
	var customer  = frappe.query_report.get_filter_value("customer");
	var from_date = frappe.query_report.get_filter_value("from_date");
	var to_date   = frappe.query_report.get_filter_value("to_date");

	if (!company || !from_date || !to_date) {
		frappe.msgprint(__("Please set Company, From Date and To Date, then run the report first."));
		return;
	}

	var row_count = (frappe.query_report.data || []).filter(function (r) { return r._name; }).length;
	if (row_count === 0) {
		frappe.msgprint(__("No invoices to export. Run the report first.")); return;
	}

	frappe.confirm(
		__("This will generate a combined PDF (no background) for {0} invoice(s). Continue?", [row_count]),
		function () {
			frappe.call({
				method: "erpnext.accounts.report.sales_invoice_register.sales_invoice_register.get_bulk_invoice_html_no_bg",
				args: { company, from_date, to_date, customer: customer || null },
				freeze: true,
				freeze_message: __("Generating PDF (no background) for {0} invoice(s)…", [row_count]),
				callback: function (r) {
					var res = r.message || {};
					if (!res.html) { frappe.msgprint(__("No data returned.")); return; }
					frappe.show_alert({
						message: __("✅ {0} invoices rendered using \"{1}\" — opening in new tab.", [res.count, res.print_format]),
						indicator: "green",
					}, 6);
					_sir_open_blob(res.html);
				},
			});
		}
	);
}

function _sir_export_all_pdfs() {
	var company = frappe.query_report.get_filter_value("company");
	var customer = frappe.query_report.get_filter_value("customer");
	var from_date = frappe.query_report.get_filter_value("from_date");
	var to_date = frappe.query_report.get_filter_value("to_date");

	if (!company || !from_date || !to_date) {
		frappe.msgprint(__("Please set Company, From Date and To Date, then run the report first."));
		return;
	}

	// Confirm if many invoices
	var row_count = (frappe.query_report.data || []).filter(function (r) {
		return r._name;
	}).length;

	if (row_count === 0) {
		frappe.msgprint(__("No invoices to export. Run the report first.")); return;
	}

	var confirm_msg = __("This will generate a combined PDF for {0} invoice(s). Continue?", [row_count]);
	frappe.confirm(confirm_msg, function () {
		frappe.call({
			method: "erpnext.accounts.report.sales_invoice_register.sales_invoice_register.get_bulk_invoice_html",
			args: { company, from_date, to_date, customer: customer || null },
			freeze: true,
			freeze_message: __("Generating PDF for {0} invoice(s)…", [row_count]),
			callback: function (r) {
				var res = r.message || {};
				if (!res.html) { frappe.msgprint(__("No data returned.")); return; }

				frappe.show_alert({
					message: __("✅ {0} invoices rendered using \"{1}\" — opening in new tab.", [res.count, res.print_format]),
					indicator: "green",
				}, 6);

				_sir_open_blob(res.html);
			},
		});
	});
}
