// Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.query_reports["GST Monthly CA Summary"] = {
	"filters": [
		{
			"fieldname": "company",
			"label": __("Company"),
			"fieldtype": "Link",
			"options": "Company",
			"reqd": 1,
			"default": frappe.defaults.get_user_default("Company")
		},
		{
			"fieldname": "from_date",
			"label": __("From Date"),
			"fieldtype": "Date",
			"reqd": 1,
			"default": frappe.datetime.month_start()
		},
		{
			"fieldname": "to_date",
			"label": __("To Date"),
			"fieldtype": "Date",
			"reqd": 1,
			"default": frappe.datetime.month_end()
		}
	],

	"onload": function (report) {
		// Add custom "CA Format" button
		report.page.add_inner_button(__("📄 CA Format / Print"), function () {
			generate_ca_format(report);
		});
	}
};

// ═══════════════════════════════════════════════════════════════════════════
// GENERATE CA FORMAT VIEW
// ═══════════════════════════════════════════════════════════════════════════

function generate_ca_format(report) {
	let data = report.data;
	let filters = report.get_filter_values();

	if (!data || data.length === 0) {
		frappe.msgprint(__("No data to display. Please run the report first."));
		return;
	}

	// Parse the data into sections
	let parsed = parse_report_data(data);

	// Generate HTML
	let html = get_ca_format_html(parsed, filters);

	// Open in new window
	let print_window = window.open("", "_blank");
	print_window.document.write(html);
	print_window.document.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSE REPORT DATA
// ═══════════════════════════════════════════════════════════════════════════

function parse_report_data(data) {
	let result = {
		sales_prev: {},
		sales_cur: {},
		sales_total: {},
		purch_prev: {},
		purch_cur: {},
		purch_total: {},
		position: {},
		util_igst: {},
		util_cgst: {},
		util_sgst: {},
		util_total: {},
		carry: {}
	};

	data.forEach(row => {
		let particular = (row.particular || "").toUpperCase().trim();
		particular = particular.replace(/<[^>]+>/g, ""); // Strip HTML tags

		// Sales section
		if (particular === "PREVIOUS DUE") {
			result.sales_prev = row;
		} else if (particular.indexOf("SALES @") === 0) {
			result.sales_cur = row;
			result.tax_rate = particular.match(/[\d.]+/)?.[0] || "18.00";
		} else if (particular === "TOTAL LIABILITY") {
			result.sales_total = row;
		}
		// Purchase section
		else if (particular === "PREVIOUS ITC") {
			result.purch_prev = row;
		} else if (particular.indexOf("PURCHASE @") === 0) {
			result.purch_cur = row;
		} else if (particular === "TOTAL AVAILABLE ITC") {
			result.purch_total = row;
		}
		// Position
		else if (particular === "NET GST AVAILABLE (SURPLUS)") {
			result.position = row;
		}
		// Utilisation
		else if (particular === "IGST PAYABLE") {
			result.util_igst.payable = row.igst || 0;
		} else if (particular === "  PAID VIA ITC" && result.util_igst.payable) {
			result.util_igst.paid = row.igst || 0;
		} else if (particular === "CGST PAYABLE") {
			result.util_cgst.payable = row.cgst || 0;
		} else if (particular === "  PAID VIA ITC" && result.util_cgst.payable) {
			result.util_cgst.paid = row.cgst || 0;
		} else if (particular === "SGST PAYABLE") {
			result.util_sgst.payable = row.sgst || 0;
		} else if (particular === "  PAID VIA ITC" && result.util_sgst.payable) {
			result.util_sgst.paid = row.sgst || 0;
		} else if (particular === "TOTAL GST PAYABLE (CASH)") {
			result.util_total = row;
		}
		// Carry forward
		else if (particular === "AVAILABLE IGST") {
			result.carry.igst = row.igst || 0;
		} else if (particular === "AVAILABLE CGST") {
			result.carry.cgst = row.cgst || 0;
		} else if (particular === "AVAILABLE SGST") {
			result.carry.sgst = row.sgst || 0;
		} else if (particular === "TOTAL CARRY FORWARD ITC") {
			result.carry.total = row.total_gst || 0;
		}
	});

	return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERATE HTML
// ═══════════════════════════════════════════════════════════════════════════

function get_ca_format_html(data, filters) {
	let company = filters.company || "Veer Creation Works";
	let from_date = filters.from_date || "";
	let to_date = filters.to_date || "";

	// Format dates as DD-MM-YYYY
	let from_disp = frappe.datetime.str_to_user(from_date);
	let to_disp = frappe.datetime.str_to_user(to_date);

	// Get month name for footer using standard JavaScript
	let date_obj = frappe.datetime.str_to_obj(to_date);
	let month_names = ["January", "February", "March", "April", "May", "June",
		"July", "August", "September", "October", "November", "December"];
	let month_name = month_names[date_obj.getMonth()] + " " + date_obj.getFullYear();

	// Format currency function
	function fmt(val) {
		if (val === null || val === undefined || val === "") return "₹ 0.00";
		let n = parseFloat(val) || 0;
		return "₹ " + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	let html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8"/>
    <title>GST Summary – ${company}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;600;700&family=DM+Mono:wght@400;500&display=swap');
        
        :root {
            --ink: #1a1a2e; --paper: #fdfaf4; --rule: #c8b89a;
            --accent: #8b3a3a; --light-bg: #f4ede0; --muted: #7a6e60;
            --green: #2d6a4f;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'EB Garamond', Georgia, serif;
            background: #e8dfd0; color: var(--ink); padding: 24px 16px;
        }
        .page {
            background: var(--paper); max-width: 860px; margin: 0 auto;
            padding: 44px 52px; box-shadow: 0 4px 40px rgba(0,0,0,0.18);
            border-top: 6px solid var(--accent); position: relative;
        }
        .page::before {
            content: "GST SUMMARY"; position: absolute; top: 50%; left: 50%;
            transform: translate(-50%,-50%) rotate(-35deg);
            font-size: 90px; font-weight: 700; color: rgba(139,58,58,0.04);
            white-space: nowrap; pointer-events: none; letter-spacing: 12px;
        }
        .header { text-align: center; border-bottom: 2px solid var(--rule);
                 padding-bottom: 16px; margin-bottom: 6px; }
        .company-name { font-size: 26px; font-weight: 700; letter-spacing: 3px;
                       text-transform: uppercase; color: var(--accent); }
        .report-title { font-size: 13px; letter-spacing: 2px; text-transform: uppercase;
                       color: var(--muted); margin-top: 4px; }
        .period-badge { display: inline-block; margin-top: 10px; background: var(--light-bg);
                       border: 1px solid var(--rule); padding: 4px 18px;
                       font-family: 'DM Mono', monospace; font-size: 12px;
                       letter-spacing: 1px; color: var(--ink); border-radius: 2px; }
        .section { margin-top: 22px; }
        .section-label { font-size: 11px; font-weight: 600; letter-spacing: 2.5px;
                        text-transform: uppercase; color: var(--accent);
                        border-bottom: 1px solid var(--rule); padding-bottom: 4px; }
        .divider { height: 1px; background: linear-gradient(to right, transparent, var(--rule), transparent);
                  margin: 4px 0 14px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        thead tr th { background: var(--light-bg); text-align: right; padding: 8px 10px;
                     font-size: 10.5px; letter-spacing: 1px; text-transform: uppercase;
                     color: var(--muted); border-bottom: 1.5px solid var(--rule);
                     font-family: 'DM Mono', monospace; font-weight: 500; }
        thead tr th:first-child { text-align: left; }
        tbody tr td { padding: 7px 10px; text-align: right;
                     border-bottom: 1px solid rgba(200,184,154,0.35);
                     font-family: 'DM Mono', monospace; font-size: 12.5px; }
        tbody tr td:first-child { text-align: left; font-family: 'EB Garamond', serif; font-size: 14px; }
        tbody tr.prev-row td { color: var(--muted); font-style: italic; }
        tbody tr.total-row td { background: var(--light-bg); font-weight: 600;
                               border-top: 1.5px solid var(--rule);
                               border-bottom: 1.5px solid var(--rule); font-size: 13px; }
        tbody tr.total-row td:first-child { font-family: 'EB Garamond', serif;
                                           font-size: 15px; font-weight: 700; }
        tbody tr.sub-row td:first-child { padding-left: 26px; color: var(--muted); font-size: 13px; }
        .carry-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 0; }
        .carry-box { background: var(--paper); border: 1px solid var(--rule);
                    padding: 12px 14px; text-align: center; border-radius: 2px; }
        .carry-box .type { font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
                          font-family: 'DM Mono', monospace; color: var(--muted); margin-bottom: 6px; }
        .carry-box .amount { font-family: 'DM Mono', monospace; font-size: 17px;
                            font-weight: 500; color: var(--green); }
        .carry-box .amount.nil { color: var(--muted); }
        .carry-total { grid-column: 1/-1; background: var(--light-bg);
                      border: 1.5px solid var(--rule); padding: 12px 18px;
                      display: flex; justify-content: space-between; align-items: center;
                      border-radius: 2px; }
        .carry-total .lbl { font-size: 11px; letter-spacing: 2px; text-transform: uppercase;
                           color: var(--muted); font-family: 'DM Mono', monospace; }
        .carry-total .val { font-family: 'DM Mono', monospace; font-size: 18px;
                           font-weight: 600; color: var(--green); }
        .footer { margin-top: 34px; border-top: 1px solid var(--rule); padding-top: 14px;
                 display: flex; justify-content: space-between; align-items: flex-end; }
        .footer .note { font-size: 11px; color: var(--muted); line-height: 1.7; }
        .sig-box { text-align: center; }
        .sig-line { width: 160px; border-bottom: 1px solid var(--ink); margin-bottom: 5px; }
        .sig-label { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
                    color: var(--muted); font-family: 'DM Mono', monospace; }
        @media print {
            body { background: white; padding: 0; }
            .page { box-shadow: none; padding: 28px 36px; border-top: 4px solid var(--accent); }
        }
    </style>
</head>
<body>
<div class="page">
    <div class="header">
        <div class="company-name">${company}</div>
        <div class="report-title">GST Monthly Summary</div>
        <div class="period-badge">${from_disp} &nbsp;TO&nbsp; ${to_disp}</div>
    </div>

    <!-- SALES LIABILITY -->
    <div class="section">
        <div class="section-label">Sales Liability</div>
        <div class="divider"></div>
        <table>
            <thead>
                <tr>
                    <th>Particular</th>
                    <th>Taxable Amt.</th>
                    <th>IGST</th>
                    <th>CGST</th>
                    <th>SGST</th>
                    <th>Total GST</th>
                </tr>
            </thead>
            <tbody>
                <tr class="prev-row">
                    <td>Previous Due</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.sales_prev.igst)}</td>
                    <td>${fmt(data.sales_prev.cgst)}</td>
                    <td>${fmt(data.sales_prev.sgst)}</td>
                    <td>${fmt(data.sales_prev.total_gst)}</td>
                </tr>
                <tr>
                    <td>Sales @ ${data.tax_rate}%</td>
                    <td>${fmt(data.sales_cur.taxable_amt)}</td>
                    <td>${fmt(data.sales_cur.igst)}</td>
                    <td>${fmt(data.sales_cur.cgst)}</td>
                    <td>${fmt(data.sales_cur.sgst)}</td>
                    <td>${fmt(data.sales_cur.total_gst)}</td>
                </tr>
                <tr class="total-row">
                    <td>Total Liability</td>
                    <td>${fmt(data.sales_total.taxable_amt)}</td>
                    <td>${fmt(data.sales_total.igst)}</td>
                    <td>${fmt(data.sales_total.cgst)}</td>
                    <td>${fmt(data.sales_total.sgst)}</td>
                    <td>${fmt(data.sales_total.total_gst)}</td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- PURCHASE ITC -->
    <div class="section">
        <div class="section-label">Purchase Input Tax Credit (ITC)</div>
        <div class="divider"></div>
        <table>
            <thead>
                <tr>
                    <th>Particular</th>
                    <th>Taxable Amt.</th>
                    <th>IGST</th>
                    <th>CGST</th>
                    <th>SGST</th>
                    <th>Total GST</th>
                </tr>
            </thead>
            <tbody>
                <tr class="prev-row">
                    <td>Previous ITC</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.purch_prev.igst)}</td>
                    <td>${fmt(data.purch_prev.cgst)}</td>
                    <td>${fmt(data.purch_prev.sgst)}</td>
                    <td>${fmt(data.purch_prev.total_gst)}</td>
                </tr>
                <tr>
                    <td>Purchase @ ${data.tax_rate}%</td>
                    <td>${fmt(data.purch_cur.taxable_amt)}</td>
                    <td>${fmt(data.purch_cur.igst)}</td>
                    <td>${fmt(data.purch_cur.cgst)}</td>
                    <td>${fmt(data.purch_cur.sgst)}</td>
                    <td>${fmt(data.purch_cur.total_gst)}</td>
                </tr>
                <tr class="total-row">
                    <td>Total Available ITC</td>
                    <td>${fmt(data.purch_total.taxable_amt)}</td>
                    <td>${fmt(data.purch_total.igst)}</td>
                    <td>${fmt(data.purch_total.cgst)}</td>
                    <td>${fmt(data.purch_total.sgst)}</td>
                    <td>${fmt(data.purch_total.total_gst)}</td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- POSITION BEFORE UTILISATION -->
    <div class="section">
        <div class="section-label">GST Position Before Utilisation</div>
        <div class="divider"></div>
        <table>
            <thead>
                <tr>
                    <th>Particular</th>
                    <th>Taxable Amt.</th>
                    <th>IGST</th>
                    <th>CGST</th>
                    <th>SGST</th>
                    <th>Total GST</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>GST Payable (Before Utilisation)</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.sales_total.igst)}</td>
                    <td>${fmt(data.sales_total.cgst)}</td>
                    <td>${fmt(data.sales_total.sgst)}</td>
                    <td>${fmt(data.sales_total.total_gst)}</td>
                </tr>
                <tr>
                    <td>GST Available ITC</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.purch_total.igst)}</td>
                    <td>${fmt(data.purch_total.cgst)}</td>
                    <td>${fmt(data.purch_total.sgst)}</td>
                    <td>${fmt(data.purch_total.total_gst)}</td>
                </tr>
                <tr class="total-row">
                    <td>Net GST Available (Surplus)</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.position.igst)}</td>
                    <td>${fmt(data.position.cgst)}</td>
                    <td>${fmt(data.position.sgst)}</td>
                    <td>${fmt(data.position.total_gst)}</td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- UTILISATION -->
    <div class="section">
        <div class="section-label">Utilisation (Set-Off) of ITC</div>
        <div class="divider"></div>
        <table>
            <thead>
                <tr>
                    <th>Particular</th>
                    <th>Taxable Amt.</th>
                    <th>IGST</th>
                    <th>CGST</th>
                    <th>SGST</th>
                    <th>Total GST</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>IGST Payable</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.util_igst.payable)}</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.util_igst.payable)}</td>
                </tr>
                <tr class="sub-row">
                    <td>Paid via ITC</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.util_igst.paid)}</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.util_igst.paid)}</td>
                </tr>
                <tr>
                    <td>CGST Payable</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.util_cgst.payable)}</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.util_cgst.payable)}</td>
                </tr>
                <tr class="sub-row">
                    <td>Paid via ITC</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.util_cgst.paid)}</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.util_cgst.paid)}</td>
                </tr>
                <tr>
                    <td>SGST Payable</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.util_sgst.payable)}</td>
                    <td>${fmt(data.util_sgst.payable)}</td>
                </tr>
                <tr class="sub-row">
                    <td>Paid via ITC</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.util_sgst.paid)}</td>
                    <td>${fmt(data.util_sgst.paid)}</td>
                </tr>
                <tr class="total-row">
                    <td>Total GST Payable (Cash)</td>
                    <td>${fmt(0)}</td>
                    <td>${fmt(data.util_total.igst)}</td>
                    <td>${fmt(data.util_total.cgst)}</td>
                    <td>${fmt(data.util_total.sgst)}</td>
                    <td>${fmt(data.util_total.total_gst)}</td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- CARRY FORWARD -->
    <div class="section">
        <div class="section-label">ITC Available for Next Month</div>
        <div class="divider"></div>
        <div class="carry-grid">
            <div class="carry-box">
                <div class="type">IGST</div>
                <div class="amount ${data.carry.igst === 0 ? 'nil' : ''}">${fmt(data.carry.igst)}</div>
            </div>
            <div class="carry-box">
                <div class="type">CGST</div>
                <div class="amount">${fmt(data.carry.cgst)}</div>
            </div>
            <div class="carry-box">
                <div class="type">SGST</div>
                <div class="amount">${fmt(data.carry.sgst)}</div>
            </div>
            <div class="carry-total">
                <span class="lbl">Total ITC Carry Forward →</span>
                <span class="val">${fmt(data.carry.total)}</span>
            </div>
        </div>
    </div>

    <!-- FOOTER -->
    <div class="footer">
        <div class="note">
            Company: <strong>${company}</strong><br/>
            Period: ${month_name} &nbsp;|&nbsp; ERPNext · India Compliance
        </div>
        <div class="sig-box">
            <div class="sig-line"></div>
            <div class="sig-label">Authorised Signatory</div>
        </div>
    </div>
</div>

<script>
// Auto-print dialog
setTimeout(() => {
    if (confirm("Print this GST Summary now?")) {
        window.print();
    }
}, 500);
</script>
</body>
</html>`;

	return html;
}