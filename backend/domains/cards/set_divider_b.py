"""Style B binder divider: one full-page picture composed with Pillow.

A background (one of BACKGROUNDS, plain white by default),
highlight cards scattered over the whole page, the logo on top and a CARTES / SORTIE / CODE DU SET panel at the bottom. The page is drawn at
300 dpi and placed in a new docx as a single image behind the text, page
margins 0, so Word prints it edge to edge. Used by `set_divider.py --style B`.
"""

import colorsys
import io
import math
import random
import zipfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

DPI = 300
PAGE_IN = (8.5, 11)  # US Letter, as the classic dividers
PAGE = (round(PAGE_IN[0] * DPI), round(PAGE_IN[1] * DPI))
EMU_PER_IN = 914400

FONT = Path(__file__).with_name("fonts") / "Fredoka.ttf"

CARD_RATIO = 620 / 444  # height / width of a scan

# Printers leave the sheet's outer ~5 mm blank: nothing that matters may be
# drawn there, or it is cut off.
SAFE_MARGIN = round(0.3 * DPI)


def font(size: int, weight: int = 600) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONT), size)
    f.set_variation_by_axes([weight, 100])  # axes: wght, wdth
    return f


# ── colour ──────────────────────────────────────────────────────────────────


def tone(hue: float, sat: float, light: float) -> tuple[int, int, int]:
    # Darkened yellows go olive: gold becomes bronze instead.
    if 0.09 < hue < 0.2 and light < 0.5:
        hue = 0.085
    r, g, b = colorsys.hls_to_rgb(hue, light, min(sat, 0.9))
    return (round(r * 255), round(g * 255), round(b * 255))


def logo_colours(logo: Path) -> tuple[tuple, tuple, tuple]:
    """The logo's two dominant, saturated colours, as a bright, a mid and a
    deep tone: the background's palette, so it carries the set's branding."""
    im = Image.open(logo).convert("RGBA")
    im.thumbnail((240, 240))
    opaque = [px[:3] for px in im.getdata() if px[3] > 200]
    sheet = Image.new("RGB", (len(opaque), 1))
    sheet.putdata(opaque)
    pal = sheet.quantize(colors=10, method=Image.Quantize.MEDIANCUT)
    palette = pal.getpalette()
    scored = []
    for count, idx in pal.getcolors():
        r, g, b = (c / 255 for c in palette[idx * 3 : idx * 3 + 3])
        hue, light, sat = colorsys.rgb_to_hls(r, g, b)
        if 0.1 < light < 0.88 and sat > 0.2:
            scored.append((count * (0.25 + sat), hue, sat))
    scored.sort(reverse=True)
    if not scored:  # a grey or black-and-white logo
        scored = [(1, 0.6, 0.5)]
    first = scored[0]
    # The second: the next one whose hue is clearly different.
    second = next(
        (
            c
            for c in scored[1:]
            if min(abs(c[1] - first[1]), 1 - abs(c[1] - first[1])) > 0.06
        ),
        first,
    )
    sat = max(first[2], 0.65)
    return (
        # Highlights a touch warmer and lighter: gold over copper, like foil.
        tone((first[1] + 0.03) % 1, sat, 0.72),
        tone(first[1], sat, 0.34),
        tone(second[1], max(second[2], 0.55), 0.06),
    )


# ── background ──────────────────────────────────────────────────────────────


def gradient(size: tuple[int, int], top: tuple, bottom: tuple) -> Image.Image:
    column = Image.new("RGB", (1, 256))
    for y in range(256):
        t = y / 255
        column.putpixel(
            (0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom))
        )
    return column.resize(size, Image.Resampling.BICUBIC)


