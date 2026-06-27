#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / "public/assets/panels-v2"
SOURCE_DIR = ASSET_ROOT / "source/panel-cells"
PANEL_OUT_DIR = ASSET_ROOT / "panels"
CELL_OUT_DIR = ASSET_ROOT / "panel-cells"
MANIFEST_PATH = ASSET_ROOT / "manifest.json"
CONTACT_SHEET_PATH = ASSET_ROOT / "panel-exact-contact.png"
LEGACY_PANEL_ATLAS = ROOT / "public/assets/panels/panel-states-atlas.png"

CELL_SIZE = 256
WEBP_QUALITY = 75
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
    cells_by_state = {
        state: extract_cell_tiles(remove_chroma_key(Image.open(SOURCE_DIR / filename).convert("RGBA")))
        for state, filename in SOURCE_FILES.items()
    }

    for state, cells in cells_by_state.items():
        for index, cell in enumerate(cells):
            save_webp(cell, CELL_OUT_DIR / state / f"cell_{index + 1:02d}.webp")

    panel_images: dict[str, dict[str, Image.Image]] = {panel_id: {} for panel_id, _ in PANELS}
    manifest = read_manifest()
    manifest.update(
        {
            "format": "webp",
            "quality": WEBP_QUALITY,
            "cellSize": CELL_SIZE,
            "states": STATES,
            "exactPanelDimensions": True,
            "panelCellSources": {
                state: f"/assets/panels-v2/source/panel-cells/{filename}"
                for state, filename in SOURCE_FILES.items()
            },
            "legacyPanelAtlas": "/assets/panels/panel-states-atlas.png",
        }
    )
    manifest["panels"] = {}

    for panel_index, (panel_id, pattern) in enumerate(PANELS):
        width_cells = max(len(row) for row in pattern)
        height_cells = len(pattern)
        manifest["panels"][panel_id] = {
            "pattern": pattern,
            "gridSize": {"width": width_cells, "height": height_cells},
            "pixelSize": {"width": width_cells * CELL_SIZE, "height": height_cells * CELL_SIZE},
            "states": {},
        }
        filled_cells = pattern_cells(pattern)
        for state in STATES:
            panel = Image.new("RGBA", (width_cells * CELL_SIZE, height_cells * CELL_SIZE), (0, 0, 0, 0))
            state_cells = cells_by_state[state]
            for cell_index, (x, y) in enumerate(filled_cells):
                tile = state_cells[(panel_index * 3 + cell_index * 5 + len(state)) % len(state_cells)]
                panel.alpha_composite(tile, (x * CELL_SIZE, y * CELL_SIZE))
            panel_images[panel_id][state] = panel
            out_path = PANEL_OUT_DIR / state / f"{panel_id}.webp"
            save_webp(panel, out_path)
            manifest["panels"][panel_id]["states"][state] = web_path(out_path)

    write_legacy_panel_atlas(panel_images)
    write_contact_sheet(panel_images)
    write_json(MANIFEST_PATH, manifest)


def extract_cell_tiles(source: Image.Image) -> list[Image.Image]:
    tiles: list[Image.Image] = []
    columns = 4
    rows = 4
    for row in range(rows):
        for col in range(columns):
            left = round(col * source.width / columns)
            top = round(row * source.height / rows)
            right = round((col + 1) * source.width / columns)
            bottom = round((row + 1) * source.height / rows)
            crop = source.crop((left, top, right, bottom))
            tiles.append(normalize_tile(crop))
    return tiles


def normalize_tile(tile: Image.Image) -> Image.Image:
    bbox = tile.getbbox()
    if bbox is None:
        return Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    crop = tile.crop(bbox)
    scale = min(252 / crop.width, 252 / crop.height)
    resized = crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((CELL_SIZE - resized.width) // 2, (CELL_SIZE - resized.height) // 2))
    return canvas


def remove_chroma_key(image: Image.Image) -> Image.Image:
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            key_score = g - max(r, b)
            if g > 110 and key_score > 45:
                pixels[x, y] = (0, 0, 0, 0)
            elif g > 95 and key_score > 22:
                pixels[x, y] = (r, min(g, max(r, b) + 12), b, 0)
            elif key_score > 8:
                pixels[x, y] = (r, min(g, max(r, b) + 18), b, a)
    return image


def pattern_cells(pattern: list[str]) -> list[tuple[int, int]]:
    cells: list[tuple[int, int]] = []
    for y, row in enumerate(pattern):
        for x, char in enumerate(row):
            if char == "+":
                cells.append((x, y))
    return cells


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
    label_band = 0
    sheet = Image.new(
        "RGBA",
        (len(PANELS) * (thumb + padding) + padding, len(STATES) * (thumb + padding) + padding + label_band),
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
