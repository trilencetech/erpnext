// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

frappe.provide("erpnext.stock");

cur_frm.cscript.tax_table = "Purchase Taxes and Charges";

erpnext.accounts.taxes.setup_tax_filters("Purchase Taxes and Charges");
erpnext.accounts.taxes.setup_tax_validations("Purchase Receipt");
erpnext.buying.setup_buying_controller();

frappe.ui.form.on("Purchase Receipt", {
	setup: (frm) => {
		frm.custom_make_buttons = {
			"Stock Entry": "Return",
			"Purchase Invoice": "Purchase Invoice",
			"Landed Cost Voucher": "Landed Cost Voucher",
		};

		frm.set_query("expense_account", "items", function () {
			return {
				query: "erpnext.controllers.queries.get_expense_account",
				filters: { company: frm.doc.company },
			};
		});

		frm.set_query("wip_composite_asset", "items", function () {
			return {
				filters: { is_composite_asset: 1, docstatus: 0 },
			};
		});

		frm.set_query("taxes_and_charges", function () {
			return {
				filters: { company: frm.doc.company },
			};
		});

		frm.set_query("subcontracting_receipt", function () {
			return {
				filters: {
					docstatus: 1,
					supplier: frm.doc.supplier,
				},
			};
		});
	},
	onload: function (frm) {
		erpnext.queries.setup_queries(frm, "Warehouse", function () {
			return erpnext.queries.warehouse(frm.doc);
		});
	},

	refresh: function (frm) {
		if (frm.doc.company) {
			frm.trigger("toggle_display_account_head");
		}

		if (frm.doc.docstatus === 1 && frm.doc.is_return === 1 && frm.doc.per_billed !== 100) {
			frm.add_custom_button(
				__("Debit Note"),
				function () {
					frappe.model.open_mapped_doc({
						method: "erpnext.stock.doctype.purchase_receipt.purchase_receipt.make_purchase_invoice",
						frm: cur_frm,
					});
				},
				__("Create")
			);
			frm.page.set_inner_btn_group_as_primary(__("Create"));
		}

		if (frm.doc.docstatus === 1 && frm.doc.is_internal_supplier && !frm.doc.inter_company_reference) {
			frm.add_custom_button(
				__("Delivery Note"),
				function () {
					frappe.model.open_mapped_doc({
						method: "erpnext.stock.doctype.purchase_receipt.purchase_receipt.make_inter_company_delivery_note",
						frm: cur_frm,
					});
				},
				__("Create")
			);
		}

		if (frm.doc.docstatus === 0) {
			if (!frm.doc.is_return) {
				frappe.db.get_single_value("Buying Settings", "maintain_same_rate").then((value) => {
					if (value) {
						frm.doc.items.forEach((item) => {
							frm.fields_dict.items.grid.update_docfield_property(
								"rate",
								"read_only",
								item.purchase_order && item.purchase_order_item
							);
						});
					}
				});
			}
		}

		if (frm.doc.docstatus === 1) {
			frm.add_custom_button(
				__("Landed Cost Voucher"),
				() => {
					frm.events.make_lcv(frm);
				},
				__("Create")
			);
		}

		frm.events.add_custom_buttons(frm);
	},

	make_lcv(frm) {
		frappe.call({
			method: "erpnext.stock.doctype.purchase_receipt.purchase_receipt.make_lcv",
			args: {
				doctype: frm.doc.doctype,
				docname: frm.doc.name,
			},
			callback: (r) => {
				if (r.message) {
					var doc = frappe.model.sync(r.message);
					frappe.set_route("Form", doc[0].doctype, doc[0].name);
				}
			},
		});
	},

	add_custom_buttons: function (frm) {
		if (frm.doc.docstatus == 0) {
			frm.add_custom_button(
				__("Purchase Invoice"),
				function () {
					if (!frm.doc.supplier) {
						frappe.throw({
							title: __("Mandatory"),
							message: __("Please Select a Supplier"),
						});
					}
					erpnext.utils.map_current_doc({
						method: "erpnext.accounts.doctype.purchase_invoice.purchase_invoice.make_purchase_receipt",
						source_doctype: "Purchase Invoice",
						target: frm,
						setters: {
							supplier: frm.doc.supplier,
						},
						get_query_filters: {
							docstatus: 1,
							per_received: ["<", 100],
							company: frm.doc.company,
						},
					});
				},
				__("Get Items From")
			);
		}
	},

	company: function (frm) {
		frm.trigger("toggle_display_account_head");
		erpnext.accounts.dimensions.update_dimension(frm, frm.doctype);
	},

	subcontracting_receipt: (frm) => {
		if (
			frm.doc.is_subcontracted === 1 &&
			frm.doc.is_old_subcontracting_flow === 0 &&
			frm.doc.subcontracting_receipt
		) {
			frm.set_value("items", null);

			erpnext.utils.map_current_doc({
				method: "erpnext.subcontracting.doctype.subcontracting_receipt.subcontracting_receipt.make_purchase_receipt",
				source_name: frm.doc.subcontracting_receipt,
				target_doc: frm,
				freeze: true,
				freeze_message: __("Mapping Purchase Receipt ..."),
			});
		}
	},

	toggle_display_account_head: function (frm) {
		var enabled = erpnext.is_perpetual_inventory_enabled(frm.doc.company);
		frm.fields_dict["items"].grid.set_column_disp(["cost_center"], enabled);
	},
});

