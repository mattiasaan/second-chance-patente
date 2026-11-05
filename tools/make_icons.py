"""Genera le icone PNG della PWA senza dipendenze esterne.

Uso:  python tools/make_icons.py
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "static" / "icons"
BG = (11, 13, 17)
FG = (52, 211, 153)


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def render(size):
    s = size
    cx = cy = s / 2
    ring_r, th = s * 0.30, s * 0.05
    a, b, c = (s * 0.37, s * 0.51), (s * 0.46, s * 0.60), (s * 0.64, s * 0.40)
    rows = []
    for y in range(s):
        row = bytearray([0])
        for x in range(s):
            px, py = x + 0.5, y + 0.5
            d = min(abs(math.hypot(px - cx, py - cy) - ring_r) - th / 2,
                    seg_dist(px, py, *a, *b) - th / 2,
                    seg_dist(px, py, *b, *c) - th / 2)
            al = max(0.0, min(1.0, 0.5 - d))
            row += bytes(int(BG[i] + (FG[i] - BG[i]) * al) for i in range(3))
        rows.append(bytes(row))
    return rows


def png(size, path):
    raw = b"".join(render(size))

    def chunk(t, d):
        body = t + d
        return struct.pack(">I", len(d)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    data = (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))
    path.write_bytes(data)
    print("scritto", path)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for sz, name in ((180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")):
        png(sz, OUT / name)
