// Copyright (c) 2026, TriLence Tech and contributors
// Interest Calculator — Script Report JS

frappe.query_reports["Interest Calculator"] = {

    // ── FILTERS ───────────────────────────────────────────────────────────────

    filters: [
        {
            fieldname: "company",
            label: __("Company"),
            fieldtype: "Link",
            options: "Company",
            default: frappe.defaults.get_default("company"),
            reqd: 1,
        },
        {
            fieldname: "account",
            label: __("Account"),
            fieldtype: "Link",
            options: "Account",
            reqd: 1,
            get_query: function () {
                var company = frappe.query_report.get_filter_value("company");
                return { filters: { company: company, is_group: 0 } };
            },
        },
        {
            fieldname: "rate",
            label: __("Interest Rate (% p.a.)"),
            fieldtype: "Float",
            default: 12,
            reqd: 1,
        },
        {
            fieldname: "to_date",
            label: __("To Date"),
            fieldtype: "Date",
            default: frappe.datetime.month_end(),
            reqd: 1,
        },
    ],

    // ── ONLOAD ────────────────────────────────────────────────────────────────

    onload: function (report) {
        report.page.add_inner_button(__("Export PDF"), function () {
            _ic_export_pdf();
        });
    },

    // ── FORMATTER ─────────────────────────────────────────────────────────────

    formatter: function (value, row, column, data, default_formatter) {
        if (!data) return default_formatter(value, row, column, data);
        var rt = data._row_type;
        var fn = column.fieldname;

        // ── Grand Summary ──────────────────────────────────────────────────
        if (rt === "result") {
            var bold = "font-weight:700;font-size:13px;";
            if (fn === "description")
                return `<span style="${bold}color:#1e3a5f;">${value || ""}</span>`;
            if (fn === "principal")
                return `<span style="${bold}color:#1e3a5f;">${_ic_fmt(value)}</span>`;
            if (fn === "interest_amount")
                return `<span style="${bold}color:#b45309;">${_ic_fmt(value)}</span>`;
            if (fn === "total_payable")
                return `<span style="${bold}color:#15803d;background:#f0fdf4;padding:2px 8px;border-radius:4px;">${_ic_fmt(value)}</span>`;
            if (fn === "rate")
                return `<span style="${bold}">${flt(value, 2)} %</span>`;
            if (fn === "days")
                return `<span style="${bold}">${value} days</span>`;
        }

        // ── Interest segment ───────────────────────────────────────────────
        if (rt === "segment") {
            if (fn === "description")
                return `<span style="color:#374151;padding-left:12px;">${value || ""}</span>`;
            if (fn === "principal")
                return `<span style="color:#374151;">${_ic_fmt(value)}</span>`;
            if (fn === "interest_amount")
                return `<span style="color:#b45309;font-weight:600;">${_ic_fmt(value)}</span>`;
            if (fn === "total_payable")
                return `<span style="color:#9ca3af;">—</span>`;
            if (fn === "rate")
                return `<span style="color:#6b7280;">${flt(value, 2)} %</span>`;
        }

        // ── Deposit / Withdrawal event ─────────────────────────────────────
        if (rt === "event") {
            var is_dep = (data.description || "").startsWith("Deposit");
            var color  = is_dep ? "#15803d" : "#dc2626";
            if (fn === "description")
                return `<span style="font-weight:600;color:${color};">▶ ${value || ""}</span>`;
            if (fn === "principal")
                return `<span style="font-weight:600;color:${color};">${_ic_fmt(value)}</span>`;
            if (fn === "total_payable")
                return `<span style="font-weight:600;color:${color};">${_ic_fmt(value)}</span>`;
            if (fn === "interest_amount" || fn === "rate" || fn === "days")
                return `<span style="color:#9ca3af;">—</span>`;
        }

        // ── 31-March Capitalisation ────────────────────────────────────────
        if (rt === "year_end") {
            if (fn === "description")
                return `<span style="font-weight:700;color:#7c3aed;">✦ ${value || ""}</span>`;
            if (fn === "principal")
                return `<span style="font-weight:600;color:#7c3aed;">${_ic_fmt(value)}</span>`;
            if (fn === "interest_amount")
                return `<span style="font-weight:700;color:#7c3aed;">${_ic_fmt(value)}</span>`;
            if (fn === "total_payable")
                return `<span style="font-weight:700;color:#7c3aed;background:#f5f3ff;padding:2px 8px;border-radius:4px;">
                            New Principal: ${_ic_fmt(value)}</span>`;
            if (fn === "rate" || fn === "days")
                return `<span style="color:#9ca3af;">—</span>`;
        }

        return default_formatter(value, row, column, data);
    },
};


// ── HELPERS ───────────────────────────────────────────────────────────────────

function flt(v, d) {
    return parseFloat((parseFloat(v) || 0).toFixed(d === undefined ? 2 : d));
}