erpnext.stock.PurchaseReceiptController = class PurchaseReceiptController extends (
	erpnext.buying.BuyingController
) {
	setup(doc) {
		this.setup_posting_date_time_check();
		super.setup(doc);
	}

	refresh() {
		var me = this;
		super.refresh();

		erpnext.accounts.ledger_preview.show_accounting_ledger_preview(this.frm);
		erpnext.accounts.ledger_preview.show_stock_ledger_preview(this.frm);

		if (this.frm.doc.docstatus > 0) {
			this.show_stock_ledger();
			//removed for temporary
			this.show_general_ledger();

			this.frm.add_custom_button(
				__("Asset"),
				function () {
					frappe.route_options = {
						purchase_receipt: me.frm.doc.name,
					};
					frappe.set_route("List", "Asset");
				},
				__("View")
			);

			this.frm.add_custom_button(
				__("Asset Movement"),
				function () {
					frappe.route_options = {
						reference_name: me.frm.doc.name,
					};
					frappe.set_route("List", "Asset Movement");
				},
				__("View")
			);
		}

		if (!this.frm.doc.is_return && this.frm.doc.status != "Closed") {
			if (this.frm.doc.docstatus == 0) {
				this.frm.add_custom_button(
					__("Purchase Order"),
					function () {
						if (!me.frm.doc.supplier) {
							frappe.throw({
								title: __("Mandatory"),
								message: __("Please Select a Supplier"),
							});
						}
						erpnext.utils.map_current_doc({
							method: "erpnext.buying.doctype.purchase_order.purchase_order.make_purchase_receipt",
							source_doctype: "Purchase Order",
							target: me.frm,
							setters: {
								supplier: me.frm.doc.supplier,
								schedule_date: undefined,
							},
							get_query_filters: {
								docstatus: 1,
								status: ["not in", ["Closed", "On Hold"]],
								per_received: ["<", 99.99],
								company: me.frm.doc.company,
							},
						});
					},
					__("Get Items From")
				);
			}

			if (this.frm.doc.docstatus == 1 && this.frm.doc.status != "Closed") {
				if (this.frm.has_perm("submit")) {
					cur_frm.add_custom_button(__("Close"), this.close_purchase_receipt, __("Status"));
				}

				cur_frm.add_custom_button(__("Purchase Return"), this.make_purchase_return, __("Create"));

				cur_frm.add_custom_button(
					__("Make Stock Entry"),
					cur_frm.cscript["Make Stock Entry"],
					__("Create")
				);

				if (flt(this.frm.doc.per_billed) < 100) {
					cur_frm.add_custom_button(
						__("Purchase Invoice"),
						this.make_purchase_invoice,
						__("Create")
					);
				}
				cur_frm.add_custom_button(
					__("Retention Stock Entry"),
					this.make_retention_stock_entry,
					__("Create")
				);

				cur_frm.page.set_inner_btn_group_as_primary(__("Create"));
			}
		}

		if (this.frm.doc.docstatus == 1 && this.frm.doc.status === "Closed" && this.frm.has_perm("submit")) {
			cur_frm.add_custom_button(__("Reopen"), this.reopen_purchase_receipt, __("Status"));
		}

		this.frm.toggle_reqd("supplier_warehouse", this.frm.doc.is_old_subcontracting_flow);

		this.frm.add_custom_button(
			__("Purchase Stock Report"),
			function () {
				show_purchase_stock_report(cur_frm);
			},
			__("Actions")
		);
	}

	make_purchase_invoice() {
		frappe.model.open_mapped_doc({
			method: "erpnext.stock.doctype.purchase_receipt.purchase_receipt.make_purchase_invoice",
			frm: cur_frm,
		});
	}

	make_purchase_return() {
		let me = this;

		let has_rejected_items = cur_frm.doc.items.filter((item) => {
			if (item.rejected_qty > 0) {
				return true;
			}
		});

		if (has_rejected_items && has_rejected_items.length > 0) {
			frappe.prompt(
				[
					{
						label: __("Return Qty from Rejected Warehouse"),
						fieldtype: "Check",
						fieldname: "return_for_rejected_warehouse",
						default: 1,
					},
				],
				function (values) {
					if (values.return_for_rejected_warehouse) {
						frappe.call({
							method: "erpnext.stock.doctype.purchase_receipt.purchase_receipt.make_purchase_return_against_rejected_warehouse",
							args: {
								source_name: cur_frm.doc.name,
							},
							callback: function (r) {
								if (r.message) {
									frappe.model.sync(r.message);
									frappe.set_route("Form", r.message.doctype, r.message.name);
								}
							},
						});
					} else {
						cur_frm.cscript._make_purchase_return();
					}
				},
				__("Return Qty"),
				__("Make Return Entry")
			);
		} else {
			cur_frm.cscript._make_purchase_return();
		}
	}

	close_purchase_receipt() {
		cur_frm.cscript.update_status("Closed");
	}

	reopen_purchase_receipt() {
		cur_frm.cscript.update_status("Submitted");
	}

	make_retention_stock_entry() {
		frappe.call({
			method: "erpnext.stock.doctype.stock_entry.stock_entry.move_sample_to_retention_warehouse",
			args: {
				company: cur_frm.doc.company,
				items: cur_frm.doc.items,
			},
			callback: function (r) {
				if (r.message) {
					var doc = frappe.model.sync(r.message)[0];
					frappe.set_route("Form", doc.doctype, doc.name);
				} else {
					frappe.msgprint(
						__("Purchase Receipt doesn't have any Item for which Retain Sample is enabled.")
					);
				}
			},
		});
	}

	apply_putaway_rule() {
		if (this.frm.doc.apply_putaway_rule) erpnext.apply_putaway_rule(this.frm);
	}
};

