// apps/gajanand/gajanand/public/js/gajanand_redirect.js
// Uses native browser URL events — works in Frappe v15 Vue router

function gj_check_redirect() {
    var hash = window.location.hash || '';
    var path = window.location.pathname || '';
    var full = hash + path;

    console.log('gj_check_redirect called, url:', full);

    if (full.toLowerCase().indexOf('gajanand-house') !== -1) {
        console.log('Gajanand House detected — redirecting to dashboard');
        window.location.hash = '#gajanand-dashboard';
    }
}

// Fire on hash change (Frappe v15 uses hash-based routing)
window.addEventListener('hashchange', function () {
    gj_check_redirect();
});

// Fire on browser back/forward
window.addEventListener('popstate', function () {
    gj_check_redirect();
});

// Also fire on initial page load in case user lands directly on workspace URL
window.addEventListener('load', function () {
    gj_check_redirect();
});