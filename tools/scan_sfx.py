"""Measures explosion samples so suitable ones can be picked without listening.

    python tools/scan_sfx.py D:/samples/ExplosionSounds > art/sfx_scan.tsv

Per file: length (to -40 dB), time to the peak, share of energy below 150 Hz, spectral
centroid and the punch = loudness of the first 150 ms relative to the whole sound.
"""
import sys, wave
from pathlib import Path
import numpy as np


def read(path):
    with wave.open(str(path)) as w:
        n, ch, sw, sr = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = w.readframes(n)
    if sw == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3)
        x = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
        x = np.where(x >= 1 << 23, x - (1 << 24), x) / float(1 << 23)
    elif sw == 2:
        x = np.frombuffer(raw, np.int16) / 32768.0
    elif sw == 4:
        x = np.frombuffer(raw, np.int32) / float(1 << 31)
    else:
        raise ValueError(sw)
    return x.reshape(-1, ch).mean(axis=1), sr


def measure(x, sr):
    env = np.abs(x)
    peak = env.max() + 1e-12
    hop = sr // 100
    frames = np.array([env[i:i + hop].max() for i in range(0, len(env), hop)])
    above = np.nonzero(frames > peak * 0.01)[0]            # -40 dB
    start, end = above[0], above[-1]
    length = (end - start) / 100
    tpeak = (np.argmax(frames) - start) / 100
    seg = x[start * hop:(end + 1) * hop]
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
    f = np.fft.rfftfreq(len(seg), 1 / sr)
    low = spec[f < 150].sum() / spec.sum()
    cent = (spec * f).sum() / spec.sum()
    rms = lambda s: np.sqrt(np.mean(s ** 2)) + 1e-12
    punch = 20 * np.log10(rms(seg[:int(0.15 * sr)]) / rms(seg))
    return length, tpeak, low, cent, punch, 20 * np.log10(peak)


def main():
    root = Path(sys.argv[1])
    print("file\tlen\ttpeak\tlow\tcentroid\tpunch\tpeakdb")
    for p in sorted(root.rglob("*.wav")):
        try:
            x, sr = read(p)
            m = measure(x, sr)
        except Exception as e:
            print(f"{p.relative_to(root)}\tERR {e}", file=sys.stderr)
            continue
        print(f"{p.relative_to(root).as_posix()}\t" + "\t".join(f"{v:.2f}" if i != 3 else f"{v:.0f}" for i, v in enumerate(m)))


if __name__ == "__main__":
    main()