// for backward compatibility: combine new and previous states
extend_cscript(cur_frm.cscript, new erpnext.stock.PurchaseReceiptController({ frm: cur_frm }));

cur_frm.cscript.update_status = function (status) {
	frappe.ui.form.is_saving = true;
	frappe.call({
		method: "erpnext.stock.doctype.purchase_receipt.purchase_receipt.update_purchase_receipt_status",
		args: { docname: cur_frm.doc.name, status: status },
		callback: function (r) {
			if (!r.exc) cur_frm.reload_doc();
		},
		always: function () {
			frappe.ui.form.is_saving = false;
		},
	});
};

cur_frm.fields_dict["items"].grid.get_field("project").get_query = function (doc, cdt, cdn) {
	return {
		filters: [["Project", "status", "not in", "Completed, Cancelled"]],
	};
};

cur_frm.fields_dict["select_print_heading"].get_query = function (doc, cdt, cdn) {
	return {
		filters: [["Print Heading", "docstatus", "!=", "2"]],
	};
};

cur_frm.fields_dict["items"].grid.get_field("bom").get_query = function (doc, cdt, cdn) {
	var d = locals[cdt][cdn];
	return {
		filters: [
			["BOM", "item", "=", d.item_code],
			["BOM", "is_active", "=", "1"],
			["BOM", "docstatus", "=", "1"],
		],
	};
};

