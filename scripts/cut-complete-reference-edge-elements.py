#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / "public/assets/panels-v3/edge-elements"
REFERENCE_PATH = ASSET_ROOT / "reference/edge-elements-reference.png"
OUT_ROOT = ASSET_ROOT / "reference-complete"
SPRITE_DIR = OUT_ROOT / "sprites"
CONTACT_DIR = OUT_ROOT / "contact-sheets"
MASK_PATH = OUT_ROOT / "reference-alpha-mask.png"
MANIFEST_PATH = OUT_ROOT / "manifest.json"
VALIDATION_PATH = OUT_ROOT / "validation-report.json"

WEBP_QUALITY = 75
STATES = ["ideal", "damaged", "heavyDamage", "debris"]
MIN_COMPONENT_AREA = 120


def main() -> None:
    source = Image.open(REFERENCE_PATH).convert("RGBA")
    mask = make_reference_mask(source)
    components = find_components(mask)
    MASK_PATH.parent.mkdir(parents=True, exist_ok=True)
    mask.save(MASK_PATH, "PNG", compress_level=1)

    base_sprites = cut_base_sprites(source, mask, components)
    all_sprites: dict[str, list[dict]] = {}
    for state in STATES:
        all_sprites[state] = write_state_sprites(base_sprites, state)
        write_contact_sheet(CONTACT_DIR / f"{state}.png", all_sprites[state])

    write_manifest(base_sprites, all_sprites)
    write_validation(all_sprites)


def make_reference_mask(image: Image.Image) -> Image.Image:
    bg = estimate_background(image)
    bg_luma = luma(bg)
    mask = Image.new("L", image.size, 0)
    pixels = image.load()
    out = mask.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            lum = luma((r, g, b))
            diff = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
            cyan = b > 45 and g > 30 and diff > 10
            copper = r > 55 and g > 25 and diff > 10
            if a > 0 and ((diff > 24 and lum > bg_luma + 9) or cyan or copper):
                out[x, y] = 255
    return mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))


