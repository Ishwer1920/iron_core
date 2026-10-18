/* IronCore Pharma — shared storefront state: cart + wishlist (favorites).
   Works on every page. Exposes window.IronStore and keeps header badges in sync. */
(function () {
  "use strict";

  var CART_KEY = "ironCoreCart";
  var WISH_KEY = "ironCoreWishlist";
  var SHIPPING_FLAT = 50;        // mirrors app.py
  var FREE_SHIPPING_OVER = 2000; // mirrors app.py

  /* ---------- storage helpers ---------- */
  function read(key) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* storage unavailable (private mode) — state just won't persist */
    }
  }

  /* ---------- price helpers ---------- */
  function parsePrice(value) {
    if (value == null) return 0;
    var m = String(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  }
  function formatMoney(n) {
    return "₹" + Number(n || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  function priceLabel(value) {
    var n = parsePrice(value);
    return n > 0 ? formatMoney(n) : "Price on request";
  }

  /* ---------- star rating rendering ---------- */
  // Renders 5 stars with a gold fill proportional to `rating` (0–5).
  function starsHtml(rating, extraClass) {
    var r = Math.max(0, Math.min(5, Number(rating) || 0));
    var out = '<span class="stars' + (extraClass ? " " + extraClass : "") +
      '" role="img" aria-label="' + r.toFixed(1) + ' out of 5 stars">';
    for (var i = 1; i <= 5; i++) {
      var fill = Math.max(0, Math.min(1, r - (i - 1))) * 100;
      out += '<span class="star"><span class="star__fill" style="width:' + fill + '%">★</span>★</span>';
    }
    out += "</span>";
    return out;
  }

  /* ---------- catalog lookup ---------- */
  function findProduct(slug) {
    var cat = window.ironCoreCatalog;
    if (!cat || !cat.products) return null;
    for (var i = 0; i < cat.products.length; i++) {
      if (cat.products[i].slug === slug) return cat.products[i];
    }
    return null;
  }
  function toLineItem(product) {
    return {
      slug: product.slug,
      name: product.name,
      packSize: product.packSize || "",
      price: product.price || "",
      image: product.image || (product.images && product.images[0]) || "img/product-capsules.svg",
      rating: product.rating || 0,
    };
  }

  /* ---------- cart ---------- */
  function getCart() { return read(CART_KEY); }
  function saveCart(cart) { write(CART_KEY, cart); syncBadges(); }

  function cartCount() {
    return getCart().reduce(function (sum, it) { return sum + (it.quantity || 1); }, 0);
  }
  function cartSubtotal() {
    return getCart().reduce(function (sum, it) {
      return sum + parsePrice(it.price) * (it.quantity || 1);
    }, 0);
  }
  function cartHasPricing() {
    return getCart().some(function (it) { return parsePrice(it.price) > 0; });
  }
  function shippingFor(subtotal) {
    if (subtotal <= 0 || subtotal >= FREE_SHIPPING_OVER) return 0;
    return SHIPPING_FLAT;
  }

  function addToCart(slugOrProduct, qty) {
    var product = typeof slugOrProduct === "string" ? findProduct(slugOrProduct) : slugOrProduct;
    if (!product) return false;
    qty = Math.max(1, parseInt(qty, 10) || 1);
    var cart = getCart();
    var existing = null;
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].slug === product.slug) { existing = cart[i]; break; }
    }
    if (existing) {
      existing.quantity = (existing.quantity || 1) + qty;
    } else {
      var item = toLineItem(product);
      item.quantity = qty;
      cart.push(item);
    }
    saveCart(cart);
    return true;
  }
  function setQty(slug, qty) {
    qty = parseInt(qty, 10) || 1;
    var cart = getCart();
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].slug === slug) {
        cart[i].quantity = Math.max(1, Math.min(999, qty));
        break;
      }
    }
    saveCart(cart);
  }
  function removeFromCart(slug) {
    saveCart(getCart().filter(function (it) { return it.slug !== slug; }));
  }
  function clearCart() { saveCart([]); }

  /* ---------- wishlist ---------- */
  function getWishlist() { return read(WISH_KEY); }
  function saveWishlist(list) { write(WISH_KEY, list); syncBadges(); }
  function wishCount() { return getWishlist().length; }
  function inWishlist(slug) {
    return getWishlist().some(function (it) { return it.slug === slug; });
  }
  function toggleWishlist(slugOrProduct) {
    var product = typeof slugOrProduct === "string" ? findProduct(slugOrProduct) : slugOrProduct;
    if (!product) return false;
    var list = getWishlist();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].slug === product.slug) { idx = i; break; }
    }
    var nowSaved;
    if (idx >= 0) {
      list.splice(idx, 1);
      nowSaved = false;
    } else {
      list.push(toLineItem(product));
      nowSaved = true;
    }
    saveWishlist(list);
    return nowSaved;
  }
  function removeFromWishlist(slug) {
    saveWishlist(getWishlist().filter(function (it) { return it.slug !== slug; }));
  }

  /* ---------- header badges ---------- */
  function syncBadges() {
    var c = cartCount();
    document.querySelectorAll(".cart-badge").forEach(function (b) {
      b.textContent = c;
      b.classList.toggle("is-empty", c === 0);
    });
    var w = wishCount();
    document.querySelectorAll(".wishlist-badge").forEach(function (b) {
      b.textContent = w;
      b.classList.toggle("is-empty", w === 0);
    });
    // reflect saved state on any heart buttons currently on the page
    document.querySelectorAll("[data-fav]").forEach(function (btn) {
      btn.classList.toggle("is-active", inWishlist(btn.getAttribute("data-fav")));
      btn.setAttribute("aria-pressed", inWishlist(btn.getAttribute("data-fav")) ? "true" : "false");
    });
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(message, actionLabel, actionHref) {
    var box = document.getElementById("iron-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "iron-toast";
      box.className = "iron-toast";
      document.body.appendChild(box);
    }
    box.innerHTML = '<span>' + escapeHtml(message) + "</span>" +
      (actionLabel ? ' <a href="' + escapeHtml(actionHref || "#") + '">' + escapeHtml(actionLabel) + "</a>" : "");
    box.classList.add("is-show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { box.classList.remove("is-show"); }, 3200);
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- global delegated actions (product cards etc.) ---------- */
  document.addEventListener("click", function (e) {
    var addBtn = e.target.closest("[data-add-cart]");
    if (addBtn) {
      e.preventDefault();
      var slug = addBtn.getAttribute("data-add-cart");
      if (addToCart(slug)) {
        toast("Added to cart", "View cart", "cart.html");
      }
      return;
    }
    var favBtn = e.target.closest("[data-fav]");
    if (favBtn) {
      e.preventDefault();
      var fslug = favBtn.getAttribute("data-fav");
      var saved = toggleWishlist(fslug);
      toast(saved ? "Saved to favorites" : "Removed from favorites",
            saved ? "View favorites" : null, "wishlist.html");
    }
  });

  /* ---------- expose + boot ---------- */
  window.IronStore = {
    getCart: getCart, addToCart: addToCart, setQty: setQty, removeFromCart: removeFromCart,
    clearCart: clearCart, cartCount: cartCount, cartSubtotal: cartSubtotal,
    cartHasPricing: cartHasPricing, shippingFor: shippingFor,
    getWishlist: getWishlist, toggleWishlist: toggleWishlist, inWishlist: inWishlist,
    removeFromWishlist: removeFromWishlist, wishCount: wishCount,
    parsePrice: parsePrice, formatMoney: formatMoney, priceLabel: priceLabel,
    starsHtml: starsHtml,
    findProduct: findProduct, syncBadges: syncBadges, toast: toast,
    SHIPPING_FLAT: SHIPPING_FLAT, FREE_SHIPPING_OVER: FREE_SHIPPING_OVER,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncBadges);
  } else {
    syncBadges();
  }
  // keep tabs/windows in sync
  window.addEventListener("storage", function (e) {
    if (e.key === CART_KEY || e.key === WISH_KEY) syncBadges();
  });
})();