function _ic_fmt(v) {
    if (v === null || v === undefined || v === "") return "—";
    return "₹ " + flt(v, 2).toLocaleString("en-IN", {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
}

function _ic_date(d) {
    if (!d) return "";
    var dt = typeof d === "string" ? new Date(d + "T00:00:00") : d;
    return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}


// ── PDF EXPORT ────────────────────────────────────────────────────────────────

function _ic_export_pdf() {
    var data = frappe.query_report.data;
    if (!data || !data.length) {
        frappe.msgprint(__("No data to export."));
        return;
    }

    var filters  = frappe.query_report.get_values();
    var company  = filters.company || "";
    var account  = filters.account || "";
    var rate     = flt(filters.rate || 12, 2);
    var to_dt    = filters.to_date || "";

    var summary = data.find(function (r) { return r._row_type === "result"; }) || {};
    var details = data.filter(function (r) { return r._row_type !== "result"; });
    var from_dt = summary.from_date || "";

    var html = _ic_build_pdf(company, account, rate, from_dt, to_dt, summary, details);
    var blob = new Blob([html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
}


function _ic_build_pdf(company, account, rate, from_dt, to_dt, s, details) {
    var principal    = flt(s.principal || 0, 2);
    var grand_int    = flt(s.interest_amount || 0, 2);
    var total_payable = flt(s.total_payable || 0, 2);
    var days         = s.days || 0;
    var today        = _ic_date(frappe.datetime.get_today());

    // Build detail rows HTML
    var detail_rows_html = details.map(function (r) {
        var rt = r._row_type;

        var pca = "-webkit-print-color-adjust:exact;print-color-adjust:exact;";
        if (rt === "event") {
            var is_dep = (r.description || "").startsWith("Deposit");
            var clr    = is_dep ? "#15803d" : "#dc2626";
            var bg     = is_dep ? "#f0fdf4" : "#fef2f2";
            return `<tr class="event-row" style="background:${bg};${pca}">
                <td colspan="4" style="color:${clr};font-weight:600;padding:7px 14px;${pca}">
                    ▶ ${r.description || ""}
                </td>
                <td style="text-align:right;color:${clr};font-weight:700;padding:7px 14px;${pca}" colspan="2">
                    New Working Principal: ${_ic_fmt(r.total_payable)}
                </td>
            </tr>`;
        }

        if (rt === "year_end") {
            return `<tr class="year-end-row" style="background:#f5f3ff;${pca}">
                <td colspan="4" style="color:#7c3aed;font-weight:700;padding:8px 14px;${pca}">
                    ✦ ${r.description || ""}
                </td>
                <td style="text-align:right;color:#7c3aed;padding:8px 14px;${pca}">
                    Interest Added: ${_ic_fmt(r.interest_amount)}
                </td>
                <td style="text-align:right;color:#7c3aed;font-weight:700;padding:8px 14px;${pca}">
                    New Principal: ${_ic_fmt(r.total_payable)}
                </td>
            </tr>`;
        }

        // segment row
        return `<tr>
            <td style="padding-left:20px;color:#374151;">${r.description || "Interest Period"}</td>
            <td style="text-align:right;">${_ic_fmt(r.principal)}</td>
            <td style="text-align:center;">${_ic_date(r.from_date)}</td>
            <td style="text-align:center;">${_ic_date(r.to_date)}</td>
            <td style="text-align:center;">${r.days || 0}</td>
            <td style="text-align:right;color:#b45309;font-weight:600;">${_ic_fmt(r.interest_amount)}</td>
        </tr>`;
    }).join("");

    return `<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<title>Interest Calculator — ${account}</title>
<style>
  * { font-family: Arial, sans-serif; box-sizing: border-box; margin: 0; padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important; }
  body { background: #f3f4f6; padding: 24px; }
  .page { max-width: 900px; margin: 0 auto; background: #fff;
          border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.12); overflow: hidden; }

  .hdr { background: #1e3a5f !important; color: #fff !important; padding: 20px 28px; }
  .hdr-company { font-size: 20px; font-weight: 700; }
  .hdr-title   { font-size: 13px; color: #93c5fd !important; margin-top: 2px;
                 letter-spacing: 1px; text-transform: uppercase; }
  .hdr-meta    { display: flex; gap: 20px; margin-top: 10px; font-size: 12px;
                 color: #cbd5e1 !important; flex-wrap: wrap; }
  .hdr-meta span strong { color: #fff !important; }

  .boxes { display: flex; border-bottom: 1px solid #e5e7eb; }
  .box   { flex: 1; padding: 16px 20px; border-right: 1px solid #e5e7eb; }
  .box:last-child { border-right: none; }
  .box-label { font-size: 10.5px; color: #6b7280; text-transform: uppercase; letter-spacing: .6px; }
  .box-value { font-size: 20px; font-weight: 700; margin-top: 3px; }
  .box-sub   { font-size: 10.5px; color: #9ca3af; margin-top: 2px; }
  .box-p  .box-value { color: #1e3a5f !important; }
  .box-d  .box-value { color: #6b7280 !important; font-size: 17px; }
  .box-i  .box-value { color: #b45309 !important; }
  .box-t  .box-value { color: #15803d !important; }

  .formula-bar { background: #f8fafc !important; border-bottom: 1px solid #e5e7eb;
                 padding: 9px 20px; font-size: 11.5px; color: #6b7280; }
  .formula-bar strong { color: #374151; }

  .section-title { padding: 14px 20px 6px; font-size: 11px; font-weight: 700;
                   color: #374151; text-transform: uppercase; letter-spacing: .6px; }

  table { width: 100%; border-collapse: collapse; }
  thead th { background: #1e3a5f !important; color: #fff !important; padding: 8px 14px;
             font-size: 11px; text-align: left; }
  thead th.r { text-align: right; }
  thead th.c { text-align: center; }
  tbody tr:nth-child(even):not(.event-row):not(.year-end-row) { background: #f9fafb !important; }
  tbody td { padding: 7px 14px; font-size: 12px; color: #374151;
             border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
  tfoot td { background: #1e3a5f !important; color: #fff !important; font-weight: 700;
             padding: 9px 14px; font-size: 12.5px; }
  tfoot td.r { text-align: right; }

  .footer { padding: 10px 20px; background: #f9fafb !important;
            border-top: 1px solid #e5e7eb;
            display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; }

  .print-wrap { text-align: center; padding: 14px; }
  .print-btn  { background: #1e3a5f; color: #fff; border: none; border-radius: 6px;
                padding: 9px 26px; font-size: 13px; cursor: pointer; }

  @media print {
    body { background: #fff !important; padding: 0; }
    .page { box-shadow: none; border-radius: 0; max-width: 100%; }
    .print-wrap { display: none; }
    .hdr { background: #1e3a5f !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    thead th { background: #1e3a5f !important; color: #fff !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    tfoot td { background: #1e3a5f !important; color: #fff !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
</style>
</head><body><div class="page">

  <div class="hdr">
    <div class="hdr-company">${company}</div>
    <div class="hdr-title">Interest Calculator</div>
    <div class="hdr-meta">
      <span>Account: <strong>${account}</strong></span>
      <span>Credit Date: <strong>${_ic_date(from_dt)}</strong></span>
      <span>Up To: <strong>${_ic_date(to_dt)}</strong></span>
      <span>Rate: <strong>${rate}% p.a.</strong></span>
      <span>Printed: <strong>${today}</strong></span>
    </div>
  </div>

  <div class="boxes">
    <div class="box box-p">
      <div class="box-label">Opening Principal</div>
      <div class="box-value" style="color:#1e3a5f;">${_ic_fmt(principal)}</div>
      <div class="box-sub">First credit on ${_ic_date(from_dt)}</div>
    </div>
    <div class="box box-d">
      <div class="box-label">Total Duration</div>
      <div class="box-value" style="color:#6b7280;">${days} days</div>
      <div class="box-sub">${_ic_date(from_dt)} to ${_ic_date(to_dt)}</div>
    </div>
    <div class="box box-i">
      <div class="box-label">Total Interest</div>
      <div class="box-value" style="color:#b45309;">${_ic_fmt(grand_int)}</div>
      <div class="box-sub">@ ${rate}% p.a. simple interest</div>
    </div>
    <div class="box box-t">
      <div class="box-label">Total Payable</div>
      <div class="box-value" style="color:#15803d;">${_ic_fmt(total_payable)}</div>
      <div class="box-sub">Principal + All Interest</div>
    </div>
  </div>

  <div class="formula-bar">
    <strong>Method:</strong>
    Simple Interest = Principal × Rate × Days ÷ 36500 &nbsp;|&nbsp;
    <strong>31-March:</strong> Accrued interest added to principal each financial year end
  </div>

  <div class="section-title">Detailed Interest Schedule</div>
  <table>
    <thead><tr>
      <th>Description</th>
      <th class="r">Working Principal</th>
      <th class="c">From</th>
      <th class="c">To</th>
      <th class="c">Days</th>
      <th class="r">Interest</th>
    </tr></thead>
    <tbody>${detail_rows_html}</tbody>
    <tfoot><tr>
      <td colspan="4">Total Interest</td>
      <td class="r">${days} days</td>
      <td class="r">${_ic_fmt(grand_int)}</td>
    </tr></tfoot>
  </table>

  <div class="footer">
    <span>${company} · Interest Calculator</span>
    <span>Printed on ${today}</span>
  </div>

  <div class="print-wrap">
    <button class="print-btn" onclick="window.print()">🖨️&nbsp; Print / Save as PDF</button>
  </div>

</div></body></html>`;
}