def radial(
    size: tuple[int, int], centre: tuple[float, float], radius: float
) -> Image.Image:
    """An L mask, 255 at `centre` fading to 0 at `radius` (fractions of the page width)."""
    small = (size[0] // 8, size[1] // 8)
    mask = Image.new("L", small)
    cx, cy, r = centre[0] * small[0], centre[1] * small[1], radius * small[0]
    mask.putdata(
        [
            round(255 * max(0.0, 1 - math.hypot(x - cx, y - cy) / r) ** 2)
            for y in range(small[1])
            for x in range(small[0])
        ]
    )
    return mask.resize(size, Image.Resampling.BICUBIC)


def holo_bands(size: tuple[int, int], strength: float = 1) -> Image.Image:
    """Diagonal rainbow bands, like a holo card's foil (RGBA, mostly clear)."""
    small = (size[0] // 10, size[1] // 10)
    out = Image.new("RGBA", small)
    span = small[0] + small[1]
    pixels = []
    for y in range(small[1]):
        for x in range(small[0]):
            t = (x * 0.8 + y) / span
            r, g, b = colorsys.hsv_to_rgb((t * 2.5) % 1, 0.45, 1)
            # Soft foil bands, brighter where a broad sheen passes.
            bands = (0.5 + 0.5 * math.sin(t * math.tau * 6)) ** 4
            sheen = (0.5 + 0.5 * math.sin(t * math.tau * 1.5 + 1)) ** 2
            alpha = min(
                255, strength * (30 * sheen + 120 * bands * (0.35 + 0.65 * sheen))
            )
            pixels.append(
                (round(r * 255), round(g * 255), round(b * 255), round(alpha))
            )
    out.putdata(pixels)
    return out.resize(size, Image.Resampling.BICUBIC)


def glitter(size: tuple[int, int], count: int = 700) -> Image.Image:
    """Small soft sparkles (an L mask)."""
    rng = random.Random(0)
    sparkles = Image.new("L", size)
    draw = ImageDraw.Draw(sparkles)
    for _ in range(count):
        x, y = rng.uniform(0, size[0]), rng.uniform(0, size[1])
        r = rng.uniform(2, 7)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=rng.randint(90, 230))
    return sparkles.filter(ImageFilter.GaussianBlur(2)).point(lambda v: v * 0.6)


def screen(page: Image.Image, layer: Image.Image) -> Image.Image:
    """`layer` (RGBA) screened onto `page`: it lights what's under it."""
    lit = Image.composite(
        layer, Image.new("RGBA", page.size, (0, 0, 0, 255)), layer.getchannel("A")
    )
    return ImageChops.screen(page.convert("RGB"), lit.convert("RGB"))


def glow(palette: tuple[tuple, tuple, tuple]) -> Image.Image:
    """A glow of the bright tone in the upper middle, fading through the mid
    tone to the deep one at the bottom."""
    bright, mid, deep = palette
    page = gradient(PAGE, mid, deep)
    page.paste(bright, mask=radial(PAGE, (0.5, 0.36), 0.9).point(lambda v: v * 0.75))
    return page


def vignette(page: Image.Image, amount: float = 0.6) -> Image.Image:
    mask = ImageChops.invert(radial(PAGE, (0.5, 0.5), 0.95))
    page.paste((0, 0, 0), mask=mask.point(lambda v: v * amount))
    return page


def foil_glow(page: Image.Image) -> Image.Image:
    page = screen(page, holo_bands(PAGE))
    page.paste((255, 255, 240), mask=glitter(PAGE))
    return page


# Each background, from the set's context: (bright, mid, deep) logo tones,
# its symbol, series and Pokemon types.


class Context:
    def __init__(
        self, logo: Path, symbol: Image.Image, series: str | None, types: list[str]
    ):
        self.palette = logo_colours(logo)
        self.symbol = symbol
        self.series = series
        self.types = types


def bg_glow(ctx: Context) -> Image.Image:
    return vignette(foil_glow(glow(ctx.palette)))


def bg_sunburst(ctx: Context) -> Image.Image:
    """Rays of the bright tone fanning out from behind the logo."""
    bright, mid, deep = ctx.palette
    page = glow(ctx.palette)
    small = (PAGE[0] // 8, PAGE[1] // 8)
    cx, cy = small[0] * 0.5, small[1] * 0.12
    reach = math.hypot(small[0], small[1])
    mask = Image.new("L", small)
    mask.putdata(
        [
            round(
                255
                * (0.5 + 0.5 * math.cos(math.atan2(y - cy, x - cx) * 18)) ** 3
                * max(0.0, 1 - math.hypot(x - cx, y - cy) / reach) ** 1.2
                * 0.9
            )
            for y in range(small[1])
            for x in range(small[0])
        ]
    )
    page.paste(bright, mask=mask.resize(PAGE, Image.Resampling.BICUBIC))
    page.paste((255, 255, 240), mask=glitter(PAGE, 400))
    return vignette(page)


def bg_spotlight(ctx: Context) -> Image.Image:
    """A dark room, one pool of light behind the logo, a softer one on the cards."""
    bright, mid, deep = ctx.palette
    page = Image.new("RGB", PAGE, deep)
    page.paste(mid, mask=radial(PAGE, (0.5, 0.55), 0.95).point(lambda v: v * 0.6))
    page.paste(bright, mask=radial(PAGE, (0.5, 0.13), 0.6).point(lambda v: v * 0.9))
    return vignette(page, 0.8)


def symbol_mask(symbol: Image.Image, width: int) -> Image.Image:
    """The symbol's shape at any size: the small PNG upscaled, then its edge
    re-sharpened (a threshold, softened a little) so it isn't a blur."""
    alpha = symbol.convert("RGBA").getchannel("A")
    height = round(width * alpha.height / alpha.width)
    big = alpha.resize((width, height), Image.Resampling.BICUBIC)
    return big.point(lambda v: 255 if v > 128 else 0).filter(
        ImageFilter.GaussianBlur(3)
    )


def bg_symbol(ctx: Context) -> Image.Image:
    """The set symbol, oversized and faint, cropped off the bottom right."""
    page = glow(ctx.palette)
    mark = symbol_mask(ctx.symbol, round(PAGE[0] * 1.15)).rotate(
        -14, resample=Image.Resampling.BICUBIC, expand=True
    )
    layer = Image.new("L", PAGE)
    layer.paste(mark, (round(PAGE[0] * 0.25), round(PAGE[1] * 0.3)))
    page.paste(ctx.palette[0], mask=layer.point(lambda v: v * 0.32))
    page.paste((255, 255, 240), mask=glitter(PAGE, 400))
    return vignette(page)


def pokeball(size: int, stroke: int) -> Image.Image:
    """A Poke Ball's outline (an L mask)."""
    im = Image.new("L", (size, size))
    d = ImageDraw.Draw(im)
    pad = stroke // 2
    d.ellipse((pad, pad, size - pad, size - pad), outline=255, width=stroke)
    c, button = size / 2, size * 0.17
    d.rectangle((pad, c - stroke / 2, c - button, c + stroke / 2), fill=255)
    d.rectangle((c + button, c - stroke / 2, size - pad, c + stroke / 2), fill=255)
    d.ellipse(
        (c - button, c - button, c + button, c + button), outline=255, width=stroke
    )
    inner = button * 0.5
    d.ellipse(
        (c - inner, c - inner, c + inner, c + inner),
        outline=255,
        width=max(2, stroke // 2),
    )
    return im


def bg_pokeballs(ctx: Context) -> Image.Image:
    """Poke Ball outlines of every size, faint, strewn behind the cards."""
    page = glow(ctx.palette)
    rng = random.Random("pokeballs")
    layer = Image.new("L", PAGE)
    for _ in range(14):
        size = round(rng.uniform(0.18, 0.7) * PAGE[0])
        ball = pokeball(size, max(8, size // 28)).rotate(
            rng.uniform(0, 360), resample=Image.Resampling.BICUBIC
        )
        x, y = rng.uniform(-0.2, 0.9) * PAGE[0], rng.uniform(-0.1, 0.9) * PAGE[1]
        layer.paste(
            ImageChops.lighter(
                layer.crop((round(x), round(y), round(x) + size, round(y) + size)), ball
            ),
            (round(x), round(y)),
        )
    page.paste(ctx.palette[0], mask=layer.point(lambda v: v * 0.2))
    return vignette(page)


def bg_halftone(ctx: Context) -> Image.Image:
    """A print halftone: a 45-degree grid of dots, growing towards the bottom."""
    page = glow(ctx.palette)
    layer = Image.new("L", PAGE)
    d = ImageDraw.Draw(layer)
    step = 46
    cos, sin = math.cos(math.pi / 4), math.sin(math.pi / 4)
    side = math.hypot(*PAGE)
    for i in range(-int(side / step), int(side / step)):
        for j in range(-int(side / step), int(side / step)):
            u, v = i * step, j * step
            x, y = u * cos - v * sin + PAGE[0] / 2, u * sin + v * cos + PAGE[1] / 2
            if -step < x < PAGE[0] + step and -step < y < PAGE[1] + step:
                t = max(0.0, min(1.0, y / PAGE[1]))
                r = step * 0.48 * (0.15 + 0.85 * t**1.5)
                d.ellipse((x - r, y - r, x + r, y + r), fill=255)
    page.paste(ctx.palette[0], mask=layer.point(lambda v: v * 0.14))
    return vignette(page)


def bg_playmat(ctx: Context) -> Image.Image:
    """Dark felt in the deep tone, a stitched border in the bright one."""
    bright, mid, deep = ctx.palette
    felt = tuple(round(d * 0.7 + m * 0.3) for d, m in zip(deep, mid))
    page = Image.new("RGB", PAGE, felt)
    page.paste(mid, mask=radial(PAGE, (0.5, 0.45), 0.9).point(lambda v: v * 0.35))
    fibres = Image.effect_noise((PAGE[0] // 2, PAGE[1] // 2), 60).resize(PAGE)
    fibres = fibres.filter(ImageFilter.GaussianBlur(1.2))
    page = ImageChops.overlay(
        page, Image.merge("RGB", [fibres.point(lambda v: 128 + (v - 128) * 0.35)] * 3)
    )
    page = vignette(page, 0.65)
    d = ImageDraw.Draw(page)
    inset, radius = round(0.22 * DPI), round(0.3 * DPI)
    box = (inset, inset, PAGE[0] - inset, PAGE[1] - inset)
    # The rim's darker edge, then a dashed stitch line along it.
    d.rounded_rectangle(
        box, radius, outline=tuple(round(c * 0.5) for c in felt), width=14
    )
    dash, gap = 34, 22
    x0, y0, x1, y1 = (v + 30 * k for v, k in zip(box, (1, 1, -1, -1)))
    stitch = tuple(round(c * 0.85) for c in bright)
    for a, b, fixed, horizontal in (
        (x0 + radius, x1 - radius, y0, True),
        (x0 + radius, x1 - radius, y1, True),
        (y0 + radius, y1 - radius, x0, False),
        (y0 + radius, y1 - radius, x1, False),
    ):
        pos = a
        while pos < b:
            end = min(pos + dash, b)
            d.line(
                (pos, fixed, end, fixed) if horizontal else (fixed, pos, fixed, end),
                fill=stitch,
                width=7,
            )
            pos = end + gap
    for cx, cy, start in (
        (x0 + radius, y0 + radius, 180),
        (x1 - radius, y0 + radius, 270),
        (x1 - radius, y1 - radius, 0),
        (x0 + radius, y1 - radius, 90),
    ):
        for k in range(0, 90, 12):
            d.arc(
                (cx - radius, cy - radius, cx + radius, cy + radius),
                start + k,
                start + k + 7,
                fill=stitch,
                width=7,
            )
    return page


def bg_foil(ctx: Context) -> Image.Image:
    """The whole page as brushed foil in the logo's tones, holo bands on top."""
    bright, mid, deep = ctx.palette
    grain = Image.effect_noise((PAGE[0] // 40, PAGE[1] // 2), 70)
    grain = grain.resize(PAGE, Image.Resampling.BICUBIC).filter(
        ImageFilter.GaussianBlur(2)
    )
    metal = ImageOps.colorize(grain, black=deep, mid=mid, white=bright)
    page = Image.blend(glow(ctx.palette), metal, 0.45)
    page = screen(page, holo_bands(PAGE, 1.6))
    page.paste((255, 255, 240), mask=glitter(PAGE, 500))
    return vignette(page, 0.5)


SERIES_PALETTES = {
    "Mega Evolution": ((246, 150, 232), (122, 40, 142), (22, 8, 38)),
    "Scarlet & Violet": ((255, 150, 120), (150, 36, 86), (26, 8, 40)),
    "Sword & Shield": ((140, 196, 255), (40, 72, 166), (8, 12, 42)),
    "Energies": ((176, 240, 176), (40, 122, 72), (6, 30, 16)),
    "World Championships": ((255, 222, 128), (30, 62, 142), (6, 10, 36)),
}


def bg_series(ctx: Context) -> Image.Image:
    """The glow and foil in one fixed palette per series, so a series'
    dividers match each other."""
    palette = SERIES_PALETTES.get(ctx.series or "", ctx.palette)
    return vignette(foil_glow(glow(palette)))


TYPE_COLOURS = {
    "Grass": (88, 190, 80),
    "Fire": (240, 92, 46),
    "Water": (56, 150, 232),
    "Lightning": (250, 210, 50),
    "Psychic": (186, 96, 206),
    "Fighting": (204, 110, 56),
    "Darkness": (90, 104, 140),
    "Metal": (166, 176, 188),
    "Dragon": (206, 170, 64),
    "Fairy": (240, 130, 190),
    "Colorless": (220, 220, 220),
}


def bg_energy(ctx: Context) -> Image.Image:
    """Soft orbs (bokeh) in the colours of the set's Pokemon types, as many
    of each as the type has cards."""
    page = glow(tuple(tuple(round(c * 0.6) for c in tone) for tone in ctx.palette))
    colours = [TYPE_COLOURS[t] for t in ctx.types if t in TYPE_COLOURS] or [
        ctx.palette[0]
    ]
    rng = random.Random("energy")
    for blur in (24, 8, 2):
        layer = Image.new("RGBA", PAGE, (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        for _ in range(16):
            r = rng.uniform(0.03, 0.12) * PAGE[0] * (1.6 if blur == 24 else 1)
            x, y = rng.uniform(0, PAGE[0]), rng.uniform(0, PAGE[1])
            d.ellipse(
                (x - r, y - r, x + r, y + r),
                fill=(*rng.choice(colours), rng.randint(60, 130)),
            )
        page = screen(page, layer.filter(ImageFilter.GaussianBlur(blur)))
    return vignette(page)


def bg_white(ctx: Context) -> Image.Image:
    """No background: a plain white page."""
    return Image.new("RGB", PAGE, (255, 255, 255))


BACKGROUNDS = {
    "white": bg_white,
    "glow": bg_glow,
    "sunburst": bg_sunburst,
    "spotlight": bg_spotlight,
    "symbol": bg_symbol,
    "pokeballs": bg_pokeballs,
    "halftone": bg_halftone,
    "playmat": bg_playmat,
    "foil": bg_foil,
    "series": bg_series,
    "energy": bg_energy,
}


# ── cards ───────────────────────────────────────────────────────────────────


def rounded(im: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", im.size)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, im.width - 1, im.height - 1), radius, fill=255
    )
    out = im.convert("RGBA")
    out.putalpha(ImageChops.multiply(out.getchannel("A"), mask))
    return out


def paste_with_shadow(
    page: Image.Image,
    im: Image.Image,
    centre: tuple[float, float],
    blur: int,
    offset: tuple[int, int],
    opacity: float,
) -> None:
    alpha = im.getchannel("A")
    pad = blur * 3
    shadow = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
    shadow.putalpha(Image.new("L", shadow.size))
    shadow_alpha = Image.new("L", shadow.size)
    shadow_alpha.paste(alpha.point(lambda v: v * opacity), (pad, pad))
    shadow.putalpha(shadow_alpha.filter(ImageFilter.GaussianBlur(blur)))
    x, y = round(centre[0] - im.width / 2), round(centre[1] - im.height / 2)
    page.alpha_composite(shadow, (x - pad + offset[0], y - pad + offset[1]))
    page.alpha_composite(im, (x, y))


def card_scatter(
    page: Image.Image, scans: list[Path], seed: str, shadow: float = 0.75
) -> None:
    """The cards strewn over the whole page, as if tossed on a table, evenly
    whatever their number: each card's centre is the best of 80 random
    candidates, the one farthest from the cards already placed and from the
    logo (best-candidate sampling, distances in card widths/heights), and of
    40 such layouts the one whose closest two cards are farthest apart. Each
    is tilted and sized at random, the cards in a shuffled order and drawn
    in a shuffled order, all seeded by the set code (a set always gets the
    same page). Every card stays whole inside SAFE_MARGIN, which printers
    can't reach."""
    rng = random.Random(seed)
    scans = random.Random(f"{seed}-order").sample(scans, len(scans))
    n = len(scans)
    # The printable page above the panel (its bottom 10%), shared out so a
    # card's area is a little more than its share (they overlap).
    area_w, area_h = PAGE[0] - 2 * SAFE_MARGIN, PAGE[1] * 0.9 - SAFE_MARGIN
    card_h = 0.84 * math.sqrt(area_w * area_h / (n + 1.5) * CARD_RATIO)
    card_h = min(card_h, area_h * 0.4)
    card_w = card_h / CARD_RATIO
    x_range = (SAFE_MARGIN + card_w * 0.5, PAGE[0] - SAFE_MARGIN - card_w * 0.5)
    y_range = (SAFE_MARGIN + card_h * 0.45, SAFE_MARGIN + area_h - card_h * 0.5)
    # The logo counts as cards already there: three points along it.
    logo = [(PAGE[0] * f, PAGE[1] * 0.1) for f in (0.33, 0.5, 0.67)]

    def spacing(taken: list[tuple[float, float]], x: float, y: float) -> float:
        return min(math.hypot((x - a) / card_w, (y - b) / card_h) for a, b in taken)

    def layout() -> list[tuple[float, float]]:
        placed = list(logo)
        for _ in range(n):
            candidates = [
                (rng.uniform(*x_range), rng.uniform(*y_range)) for _ in range(80)
            ]
            placed.append(max(candidates, key=lambda c: spacing(placed, *c)))
        return placed[len(logo) :]

    def closest_pair(centres: list[tuple[float, float]]) -> float:
        points = logo + centres
        return min(
            math.hypot((a[0] - b[0]) / card_w, (a[1] - b[1]) / card_h)
            for k, a in enumerate(points)
            for b in points[k + 1 :]
        )

    # The greedy pass alone can leave a corner empty: of 40 tries, keep the
    # one whose two closest cards are farthest apart.
    centres = max((layout() for _ in range(40)), key=closest_pair)

    order = list(range(n))
    rng.shuffle(order)
    for i in order:
        x, y = centres[i]
        angle = rng.uniform(-28, 28)
        h = round(card_h * rng.uniform(0.9, 1.06))
        w = round(h / CARD_RATIO)
        scan = (
            Image.open(scans[i]).convert("RGB").resize((w, h), Image.Resampling.LANCZOS)
        )
        card = rounded(scan, round(w * 0.045))
        card = card.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
        # Pulled back inside the printable area (its tilted bounding box).
        x = min(
            max(x, SAFE_MARGIN + card.width / 2), PAGE[0] - SAFE_MARGIN - card.width / 2
        )
        y = min(
            max(y, SAFE_MARGIN + card.height / 2),
            PAGE[1] - SAFE_MARGIN - card.height / 2,
        )
        paste_with_shadow(page, card, (x, y), blur=30, offset=(0, 26), opacity=shadow)


def darken(
    page: Image.Image, centre: tuple[float, float], radius: float, amount: float
) -> None:
    """A soft dark halo, so the logo and panel read over the cards."""
    mask = radial(PAGE, centre, radius).point(lambda v: v * amount)
    page.paste((0, 0, 0, 255), mask=mask)


# ── logo and panel ──────────────────────────────────────────────────────────


def place_logo(
    page: Image.Image, logo_path: Path, box: tuple[int, int, int, int]
) -> None:
    logo = Image.open(logo_path).convert("RGBA")
    max_w, max_h = box[2] - box[0], box[3] - box[1]
    scale = min(max_w / logo.width, max_h / logo.height)
    logo = logo.resize(
        (round(logo.width * scale), round(logo.height * scale)),
        Image.Resampling.LANCZOS,
    )
    centre = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
    paste_with_shadow(page, logo, centre, blur=20, offset=(0, 14), opacity=0.6)


def stats_panel(
    page: Image.Image,
    symbol: Image.Image,
    cartes: int,
    release: str,
    code: str,
    box: tuple[int, int, int, int],
    solid: bool = False,
) -> None:
    overlay = Image.new("RGBA", PAGE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    radius = (box[3] - box[1]) // 2
    draw.rounded_rectangle(
        box,
        radius,
        # Solid on a white page, where there's no dark to see through to.
        fill=(24, 24, 30, 240) if solid else (12, 12, 20, 175),
        outline=(255, 255, 255, 120),
        width=5,
    )
    page.alpha_composite(overlay)

    draw = ImageDraw.Draw(page)
    label_font, value_font = font(40, 500), font(86, 600)
    columns = [("CARTES", str(cartes)), ("SORTIE", release), ("CODE DU SET", code)]
    widths = [0.9, 1.75, 1.35]
    inner_left, inner_right = box[0] + radius * 0.6, box[2] - radius * 0.6
    unit = (inner_right - inner_left) / sum(widths)
    x = inner_left
    label_y, value_y = (
        box[1] + (box[3] - box[1]) * 0.3,
        box[1] + (box[3] - box[1]) * 0.64,
    )
    for i, ((label, value), w) in enumerate(zip(columns, widths)):
        cx = x + unit * w / 2
        spaced = " ".join(label).replace("   ", "  ")
        draw.text(
            (cx, label_y),
            spaced,
            font=label_font,
            fill=(255, 255, 255, 185),
            anchor="mm",
        )
        if label == "CODE DU SET":
            mark = symbol.convert("RGBA")
            size = 72
            mark = mark.resize(
                (size, round(size * mark.height / mark.width)), Image.Resampling.LANCZOS
            )
            text_w = draw.textlength(value, font=value_font)
            total = mark.width + 28 + text_w
            left = cx - total / 2
            page.alpha_composite(mark, (round(left), round(value_y - mark.height / 2)))
            draw.text(
                (left + mark.width + 28, value_y),
                value,
                font=value_font,
                fill="white",
                anchor="lm",
            )
        else:
            draw.text((cx, value_y), value, font=value_font, fill="white", anchor="mm")
        if i < len(columns) - 1:
            sep_x = x + unit * w
            draw.line(
                (sep_x, box[1] + 50, sep_x, box[3] - 50),
                fill=(255, 255, 255, 90),
                width=4,
            )
        x += unit * w


# ── page and docx ───────────────────────────────────────────────────────────


def render_page(
    logo: Path,
    symbol_path: Path,
    scans: list[Path],
    cartes: int,
    release: str,
    code: str,
    background: str = "white",
    series: str | None = None,
    types: list[str] | None = None,
) -> Image.Image:
    symbol = Image.open(symbol_path)
    ctx = Context(logo, symbol, series, types or [])
    page = BACKGROUNDS[background](ctx).convert("RGBA")
    margin = round(0.45 * DPI)
    panel = (
        margin,
        PAGE[1] - margin - round(1.05 * DPI),
        PAGE[0] - margin,
        PAGE[1] - margin,
    )
    white = background == "white"
    card_scatter(page, scans, code, shadow=0.35 if white else 0.75)
    if not white:
        darken(page, (0.5, 0.12), 0.55, 1)
        darken(page, (0.5, 0.93), 0.75, 0.7)
    place_logo(
        page,
        logo,
        (margin + 120, round(0.4 * DPI), PAGE[0] - margin - 120, round(2.55 * DPI)),
    )
    stats_panel(page, symbol, cartes, release, code, panel, solid=white)
    return page.convert("RGB")


CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page.jpeg"/></Relationships>"""


def document_xml(code: str) -> str:
    cx, cy = (round(v * EMU_PER_IN) for v in PAGE_IN)
    w, h = (round(v * 1440) for v in PAGE_IN)  # twips
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="1" name="{code} divider"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="page.jpeg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p><w:sectPr><w:pgSz w:w="{w}" w:h="{h}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>"""


def write_docx(page: Image.Image, code: str, out_path: Path) -> None:
    jpeg = io.BytesIO()
    page.save(jpeg, "JPEG", quality=92, dpi=(DPI, DPI), subsampling=0)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", CONTENT_TYPES)
        zf.writestr("_rels/.rels", ROOT_RELS)
        zf.writestr("word/_rels/document.xml.rels", DOC_RELS)
        zf.writestr("word/document.xml", document_xml(code))
        zf.writestr(
            "word/media/page.jpeg", jpeg.getvalue(), compress_type=zipfile.ZIP_STORED
        )


def build_divider_b(
    code: str,
    logo: Path,
    symbol: Path,
    scans: list[Path],
    cartes: int,
    release: str,
    out_path: Path,
    preview: Path | None = None,
    background: str = "white",
    series: str | None = None,
    types: list[str] | None = None,
) -> None:
    page = render_page(
        logo, symbol, scans, cartes, release, code, background, series, types
    )
    write_docx(page, code, out_path)
    if preview is not None:
        page.resize((PAGE[0] // 3, PAGE[1] // 3), Image.Resampling.LANCZOS).save(
            preview
        )