frappe.provide("erpnext.buying");

frappe.ui.form.on("Purchase Receipt", "is_subcontracted", function (frm) {
	if (frm.doc.is_old_subcontracting_flow) {
		erpnext.buying.get_default_bom(frm);
	}

	frm.toggle_reqd("supplier_warehouse", frm.doc.is_old_subcontracting_flow);
});

frappe.ui.form.on("Purchase Receipt Item", {
	item_code: function (frm, cdt, cdn) {
		var d = locals[cdt][cdn];
		frappe.db.get_value("Item", { name: d.item_code }, "sample_quantity", (r) => {
			frappe.model.set_value(cdt, cdn, "sample_quantity", r.sample_quantity);
			validate_sample_quantity(frm, cdt, cdn);
		});
	},
	qty: function (frm, cdt, cdn) {
		validate_sample_quantity(frm, cdt, cdn);
	},
	sample_quantity: function (frm, cdt, cdn) {
		validate_sample_quantity(frm, cdt, cdn);
	},
	batch_no: function (frm, cdt, cdn) {
		validate_sample_quantity(frm, cdt, cdn);
	},
});

cur_frm.cscript._make_purchase_return = function () {
	frappe.model.open_mapped_doc({
		method: "erpnext.stock.doctype.purchase_receipt.purchase_receipt.make_purchase_return",
		frm: cur_frm,
	});
};

cur_frm.cscript["Make Stock Entry"] = function () {
	frappe.model.open_mapped_doc({
		method: "erpnext.stock.doctype.purchase_receipt.purchase_receipt.make_stock_entry",
		frm: cur_frm,
	});
};

var validate_sample_quantity = function (frm, cdt, cdn) {
	var d = locals[cdt][cdn];
	if (d.sample_quantity && d.qty) {
		frappe.call({
			method: "erpnext.stock.doctype.stock_entry.stock_entry.validate_sample_quantity",
			args: {
				batch_no: d.batch_no,
				item_code: d.item_code,
				sample_quantity: d.sample_quantity,
				qty: d.qty,
			},
			callback: (r) => {
				frappe.model.set_value(cdt, cdn, "sample_quantity", r.message);
			},
		});
	}
};

/* ─── Purchase Stock Report helpers ──────────────────────────────────────── */

var PR_REPORT_STYLES = `
	.pr-report-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap;}
	.pr-report-toolbar .pr-search{flex:1;min-width:180px;border-radius:6px;border:1px solid #d1d5db;
		padding:7px 12px;font-size:13px;outline:none;}
	.pr-report-toolbar .pr-search:focus{border-color:#5e64ff;box-shadow:0 0 0 2px rgba(94,100,255,.15);}
	.pr-report-wrap{overflow:auto;max-height:62vh;border-radius:8px;
		border:1px solid #e5e7eb;box-shadow:0 1px 4px rgba(0,0,0,.07);}
	.pr-report-table{width:100%;border-collapse:collapse;font-size:13px;}
	.pr-report-table thead tr{
		background:linear-gradient(135deg,#1a73e8 0%,#0d47a1 100%);color:#fff;
		position:sticky;top:0;z-index:2;}
	.pr-report-table thead th{padding:11px 14px;font-weight:600;font-size:12px;
		letter-spacing:.4px;border:none;white-space:nowrap;}
	.pr-report-table tbody tr{border-bottom:1px solid #f0f0f0;transition:background .15s;}
	.pr-report-table tbody tr.even{background:#fafafa;}
	.pr-report-table tbody tr:hover{background:#e8f0fe !important;}
	.pr-report-table tbody td{padding:9px 14px;vertical-align:middle;}
	.pr-group-row{cursor:pointer;}
	.pr-group-row td:first-child{font-weight:600;color:#1a73e8;}
	.pr-dn-row{background:#ffe5e5 !important;}
	.pr-dn-row:hover{background:#ffd0d0 !important;}
	.pr-count-badge{display:inline-block;background:#e8f0fe;color:#1a73e8;
		border-radius:12px;padding:1px 9px;font-size:12px;font-weight:600;}
	.pr-qty-cell{font-weight:600;font-family:monospace;font-size:13px;}
	.pr-footer-tip{margin-top:8px;margin-bottom:0;font-size:12px;color:#888;}
	.pr-alert-bar{display:flex;align-items:center;gap:8px;background:#fff8e1;
		border:1px solid #ffe082;border-radius:6px;padding:8px 12px;
		margin-bottom:12px;font-size:13px;color:#5d4037;}
`;

