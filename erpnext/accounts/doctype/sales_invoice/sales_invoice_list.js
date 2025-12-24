// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

// render
frappe.listview_settings["Sales Invoice"] = {
	add_fields: [
		"customer",
		"customer_name",
		"base_grand_total",
		"outstanding_amount",
		"due_date",
		"company",
		"currency",
		"is_return",
	],
	get_indicator: function (doc) {
		const status_colors = {
			Draft: "red",
			Unpaid: "orange",
			Paid: "green",
			Return: "gray",
			"Credit Note Issued": "gray",
			"Unpaid and Discounted": "orange",
			"Partly Paid and Discounted": "yellow",
			"Overdue and Discounted": "red",
			Overdue: "red",
			"Partly Paid": "yellow",
			"Internal Transfer": "darkgrey",
		};
		return [__(doc.status), status_colors[doc.status], "status,=," + doc.status];
	},
	right_column: "grand_total",

	onload: function (listview) {
		if (frappe.model.can_create("Delivery Note")) {
			listview.page.add_action_item(__("Delivery Note"), () => {
				erpnext.bulk_transaction_processing.create(listview, "Sales Invoice", "Delivery Note");
			});
		}

		if (frappe.model.can_create("Payment Entry")) {
			listview.page.add_action_item(__("Payment"), () => {
				erpnext.bulk_transaction_processing.create(listview, "Sales Invoice", "Payment Entry");
			});
		}
		const report_link = `
            <div style="margin-top: 1rem;">
              
						<button class="btn btn-primary" onclick="window.open('/app/query-report/Available%20Stock%20Filtered%20View', '_blank')">
							    Available Stock Report <br/> (With Weight)
  						</button>
						<br/>
						<button class="btn btn-primary" onclick="window.open('/app/query-report/Total%20Stock%20View/', '_blank')">
							    Total Stock Report
  						</button>
                
            </div>
        `;
		$(listview.page.sidebar).append(report_link);
	},
};
