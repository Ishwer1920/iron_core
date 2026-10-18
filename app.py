"""IronCore Pharma — backend server.

Serves the static storefront AND an API:
  - email/password auth (SQLite + hashed passwords + signed-cookie sessions)
  - admin role + admin panel API (products CRUD, users, enquiries)
  - public enquiry submission

The product catalog lives in the DB. Whenever products change, js/products-data.js
is regenerated from the DB so the storefront stays in sync.

Run:  python app.py      (serves http://127.0.0.1:8000)
"""
import os
import re
import json
import sqlite3
import secrets
from datetime import datetime, timezone, timedelta
from functools import wraps

from flask import Flask, request, session, jsonify, send_from_directory, abort, Response
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

from imaging import whiten_to_white_bg

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "app.db")
SECRET_PATH = os.path.join(DATA_DIR, "secret.key")
CATALOG_SEED = os.path.join(DATA_DIR, "catalog.json")
ADMIN_CREDS_PATH = os.path.join(DATA_DIR, "ADMIN_CREDENTIALS.txt")
PRODUCTS_JS = os.path.join(BASE_DIR, "js", "products-data.js")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MIN_PASSWORD = 6
ADMIN_EMAIL = "admin@ironcore.com"

# Checkout: flat shipping rule mirrored on the client (js/store.js).
SHIPPING_FLAT = 50.0
FREE_SHIPPING_OVER = 2000.0
PAYMENT_METHODS = {"card", "upi", "netbanking", "cod"}


def price_to_number(value):
    """Extract a numeric price from strings like '₹1,299.00' or 'Price on request'."""
    if value is None:
        return 0.0
    m = re.search(r"\d+(?:\.\d+)?", str(value).replace(",", ""))
    return float(m.group()) if m else 0.0

PRODUCTS_IMG_DIR = os.path.join(BASE_DIR, "img", "products")
BANNERS_IMG_DIR = os.path.join(BASE_DIR, "img", "banners")
IMG_DIR = os.path.join(BASE_DIR, "img")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"}
VIDEO_EXTS = {".mp4", ".webm", ".ogv", ".ogg", ".mov", ".m4v"}
MEDIA_EXTS = IMAGE_EXTS | VIDEO_EXTS


def media_type_of(path):
    return "video" if os.path.splitext(path or "")[1].lower() in VIDEO_EXTS else "image"


def normalize_code(s):
    """Uppercase and strip all whitespace so codes match regardless of spacing/case."""
    return re.sub(r"\s+", "", str(s or "")).upper()


def parse_codes(text):
    """Split a blob of pasted/uploaded text into a de-duplicated list of codes."""
    out, seen = [], set()
    for part in re.split(r"[\s,;]+", str(text or "")):
        c = normalize_code(part)
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


ROLES = {"customer", "staff", "co-admin", "admin"}
ADMIN_ROLES = {"admin", "co-admin"}
ACTIVE_WINDOW_MIN = 15

os.makedirs(DATA_DIR, exist_ok=True)

PRODUCT_FIELDS = ["slug", "category", "name", "composition", "pack_size",
                  "price", "rating", "stock", "image", "images_json", "description"]


def get_secret_key():
    if os.path.exists(SECRET_PATH):
        with open(SECRET_PATH, "r", encoding="utf-8") as fh:
            return fh.read().strip()
    key = secrets.token_hex(32)
    with open(SECRET_PATH, "w", encoding="utf-8") as fh:
        fh.write(key)
    return key


app = Flask(__name__, static_folder=None)
app.secret_key = get_secret_key()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    MAX_CONTENT_LENGTH=64 * 1024 * 1024,  # 64 MB upload cap (allows short banner videos)
)


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ----------------------------------------------------------------------------
# Schema + seeding
# ----------------------------------------------------------------------------
def init_db():
    with db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                is_admin INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )""")
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(users)")]
        for col, ddl in (("is_admin", "INTEGER NOT NULL DEFAULT 0"),
                         ("role", "TEXT NOT NULL DEFAULT 'customer'"),
                         ("last_seen", "TEXT")):
            if col not in cols:
                conn.execute(f"ALTER TABLE users ADD COLUMN {col} {ddl}")
        # keep role <-> is_admin consistent for any pre-existing rows
        conn.execute("UPDATE users SET role = 'admin' WHERE is_admin = 1 AND role = 'customer'")
        conn.execute("UPDATE users SET is_admin = 1 WHERE role IN ('admin','co-admin')")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                slug TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                image TEXT,
                sort INTEGER NOT NULL DEFAULT 0
            )""")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS products (
                slug TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                name TEXT NOT NULL,
                composition TEXT,
                pack_size TEXT,
                price TEXT,
                rating REAL,
                stock TEXT,
                image TEXT,
                images_json TEXT,
                description TEXT,
                sort INTEGER NOT NULL DEFAULT 0
            )""")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS enquiries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT, email TEXT, contact TEXT, location TEXT,
                service TEXT, message TEXT, source TEXT,
                created_at TEXT NOT NULL
            )""")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_slug TEXT NOT NULL,
                user_id INTEGER,
                name TEXT,
                rating INTEGER NOT NULL,
                comment TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL
            )""")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_no TEXT UNIQUE NOT NULL,
                user_id INTEGER,
                name TEXT, email TEXT, phone TEXT,
                address TEXT, city TEXT, state TEXT, pincode TEXT,
                payment_method TEXT,
                items_json TEXT NOT NULL,
                item_count INTEGER NOT NULL DEFAULT 0,
                subtotal REAL NOT NULL DEFAULT 0,
                shipping REAL NOT NULL DEFAULT 0,
                total REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL
            )""")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS auth_codes (
                code TEXT PRIMARY KEY,
                used INTEGER NOT NULL DEFAULT 0,
                used_at TEXT,
                created_at TEXT NOT NULL
            )""")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )""")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS banners (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                zone TEXT NOT NULL,
                media_type TEXT NOT NULL DEFAULT 'image',
                media_url TEXT,
                eyebrow TEXT,
                title TEXT,
                title_highlight TEXT,
                subtitle TEXT,
                link_url TEXT,
                button_enabled INTEGER NOT NULL DEFAULT 0,
                button_text TEXT,
                button_link TEXT,
                duration INTEGER NOT NULL DEFAULT 5,
                sort INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            )""")


def seed_catalog():
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) AS c FROM products").fetchone()["c"]
        if n > 0 or not os.path.exists(CATALOG_SEED):
            return
        with open(CATALOG_SEED, "r", encoding="utf-8") as fh:
            cat = json.load(fh)
        for i, c in enumerate(cat.get("categories", [])):
            conn.execute(
                "INSERT OR REPLACE INTO categories (slug,name,count,image,sort) VALUES (?,?,?,?,?)",
                (c["slug"], c["name"], c.get("count", 0), c.get("image", ""), i))
        for i, p in enumerate(cat.get("products", [])):
            conn.execute(
                """INSERT OR REPLACE INTO products
                   (slug,category,name,composition,pack_size,price,rating,stock,image,images_json,description,sort)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (p["slug"], p["category"], p["name"], p.get("composition", ""),
                 p.get("packSize", ""), p.get("price", ""), p.get("rating", 0),
                 p.get("stock", ""), p.get("image", ""),
                 json.dumps(p.get("images", [p.get("image", "")])), p.get("description", ""), i))
    print("[seed] catalog loaded into DB")