function _pr_inject_styles() {
	if (!document.getElementById("pr-report-css")) {
		let s = document.createElement("style");
		s.id = "pr-report-css";
		s.textContent = PR_REPORT_STYLES;
		document.head.appendChild(s);
	}
}

function _pr_build_summary_rows(data, filter) {
	let f = (filter || "").toLowerCase();
	return data
		.filter(
			(r) =>
				!f ||
				(r.item_code || "").toLowerCase().includes(f) ||
				(r.item_name || "").toLowerCase().includes(f)
		)
		.map(
			(r, i) => `
		<tr class="pr-group-row ${i % 2 ? "even" : ""}"
			data-item-code="${frappe.utils.escape_html(r.item_code)}">
			<td>${frappe.utils.escape_html(r.item_code)}</td>
			<td>${frappe.utils.escape_html(r.item_name || "")}</td>
			<td style="text-align:center;">
				<span class="pr-count-badge">${r.no_of_items}</span>
			</td>
			<td style="text-align:right;" class="pr-qty-cell">
				${frappe.format(r.total_qty, { fieldtype: "Float" })}
			</td>
		</tr>`
		)
		.join("");
}

function show_purchase_stock_report(frm) {
	_pr_inject_styles();
	frappe.call({
		method: "erpnext.stock.doctype.purchase_receipt.purchase_receipt.get_purchase_stock_report",
		args: { purchase_receipt: frm.doc.name },
		callback: function (r) {
			if (!r.message || !r.message.length) {
				frappe.msgprint(__("No items found for this Purchase Receipt."));
				return;
			}
			let data = r.message;

			let html = `
			<div class="pr-report-toolbar">
				<input type="text" id="pr-sum-search" class="pr-search"
					placeholder="${__("Search by Item Code or Name…")}" />
				<button class="btn btn-sm btn-default" id="pr-sum-pdf">
					<i class="fa fa-file-pdf-o"></i>&ensp;${__("Export PDF")}
				</button>
			</div>
			<div class="pr-report-wrap">
				<table class="pr-report-table">
					<thead>
						<tr>
							<th>${__("Item Code")}</th>
							<th>${__("Item Name")}</th>
							<th style="text-align:center;">${__("No. of Items")}</th>
							<th style="text-align:right;">${__("Total Qty / Weight")}</th>
						</tr>
					</thead>
					<tbody id="pr-sum-tbody">${_pr_build_summary_rows(data, "")}</tbody>
				</table>
			</div>
			<p class="pr-footer-tip">
				<i class="fa fa-hand-pointer-o"></i>&ensp;
				${__("Click any row to view individual items.")}
			</p>`;

			let d = new frappe.ui.Dialog({
				title: __("Purchase Stock Report — {0}", [frm.doc.name]),
				fields: [{ fieldtype: "HTML", fieldname: "rh", options: html }],
				size: "extra-large",
			});
			d.show();
			d.$wrapper.find(".modal-dialog").css({ "max-width": "92vw", width: "92vw" });

			let $tbody = d.$wrapper.find("#pr-sum-tbody");

			function _attach_row_clicks() {
				d.$wrapper.find(".pr-group-row").off("click").on("click", function () {
					show_pr_stock_drilldown(frm, $(this).data("item-code"));
				});
			}

			d.$wrapper.find("#pr-sum-search").on("input", function () {
				$tbody.html(_pr_build_summary_rows(data, $(this).val()));
				_attach_row_clicks();
			});

			_attach_row_clicks();

			d.$wrapper.find("#pr-sum-pdf").on("click", function () {
				_pr_export_summary_pdf(frm.doc.name, data);
			});
		},
	});
}

