#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / "public/assets/cabins-v1"
SOURCE_SHEET = ASSET_ROOT / "source/imagegen/cabin-damage-reference-source.png"
OUT_DIR = ASSET_ROOT / "cabins"
MANIFEST_PATH = ASSET_ROOT / "manifest.json"
CONTACT_SHEET_PATH = ASSET_ROOT / "cabin-contact-sheet.png"
VALIDATION_PATH = ASSET_ROOT / "validation-report.json"

CELL_SIZE = 256
WEBP_QUALITY = 75
STATES = ["ideal", "damaged", "heavyDamage", "deformed", "debris"]

CABINS = [
    {
        "id": "cabin_1x1",
        "name": "Cabin 1x1",
        "source": ROOT / "public/assets/modules/cabin-exterior-1x1.png",
        "gridSize": {"width": 1, "height": 1},
        "sourceRow": 0,
    },
    {
        "id": "cabin_1x2",
        "name": "Cabin 1x2",
        "source": ROOT / "public/assets/modules/cabin-exterior-1x2.png",
        "gridSize": {"width": 1, "height": 2},
        "sourceRow": 1,
    },
    {
        "id": "cabin_2x1",
        "name": "Cabin 2x1",
        "source": ROOT / "public/assets/modules/cabin-exterior-2x1.png",
        "gridSize": {"width": 2, "height": 1},
        "sourceRow": 2,
    },
]


def main() -> None:
    if not SOURCE_SHEET.exists():
        raise FileNotFoundError(f"Missing imagegen source sheet: {SOURCE_SHEET}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    overlays = extract_source_sheet()
    generated: dict[str, dict[str, Image.Image]] = {}

    for cabin in CABINS:
        width = cabin["gridSize"]["width"] * CELL_SIZE
        height = cabin["gridSize"]["height"] * CELL_SIZE
        size = (width, height)
        base = normalize_current_source(Image.open(cabin["source"]).convert("RGBA"), size)
        generated[cabin["id"]] = {}

        for col, state in enumerate(STATES):
            image = build_state_image(cabin, state, col, base, overlays[cabin["sourceRow"]], size)
            out_path = OUT_DIR / state / f"{cabin['id']}.webp"
            save_webp(image, out_path)
            generated[cabin["id"]][state] = image

    write_manifest()
    write_contact_sheet(generated)
    write_validation_report(generated)


def normalize_current_source(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    bbox = image.getbbox()
    if bbox:
        image = image.crop(bbox)
    return fit_rgba(image, size, margin=2)


def extract_source_sheet() -> list[list[Image.Image]]:
    sheet = Image.open(SOURCE_SHEET).convert("RGBA")
    cell_w = sheet.width / 5
    cell_h = sheet.height / 3
    rows: list[list[Image.Image]] = []
    for row in range(3):
        row_images: list[Image.Image] = []
        for col in range(5):
            left = int(round(col * cell_w))
            top = int(round(row * cell_h))
            right = int(round((col + 1) * cell_w))
            bottom = int(round((row + 1) * cell_h))
            row_images.append(remove_green_background(sheet.crop((left, top, right, bottom))))
        rows.append(row_images)
    return rows


def remove_green_background(image: Image.Image) -> Image.Image:
    pixels = image.load()
    alpha = Image.new("L", image.size, 0)
    alpha_pixels = alpha.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            is_key = g > 130 and g > r * 1.45 and g > b * 1.45
            alpha_pixels[x, y] = 0 if is_key else a

    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.25))
    image.putalpha(alpha)
    bbox = image.getbbox()
    return image.crop(bbox) if bbox else image


def build_state_image(
    cabin: dict,
    state: str,
    source_col: int,
    base: Image.Image,
    source_row: list[Image.Image],
    size: tuple[int, int],
) -> Image.Image:
    if state == "ideal":
        return base.copy()

    overlay = fit_rgba(source_row[source_col], size, margin=0)
    if state == "debris":
        return tune_state(add_edge_protrusions(overlay, seed_for(cabin["id"], "debris")), "debris")

    image = deform_image(base, seed_for(cabin["id"], state)) if state == "deformed" else tune_state(base.copy(), state)
    image.alpha_composite(tune_overlay(overlay, state))
    image = add_damage_marks(image, state, seed_for(cabin["id"], state))
    if state in {"heavyDamage", "deformed"}:
        image = add_edge_protrusions(image, seed_for(cabin["id"], state) + 71)
    return image


