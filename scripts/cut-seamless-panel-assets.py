#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / "public/assets/panels-v2"
SOURCE_DIR = ASSET_ROOT / "source/panel-seamless"
PANEL_OUT_DIR = ASSET_ROOT / "panels"
MANIFEST_PATH = ASSET_ROOT / "manifest.json"
CONTACT_SHEET_PATH = ASSET_ROOT / "panel-seamless-contact.png"
LEGACY_PANEL_ATLAS = ROOT / "public/assets/panels/panel-states-atlas.png"

CELL_SIZE = 256
WEBP_QUALITY = 75
SOURCE_COLUMNS = 7
SOURCE_ROWS = 2
STATES = ["ideal", "damaged", "critical", "debris"]
SOURCE_FILES = {
    "ideal": "ideal-source.png",
    "damaged": "damaged-source.png",
    "critical": "critical-source.png",
    "debris": "debris-source.png",
}

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
    manifest = read_manifest()
    manifest.update(
        {
            "format": "webp",
            "quality": WEBP_QUALITY,
            "cellSize": CELL_SIZE,
            "states": STATES,
            "exactPanelDimensions": True,
            "seamlessPanels": True,
            "panelAssemblyMode": "whole generated tetris shapes",
            "panelSeamlessSources": {
                state: f"/assets/panels-v2/source/panel-seamless/{filename}"
                for state, filename in SOURCE_FILES.items()
            },
            "legacyPanelAtlas": "/assets/panels/panel-states-atlas.png",
        }
    )
    manifest["panels"] = {}

    panel_images: dict[str, dict[str, Image.Image]] = {panel_id: {} for panel_id, _ in PANELS}

    for state in STATES:
        sheet = remove_chroma_key(Image.open(SOURCE_DIR / SOURCE_FILES[state]).convert("RGBA"))
        source_boxes = find_source_boxes(sheet)
        for index, (panel_id, pattern) in enumerate(PANELS):
            slot = sheet.crop(source_boxes[index])
            panel = normalize_panel(slot, pattern)
            panel = apply_pattern_mask(panel, pattern)
            out_path = PANEL_OUT_DIR / state / f"{panel_id}.webp"
            save_webp(panel, out_path)
            panel_images[panel_id][state] = panel

    for panel_id, pattern in PANELS:
        width_cells = max(len(row) for row in pattern)
        height_cells = len(pattern)
        manifest["panels"][panel_id] = {
            "pattern": pattern,
            "gridSize": {"width": width_cells, "height": height_cells},
            "pixelSize": {"width": width_cells * CELL_SIZE, "height": height_cells * CELL_SIZE},
            "states": {
                state: web_path(PANEL_OUT_DIR / state / f"{panel_id}.webp")
                for state in STATES
            },
        }

    write_legacy_panel_atlas(panel_images)
    write_contact_sheet(panel_images)
    write_json(MANIFEST_PATH, manifest)


def find_source_boxes(sheet: Image.Image) -> list[tuple[int, int, int, int]]:
    components = find_alpha_components(sheet)
    rows = [[], []]
    for component in components:
        row = 0 if component["cy"] < sheet.height / 2 else 1
        rows[row].append(component)
    boxes: list[tuple[int, int, int, int]] = []
    for row_components in rows:
        boxes.extend(cluster_row_boxes(row_components, sheet.width, sheet.height))
    if len(boxes) != len(PANELS):
        return equal_source_boxes(sheet)
    return boxes


def find_alpha_components(sheet: Image.Image) -> list[dict[str, float]]:
    alpha = sheet.getchannel("A")
    width, height = sheet.size
    visited = bytearray(width * height)
    components: list[dict[str, float]] = []
    threshold = 18
    for y in range(height):
        for x in range(width):
            start_index = y * width + x
            if visited[start_index] or alpha.getpixel((x, y)) <= threshold:
                continue
            stack = [(x, y)]
            visited[start_index] = 1
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
                    index = ny * width + nx
                    if visited[index] or alpha.getpixel((nx, ny)) <= threshold:
                        continue
                    visited[index] = 1
                    stack.append((nx, ny))
            if area < 80:
                continue
            components.append({
                "left": left,
                "top": top,
                "right": right + 1,
                "bottom": bottom + 1,
                "area": area,
                "cx": (left + right + 1) / 2,
                "cy": (top + bottom + 1) / 2,
            })
    return components


def cluster_row_boxes(
    components: list[dict[str, float]],
    sheet_width: int,
    sheet_height: int,
) -> list[tuple[int, int, int, int]]:
    if not components:
        return []
    centers = [
        min(component["cx"] for component in components)
        + i * (max(component["cx"] for component in components) - min(component["cx"] for component in components))
        / max(1, SOURCE_COLUMNS - 1)
        for i in range(SOURCE_COLUMNS)
    ]
    assignments = [0] * len(components)
    for _ in range(12):
        buckets = [[] for _ in range(SOURCE_COLUMNS)]
        for index, component in enumerate(components):
            nearest = min(range(SOURCE_COLUMNS), key=lambda center_index: abs(component["cx"] - centers[center_index]))
            assignments[index] = nearest
            buckets[nearest].append(component)
        for index, bucket in enumerate(buckets):
            if not bucket:
                continue
            total = sum(component["area"] for component in bucket)
            centers[index] = sum(component["cx"] * component["area"] for component in bucket) / total
    clusters = [[] for _ in range(SOURCE_COLUMNS)]
    for index, component in enumerate(components):
        clusters[assignments[index]].append(component)
    boxes = []
    for cluster in clusters:
        if not cluster:
            continue
        left = min(component["left"] for component in cluster)
        top = min(component["top"] for component in cluster)
        right = max(component["right"] for component in cluster)
        bottom = max(component["bottom"] for component in cluster)
        boxes.append((
            max(0, round(left) - 14),
            max(0, round(top) - 14),
            min(sheet_width, round(right) + 14),
            min(sheet_height, round(bottom) + 14),
        ))
    boxes.sort(key=lambda box: (box[0] + box[2]) / 2)
    if len(boxes) != SOURCE_COLUMNS:
        return []
    return boxes