/* ─── Drill-down ─────────────────────────────────────────────────────────── */

function _pr_build_drill_rows(items, filter) {
	let f = (filter || "").toLowerCase();
	return items
		.filter(
			(it) =>
				!f ||
				(it.item_code || "").toLowerCase().includes(f) ||
				(it.item_name || "").toLowerCase().includes(f)
		)
		.map(
			(it, i) => `
		<tr class="${it.has_submitted_dn ? "pr-dn-row" : i % 2 ? "even" : ""}">
			<td>${frappe.utils.escape_html(it.item_code || "")}</td>
			<td>${frappe.utils.escape_html(it.item_name || "")}</td>
			<td style="text-align:right;" class="pr-qty-cell">
				${frappe.format(it.qty, { fieldtype: "Float" })}
			</td>
			<td>${frappe.utils.escape_html(it.uom || "")}</td>
		</tr>`
		)
		.join("");
}

function show_pr_stock_drilldown(frm, item_code) {
	_pr_inject_styles();
	frappe.call({
		method: "erpnext.stock.doctype.purchase_receipt.purchase_receipt.get_purchase_stock_report_items",
		args: { purchase_receipt: frm.doc.name, item_code: item_code },
		callback: function (r) {
			if (!r.message) return;
			let items = r.message;
			let dn_count = items.filter((it) => it.has_submitted_dn).length;

			let alert_bar =
				dn_count > 0
					? `<div class="pr-alert-bar">
						<i class="fa fa-exclamation-triangle" style="color:#e65100;font-size:15px;"></i>
						<span>
							<strong>${dn_count}</strong>
							&nbsp;${__("item(s) already dispatched via a submitted Delivery Note (highlighted in red).")}
						</span>
					</div>`
					: "";

			let legend =
				frm.doc.docstatus === 1
					? `<p class="pr-footer-tip">
						<span style="display:inline-block;width:14px;height:14px;background:#ffe5e5;
							border:1px solid #f08080;border-radius:2px;vertical-align:middle;"></span>
						&ensp;${__("Row highlighted in red = submitted Delivery Note exists for this item.")}
					</p>`
					: "";

			let html = `
			${alert_bar}
			<div class="pr-report-toolbar">
				<input type="text" id="pr-drill-search" class="pr-search"
					placeholder="${__("Search by Item Code or Name…")}" />
				<button class="btn btn-sm btn-default" id="pr-drill-pdf">
					<i class="fa fa-file-pdf-o"></i>&ensp;${__("Export PDF")}
				</button>
			</div>
			<div class="pr-report-wrap">
				<table class="pr-report-table">
					<thead>
						<tr>
							<th>${__("Item Code")}</th>
							<th>${__("Item Name")}</th>
							<th style="text-align:right;">${__("Qty / Weight")}</th>
							<th>${__("UOM")}</th>
						</tr>
					</thead>
					<tbody id="pr-drill-tbody">${_pr_build_drill_rows(items, "")}</tbody>
				</table>
			</div>
			${legend}`;

			let d = new frappe.ui.Dialog({
				title: __("Items — {0}", [item_code]),
				fields: [{ fieldtype: "HTML", fieldname: "dh", options: html }],
				size: "extra-large",
			});
			d.show();
			d.$wrapper.find(".modal-dialog").css({ "max-width": "92vw", width: "92vw" });

			d.$wrapper.find("#pr-drill-search").on("input", function () {
				d.$wrapper.find("#pr-drill-tbody").html(_pr_build_drill_rows(items, $(this).val()));
			});

			d.$wrapper.find("#pr-drill-pdf").on("click", function () {
				_pr_export_drill_pdf(frm.doc.name, item_code, items);
			});
		},
	});
}

/* ─── PDF helpers ────────────────────────────────────────────────────────── */

