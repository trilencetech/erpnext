// Copyright (c) 2026, TriLence Tech and contributors
// Opening Stock Audit — Script Report

frappe.query_reports["Opening Stock Audit"] = {

	// ── FILTERS ──────────────────────────────────────────────────────────────

	filters: [
		{
			label: __("Company"),
			fieldname: "company",
			fieldtype: "Link",
			options: "Company",
			reqd: 1,
			default: frappe.defaults.get_default("company"),
			width: "200px",
		},
		{
			label: __("From Date"),
			fieldname: "from_date",
			fieldtype: "Date",
			reqd: 1,
			default: frappe.datetime.get_today(),
			width: "140px",
		},
		{
			label: __("To Date"),
			fieldname: "to_date",
			fieldtype: "Date",
			reqd: 1,
			default: frappe.datetime.get_today(),
			width: "140px",
		},
		{
			label: __("Stock Entry Type"),
			fieldname: "stock_entry_type",
			fieldtype: "Select",
			options: "\nOpening Stock\nMaterial Receipt\nMaterial Transfer",
			width: "180px",
		},
	],

	// ── FORMATTER ────────────────────────────────────────────────────────────

	formatter: function (value, row, column, data, default_formatter) {
		if (!data) return default_formatter(value, row, column, data);

		var multi    = (data.entry_count || 1) > 1;
		var is_sold  = !!data.is_sold;
		var rtype    = data.row_type;
		var formatted;

		// ── Per-row-type cell content ─────────────────────────────────────────

		if (rtype === "group_header") {
			value = default_formatter(value, row, column, data);

			if (column.fieldname === "item_code") {
				var color = multi ? "#92400e" : "#064e3b";
				formatted = `<strong style="color:${color};font-size:12px;">${value}</strong>`;

			} else if (column.fieldname === "item_group") {
				var badge = multi
					? `<span style="display:inline-block;background:#fef3c7;color:#92400e;
					   border:1px solid #fbbf24;border-radius:10px;padding:1px 8px;
					   font-size:10px;font-weight:700;margin-left:6px;">
					   ⚠ ${data.entry_count} entries</span>`
					: `<span style="display:inline-block;background:#d1fae5;color:#064e3b;
					   border:1px solid #6ee7b7;border-radius:10px;padding:1px 8px;
					   font-size:10px;font-weight:600;margin-left:6px;">✓ 1 entry</span>`;
				formatted = `<span>${value}</span>${badge}`;

			} else {
				formatted = `<strong>${value}</strong>`;
			}

		} else if (rtype === "subtotal") {
			value = default_formatter(value, row, column, data);
			if (multi && column.fieldname === "qty") {
				formatted = `<strong style="color:#92400e;">${value}</strong>`;
			} else if (multi && column.fieldname === "stock_entry") {
				formatted = `<span style="color:#92400e;font-style:italic;">${value}</span>`;
			} else {
				formatted = `<strong>${value}</strong>`;
			}

		} else if (rtype === "grand_total") {
			value = default_formatter(value, row, column, data);
			formatted = `<strong style="color:#1a3a6a;">${value}</strong>`;

		} else {
			// data rows
			value = default_formatter(value, row, column, data);

			if (multi && column.fieldname === "qty") {
				formatted = `<strong style="color:#b45309;">${value}</strong>`;
			} else if (column.fieldname === "stock_entry" && data.stock_entry) {
				formatted = `<a href="/app/stock-entry/${data.stock_entry}" target="_blank"
					style="color:#1a56db;font-weight:600;text-decoration:none;"
					onmouseover="this.style.textDecoration='underline'"
					onmouseout="this.style.textDecoration='none'">
					${data.stock_entry}
				</a>`;
			} else {
				formatted = value;
			}
		}

		// ── "Sold" column badge ───────────────────────────────────────────────
		if (column.fieldname === "sold" && value === "Yes") {
			formatted = `<span style="display:inline-block;background:#fecaca;color:#991b1b;
				border:1px solid #f87171;border-radius:10px;padding:1px 10px;
				font-size:11px;font-weight:700;">✦ Yes</span>`;
		}

		// ── Sold highlight — red full-cell overlay ────────────────────────────
		// Applied to group_header / data / subtotal rows whose item_id was found
		// in a submitted Delivery Note. Grand total rows are never highlighted.
		if (is_sold && rtype !== "grand_total") {
			return `<span style="display:block;background:#fee2e2;color:inherit;
				margin:-50px;padding:50px;line-height:1.5;">${formatted}</span>`;
		}

		return formatted;
	},

	// ── ON LOAD ──────────────────────────────────────────────────────────────

	onload: function (report) {
		// Compare with external Excel button
		report.page.add_inner_button(__("Compare Excel"), function () {
			var filters = report.get_values();
			if (!filters || !filters.company) {
				frappe.msgprint(__("Please select a Company and date range before comparing."));
				return;
			}

			var input    = document.createElement("input");
			input.type   = "file";
			input.accept = ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

			input.onchange = function (e) {
				var file = e.target.files[0];
				if (!file) return;

				var reader    = new FileReader();
				reader.onload = function (evt) {
					var b64 = evt.target.result.split(",")[1];

					frappe.call({
						method: "erpnext.stock.report.opening_stock_audit.opening_stock_audit.get_diff_report_html",
						args:   { file_data: b64, filters: JSON.stringify(filters) },
						freeze: true,
						freeze_message: __("Comparing external Excel with system data…"),
						callback: function (r) {
							if (!r.message) return;
							var blob = new Blob([r.message], { type: "text/html; charset=utf-8" });
							var url  = URL.createObjectURL(blob);
							var win  = window.open(url, "_blank");
							win && win.focus();
						},
					});
				};
				reader.readAsDataURL(file);
			};

			input.click();
		});

		// Export diff report as Excel
		report.page.add_inner_button(__("Export Excel"), function () {
			var filters = report.get_values();
			if (!filters || !filters.company) {
				frappe.msgprint(__("Please select a Company and date range before exporting."));
				return;
			}

			var input    = document.createElement("input");
			input.type   = "file";
			input.accept = ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

			input.onchange = function (e) {
				var file = e.target.files[0];
				if (!file) return;

				var reader    = new FileReader();
				reader.onload = function (evt) {
					var b64 = evt.target.result.split(",")[1];

					frappe.call({
						method: "erpnext.stock.report.opening_stock_audit.opening_stock_audit.get_diff_excel",
						args:   { file_data: b64, filters: JSON.stringify(filters) },
						freeze: true,
						freeze_message: __("Building Excel diff report…"),
						callback: function (r) {
							if (!r.message) return;
							var bytes = atob(r.message.data);
							var arr   = new Uint8Array(bytes.length);
							for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
							var blob = new Blob([arr], {
								type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
							});
							var url  = URL.createObjectURL(blob);
							var a    = document.createElement("a");
							a.href     = url;
							a.download = r.message.filename;
							document.body.appendChild(a);
							a.click();
							document.body.removeChild(a);
							URL.revokeObjectURL(url);
						},
					});
				};
				reader.readAsDataURL(file);
			};

			input.click();
		});

		// PDF → Excel upload-and-convert button
		report.page.add_inner_button(__("PDF → Excel"), function () {
			var input    = document.createElement("input");
			input.type   = "file";
			input.accept = ".pdf,application/pdf";

			input.onchange = function (e) {
				var file = e.target.files[0];
				if (!file) return;

				var reader    = new FileReader();
				reader.onload = function (evt) {
					var b64 = evt.target.result.split(",")[1];

					frappe.call({
						method: "erpnext.stock.report.opening_stock_audit.opening_stock_audit.pdf_to_excel",
						args:   { file_data: b64, file_name: file.name },
						freeze: true,
						freeze_message: __("Converting PDF to Excel…"),
						callback: function (r) {
							if (!r.message) return;

							var bytes = atob(r.message.data);
							var arr   = new Uint8Array(bytes.length);
							for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);

							var blob = new Blob([arr], {
								type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
							});
							var url  = URL.createObjectURL(blob);
							var a    = document.createElement("a");
							a.href     = url;
							a.download = r.message.filename;
							document.body.appendChild(a);
							a.click();
							document.body.removeChild(a);
							URL.revokeObjectURL(url);
						},
					});
				};
				reader.readAsDataURL(file);
			};

			input.click();
		});

		// Print PDF button
		report.page.add_inner_button(__("Print PDF"), function () {
			var filters = report.get_values();
			if (!filters || !filters.company) {
				frappe.msgprint(__("Please select a Company before printing."));
				return;
			}

			frappe.call({
				method: "erpnext.stock.report.opening_stock_audit.opening_stock_audit.get_print_html",
				args: { filters: JSON.stringify(filters) },
				freeze: true,
				freeze_message: __("Building audit report…"),
				callback: function (r) {
					if (!r.message) return;
					var blob = new Blob([r.message], { type: "text/html; charset=utf-8" });
					var url  = URL.createObjectURL(blob);
					var win  = window.open(url, "_blank");
					win.focus();
					win.addEventListener("load", function () {
						setTimeout(function () {
							win.print();
							URL.revokeObjectURL(url);
						}, 400);
					});
				},
			});
		});
	},
};
