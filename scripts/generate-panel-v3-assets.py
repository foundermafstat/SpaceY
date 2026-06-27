#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = ROOT / "public/assets/panels-v3"
SOURCE_DIR = ASSET_ROOT / "source/materials"
MATERIAL_OUT_DIR = ASSET_ROOT / "materials"
PANEL_OUT_DIR = ASSET_ROOT / "panels"
EDGE_KIT_SOURCE_PATH = ASSET_ROOT / "source/edge-kit/edge-kit-source.png"
EDGE_KIT_OUT_PATH = ASSET_ROOT / "edge-kit/edge-kit.webp"
EDGE_PIECES_CONTACT_SHEET_PATH = ASSET_ROOT / "edge-kit/edge-pieces-contact-sheet.png"
REFERENCE_EDGE_MANIFEST_PATH = ASSET_ROOT / "edge-elements/reference-complete/manifest.json"
MANIFEST_PATH = ASSET_ROOT / "manifest.json"
CONTACT_SHEET_PATH = ASSET_ROOT / "panel-contact-sheet.png"
VALIDATION_PATH = ASSET_ROOT / "validation-report.json"

CELL_SIZE = 256
MATERIAL_SIZE = 1024
WEBP_QUALITY = 75
STATES = ["ideal", "damaged", "heavyDamage", "debris"]
SOURCE_FILES = {
    "ideal": "ideal-source.png",
    "damaged": "damaged-source.png",
    "heavyDamage": "heavyDamage-source.png",
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


def main() -> None:
    materials = load_materials()
    edge_pieces_by_state = load_reference_complete_edge_pieces()
    panel_images: dict[str, dict[str, Image.Image]] = {panel_id: {} for panel_id, _ in PANELS}

    for state, material in materials.items():
        save_webp(material, MATERIAL_OUT_DIR / f"{state}.webp")
    write_edge_pieces_contact_sheet(edge_pieces_by_state["ideal"])

    for panel_id, pattern in PANELS:
        for state in STATES:
            panel = build_panel_image(panel_id, pattern, state, materials[state], edge_pieces_by_state[state])
            out_path = PANEL_OUT_DIR / state / f"{panel_id}.webp"
            save_webp(panel, out_path)
            panel_images[panel_id][state] = panel

    write_contact_sheet(panel_images)
    write_manifest(edge_pieces_by_state)
    write_validation_report()


def load_materials() -> dict[str, Image.Image]:
    materials: dict[str, Image.Image] = {}
    for state in STATES:
        source_path = SOURCE_DIR / SOURCE_FILES[state]
        if not source_path.exists():
            raise FileNotFoundError(f"Missing material source: {source_path}")
        material = Image.open(source_path).convert("RGBA")
        material = ImageOps.fit(material, (MATERIAL_SIZE, MATERIAL_SIZE), Image.Resampling.LANCZOS)
        material.putalpha(255)
        materials[state] = tune_material(material, state)
    return materials


def load_edge_kit() -> Image.Image:
    if not EDGE_KIT_SOURCE_PATH.exists():
        raise FileNotFoundError(f"Missing edge kit source: {EDGE_KIT_SOURCE_PATH}")
    edge_kit = Image.open(EDGE_KIT_SOURCE_PATH).convert("RGBA")
    edge_kit = ImageOps.fit(edge_kit, (MATERIAL_SIZE, MATERIAL_SIZE), Image.Resampling.LANCZOS)
    edge_kit.putalpha(255)
    edge_kit = ImageEnhance.Color(edge_kit).enhance(0.95)
    edge_kit = ImageEnhance.Contrast(edge_kit).enhance(1.18)
    return edge_kit


def load_reference_complete_edge_pieces() -> dict[str, list[dict]]:
    if not REFERENCE_EDGE_MANIFEST_PATH.exists():
        raise FileNotFoundError(f"Missing complete edge elements manifest: {REFERENCE_EDGE_MANIFEST_PATH}")

    manifest = json.loads(REFERENCE_EDGE_MANIFEST_PATH.read_text(encoding="utf-8"))
    pieces_by_state: dict[str, list[dict]] = {}
    for state in STATES:
        state_manifest = manifest["statesManifest"][state]
        pieces: list[dict] = []
        for sprite in state_manifest["sprites"]:
            path = ROOT / "public" / sprite["path"].lstrip("/")
            if not path.exists():
                raise FileNotFoundError(f"Missing complete edge sprite: {path}")
            image = Image.open(path).convert("RGBA")
            pieces.append(
                {
                    "id": sprite["id"],
                    "kind": sprite["kind"],
                    "role": classify_reference_edge_role(sprite["kind"], image.width, image.height),
                    "image": image,
                    "path": sprite["path"],
                    "area": image.width * image.height,
                }
            )
        pieces.sort(key=lambda item: item["area"], reverse=True)
        pieces_by_state[state] = pieces
    return pieces_by_state


def classify_reference_edge_role(source_kind: str, width: int, height: int) -> str:
    ratio = width / height if height else 1
    if source_kind == "corner":
        return "corner"
    if ratio >= 3.0 and width >= 180:
        return "long_horizontal"
    if ratio <= 0.34 and height >= 180:
        return "long_vertical"
    if ratio >= 1.7 and width >= 90:
        return "horizontal"
    if ratio <= 0.62 and height >= 90:
        return "vertical"
    if 0.68 <= ratio <= 1.45 and max(width, height) <= 170:
        return "corner"
    return "module"


def extract_edge_pieces(edge_kit: Image.Image) -> list[dict]:
    mask = make_edge_piece_mask(edge_kit)
    components = find_mask_components(mask, min_area=140)
    pieces: list[dict] = []
    for index, component in enumerate(components):
        left = max(0, component["left"] - 2)
        top = max(0, component["top"] - 2)
        right = min(edge_kit.width, component["right"] + 2)
        bottom = min(edge_kit.height, component["bottom"] + 2)
        if right - left < 10 or bottom - top < 10:
            continue
        image = edge_kit.crop((left, top, right, bottom)).convert("RGBA")
        alpha = mask.crop((left, top, right, bottom)).filter(ImageFilter.GaussianBlur(radius=0.35))
        image.putalpha(alpha)
        bbox = image.getbbox()
        if bbox is None:
            continue
        image = image.crop(bbox)
        pieces.append(
            {
                "id": f"edge_piece_{index:03d}",
                "kind": classify_edge_piece(image.width, image.height),
                "image": image,
                "box": {"left": left, "top": top, "right": right, "bottom": bottom},
                "area": component["area"],
            }
        )
    pieces.sort(key=lambda item: item["area"], reverse=True)
    if not pieces:
        pieces.append({"id": "edge_piece_fallback", "kind": "module", "image": edge_kit, "box": {}, "area": edge_kit.width * edge_kit.height})
    return pieces


def make_edge_piece_mask(image: Image.Image) -> Image.Image:
    bg = estimate_background_rgb(image)
    bg_luma = rgb_luma(bg)
    mask = Image.new("L", image.size, 0)
    pixels = image.load()
    out = mask.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            luma = rgb_luma((r, g, b))
            diff = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
            accent = b > 70 or r > 80
            if a > 0 and ((diff > 28 and luma > bg_luma + 8) or (accent and diff > 18)):
                out[x, y] = 255
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    return mask


def estimate_background_rgb(image: Image.Image) -> tuple[int, int, int]:
    samples: list[tuple[int, int, int]] = []
    for x in range(0, image.width, 32):
        samples.append(image.getpixel((x, 0))[:3])
        samples.append(image.getpixel((x, image.height - 1))[:3])
    for y in range(0, image.height, 32):
        samples.append(image.getpixel((0, y))[:3])
        samples.append(image.getpixel((image.width - 1, y))[:3])
    samples.sort(key=rgb_luma)
    return samples[max(0, len(samples) // 4)]


def rgb_luma(rgb: tuple[int, int, int]) -> float:
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722


def find_mask_components(mask: Image.Image, min_area: int) -> list[dict[str, int]]:
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
            if area >= min_area:
                components.append({"left": left, "top": top, "right": right + 1, "bottom": bottom + 1, "area": area})
    return components


def classify_edge_piece(width: int, height: int) -> str:
    if width >= height * 2.6 and width >= 80:
        return "horizontal"
    if height >= width * 2.1 and height >= 70:
        return "vertical"
    if width <= 120 and height <= 120:
        return "corner"
    return "module"


def tune_material(material: Image.Image, state: str) -> Image.Image:
    if state == "ideal":
        material = ImageEnhance.Color(material).enhance(0.92)
        material = ImageEnhance.Contrast(material).enhance(1.08)
    elif state == "damaged":
        material = ImageEnhance.Color(material).enhance(0.95)
        material = ImageEnhance.Contrast(material).enhance(1.14)
    elif state == "heavyDamage":
        material = ImageEnhance.Color(material).enhance(1.04)
        material = ImageEnhance.Contrast(material).enhance(1.2)
        material = ImageEnhance.Brightness(material).enhance(0.9)
    else:
        material = ImageEnhance.Color(material).enhance(1.1)
        material = ImageEnhance.Contrast(material).enhance(1.25)
        material = ImageEnhance.Brightness(material).enhance(0.82)
    return material


def build_panel_image(
    panel_id: str,
    pattern: list[str],
    state: str,
    material: Image.Image,
    edge_pieces: list[dict],
) -> Image.Image:
    width, height = pattern_pixel_size(pattern)
    base_mask = make_pattern_mask(pattern)
    final_mask = make_state_mask(panel_id, pattern, state, base_mask)
    rng = seeded_rng(panel_id, state)

    panel = material_for_panel(material, width, height)
    panel = add_surface_variation(panel, final_mask, rng, state)
    panel = add_state_damage(panel, final_mask, rng, state)
    panel = add_outer_contour(panel, final_mask, state)
    panel = add_edge_ornaments(panel, pattern, final_mask, seeded_rng(panel_id, "edge-layout"), state, edge_pieces)
    panel = add_outer_accent_lights(panel, pattern, final_mask, rng, state)
    panel.putalpha(final_mask)
    return panel


def material_for_panel(material: Image.Image, width: int, height: int) -> Image.Image:
    scale = max(width / material.width, height / material.height)
    resized = material.resize(
        (max(1, math.ceil(material.width * scale)), max(1, math.ceil(material.height * scale))),
        Image.Resampling.LANCZOS,
    )
    left = max(0, (resized.width - width) // 2)
    top = max(0, (resized.height - height) // 2)
    return resized.crop((left, top, left + width, top + height)).convert("RGBA")


def make_pattern_mask(pattern: list[str]) -> Image.Image:
    width, height = pattern_pixel_size(pattern)
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    for y, row in enumerate(pattern):
        for x, char in enumerate(row):
            if char == "+":
                draw.rectangle(
                    (
                        x * CELL_SIZE,
                        y * CELL_SIZE,
                        (x + 1) * CELL_SIZE - 1,
                        (y + 1) * CELL_SIZE - 1,
                    ),
                    fill=255,
                )
    return mask


def make_state_mask(panel_id: str, pattern: list[str], state: str, base_mask: Image.Image) -> Image.Image:
    rng = seeded_rng(panel_id, state, "mask")
    mask = apply_corner_shape_variants(panel_id, pattern, state, base_mask)
    if state in {"ideal", "damaged"}:
        return mask

    draw = ImageDraw.Draw(mask)
    cells = filled_cells(pattern)
    cell_count = len(cells)
    outer_edges = find_outer_edges(pattern)

    chip_count = max(2, round(cell_count * (1.2 if state == "heavyDamage" else 2.1)))
    for _ in range(chip_count):
        side, x, y = rng.choice(outer_edges)
        cut_edge_chip(draw, rng, side, x, y, state)

    hole_count = max(1, round(cell_count * (0.75 if state == "heavyDamage" else 1.35)))
    for _ in range(hole_count):
        x, y = rng.choice(cells)
        cut_internal_hole(draw, rng, x, y, state)

    outside = ImageChops.invert(base_mask)
    mask.paste(0, mask=outside)
    return mask


def apply_corner_shape_variants(panel_id: str, pattern: list[str], state: str, base_mask: Image.Image) -> Image.Image:
    rng = seeded_rng(panel_id, state, "corner-shape")
    mask = base_mask.copy()
    draw = ImageDraw.Draw(mask)
    corners = find_convex_corners(pattern)
    rng.shuffle(corners)
    probability = {"ideal": 0.38, "damaged": 0.44, "heavyDamage": 0.48, "debris": 0.54}[state]
    for corner in corners:
        if rng.random() <= probability:
            cut_corner_shape(draw, rng, corner, state)
    mask.paste(0, mask=ImageChops.invert(base_mask))
    return mask


def cut_corner_shape(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    corner: tuple[str, int, int],
    state: str,
) -> None:
    orientation, px, py = corner
    amount = rng.randrange(16, 36 if state in {"ideal", "damaged"} else 58)
    style = rng.choice(["chamfer", "round", "fold"])
    if orientation == "nw":
        points = [(px, py), (px + amount, py), (px, py + amount)]
        box = (px - amount, py - amount, px + amount, py + amount)
        fold = (px, py, px + amount, py + amount)
    elif orientation == "ne":
        points = [(px, py), (px - amount, py), (px, py + amount)]
        box = (px - amount, py - amount, px + amount, py + amount)
        fold = (px - amount, py, px, py + amount)
    elif orientation == "sw":
        points = [(px, py), (px + amount, py), (px, py - amount)]
        box = (px - amount, py - amount, px + amount, py + amount)
        fold = (px, py - amount, px + amount, py)
    else:
        points = [(px, py), (px - amount, py), (px, py - amount)]
        box = (px - amount, py - amount, px + amount, py + amount)
        fold = (px - amount, py - amount, px, py)

    if style == "round":
        draw.pieslice(box, start=0, end=360, fill=0)
    elif style == "fold":
        draw.rounded_rectangle(fold, radius=max(4, amount // 4), fill=0)
    else:
        draw.polygon(points, fill=0)


def add_surface_variation(panel: Image.Image, mask: Image.Image, rng: random.Random, state: str) -> Image.Image:
    overlay = Image.new("RGBA", panel.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    scratch_count = {
        "ideal": 18,
        "damaged": 42,
        "heavyDamage": 58,
        "debris": 72,
    }[state]
    for _ in range(scratch_count):
        x = rng.randrange(panel.width)
        y = rng.randrange(panel.height)
        length = rng.randrange(18, 100)
        angle = rng.uniform(-0.9, 0.9)
        x2 = round(x + math.cos(angle) * length)
        y2 = round(y + math.sin(angle) * length)
        alpha = rng.randrange(22, 66 if state == "ideal" else 96)
        color = (190, 211, 214, alpha) if rng.random() < 0.7 else (20, 28, 33, alpha)
        draw.line((x, y, x2, y2), fill=color, width=rng.choice([1, 1, 2]))

    rivet_count = max(2, (panel.width * panel.height) // 52000)
    for _ in range(rivet_count):
        x = rng.randrange(18, max(19, panel.width - 18))
        y = rng.randrange(18, max(19, panel.height - 18))
        radius = rng.choice([2, 3, 4])
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(12, 17, 21, 115))
        draw.point((x - 1, y - 1), fill=(146, 170, 178, 145))

    overlay.putalpha(ImageChops.multiply(overlay.getchannel("A"), mask))
    panel.alpha_composite(overlay)
    return panel


def add_state_damage(panel: Image.Image, mask: Image.Image, rng: random.Random, state: str) -> Image.Image:
    if state == "ideal":
        return panel

    overlay = Image.new("RGBA", panel.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    crack_count = {"damaged": 12, "heavyDamage": 28, "debris": 42}[state]
    for _ in range(crack_count):
        x = rng.randrange(panel.width)
        y = rng.randrange(panel.height)
        points = [(x, y)]
        for _ in range(rng.randrange(2, 6)):
            x += rng.randrange(-38, 39)
            y += rng.randrange(-38, 39)
            points.append((x, y))
        draw.line(points, fill=(6, 9, 11, rng.randrange(90, 190)), width=rng.choice([1, 2, 3]))
        if state != "damaged" and rng.random() < 0.38:
            draw.line(points, fill=(219, 95, 30, rng.randrange(42, 110)), width=1)

    scorch_count = {"damaged": 5, "heavyDamage": 12, "debris": 18}[state]
    for _ in range(scorch_count):
        cx = rng.randrange(panel.width)
        cy = rng.randrange(panel.height)
        radius = rng.randrange(18, 80 if state == "damaged" else 122)
        color = (3, 5, 7, rng.randrange(36, 90))
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=color)

    overlay = overlay.filter(ImageFilter.GaussianBlur(0.45 if state == "damaged" else 0.7))
    overlay.putalpha(ImageChops.multiply(overlay.getchannel("A"), mask))
    panel.alpha_composite(overlay)
    return panel


def add_outer_contour(panel: Image.Image, mask: Image.Image, state: str) -> Image.Image:
    border_width = 18 if state in {"ideal", "damaged"} else 22
    eroded = mask.filter(ImageFilter.MinFilter(border_width * 2 + 1))
    edge = ImageChops.subtract(mask, eroded).filter(ImageFilter.GaussianBlur(radius=5.5))

    shade_alpha = 58 if state in {"ideal", "damaged"} else 84
    shade = Image.new("RGBA", panel.size, (10, 15, 18, shade_alpha))
    shade.putalpha(edge.point(lambda value: min(shade_alpha, round(value * 0.34))))
    panel.alpha_composite(shade)

    highlight_band = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(13))).filter(ImageFilter.GaussianBlur(radius=3.5))
    highlight = Image.new("RGBA", panel.size, (126, 151, 154, 36))
    highlight.putalpha(highlight_band.point(lambda value: min(36, round(value * 0.18))))
    panel.alpha_composite(highlight)
    return panel


def add_edge_ornaments(
    panel: Image.Image,
    pattern: list[str],
    mask: Image.Image,
    rng: random.Random,
    state: str,
    edge_pieces: list[dict],
) -> Image.Image:
    overlay = Image.new("RGBA", panel.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    edges = find_outer_edges(pattern)
    runs = find_outer_edge_runs(pattern)
    edge_alpha = {"ideal": 220, "damaged": 208, "heavyDamage": 188, "debris": 172}[state]

    for run in runs:
        draw_edge_run_piece(overlay, draw, edge_pieces, rng, run, edge_alpha)

    for side, x, y in edges:
        if rng.random() < 0.18:
            draw_edge_module_piece(overlay, edge_pieces, rng, side, x, y, max(70, edge_alpha - 18))

    for corner in find_convex_corners(pattern):
        draw_corner_bracket(overlay, draw, edge_pieces, rng, corner, edge_alpha)

    for corner in find_concave_corners(pattern):
        draw_inner_corner_pad(overlay, draw, edge_pieces, rng, corner, max(118, edge_alpha - 38))

    overlay = overlay.filter(ImageFilter.UnsharpMask(radius=0.8, percent=35, threshold=5))
    overlay.putalpha(ImageChops.multiply(overlay.getchannel("A"), mask))
    panel.alpha_composite(overlay)
    return panel


def draw_edge_run_piece(
    overlay: Image.Image,
    draw: ImageDraw.ImageDraw,
    edge_pieces: list[dict],
    rng: random.Random,
    run: tuple[str, int, int, int],
    alpha: int,
) -> None:
    side, start_x, start_y, length = run
    depth = rng.randrange(42, 68)
    if side in {"top", "bottom"}:
        left = start_x * CELL_SIZE
        right = (start_x + length) * CELL_SIZE
        if side == "top":
            top = start_y * CELL_SIZE
            bottom = top + depth
        else:
            bottom = (start_y + 1) * CELL_SIZE
            top = bottom - depth
        box = (left, top, right, bottom)
        piece, rotate = select_oriented_edge_piece(edge_pieces, "horizontal", rng, right - left, bottom - top)
    else:
        top = start_y * CELL_SIZE
        bottom = (start_y + length) * CELL_SIZE
        if side == "left":
            left = start_x * CELL_SIZE
            right = left + depth
        else:
            right = (start_x + 1) * CELL_SIZE
            left = right - depth
        box = (left, top, right, bottom)
        piece, rotate = select_oriented_edge_piece(edge_pieces, "vertical", rng, right - left, bottom - top)

    paste_edge_piece(overlay, piece, box, rng, alpha, rotate=rotate, anchor=side)
    if length >= 2 and rng.random() < 0.48:
        module_box = secondary_edge_module_box(box, side, rng)
        module_piece, module_rotate = select_oriented_edge_piece(
            edge_pieces,
            "module",
            rng,
            module_box[2] - module_box[0],
            module_box[3] - module_box[1],
        )
        paste_edge_piece(
            overlay,
            module_piece,
            module_box,
            rng,
            max(118, alpha - 34),
            rotate=module_rotate,
            anchor=side,
        )

    if rng.random() < 0.28:
        draw_cyan_or_copper_insert(draw, rng, small_insert_box(box, side, rng), max(58, alpha - 12))


def draw_edge_module_piece(
    overlay: Image.Image,
    edge_pieces: list[dict],
    rng: random.Random,
    side: str,
    x: int,
    y: int,
    alpha: int,
) -> None:
    left = x * CELL_SIZE
    top = y * CELL_SIZE
    size = rng.randrange(28, 54)
    pos = rng.randrange(48, CELL_SIZE - 48)
    if side == "top":
        box = (left + pos - size // 2, top, left + pos + size // 2, top + size)
    elif side == "bottom":
        box = (left + pos - size // 2, top + CELL_SIZE - size, left + pos + size // 2, top + CELL_SIZE)
    elif side == "left":
        box = (left, top + pos - size // 2, left + size, top + pos + size // 2)
    else:
        box = (left + CELL_SIZE - size, top + pos - size // 2, left + CELL_SIZE, top + pos + size // 2)
    piece, rotate = select_oriented_edge_piece(edge_pieces, "module", rng, box[2] - box[0], box[3] - box[1])
    paste_edge_piece(overlay, piece, box, rng, alpha, rotate=rotate, anchor=side)


def draw_edge_rail(
    overlay: Image.Image,
    draw: ImageDraw.ImageDraw,
    edge_kit: Image.Image,
    rng: random.Random,
    side: str,
    x: int,
    y: int,
    alpha: int,
) -> None:
    left = x * CELL_SIZE
    top = y * CELL_SIZE
    inset = rng.randrange(8, 18)
    rail_depth = rng.randrange(24, 42)
    rail_margin = rng.randrange(12, 38)
    slot = rng.randrange(28, 72)

    if side == "top":
        box = (left + rail_margin, top + inset, left + CELL_SIZE - rail_margin, top + inset + rail_depth)
        slot_box = centered_box_on_horizontal(box, slot, rng)
    elif side == "bottom":
        box = (left + rail_margin, top + CELL_SIZE - inset - rail_depth, left + CELL_SIZE - rail_margin, top + CELL_SIZE - inset)
        slot_box = centered_box_on_horizontal(box, slot, rng)
    elif side == "left":
        box = (left + inset, top + rail_margin, left + inset + rail_depth, top + CELL_SIZE - rail_margin)
        slot_box = centered_box_on_vertical(box, slot, rng)
    else:
        box = (left + CELL_SIZE - inset - rail_depth, top + rail_margin, left + CELL_SIZE - inset, top + CELL_SIZE - rail_margin)
        slot_box = centered_box_on_vertical(box, slot, rng)

    paste_textured_box(overlay, edge_kit, box, rng, alpha, feather=9)
    draw_cyan_or_copper_insert(draw, rng, slot_box, alpha)

    if rng.random() < 0.45:
        draw_bolt_pair(draw, side, box, alpha)


def draw_edge_lock(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    side: str,
    x: int,
    y: int,
    alpha: int,
) -> None:
    left = x * CELL_SIZE
    top = y * CELL_SIZE
    lock_w = rng.randrange(22, 38)
    lock_h = rng.randrange(15, 28)
    pos = rng.randrange(52, CELL_SIZE - 52)
    if side == "top":
        box = (left + pos - lock_w // 2, top + 37, left + pos + lock_w // 2, top + 37 + lock_h)
    elif side == "bottom":
        box = (left + pos - lock_w // 2, top + CELL_SIZE - 37 - lock_h, left + pos + lock_w // 2, top + CELL_SIZE - 37)
    elif side == "left":
        box = (left + 37, top + pos - lock_w // 2, left + 37 + lock_h, top + pos + lock_w // 2)
    else:
        box = (left + CELL_SIZE - 37 - lock_h, top + pos - lock_w // 2, left + CELL_SIZE - 37, top + pos + lock_w // 2)
    draw.rounded_rectangle(box, radius=5, fill=(28, 38, 42, min(82, alpha)))


def draw_corner_bracket(
    overlay: Image.Image,
    draw: ImageDraw.ImageDraw,
    edge_pieces: list[dict],
    rng: random.Random,
    corner: tuple[str, int, int],
    alpha: int,
) -> None:
    orientation, px, py = corner
    size = rng.randrange(68, 112)
    x1, y1, x2, y2 = bracket_bounds(orientation, px, py, size)
    piece, rotate = select_oriented_edge_piece(edge_pieces, "corner", rng, x2 - x1, y2 - y1)
    paste_edge_piece(overlay, piece, (x1, y1, x2, y2), rng, min(245, alpha + 24), rotate=rotate, anchor=orientation)

    if rng.random() < 0.32:
        draw_cyan_or_copper_insert(draw, rng, shrink_box((x1, y1, x2, y2), max(12, size // 3)), alpha)


def draw_inner_corner_pad(
    overlay: Image.Image,
    draw: ImageDraw.ImageDraw,
    edge_pieces: list[dict],
    rng: random.Random,
    corner: tuple[str, int, int],
    alpha: int,
) -> None:
    orientation, px, py = corner
    size = rng.randrange(38, 68)
    if orientation == "nw":
        box = (px, py, px + size, py + size)
    elif orientation == "ne":
        box = (px - size, py, px, py + size)
    elif orientation == "sw":
        box = (px, py - size, px + size, py)
    else:
        box = (px - size, py - size, px, py)
    piece, rotate = select_oriented_edge_piece(edge_pieces, "corner", rng, box[2] - box[0], box[3] - box[1])
    paste_edge_piece(overlay, piece, box, rng, alpha, rotate=rotate, anchor=orientation)
    if rng.random() < 0.25:
        draw_cyan_or_copper_insert(draw, rng, shrink_box(box, max(9, size // 3)), alpha)


def paste_textured_box(
    target: Image.Image,
    texture: Image.Image,
    box: tuple[int, int, int, int],
    rng: random.Random,
    alpha: int,
    feather: int = 0,
) -> None:
    left, top, right, bottom = box
    width = max(1, right - left)
    height = max(1, bottom - top)
    crop_w = min(texture.width, max(96, width * 4))
    crop_h = min(texture.height, max(96, height * 4))
    sx = rng.randrange(0, max(1, texture.width - crop_w + 1))
    sy = rng.randrange(0, max(1, texture.height - crop_h + 1))
    patch = texture.crop((sx, sy, sx + crop_w, sy + crop_h)).resize((width, height), Image.Resampling.LANCZOS)
    patch = ImageEnhance.Contrast(patch).enhance(1.04)
    if feather:
        matte = Image.new("L", (width, height), 0)
        matte_draw = ImageDraw.Draw(matte)
        matte_draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=min(width, height) // 3, fill=alpha)
        matte = matte.filter(ImageFilter.GaussianBlur(radius=feather))
        patch.putalpha(matte)
    else:
        patch.putalpha(alpha)
    target.alpha_composite(patch, (left, top))


def select_oriented_edge_piece(
    edge_pieces: list[dict],
    purpose: str,
    rng: random.Random,
    max_width: int,
    max_height: int,
) -> tuple[dict, int]:
    if purpose == "horizontal":
        primary = ["long_horizontal", "horizontal"] if max_width >= 340 else ["horizontal", "module"]
        buckets = [(primary, 0), (["long_vertical", "vertical"], 90), (["corner"], 0)]
    elif purpose == "vertical":
        primary = ["long_vertical", "vertical"] if max_height >= 340 else ["vertical", "module"]
        buckets = [(primary, 0), (["long_horizontal", "horizontal"], 90), (["corner"], 0)]
    elif purpose == "corner":
        buckets = [(["corner"], rng.choice([0, 90, 180, 270])), (["module"], rng.choice([0, 90, 180, 270]))]
    else:
        buckets = [
            (["module", "corner"], rng.choice([0, 90, 180, 270])),
            (["horizontal"], 0),
            (["vertical"], 0),
        ]

    fallback: list[tuple[dict, int]] = []
    for roles, rotate in buckets:
        candidates = [(piece, rotate) for piece in edge_pieces if piece["role"] in roles]
        fitted = filter_oriented_candidates(candidates, max_width, max_height)
        if fitted:
            return rng.choice(fitted)
        fallback.extend(candidates)

    if fallback:
        return rng.choice(fallback)
    return rng.choice(edge_pieces), 0


def filter_oriented_candidates(
    candidates: list[tuple[dict, int]],
    max_width: int,
    max_height: int,
) -> list[tuple[dict, int]]:
    fitted = []
    for piece, rotate in candidates:
        width, height = oriented_piece_size(piece, rotate)
        if width <= max_width * 1.65 and height <= max_height * 1.9:
            fitted.append((piece, rotate))
    return fitted


def oriented_piece_size(piece: dict, rotate: int) -> tuple[int, int]:
    width, height = piece["image"].size
    return (height, width) if rotate in {90, 270} else (width, height)


def paste_edge_piece(
    target: Image.Image,
    piece: dict,
    box: tuple[int, int, int, int],
    rng: random.Random,
    alpha: int,
    rotate: int = 0,
    anchor: str = "center",
) -> None:
    left, top, right, bottom = normalize_box(box)
    width = max(1, right - left)
    height = max(1, bottom - top)
    source = trim_alpha_bbox(piece["image"].copy())
    if rotate:
        source = source.rotate(rotate, expand=True, resample=Image.Resampling.BICUBIC)
        source = trim_alpha_bbox(source)
    scale = min(width / source.width, height / source.height, 1.14)
    resized = source.resize(
        (max(1, round(source.width * scale)), max(1, round(source.height * scale))),
        Image.Resampling.LANCZOS,
    )
    piece_alpha = resized.getchannel("A").point(lambda value: round(value * alpha / 255))
    resized.putalpha(piece_alpha)
    x = anchored_axis(left, right, resized.width, anchor, {"left", "nw", "sw"}, {"right", "ne", "se"})
    y = anchored_axis(top, bottom, resized.height, anchor, {"top", "nw", "ne"}, {"bottom", "sw", "se"})
    target.alpha_composite(resized, (x, y))


def trim_alpha_bbox(image: Image.Image) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    return image.crop(bbox) if bbox else image


def anchored_axis(start: int, end: int, size: int, anchor: str, start_anchors: set[str], end_anchors: set[str]) -> int:
    if anchor in start_anchors:
        return start
    if anchor in end_anchors:
        return end - size
    return start + (end - start - size) // 2


def crop_piece_to_ratio(image: Image.Image, target_ratio: float, rng: random.Random) -> Image.Image:
    if image.width <= 1 or image.height <= 1:
        return image
    source_ratio = image.width / image.height
    if source_ratio > target_ratio * 1.55:
        crop_width = max(1, min(image.width, round(image.height * target_ratio * 1.18)))
        left = rng.randrange(0, max(1, image.width - crop_width + 1))
        return image.crop((left, 0, left + crop_width, image.height))
    if source_ratio < target_ratio / 1.55:
        crop_height = max(1, min(image.height, round(image.width / target_ratio * 1.18)))
        top = rng.randrange(0, max(1, image.height - crop_height + 1))
        return image.crop((0, top, image.width, top + crop_height))
    return image


def normalize_box(box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    return (round(left), round(top), round(right), round(bottom))


def secondary_edge_module_box(box: tuple[int, int, int, int], side: str, rng: random.Random) -> tuple[int, int, int, int]:
    left, top, right, bottom = normalize_box(box)
    band_w = max(1, right - left)
    band_h = max(1, bottom - top)
    if side in {"top", "bottom"}:
        width = min(band_w - 8, rng.randrange(48, 104))
        height = min(band_h, rng.randrange(30, 58))
        x = rng.randrange(left + 4, max(left + 5, right - width - 4))
        y = top if side == "top" else bottom - height
        return (x, y, x + width, y + height)

    width = min(band_w, rng.randrange(30, 58))
    height = min(band_h - 8, rng.randrange(48, 104))
    x = left if side == "left" else right - width
    y = rng.randrange(top + 4, max(top + 5, bottom - height - 4))
    return (x, y, x + width, y + height)


def small_insert_box(box: tuple[int, int, int, int], side: str, rng: random.Random) -> tuple[int, int, int, int]:
    left, top, right, bottom = normalize_box(box)
    if side in {"top", "bottom"}:
        width = rng.randrange(28, min(92, max(29, right - left - 12)))
        x = rng.randrange(left + 6, max(left + 7, right - width - 6))
        y = top if side == "top" else bottom - 6
        return (x, y, x + width, y + 6)
    height = rng.randrange(28, min(92, max(29, bottom - top - 12)))
    x = left if side == "left" else right - 6
    y = rng.randrange(top + 6, max(top + 7, bottom - height - 6))
    return (x, y, x + 6, y + height)


def draw_cyan_or_copper_insert(
    draw: ImageDraw.ImageDraw,
    rng: random.Random,
    box: tuple[int, int, int, int],
    alpha: int,
) -> None:
    color = (0, 211, 237, min(148, alpha + 18)) if rng.random() < 0.7 else (214, 105, 38, min(134, alpha + 4))
    draw.rounded_rectangle(box, radius=4, fill=color)


def draw_bolt_pair(draw: ImageDraw.ImageDraw, side: str, box: tuple[int, int, int, int], alpha: int) -> None:
    left, top, right, bottom = box
    points = (
        [(left + 9, (top + bottom) // 2), (right - 9, (top + bottom) // 2)]
        if side in {"top", "bottom"}
        else [((left + right) // 2, top + 9), ((left + right) // 2, bottom - 9)]
    )
    for x, y in points:
        draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=(10, 14, 16, min(100, alpha)))
        draw.point((x - 1, y - 1), fill=(150, 172, 174, min(82, alpha)))


def centered_box_on_horizontal(box: tuple[int, int, int, int], width: int, rng: random.Random) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    x = rng.randrange(left + 12, max(left + 13, right - width - 12))
    y = (top + bottom) // 2 - 3
    return (x, y, x + width, y + 6)


def centered_box_on_vertical(box: tuple[int, int, int, int], height: int, rng: random.Random) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    x = (left + right) // 2 - 3
    y = rng.randrange(top + 12, max(top + 13, bottom - height - 12))
    return (x, y, x + 6, y + height)


def bracket_bounds(orientation: str, px: int, py: int, size: int) -> tuple[int, int, int, int]:
    if orientation == "nw":
        return (px, py, px + size, py + size)
    if orientation == "ne":
        return (px - size, py, px, py + size)
    if orientation == "sw":
        return (px, py - size, px + size, py)
    return (px - size, py - size, px, py)


def shrink_box(box: tuple[int, int, int, int], amount: int) -> tuple[int, int, int, int]:
    left, top, right, bottom = box
    return (left + amount, top + amount, right - amount, bottom - amount)


def add_outer_accent_lights(
    panel: Image.Image,
    pattern: list[str],
    mask: Image.Image,
    rng: random.Random,
    state: str,
) -> Image.Image:
    overlay = Image.new("RGBA", panel.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    edges = find_outer_edges(pattern)
    rng.shuffle(edges)
    accent_count = min(len(edges), max(2, len(filled_cells(pattern)) // 2 + 1))
    alpha = 175 if state in {"ideal", "damaged"} else 115

    for side, x, y in edges[:accent_count]:
        if side in {"top", "bottom"}:
            length = rng.randrange(40, 92)
            inset = rng.randrange(34, max(35, CELL_SIZE - length - 34))
            px = x * CELL_SIZE + inset
            py = y * CELL_SIZE if side == "top" else (y + 1) * CELL_SIZE - 7
            draw.rounded_rectangle((px, py, px + length, py + 7), radius=3, fill=(0, 212, 238, alpha))
            draw.rectangle((px - 2, py + 2, px + length + 2, py + 5), fill=(8, 28, 31, 72))
        else:
            length = rng.randrange(40, 92)
            inset = rng.randrange(34, max(35, CELL_SIZE - length - 34))
            px = x * CELL_SIZE if side == "left" else (x + 1) * CELL_SIZE - 7
            py = y * CELL_SIZE + inset
            draw.rounded_rectangle((px, py, px + 7, py + length), radius=3, fill=(0, 212, 238, alpha))
            draw.rectangle((px + 2, py - 2, px + 5, py + length + 2), fill=(8, 28, 31, 72))

    overlay.putalpha(ImageChops.multiply(overlay.getchannel("A"), mask))
    panel.alpha_composite(overlay)
    return panel


def cut_edge_chip(draw: ImageDraw.ImageDraw, rng: random.Random, side: str, x: int, y: int, state: str) -> None:
    min_depth = 26 if state == "heavyDamage" else 42
    max_depth = 86 if state == "heavyDamage" else 136
    depth = rng.randrange(min_depth, max_depth)
    span = rng.randrange(42, 118 if state == "heavyDamage" else 164)
    offset = rng.randrange(18, CELL_SIZE - 18)
    left = x * CELL_SIZE
    top = y * CELL_SIZE

    if side == "top":
        cx = left + offset
        points = [(cx - span // 2, top - 1), (cx + span // 2, top - 1), (cx + rng.randrange(-18, 19), top + depth)]
    elif side == "bottom":
        cx = left + offset
        bottom = top + CELL_SIZE
        points = [(cx - span // 2, bottom), (cx + span // 2, bottom), (cx + rng.randrange(-18, 19), bottom - depth)]
    elif side == "left":
        cy = top + offset
        points = [(left - 1, cy - span // 2), (left - 1, cy + span // 2), (left + depth, cy + rng.randrange(-18, 19))]
    else:
        cy = top + offset
        right = left + CELL_SIZE
        points = [(right, cy - span // 2), (right, cy + span // 2), (right - depth, cy + rng.randrange(-18, 19))]
    draw.polygon(points, fill=0)


def cut_internal_hole(draw: ImageDraw.ImageDraw, rng: random.Random, x: int, y: int, state: str) -> None:
    cx = x * CELL_SIZE + rng.randrange(45, CELL_SIZE - 45)
    cy = y * CELL_SIZE + rng.randrange(45, CELL_SIZE - 45)
    radius = rng.randrange(22, 74 if state == "heavyDamage" else 108)
    points = []
    for index in range(rng.randrange(7, 12)):
        angle = index / 10 * math.tau + rng.uniform(-0.2, 0.2)
        local_radius = radius * rng.uniform(0.45, 1.12)
        points.append((round(cx + math.cos(angle) * local_radius), round(cy + math.sin(angle) * local_radius)))
    draw.polygon(points, fill=0)


def find_outer_edges(pattern: list[str]) -> list[tuple[str, int, int]]:
    cells = set(filled_cells(pattern))
    edges: list[tuple[str, int, int]] = []
    for x, y in cells:
        if (x, y - 1) not in cells:
            edges.append(("top", x, y))
        if (x, y + 1) not in cells:
            edges.append(("bottom", x, y))
        if (x - 1, y) not in cells:
            edges.append(("left", x, y))
        if (x + 1, y) not in cells:
            edges.append(("right", x, y))
    return edges


def find_outer_edge_runs(pattern: list[str]) -> list[tuple[str, int, int, int]]:
    edges = find_outer_edges(pattern)
    runs: list[tuple[str, int, int, int]] = []
    for side in ("top", "bottom"):
        groups: dict[int, list[int]] = {}
        for edge_side, x, y in edges:
            if edge_side == side:
                groups.setdefault(y, []).append(x)
        for y, xs in groups.items():
            for start, length in consecutive_runs(sorted(xs)):
                runs.append((side, start, y, length))

    for side in ("left", "right"):
        groups: dict[int, list[int]] = {}
        for edge_side, x, y in edges:
            if edge_side == side:
                groups.setdefault(x, []).append(y)
        for x, ys in groups.items():
            for start, length in consecutive_runs(sorted(ys)):
                runs.append((side, x, start, length))
    return runs


def consecutive_runs(values: list[int]) -> list[tuple[int, int]]:
    if not values:
        return []
    runs = []
    start = previous = values[0]
    for value in values[1:]:
        if value == previous + 1:
            previous = value
            continue
        runs.append((start, previous - start + 1))
        start = previous = value
    runs.append((start, previous - start + 1))
    return runs


def find_convex_corners(pattern: list[str]) -> list[tuple[str, int, int]]:
    cells = set(filled_cells(pattern))
    corners: list[tuple[str, int, int]] = []
    for x, y in cells:
        left = (x - 1, y) not in cells
        right = (x + 1, y) not in cells
        top = (x, y - 1) not in cells
        bottom = (x, y + 1) not in cells
        if left and top:
            corners.append(("nw", x * CELL_SIZE, y * CELL_SIZE))
        if right and top:
            corners.append(("ne", (x + 1) * CELL_SIZE, y * CELL_SIZE))
        if left and bottom:
            corners.append(("sw", x * CELL_SIZE, (y + 1) * CELL_SIZE))
        if right and bottom:
            corners.append(("se", (x + 1) * CELL_SIZE, (y + 1) * CELL_SIZE))
    return corners


def find_concave_corners(pattern: list[str]) -> list[tuple[str, int, int]]:
    cells = set(filled_cells(pattern))
    corners: list[tuple[str, int, int]] = []
    width_cells = max(len(row) for row in pattern)
    height_cells = len(pattern)
    for y in range(height_cells + 1):
        for x in range(width_cells + 1):
            nw = (x - 1, y - 1) in cells
            ne = (x, y - 1) in cells
            sw = (x - 1, y) in cells
            se = (x, y) in cells
            count = sum([nw, ne, sw, se])
            if count != 3:
                continue
            if not nw:
                corners.append(("nw", x * CELL_SIZE, y * CELL_SIZE))
            elif not ne:
                corners.append(("ne", x * CELL_SIZE, y * CELL_SIZE))
            elif not sw:
                corners.append(("sw", x * CELL_SIZE, y * CELL_SIZE))
            else:
                corners.append(("se", x * CELL_SIZE, y * CELL_SIZE))
    return corners


def filled_cells(pattern: list[str]) -> list[tuple[int, int]]:
    return [(x, y) for y, row in enumerate(pattern) for x, char in enumerate(row) if char == "+"]


def pattern_pixel_size(pattern: list[str]) -> tuple[int, int]:
    return max(len(row) for row in pattern) * CELL_SIZE, len(pattern) * CELL_SIZE


def seeded_rng(*parts: str) -> random.Random:
    digest = hashlib.sha256(":".join(parts).encode("utf-8")).hexdigest()
    return random.Random(int(digest[:16], 16))


def write_contact_sheet(panel_images: dict[str, dict[str, Image.Image]]) -> None:
    thumb = 150
    padding = 24
    label_h = 24
    width = padding + len(PANELS) * (thumb + padding)
    height = padding + len(STATES) * (thumb + label_h + padding)
    sheet = Image.new("RGBA", (width, height), (6, 9, 13, 255))
    draw = ImageDraw.Draw(sheet)

    for col, (panel_id, _) in enumerate(PANELS):
        for row, state in enumerate(STATES):
            image = fit_thumbnail(panel_images[panel_id][state], thumb)
            x = padding + col * (thumb + padding)
            y = padding + row * (thumb + label_h + padding)
            draw.rectangle((x - 6, y - 6, x + thumb + 6, y + thumb + 6), outline=(38, 50, 59, 255))
            sheet.alpha_composite(image, (x, y))
            draw.text((x, y + thumb + 6), f"{panel_id}:{state}", fill=(155, 180, 190, 255))

    CONTACT_SHEET_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(CONTACT_SHEET_PATH, "PNG", compress_level=1)


def write_edge_pieces_contact_sheet(edge_pieces: list[dict]) -> None:
    preview_pieces = edge_pieces[:96]
    thumb = 84
    padding = 14
    label_h = 18
    columns = 12
    rows = max(1, math.ceil(len(preview_pieces) / columns))
    sheet = Image.new(
        "RGBA",
        (padding + columns * (thumb + padding), padding + rows * (thumb + label_h + padding)),
        (6, 9, 13, 255),
    )
    draw = ImageDraw.Draw(sheet)
    for index, piece in enumerate(preview_pieces):
        col = index % columns
        row = index // columns
        x = padding + col * (thumb + padding)
        y = padding + row * (thumb + label_h + padding)
        image = fit_thumbnail(piece["image"], thumb)
        draw.rectangle((x - 4, y - 4, x + thumb + 4, y + thumb + 4), outline=(38, 50, 59, 255))
        sheet.alpha_composite(image, (x, y))
        draw.text((x, y + thumb + 4), piece["kind"][:9], fill=(155, 180, 190, 255))
    EDGE_PIECES_CONTACT_SHEET_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(EDGE_PIECES_CONTACT_SHEET_PATH, "PNG", compress_level=1)


def fit_thumbnail(image: Image.Image, size: int) -> Image.Image:
    thumb = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = min(size / image.width, size / image.height)
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )
    thumb.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return thumb


def write_manifest(edge_pieces_by_state: dict[str, list[dict]]) -> None:
    manifest = {
        "format": "webp",
        "quality": WEBP_QUALITY,
        "cellSize": CELL_SIZE,
        "states": STATES,
        "exactPanelDimensions": True,
        "panelAssemblyMode": "deterministic pattern mask over generated material",
        "geometrySource": "+/- pattern mask, not image generation",
        "seamlessPanels": True,
        "perspective": "top-down orthographic",
        "edgeElements": {
            "sourceManifest": web_path(REFERENCE_EDGE_MANIFEST_PATH),
            "piecesContactSheet": web_path(EDGE_PIECES_CONTACT_SHEET_PATH),
            "pieceCountByState": {state: len(edge_pieces_by_state[state]) for state in STATES},
            "pieceKindsByState": {state: count_edge_piece_kinds(edge_pieces_by_state[state]) for state in STATES},
            "pieceRolesByState": {state: count_edge_piece_roles(edge_pieces_by_state[state]) for state in STATES},
            "usage": "complete reference edge elements placed flush to panel borders by role: long pieces on long edges, vertical pieces on vertical edges, corner/square pieces on convex and concave corners; source aspect ratios are preserved",
        },
        "materials": {
            state: {
                "source": web_path(SOURCE_DIR / SOURCE_FILES[state]),
                "webp": web_path(MATERIAL_OUT_DIR / f"{state}.webp"),
            }
            for state in STATES
        },
        "panels": {},
        "contactSheet": web_path(CONTACT_SHEET_PATH),
        "validationReport": web_path(VALIDATION_PATH),
    }

    for panel_id, pattern in PANELS:
        width_cells = max(len(row) for row in pattern)
        height_cells = len(pattern)
        manifest["panels"][panel_id] = {
            "pattern": pattern,
            "gridSize": {"width": width_cells, "height": height_cells},
            "pixelSize": {"width": width_cells * CELL_SIZE, "height": height_cells * CELL_SIZE},
            "cells": [{"x": x, "y": y} for x, y in filled_cells(pattern)],
            "states": {
                state: web_path(PANEL_OUT_DIR / state / f"{panel_id}.webp")
                for state in STATES
            },
        }

    write_json(MANIFEST_PATH, manifest)


def count_edge_piece_kinds(edge_pieces: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for piece in edge_pieces:
        counts[piece["kind"]] = counts.get(piece["kind"], 0) + 1
    return counts


def count_edge_piece_roles(edge_pieces: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for piece in edge_pieces:
        counts[piece["role"]] = counts.get(piece["role"], 0) + 1
    return counts


def write_validation_report() -> None:
    results = []
    errors = []
    for panel_id, pattern in PANELS:
        expected_size = pattern_pixel_size(pattern)
        base_mask = make_pattern_mask(pattern)
        outside_mask = ImageChops.invert(base_mask)
        for state in STATES:
            path = PANEL_OUT_DIR / state / f"{panel_id}.webp"
            image = Image.open(path).convert("RGBA")
            alpha = image.getchannel("A")
            size_ok = image.size == expected_size
            outside_alpha = ImageChops.multiply(alpha, outside_mask).getextrema()[1]
            minus_cells_ok = outside_alpha == 0
            coverage = alpha_coverage_inside_mask(alpha, base_mask)
            coverage_ok = coverage >= (0.86 if state in {"ideal", "damaged"} else 0.52)
            ok = size_ok and minus_cells_ok and coverage_ok
            item = {
                "panelId": panel_id,
                "state": state,
                "path": web_path(path),
                "size": {"width": image.width, "height": image.height},
                "expectedSize": {"width": expected_size[0], "height": expected_size[1]},
                "sizeOk": size_ok,
                "minusCellsTransparent": minus_cells_ok,
                "plusCellsCoverage": round(coverage, 4),
                "plusCellsCoverageOk": coverage_ok,
                "ok": ok,
            }
            results.append(item)
            if not ok:
                errors.append(item)

    report = {
        "ok": not errors,
        "cellSize": CELL_SIZE,
        "panelCount": len(PANELS),
        "stateCount": len(STATES),
        "assetCount": len(PANELS) * len(STATES),
        "errors": errors,
        "results": results,
    }
    write_json(VALIDATION_PATH, report)
    if errors:
        raise AssertionError(f"Panel v3 validation failed: {len(errors)} errors")


def alpha_coverage_inside_mask(alpha: Image.Image, mask: Image.Image) -> float:
    alpha_pixels = alpha.load()
    mask_pixels = mask.load()
    covered = 0
    total = 0
    for y in range(alpha.height):
        for x in range(alpha.width):
            if mask_pixels[x, y] == 255:
                total += 1
                if alpha_pixels[x, y] > 0:
                    covered += 1
    return covered / total if total else 0


def save_webp(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=WEBP_QUALITY, lossless=False, method=6, exact=True)


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def web_path(path: Path) -> str:
    return "/" + str(path.relative_to(ROOT / "public"))


if __name__ == "__main__":
    main()
