#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageFilter

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
        "gridSize": {"width": 1, "height": 1},
        "sourceRow": 0,
    },
    {
        "id": "cabin_1x2",
        "name": "Cabin 1x2",
        "gridSize": {"width": 1, "height": 2},
        "sourceRow": 1,
    },
    {
        "id": "cabin_2x1",
        "name": "Cabin 2x1",
        "gridSize": {"width": 2, "height": 1},
        "sourceRow": 2,
    },
]


def main() -> None:
    if not SOURCE_SHEET.exists():
        raise FileNotFoundError(f"Missing imagegen source sheet: {SOURCE_SHEET}")

    source_cells = extract_source_sheet()
    generated: dict[str, dict[str, Image.Image]] = {}

    for cabin in CABINS:
        width = cabin["gridSize"]["width"] * CELL_SIZE
        height = cabin["gridSize"]["height"] * CELL_SIZE
        size = (width, height)
        generated[cabin["id"]] = {}

        for col, state in enumerate(STATES):
            image = cleanup_source_cell(source_cells[cabin["sourceRow"]][col], state)
            image = fit_rgba(image, size, margin=0)
            out_path = OUT_DIR / state / f"{cabin['id']}.webp"
            save_webp(image, out_path)
            generated[cabin["id"]][state] = image

    write_manifest()
    write_contact_sheet(generated)
    write_validation_report(generated)


def extract_source_sheet() -> list[list[Image.Image]]:
    sheet = Image.open(SOURCE_SHEET).convert("RGBA")
    cell_w = sheet.width / len(STATES)
    cell_h = sheet.height / len(CABINS)
    rows: list[list[Image.Image]] = []
    for row in range(len(CABINS)):
        row_images: list[Image.Image] = []
        for col in range(len(STATES)):
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
            is_key = g > 120 and g > r * 1.35 and g > b * 1.35
            alpha_pixels[x, y] = 0 if is_key else a

    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.25))
    image.putalpha(alpha)
    image = despill_green(image)
    bbox = image.getbbox()
    return image.crop(bbox) if bbox else image


def cleanup_source_cell(image: Image.Image, state: str) -> Image.Image:
    components = alpha_components(image, min_area=64)
    if not components:
        return image

    components.sort(key=lambda item: item["area"], reverse=True)
    if state != "debris":
        return crop_components(image, [components[0]])

    main = components[0]
    main_cx = (main["left"] + main["right"]) / 2
    main_cy = (main["top"] + main["bottom"]) / 2
    max_dx = image.width * 0.42
    max_dy = image.height * 0.36
    kept = [
        component
        for component in components
        if component["area"] >= 110
        and abs(((component["left"] + component["right"]) / 2) - main_cx) <= max_dx
        and abs(((component["top"] + component["bottom"]) / 2) - main_cy) <= max_dy
    ]
    return crop_components(image, kept or [main])


def alpha_components(image: Image.Image, min_area: int) -> list[dict[str, int]]:
    alpha = image.getchannel("A")
    width, height = alpha.size
    pixels = alpha.load()
    visited = bytearray(width * height)
    components: list[dict[str, int]] = []

    for y in range(height):
        for x in range(width):
            index = y * width + x
            if visited[index] or pixels[x, y] <= 10:
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

                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    next_index = ny * width + nx
                    if visited[next_index] or pixels[nx, ny] <= 10:
                        continue
                    visited[next_index] = 1
                    stack.append((nx, ny))

            if area >= min_area:
                components.append({"left": left, "top": top, "right": right + 1, "bottom": bottom + 1, "area": area})

    return components


def crop_components(image: Image.Image, components: list[dict[str, int]]) -> Image.Image:
    if not components:
        return image

    left = min(component["left"] for component in components)
    top = min(component["top"] for component in components)
    right = max(component["right"] for component in components)
    bottom = max(component["bottom"] for component in components)

    mask = Image.new("L", image.size, 0)
    alpha = image.getchannel("A")
    for component in components:
        box = (component["left"], component["top"], component["right"], component["bottom"])
        mask.paste(alpha.crop(box), box)

    cleaned = image.copy()
    cleaned.putalpha(mask)
    return cleaned.crop((left, top, right, bottom))


def despill_green(image: Image.Image) -> Image.Image:
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            max_rb = max(r, b)
            if g > max_rb + 18:
                pixels[x, y] = (r, min(g, max_rb + 18), b, a)
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


def save_webp(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=WEBP_QUALITY, method=6)


def write_manifest() -> None:
    manifest = {
        "format": "webp",
        "quality": WEBP_QUALITY,
        "cellSize": CELL_SIZE,
        "perspective": "top-down orthographic",
        "sourceMode": "direct imagegen source sheet crop, chroma-key removed, normalized to exact grid cell sizes",
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
