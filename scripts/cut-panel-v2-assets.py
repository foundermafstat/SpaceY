#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "public/assets/panels-v2/source"
OUT_DIR = ROOT / "public/assets/panels-v2"
LEGACY_PANEL_ATLAS = ROOT / "public/assets/panels/panel-states-atlas.png"

STATES = ["ideal", "damaged", "critical", "debris"]
SPRITE_SIZE = 256
CONNECTOR_SIZE = 192
WEBP_QUALITY = 75

PANELS = [
    ("single_1", ["+"]),
    ("bar_2h", ["++"]),
    ("bar_2v", ["+", "+"]),
    ("bar_3h", ["+++"]),
    ("block_2x2", ["++", "++"]),
    ("corner_l_2x2", ["++", "+-"]),
    ("tee_3x2", ["-+-", "+++"]),
    ("cross_3x3", ["-+-", "+++", "-+-"]),
    ("long_l_3x3", ["+--", "+--", "+++"]),
    ("zig_3x3", ["++-", "-+-", "-++"]),
    ("c_2x3", ["++", "+-", "++"]),
    ("long_corner_2x3", ["++", "+-", "+-"]),
    ("block_tail_2x3", ["++", "++", "+-"]),
    ("bar_4h", ["++++"]),
]

ELEMENT_MOUNTS_FROM_MAIN_SHEET = [
    "engine",
    "maneuver_thruster",
    "weapon",
    "reactor",
    "battery",
    "shield",
    "radiator",
    "cargo",
    "scanner",
    "utility",
]

ELEMENT_MOUNTS = [
    "engine",
    "maneuver_thruster",
    "weapon",
    "reactor",
    "battery",
    "shield",
    "radiator",
    "cargo",
    "scanner",
    "drill",
    "utility",
]

INTERPANEL_CONNECTORS = ["mechanical", "power", "crew", "shield"]

LEGACY_PANEL_MAP = [
    "single_1",
    "bar_2h",
    "bar_3h",
    "bar_4h",
    "bar_4h",
    "bar_2v",
    "bar_2v",
    "bar_2v",
    "block_2x2",
    "corner_l_2x2",
    "corner_l_2x2",
    "tee_3x2",
    "tee_3x2",
    "zig_3x3",
    "zig_3x3",
    "long_l_3x3",
    "long_l_3x3",
    "zig_3x3",
    "cross_3x3",
    "c_2x3",
    "tee_3x2",
    "long_corner_2x3",
    "long_corner_2x3",
    "bar_4h",
    "block_tail_2x3",
]


def main() -> None:
    panel_source = open_rgba(SOURCE_DIR / "panel-sheet-source.png")
    element_source = open_rgba(SOURCE_DIR / "element-mount-sheet-source.png")
    interpanel_source = open_rgba(SOURCE_DIR / "interpanel-connector-sheet-source.png")
    drill_source = open_rgba(SOURCE_DIR / "drill-mount-sheet-source.png")

    panel_boxes = find_column_boxes(panel_source, expected=14, row_count=4)
    element_boxes = find_column_boxes(element_source, expected=10, row_count=4)
    connector_boxes = find_column_boxes(interpanel_source, expected=4, row_count=4)
    drill_boxes = find_column_boxes(drill_source, expected=1, row_count=4)

    manifest = {
        "generatedFrom": {
            "panelSheet": "/assets/panels-v2/source/panel-sheet-source.png",
            "elementMountSheet": "/assets/panels-v2/source/element-mount-sheet-source.png",
            "drillMountSheet": "/assets/panels-v2/source/drill-mount-sheet-source.png",
            "interpanelConnectorSheet": "/assets/panels-v2/source/interpanel-connector-sheet-source.png",
        },
        "format": "webp",
        "quality": WEBP_QUALITY,
        "states": STATES,
        "spriteSize": SPRITE_SIZE,
        "connectorSize": CONNECTOR_SIZE,
        "panels": {},
        "elementMounts": {},
        "interpanelConnectors": {},
        "legacyPanelAtlas": "/assets/panels/panel-states-atlas.png",
    }

    panel_images: dict[str, dict[str, Image.Image]] = {}
    for index, (panel_id, pattern) in enumerate(PANELS):
        panel_images[panel_id] = {}
        manifest["panels"][panel_id] = {"pattern": pattern, "states": {}}
        for state_index, state in enumerate(STATES):
            sprite = extract_sprite(panel_source, panel_boxes[index], state_index, 4, SPRITE_SIZE)
            panel_images[panel_id][state] = sprite
            path = OUT_DIR / "panels" / state / f"{panel_id}.webp"
            save_webp(sprite, path)
            manifest["panels"][panel_id]["states"][state] = web_path(path)

    for index, mount_id in enumerate(ELEMENT_MOUNTS_FROM_MAIN_SHEET):
        manifest["elementMounts"][mount_id] = {"states": {}}
        for state_index, state in enumerate(STATES):
            sprite = extract_sprite(element_source, element_boxes[index], state_index, 4, CONNECTOR_SIZE)
            path = OUT_DIR / "element-mounts" / state / f"{mount_id}.webp"
            save_webp(sprite, path)
            manifest["elementMounts"][mount_id]["states"][state] = web_path(path)

    manifest["elementMounts"]["drill"] = {"states": {}}
    for state_index, state in enumerate(STATES):
        sprite = extract_sprite(drill_source, drill_boxes[0], state_index, 4, CONNECTOR_SIZE)
        path = OUT_DIR / "element-mounts" / state / "drill.webp"
        save_webp(sprite, path)
        manifest["elementMounts"]["drill"]["states"][state] = web_path(path)

    for index, connector_id in enumerate(INTERPANEL_CONNECTORS):
        manifest["interpanelConnectors"][connector_id] = {"states": {}}
        for state_index, state in enumerate(STATES):
            sprite = extract_sprite(interpanel_source, connector_boxes[index], state_index, 4, CONNECTOR_SIZE)
            path = OUT_DIR / "interpanel-connectors" / state / f"{connector_id}.webp"
            save_webp(sprite, path)
            manifest["interpanelConnectors"][connector_id]["states"][state] = web_path(path)

    write_legacy_panel_atlas(panel_images)
    write_json(OUT_DIR / "manifest.json", manifest)


