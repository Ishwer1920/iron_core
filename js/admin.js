/* IronCore Pharma — admin dashboard */
(function () {
  "use strict";

  async function api(path, method, body) {
    const opts = { method: method || "GET", headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    let res;
    try { res = await fetch(path, opts); }
    catch (e) { return { ok: false, status: 0, data: { error: "Can't reach the server." } }; }
    let data = {};
    try { data = await res.json(); } catch (e) { /* no body */ }
    return { ok: res.ok, status: res.status, data: data };
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString();
  }
  const el = function (id) { return document.getElementById(id); };
  const unique = function (arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); };

  let meRole = "admin";
  let editingSlug = null;
  let allImages = [];
  const picker = { selected: [], main: "" };

  /* ---------- tabs ---------- */
  function setupTabs() {
    const tabs = [].slice.call(document.querySelectorAll(".admin-tab"));
    const names = ["overview", "products", "banners", "orders", "reviews", "verification", "users", "enquiries", "settings"];
    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        tabs.forEach(function (x) { x.classList.toggle("is-active", x === t); });
        names.forEach(function (name) {
          const panel = el("tab-" + name);
          const on = name === t.dataset.tab;
          panel.hidden = !on;
          panel.classList.toggle("is-active", on);
        });
      });
    });
  }

  /* ---------- overview ---------- */
  async function loadOverview() {
    const r = await api("/api/admin/overview");
    if (!r.ok) return;
    const o = r.data;
    const roleBits = Object.keys(o.roles || {}).map(function (k) {
      return esc(k) + ": " + o.roles[k];
    }).join(" · ");
    const revenue = "₹" + Number(o.revenue || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cards = [
      { n: o.active_users, l: "Active now", s: "last " + o.active_window_min + " min" },
      { n: o.total_users, l: "Registered users", s: roleBits },
      { n: o.total_products, l: "Products", s: "" },
      { n: o.total_orders || 0, l: "Orders", s: revenue + " total" },
      { n: o.total_reviews || 0, l: "Reviews", s: (o.pending_reviews || 0) + " pending" },
      { n: o.total_codes || 0, l: "Auth codes", s: (o.used_codes || 0) + " used" },
      { n: o.total_enquiries, l: "Enquiries", s: "" },
    ];
    const pill = el("reviews-pending-pill");
    if (pill) {
      pill.hidden = !(o.pending_reviews > 0);
      pill.textContent = o.pending_reviews || "";
    }
    el("overview-cards").innerHTML = cards.map(function (c) {
      return '<div class="stat-card"><span class="stat-card__n">' + c.n + '</span>' +
        '<span class="stat-card__l">' + esc(c.l) + "</span>" +
        (c.s ? '<span class="stat-card__s">' + esc(c.s) + "</span>" : "") + "</div>";
    }).join("");
  }

  /* ---------- image picker ---------- */
  async function loadImages() {
    const r = await api("/api/admin/images");
    allImages = r.ok ? r.data : [];
  }
  function syncPicker() {
    el("p-image").value = picker.main;
    el("p-images").value = picker.selected.join("\n");
    renderImageGrid();
  }
  function toggleSelect(path) {
    const i = picker.selected.indexOf(path);
    if (i >= 0) {
      picker.selected.splice(i, 1);
      if (picker.main === path) picker.main = picker.selected[0] || "";
    } else {
      picker.selected.push(path);
      if (!picker.main) picker.main = path;
    }
    syncPicker();
  }
  function setMain(path) {
    picker.main = path;
    if (picker.selected.indexOf(path) < 0) picker.selected.push(path);
    syncPicker();
  }
  function renderImageGrid() {
    const list = unique(allImages.concat(picker.selected));
    el("image-grid").innerHTML = list.map(function (p) {
      const sel = picker.selected.indexOf(p) >= 0;
      const main = picker.main === p;
      return '<div class="img-cell' + (sel ? " is-sel" : "") + (main ? " is-main" : "") + '" data-path="' + esc(p) + '">' +
        '<img src="' + esc(p) + '" alt="" loading="lazy" onerror="this.closest(\'.img-cell\').style.display=\'none\'">' +
        '<button type="button" class="img-star" data-main="' + esc(p) + '" title="Set as main">&#9733;</button>' +
        (main ? '<span class="img-badge">Main</span>' : (sel ? '<span class="img-badge img-badge--sel">In gallery</span>' : "")) +
        "</div>";
    }).join("");
    el("image-grid").querySelectorAll(".img-cell").forEach(function (cell) {
      cell.querySelector("img").addEventListener("click", function () { toggleSelect(cell.dataset.path); });
    });
    el("image-grid").querySelectorAll(".img-star").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); setMain(b.dataset.main); });
    });
  }
  function wireUpload() {
    el("img-upload-input").addEventListener("change", function () {
      const f = this.files && this.files[0];
      if (!f) return;
      const fd = new FormData();
      fd.append("file", f);
      fetch("/api/admin/images", { method: "POST", body: fd })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
        .then(function (r) {
          if (r.ok && r.d.path) {
            if (allImages.indexOf(r.d.path) < 0) allImages.unshift(r.d.path);
            setMain(r.d.path);
          } else {
            alert((r.d && r.d.error) || "Upload failed.");
          }
        })
        .catch(function () { alert("Upload failed."); });
      this.value = "";
    });
  }

  /* ---------- categories ---------- */
  async function loadCategories(selectSlug) {
    const r = await api("/api/admin/categories");
    if (!r.ok) return;
    el("p-category").innerHTML = r.data.map(function (c) {
      return '<option value="' + esc(c.slug) + '">' + esc(c.name) + "</option>";
    }).join("");
    if (selectSlug) el("p-category").value = selectSlug;
  }
  function wireCategoryAdd() {
    el("add-cat-btn").addEventListener("click", function () { el("new-cat").hidden = false; el("new-cat-name").focus(); });
    el("new-cat-cancel").addEventListener("click", function () { el("new-cat").hidden = true; el("new-cat-name").value = ""; });
    el("new-cat-save").addEventListener("click", function () {
      const name = el("new-cat-name").value.trim();
      if (!name) return;
      api("/api/admin/categories", "POST", { name: name }).then(function (r) {
        if (r.ok) {
          el("new-cat").hidden = true; el("new-cat-name").value = "";
          loadCategories(r.data.slug);
        } else {
          alert(r.data.error || "Could not add category.");
        }
      });
    });
  }

  /* ---------- products ---------- */
  async function loadProducts() {
    const r = await api("/api/admin/products");
    const tb = el("products-tbody");
    if (!r.ok) { tb.innerHTML = '<tr><td colspan="7">Failed to load.</td></tr>'; return; }
    tb.innerHTML = r.data.map(function (p) {
      return "<tr>" +
        '<td><img class="admin-thumb" src="' + esc(p.image) + '" alt="" onerror="this.style.visibility=\'hidden\'"></td>' +
        "<td>" + esc(p.name) + "</td><td>" + esc(p.category) + "</td><td>" + esc(p.packSize) +
        "</td><td>" + esc(p.price) + "</td><td>" + esc(p.rating) + "</td>" +
        '<td class="admin-row-actions">' +
        '<button class="mini-btn" data-edit="' + esc(p.slug) + '">Edit</button>' +
        '<button class="mini-btn mini-btn--danger" data-del="' + esc(p.slug) + '">Delete</button>' +
        "</td></tr>";
    }).join("");
    tb.querySelectorAll("[data-edit]").forEach(function (b) {
      b.addEventListener("click", function () { startEdit(r.data, b.dataset.edit); });
    });
    tb.querySelectorAll("[data-del]").forEach(function (b) {
      b.addEventListener("click", function () { delProduct(b.dataset.del); });
    });
  }
  function openForm(title) {
    el("product-form-title").textContent = title;
    el("product-form").hidden = false;
    el("product-msg").textContent = "";
    el("product-form").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function resetForm() {
    editingSlug = null;
    ["p-slug", "p-name", "p-packSize", "p-price", "p-rating", "p-stock", "p-composition", "p-description"]
      .forEach(function (id) { el(id).value = ""; });
    el("p-slug").readOnly = false;
    picker.selected = []; picker.main = "";
    syncPicker();
  }
  function startAdd() { resetForm(); openForm("Add product"); }
  function startEdit(list, slug) {
    const p = list.filter(function (x) { return x.slug === slug; })[0];
    if (!p) return;
    editingSlug = slug;
    el("p-slug").value = p.slug; el("p-slug").readOnly = true;
    el("p-category").value = p.category;
    el("p-name").value = p.name;
    el("p-packSize").value = p.packSize || "";
    el("p-price").value = p.price || "";
    el("p-rating").value = p.rating || "";
    el("p-stock").value = p.stock || "";
    el("p-composition").value = p.composition || "";
    el("p-description").value = p.description || "";
    picker.selected = (p.images || []).slice();
    picker.main = p.image || picker.selected[0] || "";
    if (picker.main && picker.selected.indexOf(picker.main) < 0) picker.selected.unshift(picker.main);
    syncPicker();
    openForm("Edit product");
  }
  function collectForm() {
    let imgs = el("p-images").value.split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    const main = el("p-image").value.trim();
    if (main) imgs = [main].concat(imgs.filter(function (x) { return x !== main; }));
    return {
      slug: el("p-slug").value.trim().toLowerCase(),
      category: el("p-category").value,
      name: el("p-name").value.trim(),
      composition: el("p-composition").value.trim(),
      packSize: el("p-packSize").value.trim(),
      price: el("p-price").value.trim(),
      rating: el("p-rating").value,
      stock: el("p-stock").value.trim(),
      image: main,
      images: imgs,
      description: el("p-description").value.trim(),
    };
  }
  async function saveProduct(e) {
    e.preventDefault();
    const body = collectForm();
    const msg = el("product-msg"); msg.className = "admin-msg";
    const r = editingSlug
      ? await api("/api/admin/products/" + encodeURIComponent(editingSlug), "PUT", body)
      : await api("/api/admin/products", "POST", body);
    if (r.ok) { el("product-form").hidden = true; resetForm(); loadProducts(); loadOverview(); }
    else { msg.className = "admin-msg is-error"; msg.textContent = r.data.error || "Could not save product."; }
  }
  async function delProduct(slug) {
    if (!window.confirm('Delete product "' + slug + '"? This cannot be undone.')) return;
    const r = await api("/api/admin/products/" + encodeURIComponent(slug), "DELETE");
    if (r.ok) { loadProducts(); loadOverview(); } else alert(r.data.error || "Could not delete.");
  }

  /* ---------- users ---------- */
  async function loadUsers() {
    const r = await api("/api/admin/users");
    const tb = el("users-tbody");
    const canManage = meRole === "admin";
    el("users-note").textContent = canManage
      ? "You can change roles and reset passwords below."
      : "Only a full admin can change roles or reset passwords.";
    if (!r.ok) { tb.innerHTML = '<tr><td colspan="6">Failed to load.</td></tr>'; return; }
    const roles = ["customer", "staff", "co-admin", "admin"];
    tb.innerHTML = r.data.map(function (u) {
      const roleCell = canManage
        ? '<select class="role-select" data-uid="' + u.id + '">' +
            roles.map(function (rr) { return '<option value="' + rr + '"' + (rr === u.role ? " selected" : "") + ">" + rr + "</option>"; }).join("") +
          "</select>"
        : esc(u.role);
      const active = u.active ? '<span class="dot dot--on"></span>Active' : esc(fmtDate(u.last_seen));
      const actions = canManage ? '<button class="mini-btn" data-reset="' + u.id + '">Reset password</button>' : "—";
      return "<tr><td>" + u.id + "</td><td>" + esc(u.email) + "</td><td>" + roleCell +
        "</td><td>" + active + "</td><td>" + esc(fmtDate(u.created_at)) + "</td>" +
        '<td class="admin-row-actions">' + actions + "</td></tr>";
    }).join("") || '<tr><td colspan="6">No users yet.</td></tr>';

    if (canManage) {
      tb.querySelectorAll(".role-select").forEach(function (sel) {
        sel.addEventListener("change", function () {
          api("/api/admin/users/" + sel.dataset.uid + "/role", "PATCH", { role: sel.value }).then(function (r2) {
            if (!r2.ok) { alert(r2.data.error || "Could not change role."); loadUsers(); }
            else loadOverview();
          });
        });
      });
      tb.querySelectorAll("[data-reset]").forEach(function (b) {
        b.addEventListener("click", function () {
          const pw = window.prompt("Enter a new password for this user (min 6 chars):");
          if (!pw) return;
          api("/api/admin/users/" + b.dataset.reset + "/password", "POST", { new_password: pw }).then(function (r2) {
            alert(r2.ok ? "Password updated." : (r2.data.error || "Could not reset password."));
          });
        });
      });
    }
  }

  /* ---------- enquiries ---------- */
  async function loadEnquiries() {
    const r = await api("/api/admin/enquiries");
    const tb = el("enquiries-tbody");
    if (!r.ok) { tb.innerHTML = '<tr><td colspan="7">Failed to load.</td></tr>'; return; }
    tb.innerHTML = r.data.map(function (q) {
      return "<tr><td>" + esc(fmtDate(q.created_at)) + "</td><td>" + esc(q.name) + "</td><td>" +
        esc(q.email) + "</td><td>" + esc(q.contact) + "</td><td>" + esc(q.service) +
        "</td><td>" + esc(q.message) + "</td><td>" + esc(q.source) + "</td></tr>";
    }).join("") || '<tr><td colspan="7">No enquiries yet.</td></tr>';
  }

  /* ---------- orders ---------- */
  function money(n) {
    return "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const PAY_LABELS = { card: "Card", upi: "UPI", netbanking: "Net Banking", cod: "Cash on Delivery" };
  async function loadOrders() {
    const r = await api("/api/admin/orders");
    const tb = el("orders-tbody");
    if (!r.ok) { tb.innerHTML = '<tr><td colspan="7">Failed to load.</td></tr>'; return; }
    tb.innerHTML = r.data.map(function (o) {
      const itemsText = (o.items || []).map(function (i) { return i.quantity + "× " + i.name; }).join("\n");
      const customer = esc(o.name || "—") + (o.phone ? '<br><span class="admin-sub">' + esc(o.phone) + "</span>" : "");
      const total = o.total > 0 ? money(o.total) : "On request";
      return "<tr><td>" + esc(fmtDate(o.created_at)) + '</td><td><strong>' + esc(o.order_no) + "</strong></td><td>" +
        customer + '</td><td><span title="' + esc(itemsText) + '">' + (o.item_count || 0) + " item(s)</span></td><td>" +
        esc(PAY_LABELS[o.payment_method] || o.payment_method || "—") + "</td><td>" + total +
        '</td><td><span class="order-status order-status--' + esc(o.status) + '">' + esc(o.status) + "</span></td></tr>";
    }).join("") || '<tr><td colspan="7">No orders yet.</td></tr>';
  }

  /* ---------- reviews ---------- */
  let reviewFilter = "all";
  function starBits(rating) {
    let s = "";
    for (let i = 1; i <= 5; i++) s += '<span class="admin-star' + (i <= rating ? " is-on" : "") + '">★</span>';
    return '<span class="admin-stars">' + s + "</span>";
  }
  async function loadReviews() {
    const r = await api("/api/admin/reviews");
    const tb = el("reviews-tbody");
    if (!r.ok) { tb.innerHTML = '<tr><td colspan="7">Failed to load.</td></tr>'; return; }
    const rows = r.data.filter(function (rv) { return reviewFilter === "all" || rv.status === reviewFilter; });
    tb.innerHTML = rows.map(function (rv) {
      const approveBtn = rv.status === "approved"
        ? '<button class="mini-btn" data-unapprove="' + rv.id + '">Unapprove</button>'
        : '<button class="mini-btn mini-btn--go" data-approve="' + rv.id + '">Approve</button>';
      return "<tr><td>" + esc(fmtDate(rv.created_at)) + "</td><td>" + esc(rv.product_name) +
        "</td><td>" + esc(rv.name) + "</td><td>" + starBits(rv.rating) + "</td><td>" + esc(rv.comment) +
        '</td><td><span class="order-status order-status--' + (rv.status === "approved" ? "confirmed" : "pending") + '">' + esc(rv.status) + "</span></td>" +
        '<td class="admin-row-actions">' + approveBtn +
        '<button class="mini-btn mini-btn--danger" data-delrev="' + rv.id + '">Delete</button></td></tr>';
    }).join("") || '<tr><td colspan="7">No reviews' + (reviewFilter === "all" ? "" : " (" + reviewFilter + ")") + " yet.</td></tr>";

    tb.querySelectorAll("[data-approve]").forEach(function (b) {
      b.addEventListener("click", function () { setReviewStatus(b.dataset.approve, "approved"); });
    });
    tb.querySelectorAll("[data-unapprove]").forEach(function (b) {
      b.addEventListener("click", function () { setReviewStatus(b.dataset.unapprove, "pending"); });
    });
    tb.querySelectorAll("[data-delrev]").forEach(function (b) {
      b.addEventListener("click", function () { delReview(b.dataset.delrev); });
    });
  }
  async function setReviewStatus(id, status) {
    const r = await api("/api/admin/reviews/" + id, "PATCH", { status: status });
    if (r.ok) { loadReviews(); loadOverview(); } else alert(r.data.error || "Could not update review.");
  }
  async function delReview(id) {
    if (!window.confirm("Delete this review? This cannot be undone.")) return;
    const r = await api("/api/admin/reviews/" + id, "DELETE");
    if (r.ok) { loadReviews(); loadOverview(); } else alert(r.data.error || "Could not delete review.");
  }
  function wireReviewFilter() {
    const box = el("review-filter");
    if (!box) return;
    box.querySelectorAll("[data-filter]").forEach(function (b) {
      b.addEventListener("click", function () {
        reviewFilter = b.dataset.filter;
        box.querySelectorAll("[data-filter]").forEach(function (x) { x.classList.toggle("is-active", x === b); });
        loadReviews();
      });
    });
  }

  /* ---------- banners ---------- */
  let allMedia = [];
  let editingBannerId = null;

  async function loadMedia() {
    const r = await api("/api/admin/media");
    allMedia = r.ok ? r.data : [];
  }

  function mediaThumb(path, type) {
    if (type === "video") {
      return '<video src="' + esc(path) + '" muted playsinline preload="metadata"></video>';
    }
    return '<img src="' + esc(path) + '" alt="" loading="lazy" onerror="this.closest(\'.media-cell,.banner-thumb\').classList.add(\'is-broken\')">';
  }

  function setBannerMedia(url, type) {
    el("b-media-url").value = url || "";
    if (type) el("b-media-type").value = type;
    const prev = el("banner-preview");
    if (url) {
      prev.innerHTML = mediaThumb(url, el("b-media-type").value);
    } else {
      prev.innerHTML = '<span class="media-preview__empty">No media selected</span>';
    }
  }

  function renderBannerGallery() {
    const g = el("banner-gallery");
    if (!allMedia.length) { g.innerHTML = '<p class="admin-note">No media uploaded yet. Use the Upload button above.</p>'; return; }
    g.innerHTML = allMedia.map(function (m) {
      return '<button type="button" class="media-cell" data-pick="' + esc(m.path) + '" data-type="' + esc(m.type) + '" title="' + esc(m.path) + '">' +
        mediaThumb(m.path, m.type) +
        (m.type === "video" ? '<span class="media-cell__tag">video</span>' : "") + "</button>";
    }).join("");
    g.querySelectorAll("[data-pick]").forEach(function (b) {
      b.addEventListener("click", function () {
        setBannerMedia(b.dataset.pick, b.dataset.type);
        g.hidden = true;
      });
    });
  }

  function bannerCardHtml(b, isFirst, isLast) {
    const thumb = b.media_url
      ? '<div class="banner-thumb">' + mediaThumb(b.media_url, b.media_type) + "</div>"
      : '<div class="banner-thumb banner-thumb--none">No media</div>';
    const badges = (b.active ? '<span class="order-status order-status--confirmed">active</span>' : '<span class="order-status order-status--pending">hidden</span>') +
      (b.media_type === "video" ? ' <span class="pill-tag">video</span>' : "") +
      (b.zone === "hero" ? ' <span class="pill-tag">' + (b.duration || 5) + 's</span>' : "") +
      (b.button_enabled ? ' <span class="pill-tag">button</span>' : "");
    return '<div class="banner-card" data-id="' + b.id + '">' +
      thumb +
      '<div class="banner-card__info">' +
        "<strong>" + esc(b.title || b.eyebrow || "(untitled banner)") + "</strong>" +
        (b.eyebrow ? '<span class="banner-card__eyebrow">' + esc(b.eyebrow) + "</span>" : "") +
        '<div class="banner-card__badges">' + badges + "</div>" +
      "</div>" +
      '<div class="banner-card__actions">' +
        '<button class="mini-btn" data-move="up" ' + (isFirst ? "disabled" : "") + ' title="Move up">&uarr;</button>' +
        '<button class="mini-btn" data-move="down" ' + (isLast ? "disabled" : "") + ' title="Move down">&darr;</button>' +
        '<button class="mini-btn" data-editb="' + b.id + '">Edit</button>' +
        '<button class="mini-btn mini-btn--danger" data-delb="' + b.id + '">Delete</button>' +
      "</div></div>";
  }

  let bannerCache = [];
  async function loadBanners() {
    const r = await api("/api/admin/banners");
    if (!r.ok) { el("hero-list").innerHTML = '<p class="admin-note">Failed to load.</p>'; return; }
    bannerCache = r.data;
    renderBannerZone("hero", el("hero-list"));
    renderBannerZone("promo", el("promo-list"));
  }

  function renderBannerZone(zone, container) {
    const list = bannerCache.filter(function (b) { return b.zone === zone; });
    container.innerHTML = list.map(function (b, i) {
      return bannerCardHtml(b, i === 0, i === list.length - 1);
    }).join("") || '<p class="admin-note">No ' + zone + ' banners yet.</p>';

    container.querySelectorAll("[data-editb]").forEach(function (btn) {
      btn.addEventListener("click", function () { startEditBanner(btn.dataset.editb); });
    });
    container.querySelectorAll("[data-delb]").forEach(function (btn) {
      btn.addEventListener("click", function () { delBanner(btn.dataset.delb); });
    });
    container.querySelectorAll("[data-move]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const id = btn.closest(".banner-card").dataset.id;
        moveBanner(id, btn.dataset.move);
      });
    });
  }

  function openBannerForm(title) {
    el("banner-form-title").textContent = title;
    el("banner-form").hidden = false;
    el("banner-msg").textContent = "";
    el("banner-gallery").hidden = true;
    el("banner-form").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function applyZoneVisibility(zone) {
    const heroOnly = document.querySelectorAll(".banner-hero-only");
    heroOnly.forEach(function (n) { n.style.display = zone === "hero" ? "" : "none"; });
  }

  function resetBannerForm(zone) {
    editingBannerId = null;
    el("b-id").value = "";
    el("b-zone").value = zone;
    ["b-eyebrow", "b-title", "b-title-highlight", "b-subtitle", "b-link-url", "b-button-text", "b-button-link"]
      .forEach(function (id) { el(id).value = ""; });
    el("b-duration").value = zone === "hero" ? 6 : 5;
    el("b-button-enabled").checked = false;
    el("banner-button-fields").hidden = true;
    el("b-active").checked = true;
    setBannerMedia("", "image");
    applyZoneVisibility(zone);
  }

  function startAddBanner(zone) {
    resetBannerForm(zone);
    openBannerForm(zone === "hero" ? "Add hero banner" : "Add promo banner");
  }

  function startEditBanner(id) {
    const b = bannerCache.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!b) return;
    editingBannerId = b.id;
    el("b-id").value = b.id;
    el("b-zone").value = b.zone;
    el("b-eyebrow").value = b.eyebrow || "";
    el("b-title").value = b.title || "";
    el("b-title-highlight").value = b.title_highlight || "";
    el("b-subtitle").value = b.subtitle || "";
    el("b-link-url").value = b.link_url || "";
    el("b-duration").value = b.duration || 5;
    el("b-button-enabled").checked = !!b.button_enabled;
    el("banner-button-fields").hidden = !b.button_enabled;
    el("b-button-text").value = b.button_text || "";
    el("b-button-link").value = b.button_link || "";
    el("b-active").checked = !!b.active;
    setBannerMedia(b.media_url || "", b.media_type || "image");
    applyZoneVisibility(b.zone);
    openBannerForm(b.zone === "hero" ? "Edit hero banner" : "Edit promo banner");
  }

  function collectBanner() {
    return {
      zone: el("b-zone").value,
      media_url: el("b-media-url").value.trim(),
      media_type: el("b-media-type").value,
      eyebrow: el("b-eyebrow").value.trim(),
      title: el("b-title").value.trim(),
      title_highlight: el("b-title-highlight").value.trim(),
      subtitle: el("b-subtitle").value.trim(),
      link_url: el("b-link-url").value.trim(),
      button_enabled: el("b-button-enabled").checked,
      button_text: el("b-button-text").value.trim(),
      button_link: el("b-button-link").value.trim(),
      duration: parseInt(el("b-duration").value, 10) || 5,
      active: el("b-active").checked,
    };
  }

  async function saveBanner(e) {
    e.preventDefault();
    const body = collectBanner();
    const msg = el("banner-msg"); msg.className = "admin-msg";
    const r = editingBannerId
      ? await api("/api/admin/banners/" + editingBannerId, "PUT", body)
      : await api("/api/admin/banners", "POST", body);
    if (r.ok) { el("banner-form").hidden = true; loadBanners(); }
    else { msg.className = "admin-msg is-error"; msg.textContent = r.data.error || "Could not save banner."; }
  }

  async function delBanner(id) {
    if (!window.confirm("Delete this banner? This cannot be undone.")) return;
    const r = await api("/api/admin/banners/" + id, "DELETE");
    if (r.ok) loadBanners(); else alert(r.data.error || "Could not delete.");
  }

  async function moveBanner(id, direction) {
    const r = await api("/api/admin/banners/" + id + "/move", "PATCH", { direction: direction });
    if (r.ok) loadBanners(); else alert(r.data.error || "Could not reorder.");
  }

  function wireBannerUpload() {
    el("banner-upload-input").addEventListener("change", function () {
      const f = this.files && this.files[0];
      if (!f) return;
      const fd = new FormData();
      fd.append("file", f);
      el("banner-msg").className = "admin-msg";
      el("banner-msg").textContent = "Uploading…";
      fetch("/api/admin/media", { method: "POST", body: fd })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
        .then(function (r) {
          if (r.ok && r.d.path) {
            el("banner-msg").textContent = "";
            allMedia.unshift({ path: r.d.path, type: r.d.type });
            setBannerMedia(r.d.path, r.d.type);
          } else {
            el("banner-msg").className = "admin-msg is-error";
            el("banner-msg").textContent = (r.d && r.d.error) || "Upload failed.";
          }
        })
        .catch(function () { el("banner-msg").className = "admin-msg is-error"; el("banner-msg").textContent = "Upload failed."; });
      this.value = "";
    });
  }

  function wireBanners() {
    el("add-hero-btn").addEventListener("click", function () { startAddBanner("hero"); });
    el("add-promo-btn").addEventListener("click", function () { startAddBanner("promo"); });
    el("banner-cancel").addEventListener("click", function () { el("banner-form").hidden = true; });
    el("banner-form").addEventListener("submit", saveBanner);
    el("b-button-enabled").addEventListener("change", function () {
      el("banner-button-fields").hidden = !this.checked;
    });
    el("b-media-url").addEventListener("input", function () {
      const url = this.value.trim();
      const ext = (url.split(".").pop() || "").toLowerCase();
      if (["mp4", "webm", "ogg", "ogv", "mov", "m4v"].indexOf(ext) >= 0) el("b-media-type").value = "video";
      setBannerMedia(url, el("b-media-type").value);
    });
    el("b-media-type").addEventListener("change", function () { setBannerMedia(el("b-media-url").value.trim(), this.value); });
    el("banner-gallery-toggle").addEventListener("click", function () {
      const g = el("banner-gallery");
      g.hidden = !g.hidden;
      if (!g.hidden) renderBannerGallery();
    });
    wireBannerUpload();
  }

  /* ---------- verification codes ---------- */
  function codesMsg(text, isError) {
    const m = el("codes-msg");
    m.className = "admin-msg" + (isError ? " is-error" : " is-ok");
    m.textContent = text;
  }

  async function loadCodeStats() {
    const r = await api("/api/admin/codes/stats");
    if (!r.ok) return;
    const o = r.data;
    el("codes-stats").innerHTML = [
      { n: o.total, l: "Total codes", s: "" },
      { n: o.unused, l: "Unused", s: "available to verify" },
      { n: o.used, l: "Used", s: "already verified" },
    ].map(function (c) {
      return '<div class="stat-card"><span class="stat-card__n">' + c.n + '</span>' +
        '<span class="stat-card__l">' + esc(c.l) + "</span>" +
        (c.s ? '<span class="stat-card__s">' + esc(c.s) + "</span>" : "") + "</div>";
    }).join("");
  }

  async function loadRecentCodes() {
    const r = await api("/api/admin/codes/recent");
    const tb = el("codes-recent-tbody");
    if (!r.ok) { tb.innerHTML = '<tr><td colspan="2">Failed to load.</td></tr>'; return; }
    tb.innerHTML = r.data.map(function (c) {
      return "<tr><td>" + esc(c.code) + "</td><td>" + esc(fmtDate(c.used_at)) + "</td></tr>";
    }).join("") || '<tr><td colspan="2">No verifications yet.</td></tr>';
  }

  function refreshCodes() { loadCodeStats(); loadRecentCodes(); loadOverview(); }

  function wireCodes() {
    el("gen-btn").addEventListener("click", function () {
      const count = parseInt(el("gen-count").value, 10) || 0;
      const digits = parseInt(el("gen-digits").value, 10) || 8;
      if (!window.confirm("Generate " + count + " codes of " + digits + " digits?")) return;
      el("gen-btn").disabled = true;
      codesMsg("Generating…", false);
      api("/api/admin/codes/generate", "POST", { count: count, digits: digits }).then(function (r) {
        el("gen-btn").disabled = false;
        if (r.ok) { codesMsg("Added " + r.data.added + " new codes.", false); refreshCodes(); }
        else codesMsg(r.data.error || "Could not generate codes.", true);
      });
    });

    el("add-btn").addEventListener("click", function () {
      const codes = el("add-codes").value;
      if (!codes.trim()) { codesMsg("Enter some codes first.", true); return; }
      api("/api/admin/codes/add", "POST", { codes: codes }).then(function (r) {
        if (r.ok) { codesMsg("Added " + r.data.added + " new codes (" + r.data.parsed + " read).", false); el("add-codes").value = ""; refreshCodes(); }
        else codesMsg(r.data.error || "Could not add codes.", true);
      });
    });

    el("codes-file").addEventListener("change", function () {
      el("codes-file-name").textContent = (this.files && this.files[0]) ? this.files[0].name : "";
    });
    el("upload-codes-btn").addEventListener("click", function () {
      const f = el("codes-file").files && el("codes-file").files[0];
      if (!f) { codesMsg("Choose a file first.", true); return; }
      const fd = new FormData();
      fd.append("file", f);
      codesMsg("Uploading…", false);
      fetch("/api/admin/codes/upload", { method: "POST", body: fd })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); })
        .then(function (r) {
          if (r.ok && r.d.ok) {
            codesMsg("Added " + r.d.added + " new codes from file (" + r.d.parsed + " read).", false);
            el("codes-file").value = ""; el("codes-file-name").textContent = ""; refreshCodes();
          } else codesMsg((r.d && r.d.error) || "Upload failed.", true);
        })
        .catch(function () { codesMsg("Upload failed.", true); });
    });

    el("check-btn").addEventListener("click", function () {
      const code = el("check-code").value.trim();
      if (!code) return;
      api("/api/admin/codes/check?code=" + encodeURIComponent(code)).then(function (r) {
        const box = el("check-result");
        if (!r.ok) { box.className = "check-result is-bad"; box.textContent = r.data.error || "Error."; return; }
        if (!r.data.found) { box.className = "check-result is-bad"; box.textContent = "Not found — this code is not authorized."; }
        else if (r.data.used) { box.className = "check-result is-warn"; box.textContent = "Valid but already used on " + fmtDate(r.data.used_at) + "."; }
        else { box.className = "check-result is-good"; box.textContent = "Valid and unused — ready to verify."; }
      });
    });
    el("check-code").addEventListener("keydown", function (e) { if (e.key === "Enter") el("check-btn").click(); });

    el("clear-used-btn").addEventListener("click", function () {
      if (!window.confirm("Delete all USED codes? This cannot be undone.")) return;
      api("/api/admin/codes/clear", "POST", { scope: "used" }).then(function (r) {
        if (r.ok) { codesMsg("Used codes cleared.", false); refreshCodes(); }
      });
    });
    el("clear-all-btn").addEventListener("click", function () {
      if (!window.confirm("Delete ALL codes? Every product code will stop verifying. This cannot be undone.")) return;
      api("/api/admin/codes/clear", "POST", { scope: "all" }).then(function (r) {
        if (r.ok) { codesMsg("All codes deleted.", false); refreshCodes(); }
      });
    });
  }

  /* ---------- maintenance mode ---------- */
  function paintMaintenance(active) {
    const box = el("maintenance-toggle");
    const state = el("maintenance-state");
    if (box) box.checked = !!active;
    if (state) {
      state.textContent = active ? "Maintenance mode is ON" : "Maintenance mode is OFF";
      state.style.color = active ? "#c0392b" : "#2fae57";
    }
  }
  async function loadMaintenance() {
    const r = await api("/api/admin/settings");
    if (r.ok) paintMaintenance(r.data.maintenance);
  }
  function wireMaintenance() {
    const box = el("maintenance-toggle");
    if (!box) return;
    box.addEventListener("change", function () {
      const want = box.checked;
      const msg = el("maintenance-msg");
      if (msg) msg.className = "admin-msg";
      api("/api/admin/settings/maintenance", "POST", { active: want }).then(function (r) {
        if (r.ok) {
          paintMaintenance(r.data.active);
          if (msg) {
            msg.className = "admin-msg is-ok";
            msg.textContent = r.data.active
              ? "Site is now in maintenance mode — visitors see the “back soon” page."
              : "Maintenance mode turned off — the site is live again.";
          }
        } else {
          box.checked = !want; // revert on failure
          if (msg) { msg.className = "admin-msg is-error"; msg.textContent = (r.data && r.data.error) || "Could not update."; }
        }
      });
    });
  }

  /* ---------- settings (change own password) ---------- */
  function wireSettings() {
    wireMaintenance();
    el("pw-form").addEventListener("submit", function (e) {
      e.preventDefault();
      const cur = el("pw-current").value, nw = el("pw-new").value, cf = el("pw-confirm").value;
      const msg = el("pw-msg"); msg.className = "admin-msg";
      if (nw !== cf) { msg.className = "admin-msg is-error"; msg.textContent = "New passwords don't match."; return; }
      api("/api/account/password", "POST", { current_password: cur, new_password: nw }).then(function (r) {
        if (r.ok) {
          msg.className = "admin-msg is-ok"; msg.textContent = "Password changed.";
          el("pw-current").value = el("pw-new").value = el("pw-confirm").value = "";
        } else { msg.className = "admin-msg is-error"; msg.textContent = r.data.error || "Could not change password."; }
      });
    });
  }

  /* ---------- init / gate ---------- */
  async function init() {
    const me = await api("/api/me");
    if (!me.ok || !me.data.is_admin) { window.location.href = "login.html"; return; }
    meRole = me.data.role;
    el("admin-gate").hidden = true;
    el("admin-shell").hidden = false;
    el("admin-email").textContent = me.data.email;
    el("admin-role").textContent = me.data.role;

    setupTabs();
    await loadImages();
    loadCategories();
    loadProducts();
    loadBanners();
    loadMedia();
    loadOrders();
    loadReviews();
    loadCodeStats();
    loadRecentCodes();
    loadUsers();
    loadEnquiries();
    loadOverview();
    loadMaintenance();
    wireUpload();
    wireCategoryAdd();
    wireReviewFilter();
    wireBanners();
    wireCodes();
    wireSettings();

    el("add-product-btn").addEventListener("click", startAdd);
    el("product-cancel").addEventListener("click", function () { el("product-form").hidden = true; resetForm(); });
    el("product-form").addEventListener("submit", saveProduct);
    el("admin-logout").addEventListener("click", function () {
      api("/api/logout", "POST", {}).then(function () { window.location.href = "login.html"; });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
