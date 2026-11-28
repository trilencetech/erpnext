// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

frappe.query_reports["Profit and Loss Statement"] = $.extend({}, erpnext.financial_statements);

erpnext.utils.add_dimensions("Profit and Loss Statement", 10);

frappe.query_reports["Profit and Loss Statement"]["filters"].push({
	fieldname: "selected_view",
	label: __("Select View"),
	fieldtype: "Select",
	options: [
		{ value: "Report", label: __("Report View") },
		{ value: "Growth", label: __("Growth View") },
		{ value: "Margin", label: __("Margin View") },
	],
	default: "Report",
	reqd: 1,
});

frappe.query_reports["Profit and Loss Statement"]["filters"].push({
	fieldname: "accumulated_values",
	label: __("Accumulated Values"),
	fieldtype: "Check",
	default: 1,
});

frappe.query_reports["Profit and Loss Statement"]["filters"].push({
	fieldname: "include_default_book_entries",
	label: __("Include Default FB Entries"),
	fieldtype: "Check",
	default: 1,
});

// ── TRADITIONAL PDF BUTTON ────────────────────────────────────────────────────
(function () {
	var _orig = frappe.query_reports["Profit and Loss Statement"];
	var _orig_onload = _orig.onload;

	_orig.onload = function (report) {
		if (_orig_onload) _orig_onload.call(this, report);
		if (report.page) {
			report.page.add_inner_button(__("Traditional PDF"), function () {
				_pl_trad_pdf();
			});
		}
	};
})();

// ── HELPERS (shared with BS) ──────────────────────────────────────────────────