def equal_source_boxes(sheet: Image.Image) -> list[tuple[int, int, int, int]]:
    boxes: list[tuple[int, int, int, int]] = []
    for row in range(SOURCE_ROWS):
        for col in range(SOURCE_COLUMNS):
            left = round(col * sheet.width / SOURCE_COLUMNS)
            top = round(row * sheet.height / SOURCE_ROWS)
            right = round((col + 1) * sheet.width / SOURCE_COLUMNS)
            bottom = round((row + 1) * sheet.height / SOURCE_ROWS)
            boxes.append((left, top, right, bottom))
    return boxes


def normalize_panel(slot: Image.Image, pattern: list[str]) -> Image.Image:
    width_cells = max(len(row) for row in pattern)
    height_cells = len(pattern)
    target_width = width_cells * CELL_SIZE
    target_height = height_cells * CELL_SIZE
    canvas = Image.new("RGBA", (target_width, target_height), (0, 0, 0, 0))
    bbox = slot.getbbox()
    if bbox is None:
        return canvas
    crop = slot.crop(bbox)
    pad = 10
    target_ratio = target_width / target_height
    source_ratio = crop.width / crop.height
    # Keep whole generated panels as a single asset, but correct generator drift in aspect ratio
    # so a 4x1 panel actually reads as a long panel on a 1024x256 canvas.
    if source_ratio < target_ratio * 0.78:
        resized_width = target_width - pad * 2
        resized_height = min(target_height - pad * 2, round(resized_width / target_ratio))
    elif source_ratio > target_ratio * 1.22:
        resized_height = target_height - pad * 2
        resized_width = min(target_width - pad * 2, round(resized_height * target_ratio))
    else:
        scale = min((target_width - pad * 2) / crop.width, (target_height - pad * 2) / crop.height)
        resized_width = max(1, round(crop.width * scale))
        resized_height = max(1, round(crop.height * scale))
    resized = crop.resize(
        (max(1, resized_width), max(1, resized_height)),
        Image.Resampling.LANCZOS,
    )
    canvas.alpha_composite(resized, ((target_width - resized.width) // 2, (target_height - resized.height) // 2))
    return canvas


def apply_pattern_mask(panel: Image.Image, pattern: list[str]) -> Image.Image:
    mask = Image.new("L", panel.size, 0)
    for y, row in enumerate(pattern):
        for x, char in enumerate(row):
            if char == "+":
                left = x * CELL_SIZE
                top = y * CELL_SIZE
                for yy in range(top, top + CELL_SIZE):
                    for xx in range(left, left + CELL_SIZE):
                        mask.putpixel((xx, yy), 255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=0.35))
    alpha = panel.getchannel("A")
    panel.putalpha(Image.composite(alpha, Image.new("L", panel.size, 0), mask))
    return panel


def remove_chroma_key(image: Image.Image) -> Image.Image:
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            key_score = g - max(r, b)
            if (g > 82 and key_score > 26) or (g > 120 and r < 110 and b < 125):
                pixels[x, y] = (0, 0, 0, 0)
            elif g > 82 and key_score > 16:
                pixels[x, y] = (r, min(g, max(r, b) + 12), b, 0)
            elif key_score > 8:
                pixels[x, y] = (r, min(g, max(r, b) + 18), b, a)
    return image


def write_legacy_panel_atlas(panel_images: dict[str, dict[str, Image.Image]]) -> None:
    LEGACY_PANEL_ATLAS.parent.mkdir(parents=True, exist_ok=True)
    atlas = Image.new("RGBA", (len(LEGACY_PANEL_MAP) * CELL_SIZE, len(STATES) * CELL_SIZE), (0, 0, 0, 0))
    for col, panel_id in enumerate(LEGACY_PANEL_MAP):
        for row, state in enumerate(STATES):
            thumb = fit_thumbnail(panel_images[panel_id][state])
            atlas.alpha_composite(thumb, (col * CELL_SIZE, row * CELL_SIZE))
    atlas.save(LEGACY_PANEL_ATLAS, "PNG")


def write_contact_sheet(panel_images: dict[str, dict[str, Image.Image]]) -> None:
    thumb = 180
    padding = 18
    sheet = Image.new(
        "RGBA",
        (len(PANELS) * (thumb + padding) + padding, len(STATES) * (thumb + padding) + padding),
        (0, 0, 0, 0),
    )
    for col, (panel_id, _) in enumerate(PANELS):
        for row, state in enumerate(STATES):
            image = fit_thumbnail(panel_images[panel_id][state], thumb)
            x = padding + col * (thumb + padding)
            y = padding + row * (thumb + padding)
            sheet.alpha_composite(image, (x, y))
    sheet.save(CONTACT_SHEET_PATH, "PNG", compress_level=1)


def fit_thumbnail(image: Image.Image, size: int = CELL_SIZE) -> Image.Image:
    thumb = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = min((size * 0.92) / image.width, (size * 0.92) / image.height)
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )
    thumb.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return thumb


def save_webp(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=WEBP_QUALITY, lossless=False, method=4)


def read_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        return {}
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def web_path(path: Path) -> str:
    return "/" + str(path.relative_to(ROOT / "public"))


if __name__ == "__main__":
    main()
