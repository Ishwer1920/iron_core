"""Image helpers for IronCore.

AI background removal (rembg) -> clean, centered product shot on solid white.
Used by the admin image upload endpoint (app.py) so every product image an
admin adds automatically gets a white background, and by the one-off catalog
import script.
"""
import os

from PIL import Image

# Raster formats we can process. SVG/GIF are passed through untouched.
RASTER_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

_SESSION = None


def _session():
    """Lazily create and cache the rembg session (model loads once per process)."""
    global _SESSION
    if _SESSION is None:
        from rembg import new_session
        _SESSION = new_session()  # default model, cached on disk after first download
    return _SESSION


def whiten_to_white_bg(src_path, dest_path=None, canvas=1200, pad_ratio=0.08, quality=90):
    """Cut the product out of its photo and center it on a solid-white square.

    Writes the result to ``dest_path`` (defaults to ``src_path`` -> in place).
    Best-effort: on any failure (unsupported format, model/IO error) the original
    file is left untouched and ``False`` is returned.
    """
    dest_path = dest_path or src_path
    ext = os.path.splitext(dest_path)[1].lower()
    if ext not in RASTER_EXTS:
        return False
    try:
        from rembg import remove
    except Exception:
        return False
    try:
        with Image.open(src_path) as im:
            cutout = remove(im.convert("RGBA"), session=_session())  # RGBA w/ alpha

        # Trim to the subject's bounding box using the alpha channel.
        bbox = cutout.split()[-1].getbbox()
        if bbox:
            cutout = cutout.crop(bbox)

        w, h = cutout.size
        if not w or not h:
            return False

        # Scale the subject to fit inside a padded square, then center on white.
        inner = int(canvas * (1 - 2 * pad_ratio))
        scale = min(inner / w, inner / h)
        new_w, new_h = max(1, round(w * scale)), max(1, round(h * scale))
        cutout = cutout.resize((new_w, new_h), Image.LANCZOS)

        bg = Image.new("RGBA", (canvas, canvas), (255, 255, 255, 255))
        bg.alpha_composite(cutout, ((canvas - new_w) // 2, (canvas - new_h) // 2))
        final = bg.convert("RGB")

        if ext in (".jpg", ".jpeg"):
            final.save(dest_path, "JPEG", quality=quality)
        elif ext == ".png":
            final.save(dest_path, "PNG")
        else:  # .webp
            final.save(dest_path, "WEBP", quality=quality)
        return True
    except Exception:
        return False