def seed_admin():
    with db() as conn:
        admin = conn.execute("SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1").fetchone()
        if admin:
            return
        password = secrets.token_urlsafe(9)
        conn.execute(
            "INSERT OR IGNORE INTO users (email,password_hash,is_admin,role,created_at) VALUES (?,?,?,?,?)",
            (ADMIN_EMAIL, generate_password_hash(password), 1, "admin", datetime.now(timezone.utc).isoformat()))
        # promote if the row already existed as a normal user
        conn.execute("UPDATE users SET is_admin = 1, role = 'admin' WHERE email = ?", (ADMIN_EMAIL,))
    with open(ADMIN_CREDS_PATH, "w", encoding="utf-8") as fh:
        fh.write(f"ADMIN LOGIN\nemail: {ADMIN_EMAIL}\npassword: {password}\n")
    print(f"[seed] admin created -> {ADMIN_EMAIL} / {password}  (also saved to {ADMIN_CREDS_PATH})")


DEFAULT_BANNERS = [
    # Hero slider
    dict(zone="hero", media_type="image", media_url="img/hero-pharma.svg",
         eyebrow="PCD Pharma Franchise Across India", title="Power Your Pharma Business",
         title_highlight="Pharma",
         subtitle="Reliable formulations, disciplined quality checks, and launch-ready franchise support — all backed by ISO-certified manufacturing.",
         link_url="", button_enabled=1, button_text="Explore Products", button_link="products.html", duration=6),
    dict(zone="hero", media_type="image", media_url="img/hero-lab.svg",
         eyebrow="ISO 9001:2015 Certified", title="Quality You Can Trust",
         title_highlight="Trust",
         subtitle="GMP-compliant manufacturing, clean professional packaging, and dependable batch documentation on every order.",
         link_url="", button_enabled=1, button_text="View Products", button_link="products.html", duration=6),
    dict(zone="hero", media_type="image", media_url="img/quality-lab.svg",
         eyebrow="Complete Therapeutic Range", title="Tablets To Injectables",
         title_highlight="Injectables",
         subtitle="A broad catalogue across 15+ categories — tablets, syrups, capsules, injections and specialty care, ready for franchise expansion.",
         link_url="", button_enabled=1, button_text="Browse Categories", button_link="index.html#categories", duration=6),
    # Right-side promo cards
    dict(zone="promo", media_type="image", media_url="",
         eyebrow="Franchise", title="Monopoly Rights Available", title_highlight="",
         subtitle="", link_url="index.html#contact", button_enabled=1,
         button_text="Enquire Now", button_link="index.html#contact", duration=5),
    dict(zone="promo", media_type="image", media_url="",
         eyebrow="Services", title="3rd Party Manufacturing", title_highlight="",
         subtitle="", link_url="index.html#manufacturing", button_enabled=1,
         button_text="Learn More", button_link="index.html#manufacturing", duration=5),
]


def seed_banners():
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) AS c FROM banners").fetchone()["c"]
        if n > 0:
            return
        now = datetime.now(timezone.utc).isoformat()
        for i, b in enumerate(DEFAULT_BANNERS):
            conn.execute(
                """INSERT INTO banners
                   (zone,media_type,media_url,eyebrow,title,title_highlight,subtitle,link_url,
                    button_enabled,button_text,button_link,duration,sort,active,created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (b["zone"], b["media_type"], b["media_url"], b["eyebrow"], b["title"],
                 b["title_highlight"], b["subtitle"], b["link_url"], b["button_enabled"],
                 b["button_text"], b["button_link"], b["duration"], i, 1, now))
    print("[seed] default banners loaded into DB")


def banner_row(r):
    return dict(id=r["id"], zone=r["zone"], media_type=r["media_type"], media_url=r["media_url"],
                eyebrow=r["eyebrow"], title=r["title"], title_highlight=r["title_highlight"],
                subtitle=r["subtitle"], link_url=r["link_url"],
                button_enabled=bool(r["button_enabled"]), button_text=r["button_text"],
                button_link=r["button_link"], duration=r["duration"], sort=r["sort"],
                active=bool(r["active"]))


def catalog_from_db():
    with db() as conn:
        cats = [dict(slug=r["slug"], name=r["name"], count=r["count"], image=r["image"])
                for r in conn.execute("SELECT * FROM categories ORDER BY sort, name")]
        prods = []
        for r in conn.execute("SELECT * FROM products ORDER BY sort, name"):
            try:
                images = json.loads(r["images_json"] or "[]")
            except (ValueError, TypeError):
                images = [r["image"]]
            prods.append(dict(slug=r["slug"], category=r["category"], name=r["name"],
                              composition=r["composition"], packSize=r["pack_size"],
                              price=r["price"], rating=r["rating"], stock=r["stock"],
                              image=r["image"], images=images, description=r["description"]))
    return {"categories": cats, "products": prods}


def regenerate_products_js():
    data = catalog_from_db()
    body = "window.ironCoreCatalog = " + json.dumps(data, indent=2, ensure_ascii=False) + ";\n"
    with open(PRODUCTS_JS, "w", encoding="utf-8") as fh:
        fh.write(body)


init_db()
seed_catalog()
seed_admin()
seed_banners()


# ----------------------------------------------------------------------------
# Auth helpers
# ----------------------------------------------------------------------------
def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    with db() as conn:
        return conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()


def touch_last_seen(uid):
    with db() as conn:
        conn.execute("UPDATE users SET last_seen = ? WHERE id = ?",
                     (datetime.now(timezone.utc).isoformat(), uid))


def is_admin_role(user):
    return user is not None and (user["role"] in ADMIN_ROLES or user["is_admin"])


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if user is None:
            return jsonify(error="Not authenticated."), 401
        if not is_admin_role(user):
            return jsonify(error="Admin access required."), 403
        return fn(*args, **kwargs)
    return wrapper


def super_admin_required(fn):
    """Only full admins (not co-admins) manage roles / reset passwords."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if user is None:
            return jsonify(error="Not authenticated."), 401
        if user["role"] != "admin":
            return jsonify(error="Only a full admin can do this."), 403
        return fn(*args, **kwargs)
    return wrapper


# ----------------------------------------------------------------------------
# Settings (key/value) + maintenance mode
# ----------------------------------------------------------------------------
def get_setting(key, default=None):
    with db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key, value):
    with db() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(value)))


