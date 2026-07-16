// Copyright (c) 2026, TriLence Tech and contributors
// Purchase Receipt Register — Script Report

frappe.query_reports["Purchase Receipt Register"] = {

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
			default: frappe.datetime.month_start(),
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
			label: __("Supplier"),
			fieldname: "supplier",
			fieldtype: "Link",
			options: "Supplier",
			width: "180px",
		},
	],

	// ── FORMATTER ────────────────────────────────────────────────────────────

	formatter: function (value, row, column, data, default_formatter) {
		if (!data) return default_formatter(value, row, column, data);

		var KIND_COLORS = {
			ok:      { bg: "#d1fae5", fg: "#064e3b", border: "#6ee7b7" },
			warn:    { bg: "#fef3c7", fg: "#92400e", border: "#fbbf24" },
			error:   { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" },
			info:    { bg: "#eff6ff", fg: "#1e40af", border: "#93c5fd" },
			neutral: { bg: "#f1f5f9", fg: "#334155", border: "#cbd5e1" },
		};

		var rtype = data.row_type;
		var formatted;

		if (rtype === "group_header") {
			var c = KIND_COLORS[data.status_kind] || KIND_COLORS.neutral;
			value  = default_formatter(value, row, column, data);

			if (column.fieldname === "status") {
				formatted = `<span style="display:inline-block;background:${c.bg};color:${c.fg};
					border:1px solid ${c.border};border-radius:10px;padding:1px 9px;
					font-size:10px;font-weight:700;">${data.status}</span>`;
			} else if (column.fieldname === "purchase_receipt" || column.fieldname === "item_group") {
				formatted = `<strong style="color:${c.fg};">${value}</strong>`;
			} else {
				formatted = value;
			}

			return `<span style="display:block;background:${c.bg};margin:-50px;padding:50px;line-height:1.5;">${formatted}</span>`;
		}

		if (rtype === "data") {
			value = default_formatter(value, row, column, data);
			if (column.fieldname === "status" && data.rejected_qty) {
				return `<span style="display:inline-block;background:#fecaca;color:#991b1b;
					border:1px solid #f87171;border-radius:10px;padding:1px 9px;
					font-size:10px;font-weight:700;">Rejected ${data.rejected_qty.toFixed(3)}</span>`;
			}
			return value;
		}

		if (rtype === "subtotal") {
			value = default_formatter(value, row, column, data);
			return `<strong>${value}</strong>`;
		}

		if (rtype === "grand_total") {
			value = default_formatter(value, row, column, data);
			return `<strong style="color:#1a3a6a;">${value}</strong>`;
		}

		return default_formatter(value, row, column, data);
	},

	// ── ON LOAD ──────────────────────────────────────────────────────────────

	onload: function (report) {
		// Print PDF button
		report.page.add_inner_button(__("Print PDF"), function () {
			var filters = report.get_values();
			if (!filters || !filters.company) {
				frappe.msgprint(__("Please select a Company before printing."));
				return;
			}

			frappe.call({
				method: "erpnext.stock.report.purchase_receipt_register.purchase_receipt_register.get_print_html",
				args: { filters: JSON.stringify(filters) },
				freeze: true,
				freeze_message: __("Building Purchase Receipt Register…"),
				callback: function (r) {
					if (!r.message) return;
					var blob = new Blob([r.message], { type: "text/html; charset=utf-8" });
					var url  = URL.createObjectURL(blob);
					var win  = window.open(url, "_blank");
					win && win.focus();
					win && win.addEventListener("load", function () {
						setTimeout(function () {
							win.print();
							URL.revokeObjectURL(url);
						}, 400);
					});
				},
			});
		});

		// Export Excel button
		report.page.add_inner_button(__("Export Excel"), function () {
			var filters = report.get_values();
			if (!filters || !filters.company) {
				frappe.msgprint(__("Please select a Company before exporting."));
				return;
			}

			frappe.call({
				method: "erpnext.stock.report.purchase_receipt_register.purchase_receipt_register.get_excel",
				args: { filters: JSON.stringify(filters) },
				freeze: true,
				freeze_message: __("Building Excel report…"),
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
		});
	},
};
