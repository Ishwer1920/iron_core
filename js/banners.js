/* IronCore Pharma — home banners: hero slider + right-side promo cards.
   Rendered from /api/banners (admin-managed). Falls back to whatever static
   markup is already on the page if the API is empty or unreachable. */
(function () {
  "use strict";

  var sliderEl = document.querySelector(".hero-slider");
  var promoEl = document.querySelector(".promo-stack");
  if (!sliderEl && !promoEl) return; // not the home page

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function mediaHtml(b) {
    if (!b.media_url) return "";
    if (b.media_type === "video") {
      return '<video autoplay muted loop playsinline preload="metadata"><source src="' + esc(b.media_url) + '" /></video>';
    }
    return '<img src="' + esc(b.media_url) + '" alt="" loading="lazy" />';
  }

  function titleHtml(b) {
    var t = esc(b.title || "");
    var h = (b.title_highlight || "").trim();
    if (h) {
      var he = esc(h);
      t = t.replace(he, '<span>' + he + "</span>"); // highlight first occurrence
    }
    return t;
  }

  /* ---------------- hero slider ---------------- */
  function heroSlideHtml(b, i) {
    var hasText = !!(b.eyebrow || b.title || b.subtitle);
    var btn = (b.button_enabled && b.button_text)
      ? '<div class="hero-actions"><a class="btn btn-primary" href="' + esc(b.button_link || b.link_url || "#") + '">' + esc(b.button_text) + "</a></div>"
      : "";
    var attrs = ' data-duration="' + (b.duration || 5) + '"' + (b.link_url ? ' data-link="' + esc(b.link_url) + '"' : "");

    // Media-only banner (no eyebrow/title/subtitle): the image/video fills the whole banner.
    if (!hasText && b.media_url) {
      var cls = "hero-banner hero-slide" + (i === 0 ? " is-active" : "") + " is-media-only" + (btn ? " has-overlay" : "");
      return '<article class="' + cls + '"' + attrs + ">" +
        '<div class="hero-banner__bg">' + mediaHtml(b) + "</div>" +
        (btn ? '<div class="hero-banner__overlay">' + btn + "</div>" : "") +
        "</article>";
    }

    // Text present: copy on the left, media settles on the right.
    var visual = b.media_url
      ? '<div class="hero-banner__visual" aria-hidden="true">' + mediaHtml(b) + "</div>"
      : "";
    return '<article class="hero-banner hero-slide' + (i === 0 ? " is-active" : "") + '"' + attrs + ">" +
      '<div class="hero-banner__copy">' +
        (b.eyebrow ? '<p class="hero-banner__eyebrow">' + esc(b.eyebrow) + "</p>" : "") +
        (b.title ? "<h1>" + titleHtml(b) + "</h1>" : "") +
        (b.subtitle ? "<p>" + esc(b.subtitle) + "</p>" : "") +
        btn +
      "</div>" + visual +
      "</article>";
  }

  function renderHero(list) {
    sliderEl.innerHTML = list.map(heroSlideHtml).join("") +
      '<div class="hero-dots" aria-label="Hero slide controls"></div>';
    initSlider();
  }

  function initSlider() {
    var slides = [].slice.call(sliderEl.querySelectorAll(".hero-slide"));
    var dotsWrap = sliderEl.querySelector(".hero-dots");
    if (!slides.length) return;
    if (dotsWrap) {
      dotsWrap.innerHTML = slides.map(function (s, i) {
        return '<button type="button" class="' + (i === 0 ? "is-active" : "") + '" aria-label="Show slide ' + (i + 1) + '"></button>';
      }).join("");
    }
    var dots = dotsWrap ? [].slice.call(dotsWrap.querySelectorAll("button")) : [];
    var idx = 0, timer = null, paused = false;

    function show(n) {
      idx = (n + slides.length) % slides.length;
      slides.forEach(function (s, i) { s.classList.toggle("is-active", i === idx); });
      dots.forEach(function (d, i) { d.classList.toggle("is-active", i === idx); });
    }
    function schedule() {
      window.clearTimeout(timer);
      if (slides.length < 2 || paused) return;
      var dur = (parseInt(slides[idx].getAttribute("data-duration"), 10) || 5) * 1000;
      timer = window.setTimeout(function () { show(idx + 1); schedule(); }, dur);
    }
    function go(n) { show(n); schedule(); }

    dots.forEach(function (d, i) { d.addEventListener("click", function () { go(i); }); });

    // hover = pause auto-scroll (zoom is handled in CSS via :hover)
    sliderEl.addEventListener("mouseenter", function () { paused = true; window.clearTimeout(timer); });
    sliderEl.addEventListener("mouseleave", function () { paused = false; schedule(); });

    // whole-slide link
    slides.forEach(function (s) {
      var link = s.getAttribute("data-link");
      if (!link) return;
      s.classList.add("is-linked");
      s.addEventListener("click", function (e) {
        if (e.target.closest("a,button")) return;
        window.location.href = link;
      });
    });

    show(0);
    schedule();
  }

  /* ---------------- promo cards ---------------- */
  function promoCardHtml(b, i) {
    var cta = (b.button_enabled && b.button_text)
      ? '<a href="' + esc(b.button_link || b.link_url || "#") + '">' + esc(b.button_text) + "</a>"
      : "";
    var media = b.media_url ? '<div class="promo-card__media">' + mediaHtml(b) + "</div>" : "";
    return '<div class="promo-card' + (i % 2 === 1 ? " promo-card--pink" : "") +
      (b.media_url ? " has-media" : "") + '"' + (b.link_url ? ' data-link="' + esc(b.link_url) + '"' : "") + ">" +
      media +
      '<div class="promo-card__body">' +
        (b.eyebrow ? '<span class="promo-card__tag">' + esc(b.eyebrow) + "</span>" : "") +
        (b.title ? "<h3>" + esc(b.title) + "</h3>" : "") +
        cta +
      "</div></div>";
  }

  function renderPromo(list) {
    promoEl.innerHTML = list.map(promoCardHtml).join("");
    [].slice.call(promoEl.querySelectorAll(".promo-card[data-link]")).forEach(function (card) {
      card.classList.add("is-linked");
      card.addEventListener("click", function (e) {
        if (e.target.closest("a,button")) return;
        window.location.href = card.getAttribute("data-link");
      });
    });
  }

  /* ---------------- boot ---------------- */
  fetch("/api/banners")
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (data && sliderEl && data.hero && data.hero.length) renderHero(data.hero);
      else if (sliderEl) initSlider(); // keep static fallback slides
      if (data && promoEl && data.promo && data.promo.length) renderPromo(data.promo);
    })
    .catch(function () { if (sliderEl) initSlider(); });
})();
