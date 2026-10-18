/* IronCore Pharma — auth: login/signup page + header account state */
(function () {
  "use strict";

  async function api(path, body) {
    const opts = { method: body ? "POST" : "GET", headers: {} };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      return { ok: false, status: 0, data: { error: "Can't reach the server. Is it running?" } };
    }
    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      /* no-op */
    }
    return { ok: res.ok, status: res.status, data: data };
  }

  /* ---------------- Login / Sign-up page ---------------- */
  function initAuthForm() {
    const form = document.getElementById("auth-form");
    if (!form) return;

    const lead = document.getElementById("auth-lead");
    const msg = document.getElementById("auth-msg");
    const submit = document.getElementById("auth-submit");
    const pwInput = document.getElementById("auth-password");
    const switchText = document.getElementById("auth-switch-text");
    const switchLink = document.getElementById("auth-switch-link");
    const tabs = Array.prototype.slice.call(document.querySelectorAll(".auth-tab"));
    let mode = "login";

    // If already signed in, don't show the form — go to the store.
    api("/api/me").then(function (r) {
      if (r.ok && r.data.email) window.location.href = "index.html";
    });

    const COPY = {
      login: {
        lead: "Welcome back — log in to your account.",
        submit: "Login",
        switchText: "New to IronCore?",
        switchLink: "Create an account",
        autocomplete: "current-password",
      },
      signup: {
        lead: "Create your account — it only takes a moment.",
        submit: "Create Account",
        switchText: "Already have an account?",
        switchLink: "Log in",
        autocomplete: "new-password",
      },
    };

    function setMode(next) {
      mode = next;
      const c = COPY[mode];
      lead.textContent = c.lead;
      submit.textContent = c.submit;
      switchText.textContent = c.switchText;
      switchLink.textContent = c.switchLink;
      pwInput.setAttribute("autocomplete", c.autocomplete);
      tabs.forEach(function (t) {
        t.classList.toggle("is-active", t.dataset.mode === mode);
      });
      msg.textContent = "";
      msg.className = "auth-msg";
    }

    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        setMode(t.dataset.mode);
      });
    });

    switchLink.addEventListener("click", function (e) {
      e.preventDefault();
      setMode(mode === "login" ? "signup" : "login");
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const email = document.getElementById("auth-email").value.trim();
      const password = pwInput.value;

      msg.className = "auth-msg";
      if (!email || !password) {
        showMsg("Please enter your email and password.", true);
        return;
      }
      submit.disabled = true;
      submit.textContent = mode === "login" ? "Logging in..." : "Creating...";

      api(mode === "login" ? "/api/login" : "/api/signup", { email: email, password: password }).then(function (r) {
        submit.disabled = false;
        submit.textContent = COPY[mode].submit;
        if (r.ok) {
          showMsg("Success! Redirecting...", false);
          window.location.href = "index.html";
        } else {
          showMsg(r.data.error || "Something went wrong. Please try again.", true);
        }
      });
    });

    function showMsg(text, isError) {
      msg.textContent = text;
      msg.className = "auth-msg" + (isError ? " is-error" : " is-ok");
    }

    setMode("login");
  }

  /* ---------------- Header account state (all pages) ---------------- */
  function initHeaderAuth() {
    const link = document.getElementById("account-link");
    if (!link) return;

    api("/api/me").then(function (r) {
      if (r.ok && r.data.email) {
        renderLoggedIn(link, r.data.email, r.data.is_admin);
      } else {
        link.setAttribute("href", "login.html");
      }
    });
  }

  function renderLoggedIn(link, email, isAdmin) {
    const initial = (email[0] || "U").toUpperCase();
    link.setAttribute("href", "#");
    link.setAttribute("title", email);
    link.setAttribute("aria-label", "Account: " + email);
    link.innerHTML = '<span class="avatar">' + initial + "</span>";

    const wrap = document.createElement("div");
    wrap.className = "account-menu";
    link.parentNode.insertBefore(wrap, link);
    wrap.appendChild(link);

    const pop = document.createElement("div");
    pop.className = "account-pop";
    pop.innerHTML =
      '<p class="account-pop__email">' + escapeHtml(email) + "</p>" +
      (isAdmin ? '<a class="account-pop__admin" href="admin.html">Admin panel &rarr;</a>' : "") +
      '<button type="button" class="account-pop__logout">Log out</button>';
    wrap.appendChild(pop);

    link.addEventListener("click", function (e) {
      e.preventDefault();
      wrap.classList.toggle("is-open");
    });

    document.addEventListener("click", function (e) {
      if (!wrap.contains(e.target)) wrap.classList.remove("is-open");
    });

    pop.querySelector(".account-pop__logout").addEventListener("click", function () {
      api("/api/logout", {}).then(function () {
        window.location.reload();
      });
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initAuthForm();
      initHeaderAuth();
    });
  } else {
    initAuthForm();
    initHeaderAuth();
  }
})();
