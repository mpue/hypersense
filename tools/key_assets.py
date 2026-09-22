"""Turns the chosen raw renders from art/raw into the game's sprites in public/assets/.

    python tools/key_assets.py

Green-screen renders are keyed (alpha from green dominance, green spill removed), cropped to the
object and scaled. Black-background renders become JPGs for additive drawing (black levels crushed so
they vanish completely), the planet gets a solid disc plus a soft atmosphere alpha.
"""
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "art" / "raw"
OUT = ROOT / "public" / "assets"

# name: (raw file, max width, max height)
SPRITES = {
    "player": ("player_23", 420, 200),
    "drone": ("drone_23", 220, 220),
    "enemy_blue": ("enemy_blue_11", 256, 256),
    "enemy_orange": ("enemy_orange_11", 256, 256),
    "enemy_fighter": ("enemy_fighter_11", 360, 200),
    "cannon": ("cannon_11", 700, 160),
    "boss": ("boss_11", 1400, 700),
    "asteroid": ("asteroid_11", 300, 300),
    "powerup": ("powerup_11", 160, 160),
    "turret": ("turret_11", 220, 220),
    "dart": ("dart_11", 220, 120),
    "mine": ("mine_11", 200, 200),
    "carrier": ("carrier_11", 900, 520),
    "worm_head": ("worm_head_11", 260, 260),
    "worm_segment": ("worm_segment_11", 200, 200),
    "splitter": ("splitter_11", 300, 300),
    "coin": ("coin_11", 96, 96),
    "hull1": ("hull_11", 1536, 512),
    "hull2": ("hull_23", 1536, 512),
    "hull3": ("hull_37", 1536, 512),
    "hull4": ("hull_41", 1536, 512),
}
ADDITIVE = {  # name: (raw file, max width)
    "galaxy": ("galaxy_11", 1024),
    "nebula": ("nebula_23", 1536),
    "explosion": ("explosion_11", 512),
}
PLANET = ("planet_gas_11", 1024)
BACKDROPS = {  # name: (raw file, max width) – deckende Vollbild-Hintergründe
    "incubator": ("incubator_11", 1536),
}
TEXTURES = {  # name: (raw file, size) – deckend, als Kachel
    "hulltex1": ("hulltex_11", 512),
    "hulltex2": ("hulltex_23", 512),
}


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def key_green(im):
    rgb = np.asarray(im.convert("RGB")).astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    dom = g - np.maximum(r, b)
    alpha = 1 - smoothstep(25, 90, dom)
    g2 = np.minimum(g, np.maximum(r, b) + 8)          # Grün-Überstrahlung an den Kanten entfernen
    out = np.dstack([r, g2, b, alpha * 255]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def crop_fit(im, mw, mh, pad=6):
    bbox = im.getchannel("A").point(lambda a: 255 if a > 12 else 0).getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        im = im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))
    im.thumbnail((mw, mh), Image.LANCZOS)
    return im


def crush_black(im, floor=14):
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    a = np.clip((a - floor) * 255 / (255 - floor), 0, 255)
    return Image.fromarray(a.astype(np.uint8), "RGB")


def planet(im):
    rgb = np.asarray(im.convert("RGB")).astype(np.float32)
    lum = rgb.mean(axis=2)
    ys, xs = np.nonzero(lum > 28)
    # Die Nachtseite (rechts) ist oft zu dunkel für die Erkennung: Radius aus der größeren Ausdehnung,
    # Mittelpunkt vom beleuchteten linken Rand aus
    rad = max(xs.max() - xs.min(), ys.max() - ys.min()) / 2
    cx, cy = xs.min() + rad, (ys.min() + ys.max()) / 2
    yy, xx = np.mgrid[0:im.height, 0:im.width]
    dist = np.hypot(xx - cx, yy - cy)
    disc = 1 - smoothstep(rad * 0.96, rad * 0.99, dist)
    glow = np.clip(lum / 70, 0, 1)
    alpha = np.maximum(disc, glow)
    return Image.fromarray(np.dstack([rgb, alpha * 255]).clip(0, 255).astype(np.uint8), "RGBA")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (src, mw, mh) in SPRITES.items():
        f = RAW / f"{src}.png"
        if not f.exists():
            print("missing", f.name); continue
        crop_fit(key_green(Image.open(f)), mw, mh).save(OUT / f"{name}.png", optimize=True)
        print("sprite", name)
    for name, (src, mw) in ADDITIVE.items():
        f = RAW / f"{src}.png"
        if not f.exists():
            print("missing", f.name); continue
        im = crush_black(Image.open(f))
        im.thumbnail((mw, mw), Image.LANCZOS)
        im.save(OUT / f"{name}.jpg", quality=88)
        print("additive", name)
    for name, (src, mw) in BACKDROPS.items():
        f = RAW / f"{src}.png"
        if not f.exists():
            print("missing", f.name); continue
        im = Image.open(f).convert("RGB")
        im.thumbnail((mw, mw), Image.LANCZOS)
        im.save(OUT / f"{name}.jpg", quality=86)
        print("backdrop", name)
    for name, (src, size) in TEXTURES.items():
        f = RAW / f"{src}.png"
        if not f.exists():
            print("missing", f.name); continue
        Image.open(f).convert("RGB").resize((size, size), Image.LANCZOS).save(OUT / f"{name}.jpg", quality=86)
        print("texture", name)
    f = RAW / f"{PLANET[0]}.png"
    if f.exists():
        im = planet(Image.open(f))
        im.thumbnail((PLANET[1], PLANET[1]), Image.LANCZOS)
        im.save(OUT / "planet.png", optimize=True)
        print("planet")


if __name__ == "__main__":
    main()
