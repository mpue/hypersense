"""Contact sheet of art/raw for picking variants:  python tools/contact.py [out.png] [name prefix ...]"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
prefixes = sys.argv[2:]
files = sorted(f for f in (ROOT / "art" / "raw").glob("*.png") if not prefixes or f.stem.startswith(tuple(prefixes)))
T, COLS = 300, 6
rows = (len(files) + COLS - 1) // COLS
sheet = Image.new("RGB", (COLS * T, rows * (T + 24)), (30, 30, 30))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert("RGB")
    im.thumbnail((T, T))
    x, y = (i % COLS) * T, (i // COLS) * (T + 24)
    sheet.paste(im, (x + (T - im.width) // 2, y + (T - im.height) // 2))
    d.text((x + 6, y + T + 4), f.stem, fill=(255, 255, 255))
out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "art" / "contact.png"
sheet.save(out)
print(out)