def maintenance_is_on():
    return get_setting("maintenance", "0") == "1"


# Paths that must stay reachable while the site is in maintenance so an admin
# can still sign in and switch it back off, and so the maintenance page renders.
_MAINT_ALLOW_PREFIXES = ("/admin", "/api/admin", "/css/", "/js/", "/img/", "/fonts/")
_MAINT_ALLOW_EXACT = {
    "/login.html", "/maintenance.html", "/favicon.ico",
    "/api/login", "/api/logout", "/api/me", "/api/maintenance",
}


@app.before_request
def gate_maintenance():
    """When maintenance mode is on, show the maintenance page to everyone except
    logged-in admins (who can still browse the site and the admin panel)."""
    if not maintenance_is_on():
        return
    if is_admin_role(current_user()):
        return
    path = request.path
    if path in _MAINT_ALLOW_EXACT or path.startswith(_MAINT_ALLOW_PREFIXES):
        return
    if path.startswith("/api/"):
        return jsonify(error="The site is temporarily down for maintenance.",
                       maintenance=True), 503
    resp = send_from_directory(BASE_DIR, "maintenance.html")
    resp.status_code = 503
    resp.headers["Retry-After"] = "3600"
    return resp


def _credentials():
    data = request.get_json(silent=True) or request.form
    return (data.get("email") or "").strip().lower(), (data.get("password") or "")


# ----------------------------------------------------------------------------
# Auth API
# ----------------------------------------------------------------------------
@app.post("/api/signup")
def signup():
    email, password = _credentials()
    if not EMAIL_RE.match(email):
        return jsonify(error="Please enter a valid email address."), 400
    if len(password) < MIN_PASSWORD:
        return jsonify(error=f"Password must be at least {MIN_PASSWORD} characters."), 400
    try:
        with db() as conn:
            cur = conn.execute(
                "INSERT INTO users (email,password_hash,created_at) VALUES (?,?,?)",
                (email, generate_password_hash(password), datetime.now(timezone.utc).isoformat()))
            uid = cur.lastrowid
    except sqlite3.IntegrityError:
        return jsonify(error="An account with this email already exists. Try logging in."), 409
    session.clear()
    session["user_id"] = uid
    touch_last_seen(uid)
    return jsonify(ok=True, email=email, is_admin=False, role="customer"), 201


@app.post("/api/login")
def login():
    email, password = _credentials()
    if not email or not password:
        return jsonify(error="Email and password are required."), 400
    with db() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if row is None or not check_password_hash(row["password_hash"], password):
        return jsonify(error="Invalid email or password."), 401
    session.clear()
    session["user_id"] = row["id"]
    touch_last_seen(row["id"])
    return jsonify(ok=True, email=row["email"], is_admin=is_admin_role(row), role=row["role"])


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    user = current_user()
    if user is None:
        return jsonify(error="Not authenticated."), 401
    touch_last_seen(user["id"])
    return jsonify(email=user["email"], is_admin=is_admin_role(user), role=user["role"])


@app.post("/api/account/password")
def change_own_password():
    user = current_user()
    if user is None:
        return jsonify(error="Not authenticated."), 401
    d = request.get_json(silent=True) or {}
    current = d.get("current_password") or ""
    new = d.get("new_password") or ""
    if not check_password_hash(user["password_hash"], current):
        return jsonify(error="Your current password is incorrect."), 400
    if len(new) < MIN_PASSWORD:
        return jsonify(error=f"New password must be at least {MIN_PASSWORD} characters."), 400
    with db() as conn:
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                     (generate_password_hash(new), user["id"]))
    return jsonify(ok=True)


# ----------------------------------------------------------------------------
# Public: catalog + enquiries
# ----------------------------------------------------------------------------
@app.get("/api/catalog")
def api_catalog():
    return jsonify(catalog_from_db())


@app.get("/api/banners")
def api_banners():
    with db() as conn:
        rows = conn.execute("SELECT * FROM banners WHERE active = 1 ORDER BY sort, id").fetchall()
    return jsonify(hero=[banner_row(r) for r in rows if r["zone"] == "hero"],
                   promo=[banner_row(r) for r in rows if r["zone"] == "promo"])


@app.get("/api/maintenance")
def api_maintenance():
    return jsonify(active=maintenance_is_on(), is_admin=is_admin_role(current_user()))


@app.get("/api/admin/settings")
@admin_required
def admin_get_settings():
    return jsonify(maintenance=maintenance_is_on())


@app.post("/api/admin/settings/maintenance")
@admin_required
def admin_set_maintenance():
    d = request.get_json(silent=True) or {}
    set_setting("maintenance", "1" if d.get("active") else "0")
    return jsonify(ok=True, active=maintenance_is_on())


@app.post("/api/verify")
def verify_code():
    d = request.get_json(silent=True) or request.form
    code = normalize_code(d.get("code"))
    if not code:
        return jsonify(status="invalid", message="Please enter the product code printed on the pack."), 400
    with db() as conn:
        row = conn.execute("SELECT code, used, used_at FROM auth_codes WHERE code = ?", (code,)).fetchone()
        if row is None:
            return jsonify(status="unauthorized",
                           message="Unauthorized product. This code is not in our records — it may be counterfeit.")
        if row["used"]:
            return jsonify(status="used", used_at=row["used_at"],
                           message="This code has already been used. A genuine code works only once — if you did not verify this pack before, treat it as suspicious.")
        conn.execute("UPDATE auth_codes SET used = 1, used_at = ? WHERE code = ?",
                     (datetime.now(timezone.utc).isoformat(), code))
    return jsonify(status="verified", code=code,
                   message="Product verified. This is a genuine IronCore Pharma product.")


