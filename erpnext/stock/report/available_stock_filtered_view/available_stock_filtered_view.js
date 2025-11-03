// Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.query_reports["Available Stock Filtered View"] = {
	onload: function (report) {
		const debounced_refresh = debounce(() => {
			report.refresh();
		}, 2000); // 2-second delay

		// Attach to all filter fields
		report.filters.forEach(filter => {
			const $input = filter.$input;
			if ($input) {
				$input.on("input", debounced_refresh);
			}
		});
	},

	"filters": [
		{
			label: __("Company"),
			fieldname: "company",
			fieldtype: "Link",
			options: "Company",
			reqd: 1,
			default: frappe.defaults.get_default("company"), // pulls from Global Defaults
			width: "200px"
		},
		{
			label: __("Item Name"),
			fieldname: "item_name",
			fieldtype: "Data",
			width: "200px"
		},
		{
			label: __("Size"),
			fieldname: "size",
			fieldtype: "Data",
			width: "120px"
		},
		{
			label: __("Weight"),
			fieldname: "qty",
			fieldtype: "Float",
			width: "100px"
		}
	]

};

function debounce(fn, delay) {
	let timer = null;
	return function (...args) {
		clearTimeout(timer);
		timer = setTimeout(() => fn.apply(this, args), delay);
	};
}