function _fs_inr(v) {
	var n = Math.abs(parseFloat(v) || 0);
	if (n === 0) return "";
	return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _fs_date(d) {
	if (!d) return "";
	var dt = typeof d === "string" ? new Date(d + "T00:00:00") : d;
	return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function _fs_amt_field() {
	// Always use the last currency/float column — that is 'total' in accumulated mode
	// or the rightmost period column in non-accumulated mode.
	var cols = frappe.query_report.columns || [];
	var last = null;
	for (var c of cols) {
		if (c.fieldtype === "Currency" || c.fieldtype === "Float") last = c.fieldname;
	}
	return last || "total";
}

function _fs_period_dates() {
	// 1. Read from data rows — most reliable regardless of filter mode
	var data = frappe.query_report.data || [];
	var from_dt = "", to_dt = "";
	for (var i = 0; i < data.length; i++) {
		var r = data[i];
		if (r.year_start_date && !from_dt) from_dt = r.year_start_date;
		if (r.year_end_date   && !to_dt)   to_dt   = r.year_end_date;
		if (from_dt && to_dt) break;
	}
	// 2. Fall back to filter values (Date Range mode)
	if (!from_dt || !to_dt) {
		var f = frappe.query_report.get_values();
		from_dt = from_dt || f.period_start_date || "";
		to_dt   = to_dt   || f.period_end_date   || "";
	}
	return { from: from_dt, to: to_dt };
}

// ── P&L TRADITIONAL PDF ───────────────────────────────────────────────────────

function _pl_trad_pdf() {
	var data = frappe.query_report.data;
	if (!data || !data.length) {
		frappe.msgprint(__("Run the report first.")); return;
	}

	var filters  = frappe.query_report.get_values();
	var company  = filters.company || frappe.defaults.get_user_default("Company") || "";
	var dates    = _fs_period_dates();
	var from_dt  = _fs_date(dates.from);
	var to_dt    = _fs_date(dates.to);
	var amt      = _fs_amt_field();

	// P&L data order (from Python):
	//   income rows … "'Total Income (Credit)'" … {} spacer
	//   expense rows … "'Total Expense (Debit)'" … {} spacer
	//   "'Profit for the year'" row
	//
	// Note: prepare_data() does NOT copy root_type to report rows, so we
	// split by locating the unique "'Total …'" separator rows instead.
	var income_total_idx  = -1;
	var expense_total_idx = -1;

	for (var i = 0; i < data.length; i++) {
		var an = data[i].account_name || data[i].account || "";
		if (an.startsWith("'Total Income"))       income_total_idx  = i;
		else if (an.startsWith("'Total Expense")) expense_total_idx = i;
	}

	if (income_total_idx < 0 || expense_total_idx < 0) {
		frappe.msgprint(__("Could not find section totals in report data. Please run the report first.")); return;
	}

	function not_empty(r) { return !!(r.account_name || r.account); }

	// Income rows: index 0 … income_total_idx (include the total row for display)
	// Expense rows: index income_total_idx+1 … expense_total_idx (skipping {} spacer automatically via filter)
	var income_rows  = data.slice(0, income_total_idx  + 1).filter(not_empty);
	var expense_rows = data.slice(income_total_idx + 1, expense_total_idx + 1).filter(not_empty);

	// Totals come directly from the section-total rows
	var total_income  = Math.abs(parseFloat(data[income_total_idx][amt]  || 0));
	var total_expense = Math.abs(parseFloat(data[expense_total_idx][amt] || 0));
	var net_profit    = total_income - total_expense;
	var is_profit     = net_profit >= 0;

	// Build HTML rows for one column
	function side_rows(rows) {
		return rows.map(function (r) {
			var an   = r.account_name || r.account || "";
			var name = an.replace(/^'+|'+$/g, "").trim();
			var v    = parseFloat(r[amt] || 0);
			var disp = _fs_inr(v);
			var is_section_total = an.startsWith("'Total ");
			var is_root = !is_section_total && r.indent === 0 && !r.parent_account;
			var pad_l = is_section_total ? 16 : 16 + (r.indent || 0) * 16;
			var fw    = (is_root || is_section_total) ? "700" : "400";
			var bg    = is_section_total
				? "background:#dbeafe;border-top:2px solid #93c5fd;"
				: (is_root ? "background:#f0f9ff;" : "");
			var fs    = is_section_total ? "font-size:13.5px;" : "font-size:13px;";
			return `<tr style="${bg}">
				<td style="padding:7px 14px;padding-left:${pad_l}px;font-weight:${fw};${fs}border-bottom:1px solid #f1f5f9;">${name}</td>
				<td style="padding:7px 14px;text-align:right;font-weight:${fw};${fs}border-bottom:1px solid #f1f5f9;white-space:nowrap;">${disp}</td>
			</tr>`;
		}).join("");
	}

	var left_body  = side_rows(expense_rows);
	var right_body = side_rows(income_rows);

	var left_total  = total_expense;
	var right_total = total_income;

	if (is_profit) {
		left_body += `<tr style="background:#fefce8;">
			<td style="padding:8px 16px;font-weight:700;font-size:14px;color:#713f12;border-top:2px solid #fbbf24;">NETT PROFIT</td>
			<td style="padding:8px 16px;text-align:right;font-weight:700;font-size:14px;color:#713f12;border-top:2px solid #fbbf24;white-space:nowrap;">${_fs_inr(net_profit)}</td>
		</tr>`;
		left_total += net_profit;
	} else {
		right_body += `<tr style="background:#fff1f2;">
			<td style="padding:8px 16px;font-weight:700;font-size:14px;color:#9f1239;border-top:2px solid #fda4af;">NETT LOSS</td>
			<td style="padding:8px 16px;text-align:right;font-weight:700;font-size:14px;color:#9f1239;border-top:2px solid #fda4af;white-space:nowrap;">${_fs_inr(Math.abs(net_profit))}</td>
		</tr>`;
		right_total += Math.abs(net_profit);
	}

	var grand = left_total; // both sides are now equal

	var today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });

	var html = _pl_trad_html(company, from_dt, to_dt, today, left_body, right_body, grand);
	var blob = new Blob([html], { type: "text/html" });
	window.open(URL.createObjectURL(blob), "_blank");
}

