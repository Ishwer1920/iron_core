// The hero slider + promo banners are rendered and animated by js/banners.js
// (data-driven from /api/banners). This file keeps the rest of the site behavior.
const siteHeader = document.querySelector(".site-header");
const menuToggle = document.querySelector(".menu-toggle");
const modal = document.querySelector(".modal");
const openQueryButtons = document.querySelectorAll("[data-open-query]");
const closeQueryButtons = document.querySelectorAll("[data-close-query]");
const forms = document.querySelectorAll("form");

menuToggle?.addEventListener("click", () => {
  siteHeader?.classList.toggle("is-open");
});

document.querySelectorAll(".main-nav a").forEach((link) => {
  link.addEventListener("click", () => {
    if (!link.closest(".nav-item")) {
      siteHeader?.classList.remove("is-open");
    }
  });
});

openQueryButtons.forEach((button) => {
  button.addEventListener("click", () => {
    modal?.classList.add("is-open");
    modal?.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  });
});

closeQueryButtons.forEach((button) => {
  button.addEventListener("click", closeModal);
});

modal?.addEventListener("click", (event) => {
  if (event.target === modal) {
    closeModal();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal?.classList.contains("is-open")) {
    closeModal();
  }
});

forms.forEach((form) => {
  const isSearch = form.classList.contains("site-search") || form.getAttribute("role") === "search";
  const isEnquiry = !isSearch && !form.hasAttribute("data-no-enquiry") && !!form.querySelector("textarea");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (isSearch) {
      handleSearchSubmit(form);
    } else if (isEnquiry) {
      submitEnquiry(form);
    }
  });
});

/* ---------- product search ---------- */
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function handleSearchSubmit(form) {
  const input = form.querySelector('input[type="search"], input');
  const query = ((input && input.value) || "").trim();
  if (!query) return;
  if (isProductCatalogPage) {
    prefillSearchInputs(query);
    runSearch(query);
    history.replaceState(null, "", "products.html?q=" + encodeURIComponent(query));
    document.getElementById("product-categories")?.scrollIntoView({ behavior: "smooth" });
  } else {
    window.location.href = "products.html?q=" + encodeURIComponent(query);
  }
}

function prefillSearchInputs(query) {
  document.querySelectorAll('.site-search input, form[role="search"] input').forEach((input) => {
    input.value = query;
  });
}

function getSearchResults(query) {
  const q = query.toLowerCase();
  const cats = (window.ironCoreCatalog && window.ironCoreCatalog.categories) || [];
  const catName = (slug) => (cats.find((c) => c.slug === slug) || {}).name || "";
  return window.ironCoreCatalog.products.filter((p) =>
    [p.name, p.composition, p.description, p.packSize, p.category, catName(p.category)]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(q))
  );
}

function runSearch(query) {
  if (!window.ironCoreCatalog || !categoryProducts) return;
  const results = getSearchResults(query);
  setActiveCategoryLink(null);
  if (categoryTitle) categoryTitle.textContent = 'Search results for "' + query + '"';
  if (categoryCount) {
    categoryCount.textContent = "Showing " + results.length + " result" + (results.length === 1 ? "" : "s");
  }
  categoryProducts.innerHTML = results.length
    ? results.map(productCardMarkup).join("")
    : '<p class="catalog-empty">No products match “' + escapeHtml(query) +
      '”. Try a different term or browse the categories.</p>';
  window.IronStore?.syncBadges();
}

function readEnquiry(form) {
  const q = (sel) => form.querySelector(sel);
  const texts = [...form.querySelectorAll('input[type="text"]')];
  let source = "Website";
  if (form.closest(".modal")) source = "Enquiry modal";
  else if (form.closest(".sidebar-query")) source = "Products sidebar";
  else if (form.closest(".query-card")) source = "Contact form";
  return {
    name: (texts[0] && texts[0].value || "").trim(),
    email: (q('input[type="email"]') && q('input[type="email"]').value || "").trim(),
    contact: (q('input[type="tel"]') && q('input[type="tel"]').value || "").trim(),
    location: (texts[1] && texts[1].value || "").trim(),
    service: (q("select") && q("select").value || "").trim(),
    message: (q("textarea") && q("textarea").value || "").trim(),
    source: source,
  };
}

