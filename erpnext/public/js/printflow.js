/**
 * printflow.js
 * Location: apps/erpnext/erpnext/public/js/printflow.js
 * Auto-loaded via hooks.py  web_include_js
 */
(function () {
    'use strict';

    var HIDE_SELECTORS = [
        '.navbar', '.navbar-default', '.navbar-expand-lg',
        '.web-navbar', '.navbar-wrap', 'header.navbar',
        'nav.navbar', '.page-header-wrap', '.navbar-header',
        '#navbar-main', '[class*="navbar"]'
    ];

    var MENU_REMOVE = ['my account', 'my profile', 'switch to desk', 'go to desk'];

    function hideNavbar() {
        HIDE_SELECTORS.forEach(function (sel) {
            try {
                document.querySelectorAll(sel).forEach(function (el) {
                    el.style.setProperty('display', 'none', 'important');
                    el.style.setProperty('height', '0', 'important');
                    el.style.setProperty('overflow', 'hidden', 'important');
                });
            } catch (e) { }
        });
    }

    function stripMenu() {
        /* Keep only Logout in the user dropdown */
        var items = document.querySelectorAll(
            '.dropdown-menu li, .dropdown-menu a, .user-menu li, .user-menu a'
        );
        items.forEach(function (el) {
            var t = (el.innerText || el.textContent || '').trim().toLowerCase();
            if (MENU_REMOVE.some(function (l) { return t.indexOf(l) !== -1; })) {
                el.style.setProperty('display', 'none', 'important');
            }
        });
    }

    function run() {
        hideNavbar();
        stripMenu();
    }

    /* Run at every possible moment Frappe might render the navbar */
    run();
    document.addEventListener('DOMContentLoaded', run);
    window.addEventListener('load', run);
    setTimeout(run, 200);
    setTimeout(run, 600);
    setTimeout(run, 1500);

})();