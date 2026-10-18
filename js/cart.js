/* IronCore Pharma — cart page */
(function () {
  "use strict";
  var S = window.IronStore;
  if (!S) return;

  var list = document.getElementById("cart-list");
  var grid = document.getElementById("cart-grid");
  var empty = document.getElementById("cart-empty");
  var sumSubtotal = document.getElementById("sum-subtotal");
  var sumShipping = document.getElementById("sum-shipping");
  var sumTotal = document.getElementById("sum-total");
  var summaryNote = document.getElementById("summary-note");
  var toCheckout = document.getElementById("to-checkout");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function lineMarkup(item) {
    var unit = S.parsePrice(item.price);
    var lineTotal = unit > 0 ? S.formatMoney(unit * (item.quantity || 1)) : "On request";
    return (
      '<div class="cart-line" data-slug="' + esc(item.slug) + '">' +
        '<div class="cart-line__product">' +
          '<a class="cart-line__img" href="product.html?slug=' + esc(item.slug) + '"><img src="' + esc(item.image) + '" alt="' + esc(item.name) + '" onerror="this.style.visibility=\'hidden\'" /></a>' +
          '<div class="cart-line__info">' +
            '<a class="cart-line__name" href="product.html?slug=' + esc(item.slug) + '">' + esc(item.name) + '</a>' +
            '<p class="cart-line__meta">Pack: ' + esc(item.packSize || "N/A") + '</p>' +
            '<button class="cart-line__wish" type="button" data-move-wish>Move to favorites</button>' +
          '</div>' +
        '</div>' +
        '<div class="cart-line__price" data-label="Price">' + esc(S.priceLabel(item.price)) + '</div>' +
        '<div class="cart-line__qty" data-label="Qty">' +
          '<div class="qty-stepper">' +
            '<button type="button" class="qty-btn" data-dec aria-label="Decrease">&minus;</button>' +
            '<input type="text" inputmode="numeric" value="' + (item.quantity || 1) + '" aria-label="Quantity" data-qty />' +
            '<button type="button" class="qty-btn" data-inc aria-label="Increase">+</button>' +
          '</div>' +
        '</div>' +
        '<div class="cart-line__total" data-label="Subtotal">' + lineTotal + '</div>' +
        '<button class="cart-line__remove" type="button" data-remove aria-label="Remove item">&times;</button>' +
      '</div>'
    );
  }

  function renderSummary() {
    var subtotal = S.cartSubtotal();
    var shipping = S.shippingFor(subtotal);
    var hasPricing = S.cartHasPricing();
    sumSubtotal.textContent = hasPricing ? S.formatMoney(subtotal) : "On request";
    sumShipping.textContent = subtotal <= 0 ? "—" : (shipping === 0 ? "Free" : S.formatMoney(shipping));
    sumTotal.textContent = hasPricing ? S.formatMoney(subtotal + shipping) : "On request";
    if (!hasPricing && S.cartCount() > 0) {
      summaryNote.textContent = "Some items are priced on request — our team will confirm the final quote after you place the order.";
    } else if (shipping > 0) {
      summaryNote.textContent = "Add " + S.formatMoney(S.FREE_SHIPPING_OVER - subtotal) + " more for free shipping.";
    } else if (subtotal >= S.FREE_SHIPPING_OVER) {
      summaryNote.textContent = "You've unlocked free shipping.";
    } else {
      summaryNote.textContent = "";
    }
  }

  function render() {
    var cart = S.getCart();
    if (!cart.length) {
      grid.hidden = true;
      empty.hidden = false;
      return;
    }
    grid.hidden = false;
    empty.hidden = true;
    list.innerHTML = cart.map(lineMarkup).join("");
    renderSummary();
  }

  list.addEventListener("click", function (e) {
    var line = e.target.closest(".cart-line");
    if (!line) return;
    var slug = line.getAttribute("data-slug");
    var input = line.querySelector("[data-qty]");
    var qty = parseInt(input && input.value, 10) || 1;

    if (e.target.closest("[data-inc]")) { S.setQty(slug, qty + 1); render(); }
    else if (e.target.closest("[data-dec]")) { S.setQty(slug, Math.max(1, qty - 1)); render(); }
    else if (e.target.closest("[data-remove]")) { S.removeFromCart(slug); render(); }
    else if (e.target.closest("[data-move-wish]")) {
      var product = S.findProduct(slug);
      if (product && !S.inWishlist(slug)) S.toggleWishlist(product);
      S.removeFromCart(slug);
      render();
      S.toast("Moved to favorites", "View favorites", "wishlist.html");
    }
  });

  list.addEventListener("change", function (e) {
    var input = e.target.closest("[data-qty]");
    if (!input) return;
    var line = e.target.closest(".cart-line");
    var val = parseInt(input.value.replace(/[^\d]/g, ""), 10) || 1;
    S.setQty(line.getAttribute("data-slug"), val);
    render();
  });

  toCheckout.addEventListener("click", function () {
    if (S.cartCount() > 0) window.location.href = "checkout.html";
  });

  render();
})();