def fit_rgba(image: Image.Image, size: tuple[int, int], margin: int) -> Image.Image:
    target_w, target_h = size
    max_w = target_w - margin * 2
    max_h = target_h - margin * 2
    scale = min(max_w / image.width, max_h / image.height)
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((target_w - resized.width) // 2, (target_h - resized.height) // 2))
    return canvas


def tune_state(image: Image.Image, state: str) -> Image.Image:
    if state == "damaged":
        image = ImageEnhance.Brightness(image).enhance(0.92)
        image = ImageEnhance.Color(image).enhance(0.86)
    elif state == "heavyDamage":
        image = ImageEnhance.Brightness(image).enhance(0.74)
        image = ImageEnhance.Contrast(image).enhance(1.14)
        image = ImageEnhance.Color(image).enhance(0.72)
    elif state == "deformed":
        image = ImageEnhance.Brightness(image).enhance(0.70)
        image = ImageEnhance.Contrast(image).enhance(1.18)
        image = ImageEnhance.Color(image).enhance(0.64)
    elif state == "debris":
        image = ImageEnhance.Brightness(image).enhance(0.62)
        image = ImageEnhance.Contrast(image).enhance(1.22)
        image = ImageEnhance.Color(image).enhance(0.58)
    return image


def tune_overlay(image: Image.Image, state: str) -> Image.Image:
    image = tune_state(image, state)
    alpha_factor = {"damaged": 0.70, "heavyDamage": 0.78, "deformed": 0.86}.get(state, 1.0)
    image.putalpha(image.getchannel("A").point(lambda value: int(value * alpha_factor)))
    return image


def deform_image(image: Image.Image, seed: int) -> Image.Image:
    rng = random.Random(seed)
    width, height = image.size
    result = Image.new("RGBA", image.size, (0, 0, 0, 0))
    band = max(8, height // 22)
    amplitude = max(3, min(width, height) // 42)
    phase = rng.random() * math.pi
    for top in range(0, height, band):
        bottom = min(height, top + band)
        offset = round(math.sin((top / max(1, height)) * math.pi * 3 + phase) * amplitude)
        result.alpha_composite(image.crop((0, top, width, bottom)), (offset, top))
    return tune_state(result, "deformed")


def add_damage_marks(image: Image.Image, state: str, seed: int) -> Image.Image:
    rng = random.Random(seed)
    width, height = image.size
    level = {"damaged": 1, "heavyDamage": 2, "deformed": 3}[state]
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer, "RGBA")
    bbox = image.getbbox() or (0, 0, width, height)

    for _ in range(3 + level * 3):
        x = rng.randint(bbox[0] + width // 8, max(bbox[0] + width // 8, bbox[2] - width // 8))
        y = rng.randint(bbox[1] + height // 8, max(bbox[1] + height // 8, bbox[3] - height // 8))
        radius = rng.randint(max(4, min(width, height) // 44), max(8, min(width, height) // 20))
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(0, 0, 0, 46 + level * 22))
        draw.ellipse(
            (x - radius // 2, y - radius // 2, x + radius // 2, y + radius // 2),
            outline=(210, 118, 54, 52 + level * 22),
            width=max(1, level),
        )

    for _ in range(6 + level * 5):
        x = rng.randint(bbox[0], max(bbox[0], bbox[2] - 1))
        y = rng.randint(bbox[1], max(bbox[1], bbox[3] - 1))
        length = rng.randint(max(12, width // 12), max(18, width // 5))
        angle = rng.random() * math.pi
        x2 = x + round(math.cos(angle) * length)
        y2 = y + round(math.sin(angle) * length)
        draw.line((x, y, x2, y2), fill=(5, 9, 14, 132), width=level + 1)
        if rng.random() > 0.45:
            draw.line((x, y, x2, y2), fill=(164, 222, 240, 58), width=1)

    if level >= 2:
        for _ in range(3 + level):
            points = []
            x = rng.randint(bbox[0] + 10, max(bbox[0] + 10, bbox[2] - 10))
            y = rng.randint(bbox[1] + 10, max(bbox[1] + 10, bbox[3] - 10))
            for _ in range(4):
                points.append((x, y))
                x += rng.randint(-18, 18)
                y += rng.randint(-18, 18)
            draw.line(points, fill=(8, 10, 14, 180), width=2 + level, joint="curve")
            draw.line(points, fill=(122, 210, 238, 76), width=1)

    return alpha_composite_clipped(image, layer)


def add_edge_protrusions(image: Image.Image, seed: int) -> Image.Image:
    rng = random.Random(seed)
    bbox = image.getbbox()
    if not bbox:
        return image
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer, "RGBA")
    for _ in range(5):
        side = rng.choice(["left", "right", "top", "bottom"])
        if side in {"left", "right"}:
            x = bbox[0] + rng.randint(-2, 8) if side == "left" else bbox[2] - rng.randint(8, 18)
            y = rng.randint(bbox[1] + 12, max(bbox[1] + 12, bbox[3] - 12))
            x2 = x + rng.choice([-1, 1]) * rng.randint(12, 26)
            y2 = y + rng.randint(-10, 10)
        else:
            x = rng.randint(bbox[0] + 12, max(bbox[0] + 12, bbox[2] - 12))
            y = bbox[1] + rng.randint(-2, 8) if side == "top" else bbox[3] - rng.randint(8, 18)
            x2 = x + rng.randint(-12, 12)
            y2 = y + rng.choice([-1, 1]) * rng.randint(12, 26)
        draw.line((x, y, x2, y2), fill=(35, 42, 48, 210), width=5)
        draw.line((x, y, x2, y2), fill=(183, 104, 45, 210), width=2)
    image.alpha_composite(layer)
    return image


def alpha_composite_clipped(base: Image.Image, layer: Image.Image) -> Image.Image:
    alpha = ImageChops.multiply(layer.getchannel("A"), base.getchannel("A").filter(ImageFilter.MaxFilter(5)))
    layer.putalpha(alpha)
    out = base.copy()
    out.alpha_composite(layer)
    return out


def seed_for(cabin_id: str, state: str) -> int:
    return sum(ord(char) for char in f"{cabin_id}:{state}")


def save_webp(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=WEBP_QUALITY, method=6)


def write_manifest() -> None:
    manifest = {
        "format": "webp",
        "quality": WEBP_QUALITY,
        "cellSize": CELL_SIZE,
        "perspective": "top-down orthographic",
        "sourceMode": "current cabin top-view references plus imagegen damage reference sheet",
        "sourceReferences": {
            "currentCabins": "/assets/cabins-v1/source/reference/current-cabins-reference-sheet.png",
            "imagegenDamageSheet": "/assets/cabins-v1/source/imagegen/cabin-damage-reference-source.png",
        },
        "states": STATES,
        "exactCabinDimensions": True,
        "cabins": {},
        "contactSheet": "/assets/cabins-v1/cabin-contact-sheet.png",
        "validationReport": "/assets/cabins-v1/validation-report.json",
    }
    for cabin in CABINS:
        width = cabin["gridSize"]["width"] * CELL_SIZE
        height = cabin["gridSize"]["height"] * CELL_SIZE
        manifest["cabins"][cabin["id"]] = {
            "name": cabin["name"],
            "gridSize": cabin["gridSize"],
            "pixelSize": {"width": width, "height": height},
            "cells": [
                {"x": x, "y": y}
                for y in range(cabin["gridSize"]["height"])
                for x in range(cabin["gridSize"]["width"])
            ],
            "states": {state: f"/assets/cabins-v1/cabins/{state}/{cabin['id']}.webp" for state in STATES},
        }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def write_contact_sheet(generated: dict[str, dict[str, Image.Image]]) -> None:
    scale = 0.42
    pad = 28
    row_h = max(round(cabin["gridSize"]["height"] * CELL_SIZE * scale) for cabin in CABINS) + pad
    col_w = max(round(cabin["gridSize"]["width"] * CELL_SIZE * scale) for cabin in CABINS) + pad
    sheet = Image.new("RGBA", (len(STATES) * col_w + pad, len(CABINS) * row_h + pad), (6, 10, 18, 255))
    for row, cabin in enumerate(CABINS):
        for col, state in enumerate(STATES):
            image = generated[cabin["id"]][state]
            thumb = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
            x = pad + col * col_w + (col_w - thumb.width) // 2
            y = pad + row * row_h + (row_h - thumb.height) // 2
            sheet.alpha_composite(thumb, (x, y))
    sheet.save(CONTACT_SHEET_PATH)


def write_validation_report(generated: dict[str, dict[str, Image.Image]]) -> None:
    items = []
    for cabin in CABINS:
        width = cabin["gridSize"]["width"] * CELL_SIZE
        height = cabin["gridSize"]["height"] * CELL_SIZE
        for state in STATES:
            image = generated[cabin["id"]][state]
            alpha = image.getchannel("A")
            coverage = sum(1 for value in alpha.tobytes() if value > 12) / (image.width * image.height)
            items.append(
                {
                    "id": cabin["id"],
                    "state": state,
                    "path": f"/assets/cabins-v1/cabins/{state}/{cabin['id']}.webp",
                    "expectedSize": {"width": width, "height": height},
                    "actualSize": {"width": image.width, "height": image.height},
                    "alphaCoverage": round(coverage, 4),
                    "ok": image.size == (width, height),
                }
            )
    VALIDATION_PATH.write_text(json.dumps({"items": items, "ok": all(item["ok"] for item in items)}, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