@app.post("/api/enquiries")
def create_enquiry():
    d = request.get_json(silent=True) or request.form
    name = (d.get("name") or "").strip()
    email = (d.get("email") or "").strip()
    if not name and not email:
        return jsonify(error="Please provide at least a name or email."), 400
    with db() as conn:
        conn.execute(
            """INSERT INTO enquiries (name,email,contact,location,service,message,source,created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (name, email, (d.get("contact") or "").strip(), (d.get("location") or "").strip(),
             (d.get("service") or "").strip(), (d.get("message") or "").strip(),
             (d.get("source") or "").strip(), datetime.now(timezone.utc).isoformat()))
    return jsonify(ok=True), 201


@app.post("/api/reviews")
def create_review():
    d = request.get_json(silent=True) or {}
    slug = (d.get("slug") or "").strip().lower()
    name = (d.get("name") or "").strip()
    comment = (d.get("comment") or "").strip()
    try:
        rating = int(d.get("rating") or 0)
    except (TypeError, ValueError):
        rating = 0
    if not SLUG_RE.match(slug):
        return jsonify(error="Invalid product."), 400
    with db() as conn:
        if conn.execute("SELECT 1 FROM products WHERE slug = ?", (slug,)).fetchone() is None:
            return jsonify(error="Product not found."), 404
    if rating < 1 or rating > 5:
        return jsonify(error="Please select a star rating between 1 and 5."), 400
    if not comment:
        return jsonify(error="Please write a short review."), 400
    if not name:
        name = "Anonymous"
    uid = session.get("user_id")
    with db() as conn:
        conn.execute(
            """INSERT INTO reviews (product_slug,user_id,name,rating,comment,status,created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (slug, uid, name[:80], rating, comment[:2000], "pending",
             datetime.now(timezone.utc).isoformat()))
    return jsonify(ok=True, message="Thanks! Your review has been submitted for approval."), 201


@app.get("/api/reviews/<slug>")
def product_reviews(slug):
    slug = (slug or "").strip().lower()
    with db() as conn:
        rows = conn.execute(
            "SELECT name,rating,comment,created_at FROM reviews WHERE product_slug = ? AND status = 'approved' ORDER BY id DESC",
            (slug,)).fetchall()
    reviews = [dict(name=r["name"], rating=r["rating"], comment=r["comment"], created_at=r["created_at"]) for r in rows]
    count = len(reviews)
    average = round(sum(r["rating"] for r in reviews) / count, 1) if count else 0
    return jsonify(average=average, count=count, reviews=reviews)


def _make_order_no():
    return "IC" + datetime.now().strftime("%y%m%d") + "-" + secrets.token_hex(3).upper()


@app.post("/api/orders")
def create_order():
    d = request.get_json(silent=True) or {}
    items = d.get("items") or []
    if not isinstance(items, list) or not items:
        return jsonify(error="Your cart is empty."), 400

    name = (d.get("name") or "").strip()
    phone = (d.get("phone") or "").strip()
    address = (d.get("address") or "").strip()
    if not name:
        return jsonify(error="Please enter the name for delivery."), 400
    if not phone:
        return jsonify(error="A contact phone number is required."), 400
    if not address:
        return jsonify(error="A delivery address is required."), 400

    method = (d.get("payment_method") or "cod").strip().lower()
    if method not in PAYMENT_METHODS:
        return jsonify(error="Please choose a valid payment method."), 400

    # Recompute totals server-side from the catalog so the stored order is trustworthy.
    with db() as conn:
        rows = {r["slug"]: r for r in conn.execute("SELECT slug,name,pack_size,price FROM products")}

    clean_items, subtotal = [], 0.0
    for raw in items:
        slug = (raw.get("slug") or "").strip()
        qty = raw.get("quantity") or 1
        try:
            qty = max(1, min(999, int(qty)))
        except (TypeError, ValueError):
            qty = 1
        prod = rows.get(slug)
        name_i = prod["name"] if prod else (raw.get("name") or slug)
        pack_i = prod["pack_size"] if prod else (raw.get("packSize") or "")
        price_str = prod["price"] if prod else (raw.get("price") or "")
        unit = price_to_number(price_str)
        subtotal += unit * qty
        clean_items.append({"slug": slug, "name": name_i, "packSize": pack_i,
                            "price": price_str, "unit": unit, "quantity": qty})

    shipping = 0.0 if (subtotal <= 0 or subtotal >= FREE_SHIPPING_OVER) else SHIPPING_FLAT
    total = round(subtotal + shipping, 2)

    order_no = _make_order_no()
    uid = session.get("user_id")
    with db() as conn:
        conn.execute(
            """INSERT INTO orders
               (order_no,user_id,name,email,phone,address,city,state,pincode,
                payment_method,items_json,item_count,subtotal,shipping,total,status,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (order_no, uid, name, (d.get("email") or "").strip(), phone,
             address, (d.get("city") or "").strip(), (d.get("state") or "").strip(),
             (d.get("pincode") or "").strip(), method, json.dumps(clean_items),
             sum(i["quantity"] for i in clean_items), round(subtotal, 2), shipping, total,
             "pending" if method != "cod" else "confirmed",
             datetime.now(timezone.utc).isoformat()))
    return jsonify(ok=True, order_no=order_no, subtotal=round(subtotal, 2),
                   shipping=shipping, total=total, payment_method=method), 201


# ----------------------------------------------------------------------------
# Admin API
# ----------------------------------------------------------------------------
@app.get("/api/admin/users")
@admin_required
def admin_users():
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=ACTIVE_WINDOW_MIN)).isoformat()
    with db() as conn:
        rows = conn.execute("SELECT id,email,role,is_admin,created_at,last_seen FROM users ORDER BY id DESC").fetchall()
    return jsonify([dict(id=r["id"], email=r["email"], role=r["role"],
                         is_admin=bool(r["is_admin"]), created_at=r["created_at"],
                         last_seen=r["last_seen"],
                         active=bool(r["last_seen"] and r["last_seen"] >= cutoff)) for r in rows])


@app.get("/api/admin/enquiries")
@admin_required
def admin_enquiries():
    with db() as conn:
        rows = conn.execute("SELECT * FROM enquiries ORDER BY id DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@app.get("/api/admin/orders")
@admin_required
def admin_orders():
    with db() as conn:
        rows = conn.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()
    out = []
    for r in rows:
        try:
            items = json.loads(r["items_json"] or "[]")
        except (ValueError, TypeError):
            items = []
        out.append(dict(id=r["id"], order_no=r["order_no"], name=r["name"], email=r["email"],
                        phone=r["phone"], address=r["address"], city=r["city"], state=r["state"],
                        pincode=r["pincode"], payment_method=r["payment_method"], items=items,
                        item_count=r["item_count"], subtotal=r["subtotal"], shipping=r["shipping"],
                        total=r["total"], status=r["status"], created_at=r["created_at"]))
    return jsonify(out)


@app.get("/api/admin/reviews")
@admin_required
def admin_reviews():
    with db() as conn:
        rows = conn.execute("""
            SELECT r.id, r.product_slug, r.name, r.rating, r.comment, r.status, r.created_at,
                   p.name AS product_name
            FROM reviews r LEFT JOIN products p ON p.slug = r.product_slug
            ORDER BY r.id DESC""").fetchall()
    return jsonify([dict(id=r["id"], product_slug=r["product_slug"],
                         product_name=r["product_name"] or r["product_slug"],
                         name=r["name"], rating=r["rating"], comment=r["comment"],
                         status=r["status"], created_at=r["created_at"]) for r in rows])


@app.patch("/api/admin/reviews/<int:rid>")
@admin_required
def admin_update_review(rid):
    d = request.get_json(silent=True) or {}
    status = (d.get("status") or "").strip()
    if status not in ("pending", "approved"):
        return jsonify(error="Invalid status."), 400
    with db() as conn:
        cur = conn.execute("UPDATE reviews SET status = ? WHERE id = ?", (status, rid))
        if cur.rowcount == 0:
            return jsonify(error="Review not found."), 404
    return jsonify(ok=True, status=status)


@app.delete("/api/admin/reviews/<int:rid>")
@admin_required
def admin_delete_review(rid):
    with db() as conn:
        cur = conn.execute("DELETE FROM reviews WHERE id = ?", (rid,))
        if cur.rowcount == 0:
            return jsonify(error="Review not found."), 404
    return jsonify(ok=True)


@app.get("/api/admin/overview")
@admin_required
def admin_overview():
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=ACTIVE_WINDOW_MIN)).isoformat()
    with db() as conn:
        total_users = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        active = conn.execute("SELECT COUNT(*) AS c FROM users WHERE last_seen >= ?", (cutoff,)).fetchone()["c"]
        total_products = conn.execute("SELECT COUNT(*) AS c FROM products").fetchone()["c"]
        total_enquiries = conn.execute("SELECT COUNT(*) AS c FROM enquiries").fetchone()["c"]
        total_orders = conn.execute("SELECT COUNT(*) AS c FROM orders").fetchone()["c"]
        revenue = conn.execute("SELECT COALESCE(SUM(total),0) AS s FROM orders").fetchone()["s"]
        total_reviews = conn.execute("SELECT COUNT(*) AS c FROM reviews").fetchone()["c"]
        pending_reviews = conn.execute("SELECT COUNT(*) AS c FROM reviews WHERE status = 'pending'").fetchone()["c"]
        total_codes = conn.execute("SELECT COUNT(*) AS c FROM auth_codes").fetchone()["c"]
        used_codes = conn.execute("SELECT COUNT(*) AS c FROM auth_codes WHERE used = 1").fetchone()["c"]
        roles = {r["role"]: r["c"] for r in conn.execute("SELECT role, COUNT(*) AS c FROM users GROUP BY role")}
    return jsonify(total_users=total_users, active_users=active, total_products=total_products,
                   total_enquiries=total_enquiries, total_orders=total_orders, revenue=revenue,
                   total_reviews=total_reviews, pending_reviews=pending_reviews,
                   total_codes=total_codes, used_codes=used_codes,
                   active_window_min=ACTIVE_WINDOW_MIN, roles=roles)


@app.patch("/api/admin/users/<int:uid>/role")
@super_admin_required
def admin_set_role(uid):
    d = request.get_json(silent=True) or {}
    role = (d.get("role") or "").strip()
    if role not in ROLES:
        return jsonify(error="Invalid role."), 400
    with db() as conn:
        target = conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
        if target is None:
            return jsonify(error="User not found."), 404
        if target["role"] == "admin" and role != "admin":
            admins = conn.execute("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").fetchone()["c"]
            if admins <= 1:
                return jsonify(error="You can't remove the last full admin."), 400
        conn.execute("UPDATE users SET role = ?, is_admin = ? WHERE id = ?",
                     (role, 1 if role in ADMIN_ROLES else 0, uid))
    return jsonify(ok=True, role=role)


@app.post("/api/admin/users/<int:uid>/password")
@super_admin_required
def admin_set_password(uid):
    d = request.get_json(silent=True) or {}
    new = d.get("new_password") or ""
    if len(new) < MIN_PASSWORD:
        return jsonify(error=f"Password must be at least {MIN_PASSWORD} characters."), 400
    with db() as conn:
        if conn.execute("SELECT 1 FROM users WHERE id = ?", (uid,)).fetchone() is None:
            return jsonify(error="User not found."), 404
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                     (generate_password_hash(new), uid))
    return jsonify(ok=True)


@app.get("/api/admin/images")
@admin_required
def admin_images():
    out = []
    for folder, prefix in ((PRODUCTS_IMG_DIR, "img/products"), (IMG_DIR, "img")):
        if not os.path.isdir(folder):
            continue
        for fn in sorted(os.listdir(folder)):
            full = os.path.join(folder, fn)
            if os.path.isfile(full) and os.path.splitext(fn)[1].lower() in IMAGE_EXTS:
                out.append(f"{prefix}/{fn}")
    return jsonify(sorted(set(out)))


@app.post("/api/admin/images")
@admin_required
def admin_upload_image():
    f = request.files.get("file")
    if f is None or not f.filename:
        return jsonify(error="No file selected."), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in IMAGE_EXTS:
        return jsonify(error="Unsupported file type (use JPG, PNG, WEBP, GIF or SVG)."), 400
    name = secure_filename(f.filename)
    if not name:
        return jsonify(error="Invalid file name."), 400
    os.makedirs(PRODUCTS_IMG_DIR, exist_ok=True)
    base, e = os.path.splitext(name)
    dest = os.path.join(PRODUCTS_IMG_DIR, name)
    i = 1
    while os.path.exists(dest):
        name = f"{base}-{i}{e}"
        dest = os.path.join(PRODUCTS_IMG_DIR, name)
        i += 1
    f.save(dest)
    # Product images get an automatic clean white background (AI cutout).
    whitened = whiten_to_white_bg(dest)
    return jsonify(ok=True, path=f"img/products/{name}", whitened=whitened), 201


# ----------------------------------------------------------------------------
# Admin: banner media (images + videos) and banner CRUD
# ----------------------------------------------------------------------------
@app.get("/api/admin/media")
@admin_required
def admin_media():
    out = {}
    for folder, prefix in ((BANNERS_IMG_DIR, "img/banners"),
                           (PRODUCTS_IMG_DIR, "img/products"), (IMG_DIR, "img")):
        if not os.path.isdir(folder):
            continue
        for fn in sorted(os.listdir(folder)):
            full = os.path.join(folder, fn)
            if os.path.isfile(full) and os.path.splitext(fn)[1].lower() in MEDIA_EXTS:
                path = f"{prefix}/{fn}"
                out[path] = {"path": path, "type": media_type_of(path)}
    return jsonify(sorted(out.values(), key=lambda m: m["path"]))


@app.post("/api/admin/media")
@admin_required
def admin_upload_media():
    f = request.files.get("file")
    if f is None or not f.filename:
        return jsonify(error="No file selected."), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in MEDIA_EXTS:
        return jsonify(error="Unsupported file type. Use an image (JPG, PNG, WEBP, GIF, SVG) or video (MP4, WEBM, MOV)."), 400
    name = secure_filename(f.filename)
    if not name:
        return jsonify(error="Invalid file name."), 400
    os.makedirs(BANNERS_IMG_DIR, exist_ok=True)
    base, e = os.path.splitext(name)
    dest = os.path.join(BANNERS_IMG_DIR, name)
    i = 1
    while os.path.exists(dest):
        name = f"{base}-{i}{e}"
        dest = os.path.join(BANNERS_IMG_DIR, name)
        i += 1
    f.save(dest)
    path = f"img/banners/{name}"
    return jsonify(ok=True, path=path, type=media_type_of(path)), 201


def _banner_payload():
    d = request.get_json(silent=True) or {}
    zone = (d.get("zone") or "hero").strip()
    if zone not in ("hero", "promo"):
        zone = "hero"
    media_url = (d.get("media_url") or "").strip()
    media_type = (d.get("media_type") or "").strip().lower()
    if media_type not in ("image", "video"):
        media_type = media_type_of(media_url)
    try:
        duration = int(d.get("duration") or 5)
    except (TypeError, ValueError):
        duration = 5
    return {
        "zone": zone,
        "media_type": media_type,
        "media_url": media_url,
        "eyebrow": (d.get("eyebrow") or "").strip(),
        "title": (d.get("title") or "").strip(),
        "title_highlight": (d.get("title_highlight") or "").strip(),
        "subtitle": (d.get("subtitle") or "").strip(),
        "link_url": (d.get("link_url") or "").strip(),
        "button_enabled": 1 if d.get("button_enabled") else 0,
        "button_text": (d.get("button_text") or "").strip(),
        "button_link": (d.get("button_link") or "").strip(),
        "duration": max(1, min(60, duration)),
        "active": 0 if d.get("active") is False else 1,
    }


@app.get("/api/admin/banners")
@admin_required
def admin_banners():
    with db() as conn:
        rows = conn.execute("SELECT * FROM banners ORDER BY zone, sort, id").fetchall()
    return jsonify([banner_row(r) for r in rows])


@app.post("/api/admin/banners")
@admin_required
def admin_create_banner():
    p = _banner_payload()
    if not p["media_url"] and not p["title"]:
        return jsonify(error="Add a title or some media for the banner."), 400
    with db() as conn:
        nxt = conn.execute("SELECT COALESCE(MAX(sort),0)+1 AS s FROM banners WHERE zone = ?",
                           (p["zone"],)).fetchone()["s"]
        cur = conn.execute(
            """INSERT INTO banners
               (zone,media_type,media_url,eyebrow,title,title_highlight,subtitle,link_url,
                button_enabled,button_text,button_link,duration,sort,active,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (p["zone"], p["media_type"], p["media_url"], p["eyebrow"], p["title"],
             p["title_highlight"], p["subtitle"], p["link_url"], p["button_enabled"],
             p["button_text"], p["button_link"], p["duration"], nxt, p["active"],
             datetime.now(timezone.utc).isoformat()))
    return jsonify(ok=True, id=cur.lastrowid), 201


@app.put("/api/admin/banners/<int:bid>")
@admin_required
def admin_update_banner(bid):
    p = _banner_payload()
    with db() as conn:
        if conn.execute("SELECT 1 FROM banners WHERE id = ?", (bid,)).fetchone() is None:
            return jsonify(error="Banner not found."), 404
        conn.execute(
            """UPDATE banners SET zone=?,media_type=?,media_url=?,eyebrow=?,title=?,title_highlight=?,
               subtitle=?,link_url=?,button_enabled=?,button_text=?,button_link=?,duration=?,active=?
               WHERE id=?""",
            (p["zone"], p["media_type"], p["media_url"], p["eyebrow"], p["title"],
             p["title_highlight"], p["subtitle"], p["link_url"], p["button_enabled"],
             p["button_text"], p["button_link"], p["duration"], p["active"], bid))
    return jsonify(ok=True)


@app.patch("/api/admin/banners/<int:bid>/move")
@admin_required
def admin_move_banner(bid):
    """Swap sort order with the adjacent banner in the same zone."""
    d = request.get_json(silent=True) or {}
    direction = (d.get("direction") or "").strip()
    if direction not in ("up", "down"):
        return jsonify(error="Invalid direction."), 400
    with db() as conn:
        row = conn.execute("SELECT * FROM banners WHERE id = ?", (bid,)).fetchone()
        if row is None:
            return jsonify(error="Banner not found."), 404
        cmp_op, order = ("<", "DESC") if direction == "up" else (">", "ASC")
        neighbor = conn.execute(
            f"SELECT * FROM banners WHERE zone = ? AND sort {cmp_op} ? ORDER BY sort {order} LIMIT 1",
            (row["zone"], row["sort"])).fetchone()
        if neighbor is None:
            return jsonify(ok=True)  # already at the edge
        conn.execute("UPDATE banners SET sort = ? WHERE id = ?", (neighbor["sort"], row["id"]))
        conn.execute("UPDATE banners SET sort = ? WHERE id = ?", (row["sort"], neighbor["id"]))
    return jsonify(ok=True)


@app.delete("/api/admin/banners/<int:bid>")
@admin_required
def admin_delete_banner(bid):
    with db() as conn:
        cur = conn.execute("DELETE FROM banners WHERE id = ?", (bid,))
        if cur.rowcount == 0:
            return jsonify(error="Banner not found."), 404
    return jsonify(ok=True)


# ----------------------------------------------------------------------------
# Admin: product authentication codes
# ----------------------------------------------------------------------------
def _insert_codes(codes):
    if not codes:
        return 0
    now = datetime.now(timezone.utc).isoformat()
    added = 0
    with db() as conn:
        for c in codes:
            cur = conn.execute(
                "INSERT OR IGNORE INTO auth_codes (code,used,used_at,created_at) VALUES (?,0,NULL,?)",
                (c, now))
            added += cur.rowcount
    return added


@app.get("/api/admin/codes/stats")
@admin_required
def admin_codes_stats():
    with db() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM auth_codes").fetchone()["c"]
        used = conn.execute("SELECT COUNT(*) AS c FROM auth_codes WHERE used = 1").fetchone()["c"]
    return jsonify(total=total, used=used, unused=total - used)


@app.post("/api/admin/codes/generate")
@admin_required
def admin_codes_generate():
    d = request.get_json(silent=True) or {}
    try:
        count = int(d.get("count") or 0)
    except (TypeError, ValueError):
        count = 0
    try:
        digits = int(d.get("digits") or 8)
    except (TypeError, ValueError):
        digits = 8
    digits = max(4, min(12, digits))
    if count < 1 or count > 200000:
        return jsonify(error="Enter a number of codes between 1 and 200000."), 400
    hi = 10 ** digits
    with db() as conn:
        existing = conn.execute("SELECT COUNT(*) AS c FROM auth_codes").fetchone()["c"]
    if count > hi - existing:
        return jsonify(error=f"Not enough unique {digits}-digit codes left. Use more digits or a smaller count."), 400

    # Top up until exactly `count` NEW codes have been added (collisions are retried).
    added, rounds = 0, 0
    while added < count and rounds < 60:
        need = count - added
        want = set()
        attempts, cap = 0, need * 30 + 200
        while len(want) < need and attempts < cap:
            want.add(str(secrets.randbelow(hi)).zfill(digits))
            attempts += 1
        added += _insert_codes(list(want))
        rounds += 1
    return jsonify(ok=True, added=added, requested=count, digits=digits)


@app.post("/api/admin/codes/add")
@admin_required
def admin_codes_add():
    d = request.get_json(silent=True) or {}
    codes = parse_codes(d.get("codes"))
    if not codes:
        return jsonify(error="No codes found. Enter codes separated by spaces, commas or new lines."), 400
    added = _insert_codes(codes)
    return jsonify(ok=True, added=added, parsed=len(codes))


@app.post("/api/admin/codes/upload")
@admin_required
def admin_codes_upload():
    f = request.files.get("file")
    if f is None or not f.filename:
        return jsonify(error="No file selected."), 400
    try:
        text = f.read().decode("utf-8", errors="ignore")
    except Exception:
        return jsonify(error="Could not read that file."), 400
    codes = parse_codes(text)
    if not codes:
        return jsonify(error="No codes found in the file."), 400
    added = _insert_codes(codes)
    return jsonify(ok=True, added=added, parsed=len(codes))


@app.get("/api/admin/codes/check")
@admin_required
def admin_codes_check():
    code = normalize_code(request.args.get("code"))
    if not code:
        return jsonify(error="Enter a code to check."), 400
    with db() as conn:
        row = conn.execute("SELECT code,used,used_at,created_at FROM auth_codes WHERE code = ?", (code,)).fetchone()
    if row is None:
        return jsonify(found=False, code=code)
    return jsonify(found=True, code=code, used=bool(row["used"]),
                   used_at=row["used_at"], created_at=row["created_at"])


@app.get("/api/admin/codes/recent")
@admin_required
def admin_codes_recent():
    with db() as conn:
        rows = conn.execute(
            "SELECT code, used_at FROM auth_codes WHERE used = 1 ORDER BY used_at DESC LIMIT 50").fetchall()
    return jsonify([dict(code=r["code"], used_at=r["used_at"]) for r in rows])


@app.get("/api/admin/codes/export")
@admin_required
def admin_codes_export():
    with db() as conn:
        rows = conn.execute("SELECT code, used, used_at FROM auth_codes ORDER BY code").fetchall()
    lines = ["code,status,used_at"]
    for r in rows:
        lines.append(f"{r['code']},{'used' if r['used'] else 'unused'},{r['used_at'] or ''}")
    return Response("\n".join(lines), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=ironcore-auth-codes.csv"})


@app.get("/api/admin/codes/export.pdf")
@admin_required
def admin_codes_export_pdf():
    try:
        from fpdf import FPDF
    except ImportError:
        return jsonify(error="PDF export needs the fpdf2 package. Run: pip install fpdf2"), 500

    with db() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM auth_codes").fetchone()["c"]
        used = conn.execute("SELECT COUNT(*) AS c FROM auth_codes WHERE used = 1").fetchone()["c"]
        rows = conn.execute("SELECT code, used FROM auth_codes ORDER BY code").fetchall()

    gen_date = datetime.now().strftime("%d %b %Y, %H:%M")
    cols, col_w, row_h = 6, 31.5, 6.0
    left, top_body, bottom_limit = 10.0, 34.0, 282.0

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(False)

    def new_sheet():
        pdf.add_page()
        pdf.set_xy(10, 12)
        pdf.set_font("Helvetica", "B", 15)
        pdf.set_text_color(20, 23, 28)
        pdf.cell(190, 8, "IronCore Pharma - Product Authentication Codes")
        pdf.set_xy(10, 21)
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(90, 90, 90)
        pdf.cell(190, 6, f"Generated {gen_date}    |    Total: {total}    Unused: {total - used}    Used: {used}")
        pdf.set_draw_color(205, 208, 212)
        pdf.line(10, 30, 200, 30)
        pdf.set_font("Courier", "", 10)

    def page_number():
        pdf.set_xy(10, 288)
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(150, 150, 150)
        pdf.cell(190, 5, f"Page {pdf.page_no()}", align="C")

    new_sheet()
    if not rows:
        pdf.set_xy(10, top_body)
        pdf.set_text_color(90, 90, 90)
        pdf.cell(190, 8, "No codes yet. Generate or add codes first.")
        page_number()
        return Response(bytes(pdf.output()), mimetype="application/pdf",
                        headers={"Content-Disposition": "attachment; filename=ironcore-auth-codes.pdf"})

    x, y, col, grey = left, top_body, 0, None
    for r in rows:
        is_used = bool(r["used"])
        if is_used != grey:
            pdf.set_text_color(165, 165, 165) if is_used else pdf.set_text_color(25, 28, 34)
            grey = is_used
        pdf.set_xy(x, y)
        pdf.cell(col_w, row_h, r["code"] + (" *" if is_used else ""))
        col += 1
        if col >= cols:
            col, x, y = 0, left, y + row_h
            if y > bottom_limit:
                page_number()
                new_sheet()
                x, y, grey = left, top_body, None
        else:
            x += col_w
    page_number()
    return Response(bytes(pdf.output()), mimetype="application/pdf",
                    headers={"Content-Disposition": "attachment; filename=ironcore-auth-codes.pdf"})


@app.post("/api/admin/codes/clear")
@admin_required
def admin_codes_clear():
    scope = (request.get_json(silent=True) or {}).get("scope", "all")
    with db() as conn:
        if scope == "used":
            conn.execute("DELETE FROM auth_codes WHERE used = 1")
        else:
            conn.execute("DELETE FROM auth_codes")
    return jsonify(ok=True)


@app.post("/api/admin/categories")
@admin_required
def admin_create_category():
    d = request.get_json(silent=True) or {}
    name = (d.get("name") or "").strip()
    slug = (d.get("slug") or "").strip().lower()
    if not slug:
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    if not name or not SLUG_RE.match(slug):
        return jsonify(error="A valid category name is required."), 400
    with db() as conn:
        if conn.execute("SELECT 1 FROM categories WHERE slug = ?", (slug,)).fetchone():
            return jsonify(error="A category with this slug already exists."), 409
        nxt = conn.execute("SELECT COALESCE(MAX(sort),0)+1 AS s FROM categories").fetchone()["s"]
        conn.execute("INSERT INTO categories (slug,name,count,image,sort) VALUES (?,?,?,?,?)",
                     (slug, name.upper(), 0, (d.get("image") or "").strip(), nxt))
    regenerate_products_js()
    return jsonify(ok=True, slug=slug, name=name.upper()), 201


@app.get("/api/admin/categories")
@admin_required
def admin_categories():
    return jsonify(catalog_from_db()["categories"])


@app.get("/api/admin/products")
@admin_required
def admin_products():
    return jsonify(catalog_from_db()["products"])


def _product_payload():
    d = request.get_json(silent=True) or {}
    images = d.get("images")
    if not images:
        images = [d.get("image")] if d.get("image") else []
    try:
        rating = float(d.get("rating") or 0)
    except (TypeError, ValueError):
        rating = 0.0
    return {
        "slug": (d.get("slug") or "").strip().lower(),
        "category": (d.get("category") or "").strip(),
        "name": (d.get("name") or "").strip(),
        "composition": (d.get("composition") or "").strip(),
        "pack_size": (d.get("packSize") or d.get("pack_size") or "").strip(),
        "price": (d.get("price") or "Price on request").strip(),
        "rating": rating,
        "stock": (d.get("stock") or "").strip(),
        "image": (d.get("image") or "").strip(),
        "images_json": json.dumps([i for i in images if i]),
        "description": (d.get("description") or "").strip(),
    }


@app.post("/api/admin/products")
@admin_required
def admin_create_product():
    p = _product_payload()
    if not SLUG_RE.match(p["slug"]):
        return jsonify(error="Slug must be lowercase letters, numbers and hyphens (e.g. my-product)."), 400
    if not p["name"] or not p["category"]:
        return jsonify(error="Name and category are required."), 400
    with db() as conn:
        exists = conn.execute("SELECT 1 FROM products WHERE slug = ?", (p["slug"],)).fetchone()
        if exists:
            return jsonify(error="A product with this slug already exists."), 409
        nxt = conn.execute("SELECT COALESCE(MAX(sort),0)+1 AS s FROM products").fetchone()["s"]
        conn.execute(
            f"INSERT INTO products ({','.join(PRODUCT_FIELDS)},sort) VALUES ({','.join(['?']*len(PRODUCT_FIELDS))},?)",
            tuple(p[f] for f in PRODUCT_FIELDS) + (nxt,))
    regenerate_products_js()
    return jsonify(ok=True, slug=p["slug"]), 201


@app.put("/api/admin/products/<slug>")
@admin_required
def admin_update_product(slug):
    p = _product_payload()
    with db() as conn:
        row = conn.execute("SELECT 1 FROM products WHERE slug = ?", (slug,)).fetchone()
        if row is None:
            return jsonify(error="Product not found."), 404
        if not p["name"] or not p["category"]:
            return jsonify(error="Name and category are required."), 400
        conn.execute(
            """UPDATE products SET category=?,name=?,composition=?,pack_size=?,price=?,
               rating=?,stock=?,image=?,images_json=?,description=? WHERE slug=?""",
            (p["category"], p["name"], p["composition"], p["pack_size"], p["price"],
             p["rating"], p["stock"], p["image"], p["images_json"], p["description"], slug))
    regenerate_products_js()
    return jsonify(ok=True, slug=slug)


@app.delete("/api/admin/products/<slug>")
@admin_required
def admin_delete_product(slug):
    with db() as conn:
        cur = conn.execute("DELETE FROM products WHERE slug = ?", (slug,))
        if cur.rowcount == 0:
            return jsonify(error="Product not found."), 404
    regenerate_products_js()
    return jsonify(ok=True)


# ----------------------------------------------------------------------------
# Static storefront
# ----------------------------------------------------------------------------
BLOCKED = {"app.py", "secret.key"}


@app.get("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/admin")
def admin_page():
    return send_from_directory(BASE_DIR, "admin.html")


@app.get("/<path:filename>")
def static_files(filename):
    norm = filename.replace("\\", "/")
    base = os.path.basename(norm)
    if norm.startswith("data/") or base in BLOCKED or base.endswith(".py"):
        abort(404)
    return send_from_directory(BASE_DIR, norm)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=False)