def estimate_background(image: Image.Image) -> tuple[int, int, int]:
    samples: list[tuple[int, int, int]] = []
    for x in range(0, image.width, 32):
        samples.append(image.getpixel((x, 0))[:3])
        samples.append(image.getpixel((x, image.height - 1))[:3])
    for y in range(0, image.height, 32):
        samples.append(image.getpixel((0, y))[:3])
        samples.append(image.getpixel((image.width - 1, y))[:3])
    samples.sort(key=luma)
    return samples[min(len(samples) - 1, len(samples) // 5)]


def luma(rgb: tuple[int, int, int]) -> float:
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722


def find_components(mask: Image.Image) -> list[dict[str, int]]:
    width, height = mask.size
    pixels = mask.load()
    visited = bytearray(width * height)
    components: list[dict[str, int]] = []
    for y in range(height):
        for x in range(width):
            index = y * width + x
            if visited[index] or pixels[x, y] == 0:
                continue
            stack = [(x, y)]
            visited[index] = 1
            left = right = x
            top = bottom = y
            area = 0
            while stack:
                cx, cy = stack.pop()
                area += 1
                left = min(left, cx)
                right = max(right, cx)
                top = min(top, cy)
                bottom = max(bottom, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    next_index = ny * width + nx
                    if visited[next_index] or pixels[nx, ny] == 0:
                        continue
                    visited[next_index] = 1
                    stack.append((nx, ny))
            if area >= MIN_COMPONENT_AREA:
                components.append({"left": left, "top": top, "right": right + 1, "bottom": bottom + 1, "area": area})
    components.sort(key=lambda item: (item["top"], item["left"]))
    return components


def cut_base_sprites(source: Image.Image, mask: Image.Image, components: list[dict[str, int]]) -> list[dict]:
    sprites = []
    for index, component in enumerate(components):
        box = padded_box(component, source.size, padding=4)
        sprite = source.crop(box).convert("RGBA")
        alpha = mask.crop(box).filter(ImageFilter.GaussianBlur(radius=0.25))
        sprite.putalpha(alpha)
        bbox = sprite.getbbox()
        if bbox is None:
            continue
        sprite = sprite.crop(bbox)
        kind = classify(sprite.width, sprite.height)
        sprites.append(
            {
                "index": index,
                "id": f"{kind}_{index:03d}",
                "kind": kind,
                "image": sprite,
                "sourceBox": {"left": box[0], "top": box[1], "right": box[2], "bottom": box[3]},
            }
        )
    return sprites


def write_state_sprites(base_sprites: list[dict], state: str) -> list[dict]:
    out_dir = SPRITE_DIR / state
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for item in base_sprites:
        image = make_state_variant(item["image"], state, item["id"])
        path = out_dir / f"{item['id']}.webp"
        image.save(path, "WEBP", quality=WEBP_QUALITY, lossless=False, method=6, exact=True)
        written.append(
            {
                "id": item["id"],
                "kind": item["kind"],
                "path": path,
                "size": {"width": image.width, "height": image.height},
                "sourceBox": item["sourceBox"],
            }
        )
    return written


def make_state_variant(image: Image.Image, state: str, sprite_id: str) -> Image.Image:
    if state == "ideal":
        return image.copy()
    rng = seeded_rng(state, sprite_id)
    result = image.copy()
    if state == "damaged":
        result = ImageEnhance.Contrast(result).enhance(1.08)
        result = add_scratches(result, rng, count=max(3, (image.width * image.height) // 12000), strength=72)
        result = add_scorch(result, rng, count=max(1, (image.width * image.height) // 42000), strength=42)
        return result
    if state == "heavyDamage":
        result = ImageEnhance.Brightness(result).enhance(0.9)
        result = ImageEnhance.Contrast(result).enhance(1.18)
        result = add_scratches(result, rng, count=max(5, (image.width * image.height) // 8500), strength=110)
        result = add_scorch(result, rng, count=max(2, (image.width * image.height) // 28000), strength=75)
        result = cut_alpha_damage(result, rng, count=max(1, (image.width * image.height) // 42000), heavy=False)
        return result
    result = deform_debris(result, rng)
    result = ImageEnhance.Brightness(result).enhance(0.78)
    result = ImageEnhance.Contrast(result).enhance(1.24)
    result = add_scratches(result, rng, count=max(6, (image.width * image.height) // 7200), strength=130)
    result = add_scorch(result, rng, count=max(3, (image.width * image.height) // 22000), strength=95)
    result = cut_alpha_damage(result, rng, count=max(2, (image.width * image.height) // 30000), heavy=True)
    return result


def add_scratches(image: Image.Image, rng: random.Random, count: int, strength: int) -> Image.Image:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for _ in range(count):
        x = rng.randrange(max(1, image.width))
        y = rng.randrange(max(1, image.height))
        length = rng.randrange(12, max(13, min(120, max(image.width, image.height) // 3 + 12)))
        angle = rng.uniform(-0.5, 0.5)
        x2 = round(x + math.cos(angle) * length)
        y2 = round(y + math.sin(angle) * length)
        color = (8, 11, 13, rng.randrange(strength // 2, strength))
        draw.line((x, y, x2, y2), fill=color, width=rng.choice([1, 1, 2]))
        if rng.random() < 0.3:
            draw.line((x, y + 1, x2, y2 + 1), fill=(170, 190, 190, rng.randrange(24, 58)), width=1)
    overlay.putalpha(Image.composite(overlay.getchannel("A"), Image.new("L", image.size, 0), image.getchannel("A")))
    image.alpha_composite(overlay)
    return image


def add_scorch(image: Image.Image, rng: random.Random, count: int, strength: int) -> Image.Image:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for _ in range(count):
        radius = rng.randrange(10, max(11, min(image.width, image.height, 72)))
        cx = rng.randrange(max(1, image.width))
        cy = rng.randrange(max(1, image.height))
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(2, 4, 5, rng.randrange(strength // 2, strength)))
        if rng.random() < 0.4:
            draw.line((cx - radius, cy, cx + radius, cy), fill=(210, 95, 32, rng.randrange(32, 86)), width=1)
    overlay = overlay.filter(ImageFilter.GaussianBlur(radius=1.2))
    overlay.putalpha(Image.composite(overlay.getchannel("A"), Image.new("L", image.size, 0), image.getchannel("A")))
    image.alpha_composite(overlay)
    return image


def cut_alpha_damage(image: Image.Image, rng: random.Random, count: int, heavy: bool) -> Image.Image:
    alpha = image.getchannel("A")
    draw = ImageDraw.Draw(alpha)
    for _ in range(count):
        cx = rng.randrange(max(1, image.width))
        cy = rng.randrange(max(1, image.height))
        radius = rng.randrange(8, max(9, min(image.width, image.height, 54 if heavy else 36)))
        points = []
        sides = rng.randrange(5, 9)
        for index in range(sides):
            angle = index / sides * math.tau + rng.uniform(-0.24, 0.24)
            local_radius = radius * rng.uniform(0.45, 1.15)
            points.append((round(cx + math.cos(angle) * local_radius), round(cy + math.sin(angle) * local_radius)))
        draw.polygon(points, fill=0)
    image.putalpha(alpha)
    return image


def deform_debris(image: Image.Image, rng: random.Random) -> Image.Image:
    if image.width < 80 and image.height < 80:
        return image
    canvas = Image.new("RGBA", image.size, (0, 0, 0, 0))
    if image.width >= image.height:
        bands = max(3, min(10, image.width // 90))
        band_w = max(1, image.width // bands)
        for index in range(bands):
            left = index * band_w
            right = image.width if index == bands - 1 else min(image.width, (index + 1) * band_w)
            part = image.crop((left, 0, right, image.height))
            dx = rng.randrange(-5, 6)
            dy = rng.randrange(-8, 9)
            canvas.alpha_composite(part, (left + dx, dy))
    else:
        bands = max(3, min(10, image.height // 90))
        band_h = max(1, image.height // bands)
        for index in range(bands):
            top = index * band_h
            bottom = image.height if index == bands - 1 else min(image.height, (index + 1) * band_h)
            part = image.crop((0, top, image.width, bottom))
            dx = rng.randrange(-8, 9)
            dy = rng.randrange(-5, 6)
            canvas.alpha_composite(part, (dx, top + dy))
    return canvas


def padded_box(component: dict[str, int], size: tuple[int, int], padding: int) -> tuple[int, int, int, int]:
    width, height = size
    return (
        max(0, component["left"] - padding),
        max(0, component["top"] - padding),
        min(width, component["right"] + padding),
        min(height, component["bottom"] + padding),
    )


def classify(width: int, height: int) -> str:
    if width >= max(260, height * 2.4):
        return "horizontal"
    if height >= max(150, width * 1.8):
        return "vertical"
    if width <= 150 and height <= 150:
        return "small"
    if width <= 240 and height <= 240:
        return "corner"
    return "module"


def write_contact_sheet(path: Path, sprites: list[dict]) -> None:
    columns = 10
    thumb_w = 170
    thumb_h = 110
    padding = 12
    label_h = 16
    rows = max(1, math.ceil(len(sprites) / columns))
    sheet = Image.new(
        "RGBA",
        (padding + columns * (thumb_w + padding), padding + rows * (thumb_h + label_h + padding)),
        (6, 9, 13, 255),
    )
    draw = ImageDraw.Draw(sheet)
    for index, item in enumerate(sprites):
        col = index % columns
        row = index // columns
        x = padding + col * (thumb_w + padding)
        y = padding + row * (thumb_h + label_h + padding)
        image = Image.open(item["path"]).convert("RGBA")
        thumb = fit_thumbnail(image, thumb_w, thumb_h)
        draw.rectangle((x - 3, y - 3, x + thumb_w + 3, y + thumb_h + 3), outline=(38, 50, 59, 255))
        sheet.alpha_composite(thumb, (x, y))
        label = f"{item['id']} {item['size']['width']}x{item['size']['height']}"
        draw.text((x, y + thumb_h + 3), label, fill=(155, 180, 190, 255))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "PNG", compress_level=1)


def fit_thumbnail(image: Image.Image, width: int, height: int) -> Image.Image:
    thumb = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    scale = min(width / image.width, height / image.height)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    thumb.alpha_composite(resized, ((width - resized.width) // 2, (height - resized.height) // 2))
    return thumb


def write_manifest(base_sprites: list[dict], all_sprites: dict[str, list[dict]]) -> None:
    manifest = {
        "format": "webp",
        "quality": WEBP_QUALITY,
        "states": STATES,
        "reference": web_path(REFERENCE_PATH),
        "alphaMask": web_path(MASK_PATH),
        "mode": "complete direct reference cut plus deterministic state variants; no sprite scaling",
        "sourceComponentCount": len(base_sprites),
        "totalSpriteCount": sum(len(items) for items in all_sprites.values()),
        "statesManifest": {},
    }
    for state, sprites in all_sprites.items():
        manifest["statesManifest"][state] = {
            "spriteCount": len(sprites),
            "kindCounts": count_kinds(sprites),
            "contactSheet": web_path(CONTACT_DIR / f"{state}.png"),
            "sprites": [
                {
                    "id": item["id"],
                    "kind": item["kind"],
                    "path": web_path(item["path"]),
                    "size": item["size"],
                    "sourceBox": item["sourceBox"],
                }
                for item in sprites
            ],
        }
    write_json(MANIFEST_PATH, manifest)


def write_validation(all_sprites: dict[str, list[dict]]) -> None:
    state_count = len(next(iter(all_sprites.values()))) if all_sprites else 0
    states_ok = all(len(items) == state_count for items in all_sprites.values())
    alpha_errors = []
    for state, sprites in all_sprites.items():
        for item in sprites:
            image = Image.open(item["path"]).convert("RGBA")
            if image.getchannel("A").getextrema()[0] != 0:
                alpha_errors.append(web_path(item["path"]))
    report = {
        "ok": states_ok and not alpha_errors,
        "componentCountPerState": state_count,
        "totalSpriteCount": sum(len(items) for items in all_sprites.values()),
        "statesOk": states_ok,
        "alphaErrors": alpha_errors,
        "kindCounts": {state: count_kinds(sprites) for state, sprites in all_sprites.items()},
    }
    write_json(VALIDATION_PATH, report)
    if not report["ok"]:
        raise AssertionError(f"Reference complete validation failed: {report}")


def count_kinds(sprites: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in sprites:
        counts[item["kind"]] = counts.get(item["kind"], 0) + 1
    return counts


def seeded_rng(*parts: str) -> random.Random:
    digest = hashlib.sha256(":".join(parts).encode("utf-8")).hexdigest()
    return random.Random(int(digest[:16], 16))


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def web_path(path: Path) -> str:
    return "/" + str(path.relative_to(ROOT / "public"))


if __name__ == "__main__":
    main()