def open_rgba(path: Path) -> Image.Image:
    return remove_chroma_key(Image.open(path).convert("RGBA"))


def remove_chroma_key(image: Image.Image) -> Image.Image:
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            key_score = g - max(r, b)
            if g > 110 and key_score > 45:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            if g > 95 and key_score > 22:
                alpha = int(255 * (45 - key_score) / 23)
                pixels[x, y] = (r, min(g, max(r, b) + 18), b, max(0, min(255, alpha)))
                continue
            if key_score > 8:
                pixels[x, y] = (r, min(g, max(r, b) + 24), b, a)
    return image


def find_column_boxes(image: Image.Image, expected: int, row_count: int) -> list[tuple[int, int]]:
    band_top = 0
    band_bottom = image.height // row_count
    mask = alpha_projection(image.crop((0, band_top, image.width, band_bottom)))
    intervals = active_intervals(mask, min_count=3, max_gap=10)
    if len(intervals) == expected:
        return expand_intervals(intervals, image.width, pad=18)
    return equal_column_boxes(image.width, expected, pad=8)


def alpha_projection(image: Image.Image) -> list[int]:
    alpha = image.getchannel("A")
    projection = []
    for x in range(image.width):
        count = 0
        for y in range(image.height):
            if alpha.getpixel((x, y)) > 12:
                count += 1
        projection.append(count)
    return projection


def active_intervals(projection: Iterable[int], min_count: int, max_gap: int) -> list[tuple[int, int]]:
    intervals = []
    start = None
    last_active = None
    for x, count in enumerate(projection):
        if count > min_count:
            if start is None:
                start = x
            last_active = x
            continue
        if start is not None and last_active is not None and x - last_active > max_gap:
            intervals.append((start, last_active + 1))
            start = None
            last_active = None
    if start is not None and last_active is not None:
        intervals.append((start, last_active + 1))
    return intervals


def expand_intervals(intervals: list[tuple[int, int]], width: int, pad: int) -> list[tuple[int, int]]:
    boxes = []
    for left, right in intervals:
        boxes.append((max(0, left - pad), min(width, right + pad)))
    return boxes


def equal_column_boxes(width: int, expected: int, pad: int) -> list[tuple[int, int]]:
    boxes = []
    for index in range(expected):
        left = round(index * width / expected)
        right = round((index + 1) * width / expected)
        boxes.append((max(0, left - pad), min(width, right + pad)))
    return boxes


def extract_sprite(
    image: Image.Image,
    x_box: tuple[int, int],
    state_index: int,
    row_count: int,
    output_size: int,
) -> Image.Image:
    y0 = round(state_index * image.height / row_count)
    y1 = round((state_index + 1) * image.height / row_count)
    crop = image.crop((x_box[0], y0, x_box[1], y1))
    bbox = crop.getbbox()
    if bbox is None:
        return Image.new("RGBA", (output_size, output_size), (0, 0, 0, 0))
    crop = crop.crop(bbox)
    max_side = max(crop.width, crop.height)
    scale = min((output_size * 0.88) / max_side, 1.0)
    resized = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (output_size, output_size), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((output_size - resized.width) // 2, (output_size - resized.height) // 2))
    return canvas


def save_webp(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=WEBP_QUALITY, lossless=False, method=6)


def write_legacy_panel_atlas(panel_images: dict[str, dict[str, Image.Image]]) -> None:
    LEGACY_PANEL_ATLAS.parent.mkdir(parents=True, exist_ok=True)
    atlas = Image.new("RGBA", (len(LEGACY_PANEL_MAP) * SPRITE_SIZE, len(STATES) * SPRITE_SIZE), (0, 0, 0, 0))
    for col, panel_id in enumerate(LEGACY_PANEL_MAP):
        for row, state in enumerate(STATES):
            atlas.alpha_composite(panel_images[panel_id][state], (col * SPRITE_SIZE, row * SPRITE_SIZE))
    atlas.save(LEGACY_PANEL_ATLAS, "PNG")


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def web_path(path: Path) -> str:
    return "/" + str(path.relative_to(ROOT / "public"))


if __name__ == "__main__":
    main()
