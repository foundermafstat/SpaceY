#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / "public/assets/panels-v3/edge-elements"
SOURCE_DIR = ASSET_ROOT / "source"
SOURCE_ALPHA_DIR = ASSET_ROOT / "source-alpha"
SPRITE_DIR = ASSET_ROOT / "sprites"
CONTACT_DIR = ASSET_ROOT / "contact-sheets"
MANIFEST_PATH = ASSET_ROOT / "manifest.json"
VALIDATION_PATH = ASSET_ROOT / "validation-report.json"

WEBP_QUALITY = 75
STATES = ["ideal", "damaged", "heavyDamage", "debris"]
MIN_COMPONENT_AREA = 1200
ALPHA_THRESHOLD = 20


def main() -> None:
    manifest = {
        "format": "webp",
        "quality": WEBP_QUALITY,
        "states": STATES,
        "sourceMode": "generated large source sheets, chroma-key removed, native-size component crops",
        "reference": "/assets/panels-v3/edge-elements/reference/edge-elements-reference.png",
        "sources": {},
        "sprites": {},
        "contactSheets": {},
    }
    validation = {"ok": True, "states": {}, "errors": []}

    all_state_sprites: dict[str, list[dict]] = {}
    for state in STATES:
        image = load_state_source(state)
        components = find_components(image.getchannel("A"))
        sprites = write_state_sprites(state, image, components)
        all_state_sprites[state] = sprites
        write_state_contact_sheet(state, sprites)
        manifest["sources"][state] = {
            "raw": web_path(SOURCE_DIR / f"{state}-source.png"),
            "alpha": web_path(SOURCE_ALPHA_DIR / f"{state}-alpha.png"),
        }
        manifest["sprites"][state] = [
            {
                "id": item["id"],
                "kind": item["kind"],
                "path": web_path(item["path"]),
                "size": item["size"],
                "sourceBox": item["sourceBox"],
            }
            for item in sprites
        ]
        manifest["contactSheets"][state] = web_path(CONTACT_DIR / f"{state}.png")
        validation["states"][state] = validate_state(state, sprites)
        if not validation["states"][state]["ok"]:
            validation["ok"] = False
            validation["errors"].append(validation["states"][state])

    write_combined_contact_sheet(all_state_sprites)
    manifest["contactSheets"]["all"] = web_path(CONTACT_DIR / "all.png")
    write_json(MANIFEST_PATH, manifest)
    write_json(VALIDATION_PATH, validation)
    if not validation["ok"]:
        raise AssertionError(f"Edge element validation failed: {validation['errors']}")


def load_state_source(state: str) -> Image.Image:
    alpha_path = SOURCE_ALPHA_DIR / f"{state}-alpha.png"
    raw_path = SOURCE_DIR / f"{state}-source.png"
    if alpha_path.exists():
        return Image.open(alpha_path).convert("RGBA")
    if raw_path.exists():
        return remove_green_key(Image.open(raw_path).convert("RGBA"))
    raise FileNotFoundError(f"Missing edge element source for state: {state}")


def remove_green_key(image: Image.Image) -> Image.Image:
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            key_score = g - max(r, b)
            if g > 150 and key_score > 55:
                pixels[x, y] = (0, 0, 0, 0)
            elif g > 110 and key_score > 32:
                pixels[x, y] = (r, min(g, max(r, b) + 10), b, max(0, a // 4))
    return image


def find_components(alpha: Image.Image) -> list[dict[str, int]]:
    mask = alpha.point(lambda value: 255 if value > ALPHA_THRESHOLD else 0)
    mask = mask.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(3))
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


def write_state_sprites(state: str, image: Image.Image, components: list[dict[str, int]]) -> list[dict]:
    out_dir = SPRITE_DIR / state
    out_dir.mkdir(parents=True, exist_ok=True)
    sprites = []
    for index, component in enumerate(components):
        box = padded_box(component, image.size, padding=5)
        sprite = image.crop(box)
        bbox = sprite.getbbox()
        if bbox is None:
            continue
        sprite = sprite.crop(bbox)
        kind = classify(sprite.width, sprite.height)
        sprite_id = f"{kind}_{index:02d}"
        path = out_dir / f"{sprite_id}.webp"
        sprite.save(path, "WEBP", quality=WEBP_QUALITY, lossless=False, method=6, exact=True)
        sprites.append(
            {
                "id": sprite_id,
                "kind": kind,
                "path": path,
                "size": {"width": sprite.width, "height": sprite.height},
                "sourceBox": {"left": box[0], "top": box[1], "right": box[2], "bottom": box[3]},
            }
        )
    return sprites


def padded_box(component: dict[str, int], size: tuple[int, int], padding: int) -> tuple[int, int, int, int]:
    width, height = size
    return (
        max(0, component["left"] - padding),
        max(0, component["top"] - padding),
        min(width, component["right"] + padding),
        min(height, component["bottom"] + padding),
    )


def classify(width: int, height: int) -> str:
    if width >= max(260, height * 2.6):
        return "horizontal"
    if height >= max(170, width * 1.9):
        return "vertical"
    if width <= 180 and height <= 180:
        return "corner"
    return "module"


def validate_state(state: str, sprites: list[dict]) -> dict:
    counts: dict[str, int] = {}
    for sprite in sprites:
        counts[sprite["kind"]] = counts.get(sprite["kind"], 0) + 1
    widest_horizontal = max(
        [sprite["size"]["width"] for sprite in sprites if sprite["kind"] == "horizontal"],
        default=0,
    )
    ok = len(sprites) >= 8 and widest_horizontal >= 500
    return {
        "state": state,
        "ok": ok,
        "spriteCount": len(sprites),
        "kindCounts": counts,
        "widestHorizontal": widest_horizontal,
    }


def write_state_contact_sheet(state: str, sprites: list[dict]) -> None:
    CONTACT_DIR.mkdir(parents=True, exist_ok=True)
    write_contact_sheet(CONTACT_DIR / f"{state}.png", sprites)


def write_combined_contact_sheet(all_state_sprites: dict[str, list[dict]]) -> None:
    flat = []
    for state in STATES:
        flat.extend({**item, "id": f"{state}:{item['id']}"} for item in all_state_sprites[state])
    write_contact_sheet(CONTACT_DIR / "all.png", flat, columns=8)


def write_contact_sheet(path: Path, sprites: list[dict], columns: int = 6) -> None:
    thumb_w = 220
    thumb_h = 120
    padding = 16
    label_h = 18
    rows = max(1, (len(sprites) + columns - 1) // columns)
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
        draw.rectangle((x - 4, y - 4, x + thumb_w + 4, y + thumb_h + 4), outline=(38, 50, 59, 255))
        sheet.alpha_composite(thumb, (x, y))
        draw.text((x, y + thumb_h + 4), f"{item['id']} {item['size']['width']}x{item['size']['height']}", fill=(155, 180, 190, 255))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "PNG", compress_level=1)


def fit_thumbnail(image: Image.Image, width: int, height: int) -> Image.Image:
    thumb = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    scale = min(width / image.width, height / image.height)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    thumb.alpha_composite(resized, ((width - resized.width) // 2, (height - resized.height) // 2))
    return thumb


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def web_path(path: Path) -> str:
    return "/" + str(path.relative_to(ROOT / "public"))


if __name__ == "__main__":
    main()