function submitEnquiry(form) {
  const body = readEnquiry(form);
  fetch("/api/enquiries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((res) => res.ok)
    .catch(() => false)
    .then((ok) => showEnquiryNote(form, ok));
}

function showEnquiryNote(form, ok) {
  let note = form.querySelector(".enquiry-note");
  if (!note) {
    note = document.createElement("p");
    note.className = "enquiry-note";
    note.style.marginTop = "12px";
    note.style.fontWeight = "700";
    form.appendChild(note);
  }
  note.textContent = ok
    ? "Thanks! Your enquiry has been received — we'll be in touch."
    : "Sorry, something went wrong. Please try again.";
  note.style.color = ok ? "var(--brand-ink)" : "#d23b3b";
  if (ok) {
    form.reset();
  }
}

function closeModal() {
  modal?.classList.remove("is-open");
  modal?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

const categoryList = document.getElementById("catalog-category-list");
const sidebarLinks = document.getElementById("sidebar-category-links");
const categoryTitle = document.getElementById("category-title");
const categoryCount = document.getElementById("category-count");
const categoryProducts = document.getElementById("category-products");
const sortProducts = document.getElementById("sort-products");
const isProductCatalogPage = Boolean(categoryList && sidebarLinks && categoryTitle && categoryCount && categoryProducts);

function buildCategoryLinks() {
  if (!window.ironCoreCatalog || !categoryList || !sidebarLinks) return;

  window.ironCoreCatalog.categories.forEach((category) => {
    const linkMarkup = `<a href="#${category.slug}" data-category="${category.slug}">${category.name} <span>(${category.count})</span></a>`;
    categoryList.insertAdjacentHTML("beforeend", linkMarkup);
    sidebarLinks.insertAdjacentHTML("beforeend", `<a href="#${category.slug}" data-category="${category.slug}">${category.name}</a>`);
  });
}

function getCategoryProducts(slug) {
  return window.ironCoreCatalog.products.filter((product) => product.category === slug);
}

function renderProductList(products, categoryName) {
  if (!categoryTitle || !categoryCount || !categoryProducts) return;

  categoryTitle.textContent = categoryName;
  categoryCount.textContent = `Showing all ${products.length} results`;
  categoryProducts.innerHTML = products.map(productCardMarkup).join("");
  window.IronStore?.syncBadges();
}

function productCardMarkup(product) {
  const priceLabel = window.IronStore ? window.IronStore.priceLabel(product.price) : product.price;
  return `
    <article class="product-shop-card">
      <button class="fav-btn" type="button" data-fav="${product.slug}" aria-pressed="false" aria-label="Save ${product.name} to favorites" title="Save to favorites">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 3c0 4.5-9.5 12-9.5 12Z" /></svg>
      </button>
      <a class="product-shop-card__link" href="product.html?slug=${product.slug}">
        <div class="product-shop-card__img"><img src="${product.image}" alt="${product.name}" loading="lazy" /></div>
        <div class="product-shop-card__body">
          <h3>${product.name}</h3>
          <p class="product-shop-card__meta">${product.packSize}</p>
          <div class="product-shop-card__foot">
            <span class="product-shop-card__price">${priceLabel}</span>
            <span class="product-shop-card__rating">${window.IronStore ? window.IronStore.starsHtml(product.rating) : ""}<small>${product.rating || 0}</small></span>
          </div>
        </div>
      </a>
      <button class="btn btn-light product-shop-card__add" type="button" data-add-cart="${product.slug}">Add to Cart</button>
    </article>
  `;
}

function renderFeatured() {
  const grid = document.getElementById("featured-products");
  if (!grid || !window.ironCoreCatalog) return;
  // Show up to 8 products as "featured" — independent of any specific
  // category, so the home page always shows products.
  const featured = window.ironCoreCatalog.products.slice(0, 8);
  grid.innerHTML = featured.map(productCardMarkup).join("");
  window.IronStore?.syncBadges();
}

function setActiveCategoryLink(slug) {
  document.querySelectorAll("[data-category]").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.category === slug);
  });
}

function showCategory(slug) {
  const category = window.ironCoreCatalog.categories.find((item) => item.slug === slug) || window.ironCoreCatalog.categories[0];
  const products = getCategoryProducts(category.slug);

  setActiveCategoryLink(category.slug);
  renderProductList(products, category.name);
}

function getHashCategory() {
  const hash = window.location.hash.slice(1);
  return hash || window.ironCoreCatalog.categories[0]?.slug;
}

window.addEventListener("hashchange", () => {
  showCategory(getHashCategory());
});

sortProducts?.addEventListener("change", () => {
  const selectedCategory = getHashCategory();
  const products = getCategoryProducts(selectedCategory);

  if (sortProducts.value === "name") {
    products.sort((a, b) => a.name.localeCompare(b.name));
  }

  const category = window.ironCoreCatalog.categories.find((item) => item.slug === selectedCategory);
  renderProductList(products, category?.name || "Category");
});

// When maintenance mode is on, an admin still sees the live store (they bypass
// the gate) — show them a clear banner so it's obvious it's on.
function showMaintenanceBannerIfNeeded() {
  fetch("/api/maintenance")
    .then((r) => r.json())
    .then((d) => {
      if (!d || !d.active || !d.is_admin) return;
      if (document.getElementById("maint-admin-banner")) return;
      const bar = document.createElement("div");
      bar.id = "maint-admin-banner";
      bar.className = "maint-admin-banner";
      bar.innerHTML =
        '<span><strong>Maintenance mode is ON.</strong> Visitors see the “We’ll be back soon” page — ' +
        "you’re viewing the live store as an admin.</span>" +
        '<a href="admin.html">Turn off in Settings</a>';
      document.body.insertBefore(bar, document.body.firstChild);
      document.body.classList.add("has-maint-banner");
    })
    .catch(() => {});
}
showMaintenanceBannerIfNeeded();

buildCategoryLinks();
if (isProductCatalogPage) {
  const initialQuery = new URLSearchParams(window.location.search).get("q");
  if (initialQuery && initialQuery.trim()) {
    prefillSearchInputs(initialQuery.trim());
    runSearch(initialQuery.trim());
  } else {
    showCategory(getHashCategory());
  }
}
renderFeatured();

/* ---------------------------------------------------------------------------
   Populate the header "All Categories" dropdown from the live catalog, on
   every page. Works for the desktop dropdown and the mobile menu.
   --------------------------------------------------------------------------- */
(function () {
  function fillHeaderCategories() {
    var cats = (window.ironCoreCatalog && window.ironCoreCatalog.categories) || [];
    var menus = document.querySelectorAll(".all-categories__menu");
    if (!menus.length || !cats.length) return;
    var html = cats.map(function (c) {
      return '<a href="products.html#' + encodeURIComponent(c.slug) + '">' + c.name + "</a>";
    }).join("");
    menus.forEach(function (m) { m.innerHTML = html; });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fillHeaderCategories);
  } else {
    fillHeaderCategories();
  }
})();
