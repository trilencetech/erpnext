frappe.pages['company-selector'].on_page_load = function (wrapper) {
	let page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Select Company',
		single_column: true
	});

	frappe.call({
		method: "frappe.client.get_list",
		args: {
			doctype: "Company",
			fields: ["name"]
		},
		callback: function (r) {
			if (r.message) {
				let companies = r.message;
				let $container = $(wrapper).find('.layout-main-section');
				$container.empty();
				$container.append('<div class="company-selector-page">')
				companies.forEach(c => {
					let btn = $(` <button  style="margin:5px">${c.name}</button> `);
					btn.on('click', function () {
						frappe.call({
							method: "erpnext.api.set_session_company",
							args: { company: c.name },
							callback: function (res) {
								frappe.msgprint({
									title: __("Success"),
									message: __("Default company set to " + c.name),
									indicator: "green"
								});
								// Redirect to desk after selection
								window.location.href = "/app";
							}
						});
					});
					$container.append(btn);
				});

				$container.append('</div>')
			}
		}


	});




};
