#!/usr/bin/env python3
"""Development helper: composes the foliage cards used by trees and bushes (public/textures/leaves.webp and
needles.webp) from ambientCG leaf atlases (CC0): LeafSet024 (beech leaves) and LeafSet019 (thuja sprays).

Each card is a 512 px RGBA image: a twig with leaves (or a conifer branch with sprays) on transparency. The
transparent pixels are filled with the average leaf colour so mipmaps do not darken the edges.

Usage: python3 scripts/make-foliage.py <folder with LeafSet024/ and LeafSet019/ unpacked from the 1K-PNG zips>
"""
import math, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'textures')
S = 512


def pieces(name):
    colour = Image.open(os.path.join(SRC, name, name + '_1K-PNG_Color.png')).convert('RGB')
    alpha = Image.open(os.path.join(SRC, name, name + '_1K-PNG_Opacity.png')).convert('L')
    rgba = colour.copy()
    rgba.putalpha(alpha)
    lab, _ = ndimage.label(np.array(alpha) > 100)
    out = []
    for s in ndimage.find_objects(lab):
        h, w = s[0].stop - s[0].start, s[1].stop - s[1].start
        if h * w > 2000:
            out.append(rgba.crop((s[1].start, s[0].start, s[1].stop, s[0].stop)))
    return out


def shade(img, k, warm=0.0):
    a = np.array(img).astype(np.float32)
    a[..., 0] = a[..., 0] * k * (1 + warm * 0.35)
    a[..., 1] = a[..., 1] * k * (1 + warm * 0.08)
    a[..., 2] = a[..., 2] * k * (1 - warm * 0.2)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def pad_edges(card):
    """Transparent texels take the mean leaf colour, so filtering never pulls in black."""
    a = np.array(card).astype(np.float32)
    mask = a[..., 3] > 16
    mean = a[mask][:, :3].mean(axis=0)
    rgb = a[..., :3]
    blurred = np.array(Image.fromarray(rgb.astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32)
    fill = np.where(mask[..., None], rgb, blurred * 0.5 + mean * 0.5)
    a[..., :3] = fill
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')


def paste_leaf(card, leaf, x, y, angle, length, rnd):
    # Atlas leaves point up with the stalk at the bottom: scale to `length`, rotate about the stalk end.
    k = length / leaf.height
    lf = leaf.resize((max(2, int(leaf.width * k)), max(2, int(leaf.height * k))), Image.LANCZOS)
    lf = shade(lf, rnd.uniform(0.62, 1.08), rnd.uniform(-0.2, 0.5))
    big = Image.new('RGBA', (lf.width * 3, lf.height * 3), (0, 0, 0, 0))
    big.paste(lf, (lf.width, lf.height * 2 - lf.height), lf)
    # stalk end is now at the centre of the big canvas
    rot = big.rotate(-math.degrees(angle), resample=Image.BICUBIC, center=(big.width / 2, big.height * 2 / 3))
    card.alpha_composite(rot, (int(x - big.width / 2), int(y - big.height * 2 / 3)))


def broadleaf(seed=7):
    rnd = random.Random(seed)
    leaves = pieces('LeafSet024')
    card = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    twigs = []
    # Main twig from the bottom centre, curving up; side twigs alternate.
    x, y, a = S * 0.5, S * 0.98, -math.pi / 2
    main = []
    for i in range(24):
        a += rnd.uniform(-0.06, 0.06) + (-math.pi / 2 - a) * 0.25
        nx, ny = x + math.cos(a) * 17, y + math.sin(a) * 17
        main.append((x, y, nx, ny, 7 - i * 0.2))
        x, y = nx, ny
    twigs += main
    for k, (x0, y0, x1, y1, w) in enumerate(main[3:-2:2]):
        side = 1 if k % 2 else -1
        a = -math.pi / 2 + side * rnd.uniform(0.75, 1.2)
        x, y = x1, y1
        for i in range(rnd.randint(6, 10) - k // 3):
            a -= side * 0.07
            nx, ny = x + math.cos(a) * 14, y + math.sin(a) * 14
            twigs.append((x, y, nx, ny, max(1.5, w * 0.55 - i * 0.3)))
            x, y = nx, ny
    for x0, y0, x1, y1, w in twigs:
        draw.line((x0, y0, x1, y1), fill=(78, 60, 42, 255), width=max(1, int(w)))
    # Leaves along every twig segment, back ones darker.
    spots = []
    for x0, y0, x1, y1, w in twigs[4:]:
        base = math.atan2(y1 - y0, x1 - x0)
        for side in (-1, 1):
            if rnd.random() < 0.8:
                spots.append((x1, y1, base + side * rnd.uniform(0.45, 1.2), rnd.uniform(46, 74)))
    rnd.shuffle(spots)
    for i, (x, y, ang, ln) in enumerate(spots):
        paste_leaf(card, rnd.choice(leaves), x, y, ang + math.pi / 2, ln, rnd)
    return pad_edges(card)


def conifer(seed=3):
    rnd = random.Random(seed)
    sprays = pieces('LeafSet019')
    card = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(card)
    # A branch from the left edge (trunk) to the right; sprays fan out along it and droop at the tip.
    draw.line((0, S * 0.5, S * 0.92, S * 0.56), fill=(74, 55, 40, 255), width=6)
    for i in range(34):
        t = i / 33
        x = S * (0.04 + 0.86 * t)
        y = S * (0.5 + 0.06 * t)
        spray = rnd.choice(sprays)
        length = S * rnd.uniform(0.34, 0.5) * (1.05 - 0.4 * t)
        k = length / spray.width
        sp = spray.resize((int(spray.width * k), max(2, int(spray.height * k))), Image.LANCZOS)
        sp = shade(sp, rnd.uniform(0.55, 1.0), rnd.uniform(-0.3, 0.15))
        side = -1 if i % 2 else 1
        angle = side * rnd.uniform(25, 60) + rnd.uniform(-8, 8)
        big = Image.new('RGBA', (sp.width * 2, sp.width * 2), (0, 0, 0, 0))
        big.paste(sp, (sp.width, sp.width - sp.height // 2), sp)
        rot = big.rotate(angle, resample=Image.BICUBIC, center=(sp.width, sp.width))
        card.alpha_composite(rot, (int(x - sp.width), int(y - sp.width)))
    return pad_edges(card)


if __name__ == '__main__':
    broadleaf().save(os.path.join(OUT, 'leaves.webp'), quality=88, method=6)
    conifer().save(os.path.join(OUT, 'needles.webp'), quality=88, method=6)
    print('ok')
