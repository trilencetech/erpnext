// public/js/idle_logout.js
(function () {
    const LIMIT_MS = 10 * 60 * 1000; // 10 minutes
    const ADMIN = "Administrator";

    let timer = null;

    function forceLogout() {
        if (frappe?.ui?.toolbar?.logout) {
            frappe.ui.toolbar.logout();
            return;
        }
        frappe.call({
            method: "logout", callback: () => {
                try { localStorage.clear(); sessionStorage.clear(); } catch (e) { }
                window.location.href = "/login";
            }
        });
    }

    function resetTimer() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            const user = frappe?.session?.user;
            if (user && user !== ADMIN) forceLogout();
        }, LIMIT_MS);
    }

    // Bind broadly and in capture phase to catch events before they’re consumed
    const EVENTS = [
        "mousemove", "mousedown", "mouseup", "click", "dblclick",
        "keydown", "keyup", "wheel", "scroll", "touchstart", "touchmove", "pointermove"
    ];

    function bindActivity(el) {
        if (!el) return;
        EVENTS.forEach(evt => el.addEventListener(evt, resetTimer, { passive: true, capture: true }));
    }

    function init() {
        bindActivity(window);
        bindActivity(document);
        bindActivity(document.body);

        // Common Desk containers (cover different versions/layouts)
        ["#body", ".layout-main", ".page-container", "main", ".desk-container", ".container.page"]
            .forEach(sel => bindActivity(document.querySelector(sel)));

        // Reset on route changes inside Desk
        if (frappe?.router?.on) frappe.router.on("change", resetTimer);

        // Also reset when tab gains focus or becomes visible
        document.addEventListener("visibilitychange", resetTimer, { capture: true });
        window.addEventListener("focus", resetTimer, { capture: true });

        // Kick off
        resetTimer();
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        init();
    } else {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    }
})();
