/**
 * company_navbar.js
 * Runs on every Frappe page. Reads the active company from frappe.defaults
 * and updates the ".nav-link.company-selector" anchor in the top navbar
 * so the user always sees which company is currently active.
 *
 * Registered in hooks.py → app_include_js
 */
(function () {
    'use strict';

    var SELECTOR = '.nav-link.company-selector, a.company-selector';

    function getActiveCompany() {
        try {
            return frappe.defaults.get_default('company')
                || (frappe.boot && frappe.boot.user_default_company)
                || '';
        } catch (e) {
            return '';
        }
    }

    function updateNavbar() {
        var company = getActiveCompany();
        document.querySelectorAll(SELECTOR).forEach(function (link) {
            if (!link) return;

            /* ── update tooltip ── */
            link.title = company ? ('Active Company: ' + company) : 'Select Company';

            /* ── find or create the active-company pill ── */
            var pill = link.querySelector('.gj-co-pill');
            if (!pill) {
                pill = document.createElement('span');
                pill.className = 'gj-co-pill';
                link.appendChild(pill);
            }

            if (company) {
                pill.textContent = company;
                pill.style.display = 'inline-block';
            } else {
                pill.textContent = '';
                pill.style.display = 'none';
            }
        });
    }

    /* Run after frappe is ready, and again on every route/page change */
    function boot() {
        if (typeof frappe === 'undefined' || !frappe.defaults) {
            setTimeout(boot, 200);
            return;
        }
        updateNavbar();
        /* page-change fires whenever the user navigates in the SPA */
        $(document).on('page-change', function () {
            setTimeout(updateNavbar, 150);
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        setTimeout(boot, 300);
    });

})();