function _pl_trad_html(company, from_dt, to_dt, today, left_body, right_body, grand) {
	var grand_str = _fs_inr(grand);
	return `<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<title>P&L — ${company}</title>
<style>
  * { font-family: 'Segoe UI', Arial, sans-serif; box-sizing:border-box; margin:0; padding:0;
      -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
  body { background:#f1f5f9; padding:24px; }
  .page { max-width:1120px; margin:0 auto; background:#fff;
          border-radius:10px; box-shadow:0 4px 20px rgba(37,99,235,.10); overflow:hidden; }

  /* ── Header ── */
  .hdr { background:linear-gradient(120deg,#e0f2fe 0%,#eff6ff 100%) !important;
         border-bottom:3px solid #3b82f6; padding:22px 32px; text-align:center; }
  .hdr-co    { font-size:26px; font-weight:800; color:#1e3a8a; letter-spacing:.4px; }
  .hdr-title { font-size:15px; font-weight:600; color:#2563eb; margin-top:4px;
               letter-spacing:1.2px; text-transform:uppercase; }
  .hdr-period{ font-size:13px; color:#3b82f6; margin-top:5px; }

  /* ── T-table grid ── */
  .t-wrap { display:grid; grid-template-columns:1fr 1fr; }
  .t-side { border-right:2px solid #bfdbfe; }
  .t-side:last-child { border-right:none; }

  .col-hdr { background:#dbeafe !important; color:#1e3a8a !important; display:grid;
             grid-template-columns:1fr auto; padding:11px 16px; font-size:13px;
             font-weight:700; letter-spacing:.6px; border-bottom:2px solid #93c5fd; }

  table { width:100%; border-collapse:collapse; }
  td { font-size:13px; color:#1f2937; vertical-align:top; }

  /* ── Grand total row ── */
  .tot-row { background:#2563eb !important; }
  .tot-row td { color:#fff !important; font-weight:700; padding:10px 16px;
                font-size:14px; border:none !important;
                -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }

  /* ── Footer ── */
  .footer { padding:10px 28px; background:#f8fafc; border-top:1px solid #e2e8f0;
            display:flex; justify-content:space-between; font-size:12px; color:#94a3b8; }

  .print-wrap { text-align:center; padding:14px; background:#f8fafc; }
  .print-btn  { background:#2563eb; color:#fff; border:none; border-radius:7px;
                padding:9px 28px; font-size:13px; cursor:pointer; font-weight:600; }
  .print-btn:hover { background:#1d4ed8; }

  @media print {
    body { background:#fff; padding:0; }
    .page { box-shadow:none; border-radius:0; max-width:100%; }
    .print-wrap { display:none; }
    .hdr     { background:linear-gradient(120deg,#e0f2fe,#eff6ff) !important;
               -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
    .col-hdr { background:#dbeafe !important;
               -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
    .tot-row { background:#2563eb !important;
               -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
  }
</style>
</head><body><div class="page">

  <div class="hdr">
    <div class="hdr-co">${company}</div>
    <div class="hdr-title">Profit and Loss Account</div>
    <div class="hdr-period">From ${from_dt} &nbsp;&nbsp;To&nbsp;&nbsp; ${to_dt}</div>
  </div>

  <div class="t-wrap">
    <div class="t-side">
      <div class="col-hdr"><span>PARTICULARS (Dr)</span><span>AMOUNT</span></div>
      <table><tbody>${left_body}</tbody></table>
      <table><tbody>
        <tr class="tot-row">
          <td style="padding-left:16px;">TOTAL</td>
          <td style="text-align:right;padding-right:16px;">${grand_str}</td>
        </tr>
      </tbody></table>
    </div>
    <div class="t-side">
      <div class="col-hdr"><span>PARTICULARS (Cr)</span><span>AMOUNT</span></div>
      <table><tbody>${right_body}</tbody></table>
      <table><tbody>
        <tr class="tot-row">
          <td style="padding-left:16px;">TOTAL</td>
          <td style="text-align:right;padding-right:16px;">${grand_str}</td>
        </tr>
      </tbody></table>
    </div>
  </div>

  <div class="footer">
    <span>${company} &nbsp;·&nbsp; Profit &amp; Loss Account</span>
    <span>Printed: ${today}</span>
  </div>

  <div class="print-wrap">
    <button class="print-btn" onclick="window.print()">🖨️&nbsp; Print / Save as PDF</button>
  </div>

</div></body></html>`;
}
