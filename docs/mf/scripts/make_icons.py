"""Generates the PWA icons into icons/ (pure Python, no dependencies).

Usage:  python scripts/make_icons.py
"""
import struct, zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"
BG = (11, 12, 16)          # --bg
PANEL = (25, 28, 36)       # --s2
ACC = (100, 130, 255)      # --ac
UP = (61, 220, 151)        # --up
SS = 3                     # supersampling factor for smooth edges


def rrect(x, y, x0, y0, x1, y1, r):
    """Is (x, y) inside the rounded rectangle?"""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def render(size, maskable):
    """Dark tile with three rising bars (a screener/chart glyph) and an up-arrow dot."""
    n = size * SS
    # maskable icons are cropped to a circle/squircle by the OS: full-bleed bg, glyph inside the 80% safe zone
    pad = 0.0 if maskable else 0.04
    corner = 0.0 if maskable else 0.22
    g = 0.34 if maskable else 0.40       # glyph half-size as fraction of the tile
    c = n / 2
    bars = []
    bw = n * g * 0.44
    gap = n * g * 0.14
    base = c + n * g * 0.78
    heights = [0.9, 1.45, 2.05]          # in units of n*g*0.62
    x = c - (3 * bw + 2 * gap) / 2
    for i, hgt in enumerate(heights):
        h = n * g * 0.62 * hgt
        bars.append((x, base - h, x + bw, base, UP if i == 2 else ACC))
        x += bw + gap
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            r = g_ = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    X, Y = px * SS + sx + .5, py * SS + sy + .5
                    col = None
                    if rrect(X, Y, n * pad, n * pad, n - n * pad, n - n * pad, n * corner):
                        col = BG
                        if rrect(X, Y, c - n * g * 1.02, c - n * g * 1.02, c + n * g * 1.02, c + n * g * 1.02, n * 0.12):
                            col = PANEL
                        for (x0, y0, x1, y1, bc) in bars:
                            if rrect(X, Y, x0, y0, x1, y1, bw * 0.28):
                                col = bc
                    if col:
                        r += col[0]; g_ += col[1]; b += col[2]; a += 255
            k = SS * SS
            row += bytes((r // k, g_ // k, b // k, a // k)) if a else bytes((0, 0, 0, 0))
        rows.append(bytes(row))
    return rows


def png(path, size, maskable=False):
    raw = b"".join(render(size, maskable))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    data = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    path.write_bytes(data)
    print("wrote", path.name, len(data), "bytes")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    png(OUT / "icon-192.png", 192)
    png(OUT / "icon-512.png", 512)
    png(OUT / "maskable-192.png", 192, True)
    png(OUT / "maskable-512.png", 512, True)
    png(OUT / "apple-touch-icon.png", 180, True)   # iOS rounds the corners itself, so full-bleed
    png(OUT / "favicon-32.png", 32)
