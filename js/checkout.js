/* IronCore Pharma — checkout page.
   The delivery + payment details are collected and validated, but shipment is
   not available in India, so Place Order shows a notice instead of completing
   a purchase. */
(function () {
  "use strict";
  var S = window.IronStore;
  if (!S) return;

  var grid = document.getElementById("checkout-grid");
  var emptyBox = document.getElementById("checkout-empty");
  var summaryItems = document.getElementById("summary-items");
  var sumSubtotal = document.getElementById("sum-subtotal");
  var sumShipping = document.getElementById("sum-shipping");
  var sumTotal = document.getElementById("sum-total");
  var summaryNote = document.getElementById("summary-note");
  var errorBox = document.getElementById("checkout-error");

  var SHIPMENT_MSG = "Sorry, shipment of these products is currently not available in India.";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }

  /* ---------- render summary ---------- */
  function renderSummary() {
    var cart = S.getCart();
    summaryItems.innerHTML = cart.map(function (it) {
      var lineUnit = S.parsePrice(it.price);
      var line = lineUnit > 0 ? S.formatMoney(lineUnit * (it.quantity || 1)) : "On request";
      return '<div class="summary-item">' +
        '<img src="' + esc(it.image) + '" alt="" onerror="this.style.visibility=\'hidden\'" />' +
        '<div class="summary-item__info"><p>' + esc(it.name) + '</p><span>Qty ' + (it.quantity || 1) + '</span></div>' +
        '<div class="summary-item__price">' + line + '</div></div>';
    }).join("");

    var subtotal = S.cartSubtotal();
    var shipping = S.shippingFor(subtotal);
    var hasPricing = S.cartHasPricing();
    sumSubtotal.textContent = hasPricing ? S.formatMoney(subtotal) : "On request";
    sumShipping.textContent = subtotal <= 0 ? "—" : (shipping === 0 ? "Free" : S.formatMoney(shipping));
    sumTotal.textContent = hasPricing ? S.formatMoney(subtotal + shipping) : "On request";
    summaryNote.textContent = hasPricing
      ? ""
      : "Some items are priced on request — our team will confirm the final amount.";
  }

  /* ---------- payment method toggle ---------- */
  var panels = { card: "pay-card", upi: "pay-upi", netbanking: "pay-netbanking", cod: "pay-cod" };
  function currentMethod() {
    var checked = grid.querySelector('input[name="pay"]:checked');
    return checked ? checked.value : "card";
  }
  function syncPanels() {
    var m = currentMethod();
    Object.keys(panels).forEach(function (k) {
      document.getElementById(panels[k]).hidden = k !== m;
    });
    grid.querySelectorAll(".pay-method").forEach(function (lbl) {
      lbl.classList.toggle("is-selected", lbl.querySelector("input").checked);
    });
  }
  grid.querySelectorAll('input[name="pay"]').forEach(function (r) {
    r.addEventListener("change", syncPanels);
  });

  /* ---------- input niceties ---------- */
  var cardNumber = document.getElementById("card-number");
  cardNumber && cardNumber.addEventListener("input", function () {
    var digits = this.value.replace(/\D/g, "").slice(0, 16);
    this.value = digits.replace(/(.{4})/g, "$1 ").trim();
  });
  var cardExp = document.getElementById("card-exp");
  cardExp && cardExp.addEventListener("input", function () {
    var d = this.value.replace(/\D/g, "").slice(0, 4);
    this.value = d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
  });
  ["card-cvv", "c-pincode"].forEach(function (id) {
    var el = document.getElementById(id);
    el && el.addEventListener("input", function () { this.value = this.value.replace(/\D/g, ""); });
  });

  /* ---------- validation ---------- */
  function validate() {
    if (!val("c-name")) return "Please enter the name for delivery.";
    if (!val("c-phone")) return "Please enter a contact phone number.";
    if (val("c-phone").replace(/\D/g, "").length < 10) return "Please enter a valid 10-digit phone number.";
    if (!val("c-address")) return "Please enter a delivery address.";
    var email = val("c-email");
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "Please enter a valid email address.";

    var m = currentMethod();
    if (m === "card") {
      if (val("card-number").replace(/\s/g, "").length < 12) return "Please enter a valid card number.";
      if (!val("card-name")) return "Please enter the name on the card.";
      if (!/^\d{2}\/\d{2}$/.test(val("card-exp"))) return "Enter card expiry as MM/YY.";
      if (val("card-cvv").length < 3) return "Please enter the card CVV.";
    } else if (m === "upi") {
      if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(val("upi-id"))) return "Please enter a valid UPI ID (e.g. name@bank).";
    } else if (m === "netbanking") {
      if (!val("nb-bank")) return "Please select your bank.";
    }
    return null;
  }

  function showError(msg, isField) {
    errorBox.textContent = msg;
    errorBox.classList.toggle("is-shipment", !isField);
    errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ---------- submit ---------- */
  grid.addEventListener("submit", function (e) {
    e.preventDefault();
    errorBox.textContent = "";
    errorBox.classList.remove("is-shipment");

    var err = validate();
    if (err) { showError(err, true); return; }

    // Details are valid, but there's no shipping available — surface the notice.
    showError(SHIPMENT_MSG, false);
  });

  /* ---------- init ---------- */
  function prefillEmail() {
    fetch("/api/me").then(function (res) { return res.ok ? res.json() : null; })
      .then(function (me) {
        var el = document.getElementById("c-email");
        if (me && me.email && el && !el.value) el.value = me.email;
      })
      .catch(function () { /* not logged in — fine */ });
  }

  if (!S.getCart().length) {
    grid.hidden = true;
    emptyBox.hidden = false;
  } else {
    renderSummary();
    syncPanels();
    prefillEmail();
  }
})();