var _PR_PDF_BASE_CSS = `
	body{font-family:Arial,sans-serif;margin:24px;color:#222;}
	h2{color:#1a73e8;margin:0 0 4px;}
	.sub{color:#666;font-size:12px;margin:0 0 18px;}
	table{width:100%;border-collapse:collapse;}
	thead tr{background:#1a73e8;color:#fff;}
	th{padding:9px 12px;font-size:11px;text-align:left;white-space:nowrap;}
	td{padding:7px 12px;font-size:11px;border-bottom:1px solid #e8e8e8;}
	tr.even{background:#f7f7f7;}
	.dn-row{background:#ffe5e5;}
	.legend{margin-top:12px;font-size:11px;color:#555;display:flex;align-items:center;gap:6px;}
	.legend-box{width:12px;height:12px;background:#ffe5e5;border:1px solid #f08080;display:inline-block;}
	@media print{@page{margin:14mm;}}
`;

function _pr_open_print_window(title, subtitle, head_html, body_html, legend_html) {
	let ts = frappe.datetime.now_datetime();
	let win = window.open("", "_blank");
	if (!win) {
		frappe.msgprint(__("Please allow popups for PDF export."));
		return;
	}

	// Build via DOM to avoid deprecated document.write
	let meta = win.document.createElement("meta");
	meta.setAttribute("charset", "utf-8");
	win.document.head.appendChild(meta);

	win.document.title = title;

	let style = win.document.createElement("style");
	style.textContent = _PR_PDF_BASE_CSS;
	win.document.head.appendChild(style);

	win.document.body.innerHTML = `
		<h2>${frappe.utils.escape_html(title)}</h2>
		<p class="sub">${frappe.utils.escape_html(subtitle)}&nbsp;|&nbsp;Generated: ${ts}</p>
		<table>
			<thead><tr>${head_html}</tr></thead>
			<tbody>${body_html}</tbody>
		</table>
		${legend_html || ""}
	`;

	win.focus();
	win.print();
}

function _pr_export_summary_pdf(pr_name, data) {
	let head = ["Item Code", "Item Name", "No. of Items", "Total Qty / Weight"]
		.map((h, i) => `<th${i >= 2 ? ' style="text-align:' + (i === 2 ? "center" : "right") + ';"' : ""}>${h}</th>`)
		.join("");

	let body = data
		.map(
			(r, i) => `
		<tr class="${i % 2 ? "even" : ""}">
			<td><strong>${frappe.utils.escape_html(r.item_code)}</strong></td>
			<td>${frappe.utils.escape_html(r.item_name || "")}</td>
			<td style="text-align:center;">${r.no_of_items}</td>
			<td style="text-align:right;font-weight:600;">
				${frappe.format(r.total_qty, { fieldtype: "Float" })}
			</td>
		</tr>`
		)
		.join("");

	_pr_open_print_window(
		"Purchase Stock Report — " + pr_name,
		pr_name,
		head,
		body,
		""
	);
}

function _pr_export_drill_pdf(pr_name, item_code, items) {
	let head = ["Item Code", "Item Name", "Qty / Weight", "UOM"]
		.map((h, i) => `<th${i === 3 ? ' style="text-align:right;"' : ""}>${h}</th>`)
		.join("");

	let body = items
		.map(
			(it, i) => `
		<tr class="${it.has_submitted_dn ? "dn-row" : i % 2 ? "even" : ""}">
			<td>${frappe.utils.escape_html(it.item_code || "")}</td>
			<td>${frappe.utils.escape_html(it.item_name || "")}</td>
			<td style="text-align:right;font-weight:600;">
				${frappe.format(it.qty, { fieldtype: "Float" })}
			</td>
			<td>${frappe.utils.escape_html(it.uom || "")}</td>
		</tr>`
		)
		.join("");

	let legend = `
		<div class="legend">
			<span class="legend-box"></span>
			Row highlighted in red = submitted Delivery Note exists for this item.
		</div>`;

	_pr_open_print_window(
		"Items — " + item_code,
		pr_name + " › " + item_code,
		head,
		body,
		legend
	);
}
