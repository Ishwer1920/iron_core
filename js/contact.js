/* IronCore Pharma — site-wide contact info (phone + email).
   Values are admin-managed via /api/contact. Elements are hidden until a value
   is set and marked visible, so nothing shows a stale/placeholder number. */
(function () {
  "use strict";

  function show(a, on) {
    a.hidden = !on;
    a.style.display = on ? "" : "none";
  }
  function telHref(p) { return "tel:" + String(p).replace(/[^0-9+]/g, ""); }

  function apply(c) {
    var phone = (c && c.phone) || "";
    var email = (c && c.email) || "";

    // Anchors that display the phone number as their text (top bar, footer).
    document.querySelectorAll(".js-phone").forEach(function (a) {
      if (phone) { a.textContent = phone; a.setAttribute("href", telHref(phone)); }
      show(a, !!phone);
    });
    // Phone link-only elements, e.g. the floating "Call Us" button (keep text).
    document.querySelectorAll(".js-phone-link").forEach(function (a) {
      if (phone) a.setAttribute("href", telHref(phone));
      show(a, !!phone);
    });
    // Anchors that display the email as their text (top bar, footer).
    document.querySelectorAll(".js-email").forEach(function (a) {
      if (email) { a.textContent = email; a.setAttribute("href", "mailto:" + email); }
      show(a, !!email);
    });
  }

  fetch("/api/contact")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (c) { if (c) apply(c); })
    .catch(function () { /* leave defaults as-is */ });
})();
