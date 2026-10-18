/* IronCore Pharma — product authenticity verification */
(function () {
  "use strict";

  var form = document.getElementById("verify-form");
  var input = document.getElementById("verify-code");
  var btn = document.getElementById("verify-submit");
  var result = document.getElementById("verify-result");
  if (!form) return;

  var ICONS = {
    verified: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>',
    used: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>',
    unauthorized: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></svg>',
  };
  var TITLES = {
    verified: "Product Verified",
    used: "Code Already Used",
    unauthorized: "Unauthorized Product",
    invalid: "Enter a code",
    error: "Something went wrong",
  };

  function show(status, message, extra) {
    var cls = (status === "verified") ? "is-verified"
      : (status === "unauthorized") ? "is-unauthorized"
      : (status === "used") ? "is-used" : "is-error";
    result.className = "verify-result " + cls;
    result.hidden = false;
    result.innerHTML =
      '<div class="verify-result__icon">' + (ICONS[status] || ICONS.unauthorized) + "</div>" +
      '<div class="verify-result__body">' +
        "<strong>" + (TITLES[status] || "Result") + "</strong>" +
        "<p>" + message + "</p>" +
        (extra || "") +
      "</div>";
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var code = (input.value || "").trim();
    if (!code) {
      show("invalid", "Please enter the product code printed on your pack.");
      input.focus();
      return;
    }
    btn.disabled = true;
    btn.textContent = "Checking…";
    result.hidden = true;

    fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code }),
    })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
      .then(function (r) {
        btn.disabled = false;
        btn.textContent = "Verify now";
        var d = r.d || {};
        var extra = (d.status === "used" && d.used_at)
          ? '<span class="verify-result__meta">First used: ' + esc(fmt(d.used_at)) + "</span>"
          : "";
        show(d.status || "error", esc(d.message || "Could not verify this code."), extra);
        if (d.status === "verified") { form.reset(); }
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = "Verify now";
        show("error", "Can't reach the server. Please try again.");
      });
  });
})();
