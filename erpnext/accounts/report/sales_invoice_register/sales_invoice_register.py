# Copyright (c) 2026, TriLence Tech and contributors
# Sales Invoice Register — Script Report

import re

import frappe
from frappe import _
from frappe.utils import flt, formatdate, get_first_day, get_last_day, getdate


def execute(filters=None):
    filters = frappe._dict(filters or {})
    _validate(filters)
    return _columns(), _data(filters)


# ── VALIDATION ────────────────────────────────────────────────────────────────

def _validate(filters):
    if not filters.company:
        frappe.throw(_("Please select a Company"))
    if not filters.from_date:
        frappe.throw(_("Please select From Date"))
    if not filters.to_date:
        frappe.throw(_("Please select To Date"))
    if getdate(filters.from_date) > getdate(filters.to_date):
        frappe.throw(_("From Date cannot be greater than To Date"))


# ── COLUMNS ───────────────────────────────────────────────────────────────────

def _columns():
    return [
        {
            "label": _("Invoice No"),
            "fieldname": "invoice_name",
            "fieldtype": "Link",
            "options": "Sales Invoice",
            "width": 180,
        },
        {
            "label": _("Date"),
            "fieldname": "posting_date",
            "fieldtype": "Date",
            "width": 100,
        },
        {
            "label": _("Customer"),
            "fieldname": "customer_name",
            "fieldtype": "Data",
            "width": 220,
        },
        {
            "label": _("Grand Total"),
            "fieldname": "grand_total",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 130,
        },
        {
            "label": _("Outstanding"),
            "fieldname": "outstanding_amount",
            "fieldtype": "Currency",
            "options": "currency",
            "width": 130,
        },
        {
            "label": _("Status"),
            "fieldname": "status",
            "fieldtype": "Data",
            "width": 100,
        },
        # Hidden raw invoice name used by JS PDF button
        {
            "label": _("_name"),
            "fieldname": "_name",
            "fieldtype": "Data",
            "hidden": 1,
            "width": 0,
        },
        {
            "label": _("PDF"),
            "fieldname": "_pdf",
            "fieldtype": "Data",
            "width": 70,
        },
    ]


# ── DATA ──────────────────────────────────────────────────────────────────────

def _data(filters):
    company_currency = (
        frappe.get_cached_value(
            "Company", filters.company, "default_currency") or "INR"
    )

    conditions = [
        "docstatus !=  2",
        "is_return = 0",
        "company = %(company)s",
        "posting_date BETWEEN %(from_date)s AND %(to_date)s",
    ]
    params = {
        "company":   filters.company,
        "from_date": filters.from_date,
        "to_date":   filters.to_date,
    }

    if filters.get("customer"):
        conditions.append("customer = %(customer)s")
        params["customer"] = filters.customer

    rows = frappe.db.sql(
        """
        SELECT
            name            AS invoice_name,
            posting_date,
            customer_name,
            grand_total,
            outstanding_amount,
            status
        FROM `tabSales Invoice`
        WHERE {cond} AND docstatus !='2'
        ORDER BY posting_date, name
        """.format(cond=" AND ".join(conditions)),
        params,
        as_dict=True,
    )

    result = []
    grand_total_sum = 0.0

    for r in rows:
        grand_total_sum += flt(r.grand_total)
        result.append({
            "invoice_name":     r.invoice_name,
            "posting_date":     r.posting_date,
            "customer_name":    r.customer_name,
            "grand_total":      flt(r.grand_total, 2),
            "outstanding_amount": flt(r.outstanding_amount, 2),
            "status":           r.status,
            "_name":            r.invoice_name,
            "_pdf":             r.invoice_name,   # JS formatter replaces with button HTML
            "currency":         company_currency,
        })

    if result:
        result.append({
            "invoice_name":     "Total ({} invoices)".format(len(rows)),
            "posting_date":     None,
            "customer_name":    "",
            "grand_total":      flt(grand_total_sum, 2),
            "outstanding_amount": None,
            "status":           "",
            "_name":            "",
            "_pdf":             "",
            "currency":         company_currency,
            "_row_type":        "total",
        })

    return result


# ── BULK PDF API ──────────────────────────────────────────────────────────────

def _build_bulk_html(company, from_date, to_date, customer, pf_company_field):
    """Shared bulk-render logic; pf_company_field is the Company field holding the print format name."""
    print_format = frappe.db.get_value(
        "Company", company, pf_company_field) or "Standard"

    conditions = [
        "docstatus != 2",
        "is_return = 0",
        "company = %(company)s",
        "posting_date BETWEEN %(from_date)s AND %(to_date)s",
    ]
    params = {"company": company, "from_date": from_date, "to_date": to_date}

    if customer:
        conditions.append("customer = %(customer)s")
        params["customer"] = customer

    names = frappe.db.sql(
        "SELECT name FROM `tabSales Invoice` WHERE {} ORDER BY posting_date, name".format(
            " AND ".join(conditions)
        ),
        params,
        pluck="name",
    )

    if not names:
        frappe.throw(
            _("No submitted Sales Invoices found for the selected period."))

    pages = []
    for name in names:
        try:
            pages.append(_render_invoice_page(name, print_format))
        except Exception:
            pass

    if not pages:
        frappe.throw(
            _("Could not render any invoice. Check the print format: {0}").format(print_format))

    combined = _wrap_pages_html(pages)
    return {"html": combined, "count": len(pages), "print_format": print_format}


