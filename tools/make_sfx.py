"""Builds the game's explosion sounds from the Bluezone library.

    python tools/make_sfx.py [D:/samples/ExplosionSounds]

Each chosen sample is mixed to mono, leading silence is cut, it is shortened to a maximum length
with a fade-out and normalized to -1 dBFS. Output: public/sfx/<name>.wav (16 bit) plus sfx.json with
the position of the peak (so a whoosh can be scheduled with its peak on the beat).
Candidates were picked with tools/scan_sfx.py.
"""
import json, sys, wave
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scan_sfx import read

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "D:/samples/ExplosionSounds") / "BC0214-wav"
SRC2 = SRC.parent / "BC0200-wav"
OUT = Path(__file__).resolve().parent.parent / "public" / "sfx"

# name: (file, max seconds)
PICKS = {
    "small1": (SRC / "explosions/Bluezone-BC0214-explosion-011.wav", 1.1),
    "small2": (SRC / "explosions/Bluezone-BC0214-explosion-016.wav", 1.1),
    "small3": (SRC / "explosions/Bluezone-BC0214-explosion-031.wav", 1.1),
    "medium1": (SRC / "explosions/Bluezone-BC0214-explosion-003.wav", 2.0),
    "medium2": (SRC / "explosions/Bluezone-BC0214-explosion-010.wav", 2.0),
    "medium3": (SRC / "explosions/Bluezone-BC0214-explosion-029.wav", 2.0),
    "big1": (SRC2 / "howitzer-falling-rubble-explosion-impacts/Bluezone-BC0200-howitzer-explosion-single-002.wav", 3.0),
    "big2": (SRC2 / "artillery-falling-rubble-explosion-impacts/Bluezone-BC0200-artillery-falling-rubble-explosion-impact-001.wav", 3.0),
    "huge": (SRC2 / "artillery-falling-rubble-explosion-impacts/Bluezone-BC0200-artillery-falling-rubble-explosion-impact-006.wav", 6.0),
    "whoosh": (SRC / "explosions-whooshes/Bluezone-BC0214-explosion-whooshe-004.wav", 5.3),
    "debris": (SRC / "whooshes-debris/Bluezone-BC0214-whooshes-debris-005.wav", 1.2),
}


# Eigene Sounds aus sounds/ – werden unverändert übernommen. name: (Datei, Länge in s)
EXTRA_DIR = Path(__file__).resolve().parent.parent / "sounds"
EXTRA = {
    "pickup_shield": ("shiedl_pickup.mp3", 0.91),
    "pickup_energy": ("energy_pickup.mp3", 0.86),
    "pickup_missile": ("missile_pickup.mp3", 0.99),
    "warning_energy": ("warning_energy.mp3", 2.22),
}


def process(path, max_len):
    x, sr = read(path)
    env = np.abs(x)
    start = int(np.argmax(env > env.max() * 0.01))           # erste Stelle über -40 dB
    start = max(0, start - int(0.002 * sr))
    x = x[start:start + int(max_len * sr)]
    fade = min(len(x), int(0.35 * max_len * sr))
    x[-fade:] *= np.linspace(1, 0, fade) ** 2
    x *= 10 ** (-1 / 20) / (np.abs(x).max() + 1e-12)
    peak = float(np.argmax(np.abs(x))) / sr
    return x, sr, peak


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {}
    for name, (path, max_len) in PICKS.items():
        x, sr, peak = process(path, max_len)
        with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
            w.writeframes((x * 32767).astype("<i2").tobytes())
        meta[name] = {"file": f"{name}.wav", "peak": round(peak, 3), "len": round(len(x) / sr, 3)}
        print(f"{name:8} {len(x) / sr:4.2f}s  peak {peak:.2f}s  {sr} Hz  <- {path.name}")
    for name, (file, length) in EXTRA.items():
        src = EXTRA_DIR / file
        if not src.exists():
            print("missing", file); continue
        (OUT / f"{name}.mp3").write_bytes(src.read_bytes())
        meta[name] = {"file": f"{name}.mp3", "peak": 0, "len": length}
        print(f"{name:15} {length:4.2f}s  <- sounds/{file}")
    (OUT / "sfx.json").write_text(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
