frappe.pages['company-selector'].on_page_load = function (wrapper) {
    frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Select Company',
        single_column: true
    });

    var $main = $(wrapper).find('.layout-main-section');
    $main.empty();
    $main.html('<div class="gj-selector-loading">Loading companies…</div>');

    /* ── Fetch current company + all companies in parallel ── */
    var currentCompany = frappe.defaults.get_default('company') || '';

    frappe.call({
        method: 'frappe.client.get_list',
        args: { doctype: 'Company', fields: ['name', 'abbr'], limit: 50 },
        callback: function (r) {
            if (!r.message || !r.message.length) {
                $main.html('<div class="gj-selector-loading">No companies found.</div>');
                return;
            }
            renderPage($main, r.message, currentCompany);
        }
    });
};

/* ─────────────────────────────────────────────────────────────── */
function renderPage($container, companies, currentCompany) {
    $container.empty();

    var html = '<div class="gj-selector-wrap">';

    /* Header */
    html += '<div class="gj-selector-header">'
        + '<div class="gj-selector-title">Select Active Company</div>'
        + '<div class="gj-selector-sub">Choose the company you want to work in. '
        + 'All transactions will be recorded under the selected company.</div>'
        + '</div>';

    /* Active company banner */
    if (currentCompany) {
        html += '<div class="gj-active-banner">'
            + '<div class="gj-active-banner-dot"></div>'
            + '<div>'
            +   '<div class="gj-active-banner-label">Currently Active</div>'
            +   '<div class="gj-active-banner-name">' + frappe.utils.escape_html(currentCompany) + '</div>'
            + '</div>'
            + '</div>';
    }

    /* Company grid */
    html += '<div class="gj-company-grid">';
    companies.forEach(function (c) {
        var isActive = (c.name === currentCompany);
        html += '<button class="gj-company-btn' + (isActive ? ' gj-active' : '')
            + '" data-company="' + frappe.utils.escape_html(c.name) + '">'
            + (isActive ? '<div class="gj-active-tick">✓</div>' : '')
            + '<div class="gj-company-icon">🏢</div>'
            + '<div class="gj-company-btn-name">' + frappe.utils.escape_html(c.name) + '</div>'
            + '<div class="gj-company-btn-tag">'
            + (isActive ? '✓ Active' : (c.abbr || 'Switch'))
            + '</div>'
            + '</button>';
    });
    html += '</div></div>';

    $container.html(html);

    /* ── Click handler ── */
    $container.find('.gj-company-btn').on('click', function () {
        var $btn    = $(this);
        var company = $btn.data('company');
        if (!company) return;

        /* Optimistic UI: mark clicked button as active immediately */
        $container.find('.gj-company-btn').removeClass('gj-active');
        $container.find('.gj-active-tick').remove();
        $container.find('.gj-company-btn-tag').text(function () {
            return $(this).closest('.gj-company-btn').data('company') === company
                ? '✓ Active'
                : $(this).closest('.gj-company-btn').find('.gj-company-icon').text();
        });
        $btn.addClass('gj-active');
        $btn.find('.gj-company-btn-name').before('<div class="gj-active-tick">✓</div>');
        $btn.find('.gj-company-btn-tag').text('✓ Active');

        frappe.call({
            method: 'erpnext.api.set_session_company',
            args: { company: company },
            callback: function () {
                frappe.show_alert({
                    message: '✅ Switched to <b>' + company + '</b>',
                    indicator: 'green'
                }, 4);
                /* Small delay so the alert is visible before redirect */
                setTimeout(function () {
                    window.location.href = '/app';
                }, 900);
            }
        });
    });
}
