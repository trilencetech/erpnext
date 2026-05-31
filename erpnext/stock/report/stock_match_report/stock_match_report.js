// Copyright (c) 2026, TriLence Tech and contributors
// Stock Match Report — Script Report

frappe.query_reports["Stock Match Report"] = {

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
			label: __("As Of Date"),
			fieldname: "as_of_date",
			fieldtype: "Date",
			reqd: 1,
			default: frappe.datetime.get_today(),
			width: "150px",
		},
		{
			label: __("Item Group"),
			fieldname: "item_group",
			fieldtype: "Link",
			options: "Item Group",
			width: "180px",
		},
		{
			label: __("Item Name"),
			fieldname: "item_name",
			fieldtype: "Data",
			width: "200px",
		},
	],

	// ── FORMATTER ────────────────────────────────────────────────────────────

	formatter: function (value, row, column, data, default_formatter) {
		if (!data) return default_formatter(value, row, column, data);

		// Roll Weight column on data rows — render each weight as a styled pill
		if (column.fieldname === "roll_weight" && data.row_type === "data") {
			var raw = (data.roll_weight || "").trim();
			if (!raw) return "";
			return raw.split(/\s+/).filter(Boolean).map(function (w) {
				return '<span style="display:inline-block;font-size:12px;font-weight:700;' +
					'color:#1a3a6a;background:#eef6ff;border:1px solid #93c5fd;' +
					'border-radius:4px;padding:1px 7px;margin:1px 3px 1px 4px;' +
					'letter-spacing:0.4px;white-space:nowrap;">' + w + '</span>';
			}).join(" ");
		}

		value = default_formatter(value, row, column, data);

		// Bold rows (group headers, subtotals, grand total)
		if (data.bold) {
			value = `<strong>${value}</strong>`;
		}

		return value;
	},

	// ── ON LOAD ───────────────────────────────────────────────────────────────

	onload: function (report) {
		// Auto-refresh on filter change
		const debounced_refresh = debounce(() => report.refresh(), 1500);
		report.filters.forEach(filter => {
			const $input = filter.$input;
			if ($input) $input.on("input", debounced_refresh);
		});

		// Print PDF button
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
				method: "erpnext.stock.report.stock_match_report.stock_match_report.get_print_html",
				args: { filters: JSON.stringify(filters) },
				freeze: true,
				freeze_message: __("Building report…"),
				callback: function (r) {
					if (!r.message) return;
					const blob = new Blob([r.message], { type: "text/html; charset=utf-8" });
					const url = URL.createObjectURL(blob);
					const win = window.open(url, "_blank");
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


function debounce(fn, delay) {
	let timer = null;
	return function (...args) {
		clearTimeout(timer);
		timer = setTimeout(() => fn.apply(this, args), delay);
	};
}
