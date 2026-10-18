/* IronCore Pharma — favorites (wishlist) page */
(function () {
  "use strict";
  var S = window.IronStore;
  if (!S) return;

  var gridEl = document.getElementById("wishlist-grid");
  var emptyEl = document.getElementById("wishlist-empty");
  var toolbar = document.getElementById("wishlist-toolbar");
  var countEl = document.getElementById("wishlist-count");
  var addAllBtn = document.getElementById("wishlist-add-all");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function cardMarkup(item) {
    return (
      '<article class="product-shop-card" data-slug="' + esc(item.slug) + '">' +
        '<button class="fav-remove" type="button" data-wish-remove="' + esc(item.slug) + '" aria-label="Remove from favorites" title="Remove">&times;</button>' +
        '<a class="product-shop-card__link" href="product.html?slug=' + esc(item.slug) + '">' +
          '<div class="product-shop-card__img"><img src="' + esc(item.image) + '" alt="' + esc(item.name) + '" loading="lazy" onerror="this.style.visibility=\'hidden\'" /></div>' +
          '<div class="product-shop-card__body">' +
            '<h3>' + esc(item.name) + '</h3>' +
            '<p class="product-shop-card__meta">' + esc(item.packSize || "") + '</p>' +
            '<div class="product-shop-card__foot">' +
              '<span class="product-shop-card__price">' + esc(S.priceLabel(item.price)) + '</span>' +
              '<span class="product-shop-card__rating">' + S.starsHtml(item.rating) + '<small>' + esc(item.rating || 0) + '</small></span>' +
            '</div>' +
          '</div>' +
        '</a>' +
        '<button class="btn btn-light product-shop-card__add" type="button" data-add-cart="' + esc(item.slug) + '">Add to Cart</button>' +
      '</article>'
    );
  }

  function render() {
    var list = S.getWishlist();
    if (!list.length) {
      gridEl.innerHTML = "";
      gridEl.hidden = true;
      toolbar.hidden = true;
      emptyEl.hidden = false;
      return;
    }
    gridEl.hidden = false;
    emptyEl.hidden = true;
    toolbar.hidden = false;
    countEl.textContent = list.length + (list.length === 1 ? " saved product" : " saved products");
    gridEl.innerHTML = list.map(cardMarkup).join("");
  }

  gridEl.addEventListener("click", function (e) {
    var rm = e.target.closest("[data-wish-remove]");
    if (rm) {
      e.preventDefault();
      S.removeFromWishlist(rm.getAttribute("data-wish-remove"));
      render();
    }
    // [data-add-cart] is handled globally by store.js (adds + toast)
  });

  addAllBtn.addEventListener("click", function () {
    var list = S.getWishlist();
    list.forEach(function (it) { S.addToCart(it.slug); });
    S.toast("Added " + list.length + " item" + (list.length === 1 ? "" : "s") + " to cart", "View cart", "cart.html");
  });

  render();
})();
