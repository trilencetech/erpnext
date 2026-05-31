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

		var multi = (data.entry_count || 1) > 1;

		// ── Group header row ─────────────────────────────────────────────────
		if (data.row_type === "group_header") {
			value = default_formatter(value, row, column, data);

			if (column.fieldname === "item_code") {
				var color = multi ? "#92400e" : "#064e3b";
				return `<strong style="color:${color};font-size:12px;">${value}</strong>`;
			}
			if (column.fieldname === "item_group") {
				var badge = multi
					? `<span style="display:inline-block;background:#fef3c7;color:#92400e;
					   border:1px solid #fbbf24;border-radius:10px;padding:1px 8px;
					   font-size:10px;font-weight:700;margin-left:6px;">
					   ⚠ ${data.entry_count} entries</span>`
					: `<span style="display:inline-block;background:#d1fae5;color:#064e3b;
					   border:1px solid #6ee7b7;border-radius:10px;padding:1px 8px;
					   font-size:10px;font-weight:600;margin-left:6px;">✓ 1 entry</span>`;
				return `<span>${value}</span>${badge}`;
			}
			return `<strong>${value}</strong>`;
		}

		// ── Subtotal row ─────────────────────────────────────────────────────
		if (data.row_type === "subtotal") {
			value = default_formatter(value, row, column, data);
			if (multi && column.fieldname === "qty") {
				return `<strong style="color:#92400e;">${value}</strong>`;
			}
			if (multi && column.fieldname === "stock_entry") {
				return `<span style="color:#92400e;font-style:italic;">${value}</span>`;
			}
			return `<strong>${value}</strong>`;
		}

		// ── Grand total row ───────────────────────────────────────────────────
		if (data.row_type === "grand_total") {
			value = default_formatter(value, row, column, data);
			return `<strong style="color:#1a3a6a;">${value}</strong>`;
		}

		// ── Data rows ─────────────────────────────────────────────────────────
		value = default_formatter(value, row, column, data);

		// Qty on a warning row — orange bold
		if (multi && column.fieldname === "qty") {
			return `<strong style="color:#b45309;">${value}</strong>`;
		}

		// Stock entry link — make it stand out as a clickable drill-down
		if (column.fieldname === "stock_entry" && data.stock_entry) {
			return `<a href="/app/stock-entry/${data.stock_entry}" target="_blank"
				style="color:#1a56db;font-weight:600;text-decoration:none;"
				onmouseover="this.style.textDecoration='underline'"
				onmouseout="this.style.textDecoration='none'">
				${data.stock_entry}
			</a>`;
		}

		return value;
	},

	// ── ON LOAD ───────────────────────────────────────────────────────────────

	onload: function (report) {
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
