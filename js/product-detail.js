/* IronCore Pharma — product detail page */
(function () {
  "use strict";

  var detailName = document.getElementById("detail-name");
  var detailCategory = document.getElementById("detail-category");
  var detailImageContainer = document.getElementById("detail-image-container");
  var detailGallery = document.getElementById("detail-gallery");
  var detailPack = document.getElementById("detail-pack");
  var detailStock = document.getElementById("detail-stock");
  var detailTitle = document.getElementById("detail-title");
  var detailDescription = document.getElementById("detail-description");
  var detailComposition = document.getElementById("detail-composition");
  var detailPrice = document.getElementById("detail-price");
  var detailRating = document.getElementById("detail-rating");
  var detailCategoryLink = document.getElementById("detail-category-link");
  var detailBuyButton = document.getElementById("detail-buy-button");
  var detailAddButton = document.getElementById("detail-add-button");
  var detailFavButton = document.getElementById("detail-fav-button");
  var qtyInput = document.getElementById("detail-qty-input");
  var qtyWrap = document.getElementById("detail-qty");

  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }
  function currentQty() {
    var n = parseInt(qtyInput && qtyInput.value, 10);
    return isNaN(n) || n < 1 ? 1 : Math.min(999, n);
  }

  function renderProductDetail(product, category) {
    detailName.textContent = product.name;
    detailTitle.textContent = product.name;
    detailCategory.textContent = category ? category.name : "Product";
    detailDescription.textContent = product.description || "No product description available.";
    detailPack.textContent = "Pack: " + (product.packSize || "N/A");
    detailStock.textContent = product.stock || "Stock status unavailable";
    detailComposition.textContent = product.composition || "Not listed.";
    detailPrice.textContent = window.IronStore ? window.IronStore.priceLabel(product.price) : (product.price || "Price on request");
    if (product.rating && window.IronStore) {
      detailRating.innerHTML = window.IronStore.starsHtml(product.rating) + ' <span class="rating-num">' + product.rating.toFixed(1) + " / 5</span>";
    } else {
      detailRating.textContent = "No rating yet";
    }
    detailCategoryLink.href = category ? "products.html#" + category.slug : "products.html";
    detailCategoryLink.textContent = category ? "Back to " + category.name : "Back to Products";

    var primaryImage = product.image || (product.images && product.images[0]) || "img/product-capsules.svg";
    detailImageContainer.innerHTML = "";
    var mainImg = document.createElement("img");
    mainImg.src = primaryImage;
    mainImg.alt = product.name;
    detailImageContainer.appendChild(mainImg);

    detailGallery.innerHTML = "";
    var galleryImages = Array.isArray(product.images) && product.images.length ? product.images : [primaryImage];
    galleryImages.forEach(function (src) {
      if (!src) return;
      var g = document.createElement("img");
      g.src = src;
      g.alt = product.name;
      g.addEventListener("click", function () { mainImg.src = src; });
      detailGallery.appendChild(g);
    });

    // Note: no data-fav attribute here — this button has its own click handler
    // below, so leaving the attribute off avoids the global store.js toggle firing too.
    if (detailFavButton) syncFav(product.slug);
  }

  function syncFav(slug) {
    if (!detailFavButton || !window.IronStore) return;
    var saved = window.IronStore.inWishlist(slug);
    detailFavButton.classList.toggle("is-active", saved);
    detailFavButton.setAttribute("aria-pressed", saved ? "true" : "false");
    var label = detailFavButton.querySelector("span");
    if (label) label.textContent = saved ? "Saved" : "Favorite";
  }

  function showNotFound() {
    detailTitle.textContent = "Product not found";
    detailDescription.textContent = "The requested product could not be located. Please return to the products page and choose another item.";
    detailCategory.textContent = "Not found";
    detailPack.textContent = "";
    detailStock.textContent = "";
    detailComposition.textContent = "";
    detailPrice.textContent = "";
    detailRating.textContent = "";
    detailCategoryLink.href = "products.html";
    detailCategoryLink.textContent = "Back to Products";
    [detailBuyButton, detailAddButton, detailFavButton].forEach(function (b) {
      if (b) { b.disabled = true; }
    });
    if (qtyWrap) qtyWrap.style.display = "none";
    detailImageContainer.innerHTML = "";
    detailGallery.innerHTML = "";
  }

  var slug = getQueryParam("slug");
  var product = window.ironCoreCatalog && window.ironCoreCatalog.products.filter(function (p) { return p.slug === slug; })[0];
  var category = product && window.ironCoreCatalog.categories.filter(function (c) { return c.slug === product.category; })[0];

  // quantity stepper
  qtyWrap && qtyWrap.addEventListener("click", function (e) {
    if (e.target.closest("[data-qty-inc]")) qtyInput.value = currentQty() + 1;
    else if (e.target.closest("[data-qty-dec]")) qtyInput.value = Math.max(1, currentQty() - 1);
  });
  qtyInput && qtyInput.addEventListener("input", function () {
    this.value = this.value.replace(/[^\d]/g, "");
  });

  if (detailAddButton) {
    detailAddButton.addEventListener("click", function () {
      if (!product || !window.IronStore) return;
      window.IronStore.addToCart(product, currentQty());
      window.IronStore.toast("Added to cart", "View cart", "cart.html");
    });
  }
  if (detailBuyButton) {
    detailBuyButton.addEventListener("click", function () {
      if (!product || !window.IronStore) return;
      window.IronStore.addToCart(product, currentQty());
      window.location.href = "checkout.html";
    });
  }
  if (detailFavButton) {
    detailFavButton.addEventListener("click", function (e) {
      e.preventDefault();
      if (!product || !window.IronStore) return;
      window.IronStore.toggleWishlist(product);
      syncFav(product.slug);
    });
  }

  /* ---------------- reviews ---------------- */
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function initReviews(slug) {
    var starsBox = document.getElementById("review-stars");
    var summaryBox = document.getElementById("reviews-summary");
    var listBox = document.getElementById("reviews-list");
    var form = document.getElementById("review-form");
    var nameInput = document.getElementById("review-name");
    var commentInput = document.getElementById("review-comment");
    var msg = document.getElementById("review-msg");
    var submitBtn = document.getElementById("review-submit");
    if (!starsBox || !form) return;

    var chosen = 0;

    // build the 5 clickable stars
    function paintStars(upto) {
      starsBox.querySelectorAll(".star-input__btn").forEach(function (b, i) {
        b.classList.toggle("is-on", i < upto);
        b.setAttribute("aria-checked", i + 1 === chosen ? "true" : "false");
      });
    }
    for (var i = 1; i <= 5; i++) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "star-input__btn";
      b.dataset.value = i;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", i + " star" + (i > 1 ? "s" : ""));
      b.innerHTML = "★";
      starsBox.appendChild(b);
    }
    starsBox.addEventListener("click", function (e) {
      var btn = e.target.closest(".star-input__btn");
      if (!btn) return;
      chosen = parseInt(btn.dataset.value, 10);
      paintStars(chosen);
    });
    starsBox.addEventListener("mouseover", function (e) {
      var btn = e.target.closest(".star-input__btn");
      if (btn) paintStars(parseInt(btn.dataset.value, 10));
    });
    starsBox.addEventListener("mouseleave", function () { paintStars(chosen); });

    function renderReviews(data) {
      var count = data.count || 0;
      var avg = data.average || 0;
      if (count) {
        summaryBox.innerHTML =
          '<span class="reviews-summary__avg">' + avg.toFixed(1) + "</span>" +
          (window.IronStore ? window.IronStore.starsHtml(avg, "stars--lg") : "") +
          '<span class="reviews-summary__count">Based on ' + count + " review" + (count === 1 ? "" : "s") + "</span>";
      } else {
        summaryBox.innerHTML = '<span class="reviews-summary__count">No reviews yet — be the first to review this product.</span>';
      }
      listBox.innerHTML = (data.reviews || []).map(function (r) {
        return '<article class="review-item">' +
          '<div class="review-item__head">' +
            '<span class="review-item__name">' + escHtml(r.name || "Anonymous") + "</span>" +
            '<span class="review-item__date">' + escHtml(fmtDate(r.created_at)) + "</span>" +
          "</div>" +
          (window.IronStore ? window.IronStore.starsHtml(r.rating) : "") +
          '<p class="review-item__text">' + escHtml(r.comment || "") + "</p>" +
        "</article>";
      }).join("");
    }

    function loadReviews() {
      fetch("/api/reviews/" + encodeURIComponent(slug))
        .then(function (res) { return res.ok ? res.json() : { count: 0, average: 0, reviews: [] }; })
        .then(renderReviews)
        .catch(function () { renderReviews({ count: 0, average: 0, reviews: [] }); });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      msg.className = "review-msg";
      if (chosen < 1) { msg.className = "review-msg is-error"; msg.textContent = "Please pick a star rating."; return; }
      if (!commentInput.value.trim()) { msg.className = "review-msg is-error"; msg.textContent = "Please write a short review."; return; }
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting…";
      fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug, name: nameInput.value.trim(), rating: chosen, comment: commentInput.value.trim() }),
      })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
        .then(function (r) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit review";
          if (r.ok && r.d.ok) {
            msg.className = "review-msg is-ok";
            msg.textContent = r.d.message || "Thanks! Your review has been submitted for approval.";
            form.reset();
            chosen = 0;
            paintStars(0);
          } else {
            msg.className = "review-msg is-error";
            msg.textContent = (r.d && r.d.error) || "Could not submit your review.";
          }
        })
        .catch(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit review";
          msg.className = "review-msg is-error";
          msg.textContent = "Can't reach the server. Is it running?";
        });
    });

    loadReviews();
  }

  if (!product) showNotFound();
  else {
    renderProductDetail(product, category);
    initReviews(product.slug);
  }
})();

