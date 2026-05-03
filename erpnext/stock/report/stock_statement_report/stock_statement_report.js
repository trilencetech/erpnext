// Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.query_reports["Stock Statement Report"] = {
	onload: function (report) {
		// Auto-refresh on filter input
		const debounced_refresh = debounce(() => report.refresh(), 1500);
		report.filters.forEach(filter => {
			const $input = filter.$input;
			if ($input) $input.on("input", debounced_refresh);
		});

		// ── Print PDF button ────────────────────────────────────────────────
		report.page.add_inner_button(__("Print PDF"), function () {
			const filters = report.get_values();
			if (!filters || !filters.company) {
				frappe.msgprint(__("Please select a Company before printing."));
				return;
			}
			if (!filters.as_of_date) {
				frappe.msgprint(__("Please set the 'As Of Date' before printing."));
				return;
			}

			frappe.call({
				method: "erpnext.stock.report.stock_statement_report.stock_statement_report.get_print_html",
				args: { filters: JSON.stringify(filters) },
				freeze: true,
				freeze_message: __("Building report…"),
				callback: function (r) {
					if (!r.message) return;
					const blob = new Blob([r.message], { type: "text/html; charset=utf-8" });
					const url  = URL.createObjectURL(blob);
					const win  = window.open(url, "_blank");
					win.focus();
					// Revoke the blob URL after the window has loaded and printed
					win.addEventListener("load", function () {
						setTimeout(function () {
							win.print();
							URL.revokeObjectURL(url);
						}, 400);
					});
				}
			});
		});
	},

	"filters": [
		{
			label: __("Company"),
			fieldname: "company",
			fieldtype: "Link",
			options: "Company",
			reqd: 1,
			default: frappe.defaults.get_default("company"),
			width: "200px"
		},
		{
			label: __("As Of Date"),
			fieldname: "as_of_date",
			fieldtype: "Date",
			reqd: 1,
			default: frappe.datetime.get_today(),
			width: "150px"
		},
		{
			label: __("Item Group"),
			fieldname: "item_group",
			fieldtype: "Link",
			options: "Item Group",
			width: "180px"
		},
		{
			label: __("Item Name"),
			fieldname: "item_name",
			fieldtype: "Data",
			width: "200px"
		}
	],

	"formatter": function (value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (data && data.bold) {
			value = `<strong>${value}</strong>`;
		}
		return value;
	}
};

function debounce(fn, delay) {
	let timer = null;
	return function (...args) {
		clearTimeout(timer);
		timer = setTimeout(() => fn.apply(this, args), delay);
	};
}