@frappe.whitelist()
def get_bulk_invoice_html(company, from_date, to_date, customer=None):
    """Combined printable HTML using Company.print_format_si (with letterhead background)."""
    return _build_bulk_html(company, from_date, to_date, customer, "print_format_si")


@frappe.whitelist()
def get_bulk_invoice_html_no_bg(company, from_date, to_date, customer=None):
    """Combined printable HTML using Company.print_format_si_without_bg (no background)."""
    return _build_bulk_html(company, from_date, to_date, customer, "print_format_si_without_bg")


@frappe.whitelist()
def get_single_invoice_html(invoice_name, company):
    """Return printable HTML for one Sales Invoice using Company.print_format_si."""
    print_format = frappe.db.get_value(
        "Company", company, "print_format_si") or "Standard"
    html = _render_invoice_page(invoice_name, print_format)
    # Inject auto-print trigger into the existing <head>
    script = (
        '<script>window.addEventListener("load",function(){'
        'setTimeout(function(){window.print();},500);});</script>'
    )
    html = html.replace("</head>", script + "</head>",
                        1) if "</head>" in html else html + script
    return {"html": html, "print_format": print_format}


def _render_invoice_page(invoice_name, print_format_name):
    """
    Render a single invoice as clean, standalone HTML.

    Uses the template stored in the Print Format document directly so the
    output contains ONLY the invoice content — no Frappe printview chrome,
    no toolbar, no external script/link tags.
    """
    # Direct template rendering: no frappe.get_print() wrapper
    template_html = frappe.db.get_value(
        "Print Format", print_format_name, "html") or ""
    if template_html.strip():
        doc = frappe.get_doc("Sales Invoice", invoice_name)
        return frappe.render_template(template_html, {"doc": doc})

    # Fallback for non-HTML print formats (e.g. "Standard")
    # frappe.get_print returns the full Frappe printview page; extract only
    # the body content and strip any injected scripts/link tags.
    raw = frappe.get_print(
        "Sales Invoice", invoice_name,
        print_format=print_format_name,
        no_letterhead=True,
    )
    styles = "\n".join(re.findall(
        r'<style[^>]*>.*?</style>', raw, re.DOTALL | re.IGNORECASE))
    m = re.search(r'<body[^>]*>(.*?)</body\s*>',
                  raw, re.DOTALL | re.IGNORECASE)
    body = m.group(1).strip() if m else raw
    body = re.sub(r'<script\b[^>]*>.*?</script>', '',
                  body, flags=re.DOTALL | re.IGNORECASE)
    return (
        '<!DOCTYPE html><html><head><meta charset="UTF-8">\n'
        + styles
        + '\n</head><body>\n'
        + body
        + '\n</body></html>'
    )


def _wrap_pages_html(pages):
    """Combine multiple rendered invoice HTML pages into one printable document."""
    styles = "\n".join(
        re.findall(r'<style[^>]*>.*?</style>',
                   pages[0], re.DOTALL | re.IGNORECASE)
    ) if pages else ""

    # Extract the letterhead background URL from the rendered template CSS so we
    # can re-apply it per-page div.  The template sets it on `body`; with a single
    # body spanning all invoices and background-repeat:no-repeat, only the first
    # physical page would show the letterhead.  Applying it to each .si-page div
    # (height:297mm = one A4 page) gives every invoice its own independent background.
    _bg_url_re = re.compile(
        r'body\s*\{[^}]*background(?:-image)?\s*:\s*url\(["\']?([^"\')\s]+)["\']?\)',
        re.DOTALL | re.IGNORECASE,
    )
    bg_match = _bg_url_re.search(styles)
    bg_url = bg_match.group(1) if bg_match else None

    body_parts = []
    for p in pages:
        m = re.search(r'<body[^>]*>(.*?)</body\s*>',
                      p, re.DOTALL | re.IGNORECASE)
        part = m.group(1).strip() if m else p
        part = re.sub(r'<script\b[^>]*>.*?</script>',
                      '', part, flags=re.DOTALL | re.IGNORECASE)
        body_parts.append(part)

    # Per-page background CSS — only injected when a URL was found in the template.
    if bg_url:
        page_bg_css = (
            "  .si-page {\n"
            f"    background: url('{bg_url}') no-repeat top center !important;\n"
            "    background-size: 210mm 297mm !important;\n"
            "    -webkit-print-color-adjust: exact !important;\n"
            "    print-color-adjust: exact !important;\n"
            "  }\n"
        )
    else:
        page_bg_css = ""

    return (
        '<!DOCTYPE html><html><head><meta charset="UTF-8">\n'
        + styles + "\n"
        + "<style>\n"
        # Each .si-page is exactly one A4 page tall (matching @page{margin:0}).
        # height:297mm + page-break-after ensures every invoice starts on a fresh
        # physical page and has its own independent background image.
        + "  .si-page { height: 297mm; page-break-after: always; break-after: page; overflow: hidden; }\n"
        # + "  .si-page:last-of-type { page-break-after: avoid; break-after: avoid; }\n"
        # Suppress the body-level background — each .si-page carries its own.
        + "  body { background: none !important; }\n"
        + page_bg_css
        + "</style>\n"
        + "<script>\n"
        + "  window.addEventListener('load',function(){\n"
        + "    setTimeout(function(){window.print();},500);\n"
        + "  });\n"
        + "</script>\n"
        + "</head><body>\n"
        + "".join('<div class="si-page">{}</div>\n'.format(b)
                  for b in body_parts)
        + "</body></html>"
    )
