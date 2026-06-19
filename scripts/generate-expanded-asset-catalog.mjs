import fs from "node:fs/promises";
import sharp from "sharp";

const outDir = "public/assets/generated";
const moduleCell = 192;
const frameCell = 256;
const columns = 12;
const states = ["ideal", "light_damage", "heavy_damage", "debris"];

const hull = [
  ["hull_block_1x1_center", [1, 1]],
  ["hull_block_1x1_edge_top", [1, 1]],
  ["hull_block_1x1_edge_bottom", [1, 1]],
  ["hull_block_1x1_edge_left", [1, 1]],
  ["hull_block_1x1_edge_right", [1, 1]],
  ["hull_block_1x1_corner_top_left", [1, 1]],
  ["hull_block_1x1_corner_top_right", [1, 1]],
  ["hull_block_1x1_corner_bottom_left", [1, 1]],
  ["hull_block_1x1_corner_bottom_right", [1, 1]],
  ["hull_block_1x2_bridge", [1, 2]],
  ["hull_block_2x1_bridge", [2, 1]],
  ["hull_block_2x2_core_plate", [2, 2]],
  ["hull_block_3x1_spine", [3, 1]],
  ["hull_block_1x3_spine", [1, 3]],
  ["hull_nose_1x1", [1, 1]],
  ["hull_nose_2x1", [2, 1]],
  ["hull_tail_1x1", [1, 1]],
  ["hull_tail_2x1", [2, 1]],
  ["hull_wing_left_1x2", [1, 2]],
  ["hull_wing_right_1x2", [1, 2]],
  ["hull_wing_left_2x2", [2, 2]],
  ["hull_wing_right_2x2", [2, 2]]
].map(([id, grid]) => moduleAsset(id, "hull", grid));

const armor = [
  "armor_light_plate_1x1",
  "armor_medium_plate_1x1",
  "armor_heavy_plate_1x1",
  "armor_heavy_plate_2x1",
  "armor_heavy_plate_1x2",
  "armor_corner_plate_left",
  "armor_corner_plate_right",
  "armor_front_shield_plate",
  "armor_reactive_plate",
  "armor_anti_laser_plate",
  "armor_heat_resistant_plate",
  "armor_damaged_variant"
].map((id) => moduleAsset(id, "armor", id.includes("2x1") ? [2, 1] : id.includes("1x2") ? [1, 2] : [1, 1]));

const engines = [
  ["engine_ion_light_1x1", [1, 1], "blue"],
  ["engine_ion_light_1x2", [1, 2], "blue"],
  ["engine_plasma_medium_1x2", [1, 2], "purple"],
  ["engine_plasma_medium_2x1", [2, 1], "purple"],
  ["engine_fusion_heavy_2x2", [2, 2], "orange"],
  ["engine_fusion_heavy_3x2", [3, 2], "orange"],
  ["engine_side_thruster_left_1x1", [1, 1], "orange"],
  ["engine_side_thruster_right_1x1", [1, 1], "orange"],
  ["engine_reverse_thruster_1x1", [1, 1], "blue"],
  ["engine_dark_matter_2x2", [2, 2], "purple"],
  ["engine_alien_1x2", [1, 2], "green"],
  ["engine_damaged_variant", [1, 1], "orange"]
].map(([id, grid, glow]) => moduleAsset(id, "engine", grid, { engineVfx: engineVfx(id, glow) }));

const weaponIds = [
  ["weapon_autocannon_1x1", [1, 1]],
  ["weapon_dual_autocannon_1x1", [1, 1]],
  ["weapon_railgun_1x2", [1, 2]],
  ["weapon_heavy_railgun_2x1", [2, 1]],
  ["weapon_laser_turret_1x1", [1, 1]],
  ["weapon_plasma_cannon_1x1", [1, 1]],
  ["weapon_heavy_plasma_cannon_2x2", [2, 2]],
  ["weapon_missile_pod_1x1", [1, 1]],
  ["weapon_missile_pod_1x2", [1, 2]],
  ["weapon_flak_turret_1x1", [1, 1]],
  ["weapon_emp_emitter_1x1", [1, 1]],
  ["weapon_arc_lightning_emitter_1x1", [1, 1]],
  ["weapon_point_defense_1x1", [1, 1]],
  ["weapon_drone_bay_2x2", [2, 2]]
];
const weapons = weaponIds.flatMap(([id, grid]) => [
  moduleAsset(`${id}_base`, "weapon_base", grid),
  moduleAsset(`${id}_turret`, "weapon_turret", grid)
]);

const energy = [
  ["reactor_small_1x1", [1, 1]],
  ["reactor_medium_2x2", [2, 2]],
  ["reactor_heavy_2x2", [2, 2]],
  ["battery_pack_1x1", [1, 1]],
  ["capacitor_1x1", [1, 1]],
  ["energy_stabilizer_1x2", [1, 2]],
  ["heat_sink_1x1", [1, 1]],
  ["radiator_panel_1x2", [1, 2]],
  ["emergency_generator_1x1", [1, 1]]
].map(([id, grid]) => moduleAsset(id, "energy", grid));

const shields = [
  ["shield_generator_1x1", [1, 1]],
  ["shield_generator_2x2", [2, 2]],
  ["point_defense_module_1x1", [1, 1]],
  ["repair_nanobay_1x1", [1, 1]],
  ["decoy_launcher_1x1", [1, 1]],
  ["armor_field_projector_1x1", [1, 1]],
  ["emergency_barrier_module_1x1", [1, 1]]
].map(([id, grid]) => moduleAsset(id, "shield", grid));

const moduleAssets = [...hull, ...armor, ...engines, ...weapons, ...energy, ...shields];

const frameAssets = [
  ["scout_frame_5x7", [5, 7], "player"],
  ["raider_frame_7x9", [7, 9], "player"],
  ["frigate_frame_9x11", [9, 11], "player"],
  ["carrier_frame_11x13", [11, 13], "player"],
  ["micro_drone_frame_3x3", [3, 3], "enemy"],
  ["drone_frame_3x5", [3, 5], "enemy"],
  ["light_raider_frame_4x5", [4, 5], "enemy"],
  ["bomber_frame_5x5", [5, 5], "enemy"],
  ["sniper_frame_3x6", [3, 6], "enemy"],
  ["guard_frame_5x6", [5, 6], "enemy"]
].flatMap(([id, grid, owner]) => {
  const variants = owner === "player"
    ? ["blueprint", "hangar_dark", "cell_available", "cell_blocked", "cell_selected", "placement_error", "placement_valid"]
    : ["blueprint", "hangar_dark"];
  return variants.map((variant) => ({ id: `${id}_${variant}`, frameId: id, owner, variant, grid }));
});

const vfxAssets = [
  "engine_glow_small_blue",
  "engine_glow_medium_blue",
  "engine_glow_large_blue",
  "engine_glow_orange",
  "engine_glow_purple",
  "engine_plume_short",
  "engine_plume_medium",
  "engine_plume_long",
  "engine_ignition_flash",
  "engine_overdrive_plume",
  "side_thruster_burst",
  "reverse_thruster_burst",
  "bullet_kinetic_small",
  "bullet_kinetic_large",
  "railgun_beam_line",
  "laser_beam_core",
  "laser_beam_outer_glow",
  "plasma_projectile_small",
  "plasma_projectile_large",
  "missile_projectile",
  "missile_smoke_trail",
  "emp_wave_ring",
  "electric_arc_segment",
  "flak_projectile",
  "hit_spark_small",
  "hit_spark_medium",
  "hit_spark_large",
  "shield_hit_ring",
  "armor_hit_flash",
  "laser_burn_mark",
  "plasma_splash",
  "emp_hit_electric_noise",
  "missile_impact_flash",
  "debris_spark_burst",
  "explosion_small_sprite_sheet",
  "explosion_medium_sprite_sheet",
  "explosion_large_sprite_sheet",
  "reactor_explosion_sprite_sheet",
  "plasma_explosion_sprite_sheet",
  "missile_explosion_sprite_sheet",
  "shockwave_ring",
  "smoke_puff_small",
  "smoke_puff_large",
  "burning_debris_chunk",
  "metal_fragment_01",
  "metal_fragment_02",
  "metal_fragment_03",
  "metal_fragment_04"
].map((id) => ({ id, frames: id.includes("sprite_sheet") ? 4 : 1 }));

await fs.mkdir(outDir, { recursive: true });
const modulesManifest = await renderModuleAtlas();
const framesManifest = await renderFrameAtlas();
const vfxManifest = await renderVfxAtlas();

const catalog = {
  generatedAt: new Date().toISOString(),
  style: "top-down orthographic dark titanium sci-fi modular assets",
  modules: modulesManifest,
  frames: framesManifest,
  vfx: vfxManifest
};

await fs.writeFile(`${outDir}/asset-catalog.json`, `${JSON.stringify(catalog, null, 2)}\n`);

async function renderModuleAtlas() {
  const baseRows = Math.ceil(moduleAssets.length / columns);
  const width = columns * moduleCell;
  const height = baseRows * states.length * moduleCell;
  const composites = [];
  const manifest = {
    src: "/assets/generated/module-catalog-states-atlas.png",
    columns,
    rows: baseRows * states.length,
    cellWidth: moduleCell,
    cellHeight: moduleCell,
    states,
    assets: {}
  };

  for (const [assetIndex, asset] of moduleAssets.entries()) {
    const baseRow = Math.floor(assetIndex / columns);
    const col = assetIndex % columns;
    manifest.assets[asset.id] = {
      category: asset.category,
      grid: asset.grid,
      col,
      row: baseRow,
      states: Object.fromEntries(states.map((state, stateIndex) => [state, { col, row: stateIndex * baseRows + baseRow }])),
      engineVfx: asset.engineVfx
    };
    for (const [stateIndex, state] of states.entries()) {
      composites.push({
        input: Buffer.from(spriteSvg(asset, state, moduleCell, assetIndex)),
        left: col * moduleCell,
        top: (stateIndex * baseRows + baseRow) * moduleCell
      });
    }
  }

  await blank(width, height).composite(composites).png().toFile(`${outDir}/module-catalog-states-atlas.png`);
  await fs.writeFile(`${outDir}/module-catalog-states-atlas.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function renderFrameAtlas() {
  const rows = Math.ceil(frameAssets.length / columns);
  const width = columns * frameCell;
  const height = rows * frameCell;
  const composites = [];
  const manifest = {
    src: "/assets/generated/frame-catalog-atlas.png",
    columns,
    rows,
    cellWidth: frameCell,
    cellHeight: frameCell,
    assets: {}
  };

  for (const [index, frame] of frameAssets.entries()) {
    const row = Math.floor(index / columns);
    const col = index % columns;
    manifest.assets[frame.id] = { frameId: frame.frameId, owner: frame.owner, variant: frame.variant, grid: frame.grid, col, row };
    composites.push({
      input: Buffer.from(frameSvg(frame, frameCell)),
      left: col * frameCell,
      top: row * frameCell
    });
  }

  await blank(width, height).composite(composites).png().toFile(`${outDir}/frame-catalog-atlas.png`);
  await fs.writeFile(`${outDir}/frame-catalog-atlas.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function renderVfxAtlas() {
  const rows = Math.ceil(vfxAssets.length / columns);
  const width = columns * moduleCell;
  const height = rows * moduleCell;
  const composites = [];
  const manifest = {
    src: "/assets/generated/vfx-catalog-atlas.png",
    columns,
    rows,
    cellWidth: moduleCell,
    cellHeight: moduleCell,
    assets: {}
  };

  for (const [index, asset] of vfxAssets.entries()) {
    const row = Math.floor(index / columns);
    const col = index % columns;
    manifest.assets[asset.id] = { col, row, frames: asset.frames };
    composites.push({
      input: Buffer.from(vfxSvg(asset, moduleCell, index)),
      left: col * moduleCell,
      top: row * moduleCell
    });
  }

  await blank(width, height).composite(composites).png().toFile(`${outDir}/vfx-catalog-atlas.png`);
  await fs.writeFile(`${outDir}/vfx-catalog-atlas.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function moduleAsset(id, category, grid, extra = {}) {
  return { id, category, grid, ...extra };
}

function engineVfx(id, glow) {
  const direction = id.includes("reverse") ? "front" : id.includes("side_thruster_left") ? "left" : id.includes("side_thruster_right") ? "right" : "rear";
  return {
    nozzle: direction === "front" ? [0.5, 0.18] : direction === "left" ? [0.18, 0.5] : direction === "right" ? [0.82, 0.5] : [0.5, 0.82],
    flameDirection: direction,
    glowColor: glow,
    plumeSize: id.includes("heavy") || id.includes("dark_matter") ? "large" : id.includes("medium") ? "medium" : "small",
    ignitionStrength: id.includes("heavy") ? 0.95 : id.includes("medium") ? 0.72 : 0.48
  };
}

function blank(width, height) {
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
}

function spriteSvg(asset, state, size, seed) {
  const cx = size / 2;
  const cy = size / 2;
  const category = asset.category;
  const palette = {
    hull: ["#1b2532", "#2e3d4e", "#63d9ff"],
    armor: ["#202630", "#48515e", "#8ad7ff"],
    engine: ["#172332", "#2c4053", asset.engineVfx?.glowColor === "orange" ? "#ff9a34" : asset.engineVfx?.glowColor === "purple" ? "#9d6cff" : asset.engineVfx?.glowColor === "green" ? "#71ffbe" : "#4ddfff"],
    weapon_base: ["#1c2633", "#354559", "#ffcb75"],
    weapon_turret: ["#182231", "#3a4c5f", "#69e4ff"],
    energy: ["#172330", "#304358", "#59f5ff"],
    shield: ["#172433", "#31495d", "#79eaff"]
  }[category] ?? ["#1c2633", "#354559", "#63d9ff"];
  const opacity = state === "debris" ? 0.72 : 1;
  const base = state === "heavy_damage" ? "#151a21" : state === "debris" ? "#10151d" : palette[0];
  const accent = state === "heavy_damage" || state === "debris" ? "#ff7a34" : palette[2];
  const [gw, gh] = asset.grid;
  const wide = gw > gh;
  const tall = gh > gw;
  const bodyW = wide ? 142 : tall ? 88 : 112;
  const bodyH = tall ? 142 : wide ? 88 : 112;
  const isWingLeft = asset.id.includes("wing_left");
  const isWingRight = asset.id.includes("wing_right");
  const isNose = asset.id.includes("nose");
  const isTail = asset.id.includes("tail");
  const damage = damageOverlay(state, size, seed);
  const bodyShape = isWingLeft
    ? `<polygon points="${cx + 34},${cy - 68} ${cx + 54},${cy + 68} ${cx - 58},${cy + 32} ${cx - 38},${cy - 44}" fill="${base}" stroke="${palette[1]}" stroke-width="5"/>`
    : isWingRight
      ? `<polygon points="${cx - 34},${cy - 68} ${cx - 54},${cy + 68} ${cx + 58},${cy + 32} ${cx + 38},${cy - 44}" fill="${base}" stroke="${palette[1]}" stroke-width="5"/>`
      : isNose
        ? `<polygon points="${cx},${cy - 72} ${cx + 58},${cy + 50} ${cx - 58},${cy + 50}" fill="${base}" stroke="${palette[1]}" stroke-width="5"/>`
        : isTail
          ? `<polygon points="${cx - 58},${cy - 48} ${cx + 58},${cy - 48} ${cx + 40},${cy + 66} ${cx - 40},${cy + 66}" fill="${base}" stroke="${palette[1]}" stroke-width="5"/>`
          : `<rect x="${cx - bodyW / 2}" y="${cy - bodyH / 2}" width="${bodyW}" height="${bodyH}" rx="14" fill="${base}" stroke="${palette[1]}" stroke-width="5"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <g opacity="${opacity}">
      ${bodyShape}
      ${panelLines(cx, cy, bodyW, bodyH, palette[1], category, seed)}
      ${categoryDetails(asset, cx, cy, accent)}
      ${connectors(cx, cy, bodyW, bodyH, category)}
      ${damage}
    </g>
  </svg>`;
}

function panelLines(cx, cy, w, h, color, category, seed) {
  const lines = [];
  for (let i = 0; i < 4; i += 1) {
    const x = cx - w * 0.32 + i * w * 0.21 + rand(seed, i) * 4;
    lines.push(`<line x1="${x.toFixed(1)}" y1="${(cy - h * 0.34).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(cy + h * 0.34).toFixed(1)}" stroke="${color}" stroke-opacity="0.5" stroke-width="2"/>`);
  }
  if (category === "armor") {
    lines.push(`<rect x="${cx - w * 0.3}" y="${cy - h * 0.3}" width="${w * 0.6}" height="${h * 0.6}" rx="8" fill="none" stroke="${color}" stroke-opacity="0.62" stroke-width="3"/>`);
  }
  return lines.join("");
}

function categoryDetails(asset, cx, cy, accent) {
  if (asset.category === "engine") {
    return `<circle cx="${cx}" cy="${cy + 42}" r="24" fill="#06111c" stroke="${accent}" stroke-opacity="0.85" stroke-width="5"/><ellipse cx="${cx}" cy="${cy + 48}" rx="16" ry="28" fill="${accent}" fill-opacity="0.35"/>`;
  }
  if (asset.category === "weapon_turret") {
    const barrel = asset.id.includes("missile") ? `<rect x="${cx - 34}" y="${cy - 48}" width="68" height="54" rx="8" fill="#111a25" stroke="${accent}" stroke-opacity="0.7" stroke-width="3"/>` : `<rect x="${cx - 8}" y="${cy - 72}" width="16" height="86" rx="6" fill="#111a25" stroke="${accent}" stroke-opacity="0.65" stroke-width="3"/>`;
    return `<circle cx="${cx}" cy="${cy + 10}" r="32" fill="#141f2b" stroke="${accent}" stroke-opacity="0.55" stroke-width="4"/>${barrel}`;
  }
  if (asset.category === "weapon_base") {
    return `<circle cx="${cx}" cy="${cy}" r="36" fill="#121b26" stroke="${accent}" stroke-opacity="0.58" stroke-width="4"/>`;
  }
  if (asset.category === "energy") {
    return `<circle cx="${cx}" cy="${cy}" r="32" fill="#07131c" stroke="${accent}" stroke-opacity="0.75" stroke-width="5"/><circle cx="${cx}" cy="${cy}" r="15" fill="${accent}" fill-opacity="0.55"/>`;
  }
  if (asset.category === "shield") {
    return `<circle cx="${cx}" cy="${cy}" r="38" fill="none" stroke="${accent}" stroke-opacity="0.7" stroke-width="5"/><circle cx="${cx}" cy="${cy}" r="12" fill="${accent}" fill-opacity="0.45"/>`;
  }
  return `<line x1="${cx - 34}" y1="${cy}" x2="${cx + 34}" y2="${cy}" stroke="${accent}" stroke-opacity="0.5" stroke-width="3"/>`;
}

function connectors(cx, cy, w, h, category) {
  if (category === "weapon_turret") return "";
  const fill = "#0d1520";
  return `<rect x="${cx - 16}" y="${cy - h / 2 - 8}" width="32" height="14" rx="4" fill="${fill}"/>
    <rect x="${cx - 16}" y="${cy + h / 2 - 6}" width="32" height="14" rx="4" fill="${fill}"/>
    <rect x="${cx - w / 2 - 8}" y="${cy - 16}" width="14" height="32" rx="4" fill="${fill}"/>
    <rect x="${cx + w / 2 - 6}" y="${cy - 16}" width="14" height="32" rx="4" fill="${fill}"/>`;
}

function damageOverlay(state, size, seed) {
  if (state === "ideal") return "";
  const count = state === "light_damage" ? 5 : state === "heavy_damage" ? 10 : 14;
  const parts = [];
  for (let i = 0; i < count; i += 1) {
    const x = 45 + rand(seed + 17, i) * (size - 90);
    const y = 45 + rand(seed + 31, i) * (size - 90);
    const len = 18 + rand(seed + 43, i) * 26;
    const angle = rand(seed + 59, i) * Math.PI * 2;
    parts.push(`<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + Math.cos(angle) * len).toFixed(1)}" y2="${(y + Math.sin(angle) * len).toFixed(1)}" stroke="#03070c" stroke-opacity="0.78" stroke-width="${state === "light_damage" ? 3 : 5}" stroke-linecap="round"/>`);
    if (state !== "light_damage" && i % 3 === 0) parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#ff7734" fill-opacity="0.38"/>`);
  }
  return parts.join("");
}

function frameSvg(frame, size) {
  const [gw, gh] = frame.grid;
  const pad = 28;
  const cell = Math.min((size - pad * 2) / gw, (size - pad * 2) / gh);
  const ox = (size - gw * cell) / 2;
  const oy = (size - gh * cell) / 2;
  const color = frame.variant.includes("error") ? "#ff596a" : frame.variant.includes("valid") ? "#65ffb8" : frame.variant.includes("selected") ? "#ffffff" : "#55d9ff";
  const alpha = frame.variant === "hangar_dark" ? 0.12 : 0.28;
  const cells = [];
  for (let y = 0; y < gh; y += 1) {
    for (let x = 0; x < gw; x += 1) {
      const blocked = frame.variant === "cell_blocked" && (x + y) % 3 === 0;
      cells.push(`<rect x="${ox + x * cell}" y="${oy + y * cell}" width="${cell - 2}" height="${cell - 2}" rx="4" fill="${blocked ? "#2b1218" : "#0b1624"}" fill-opacity="${blocked ? 0.7 : alpha}" stroke="${blocked ? "#ff596a" : color}" stroke-opacity="${blocked ? 0.6 : 0.34}" stroke-width="1.5"/>`);
    }
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="none"/>${cells.join("")}<rect x="${ox}" y="${oy}" width="${gw * cell}" height="${gh * cell}" rx="10" fill="none" stroke="${color}" stroke-opacity="0.5" stroke-width="3"/></svg>`;
}

function vfxSvg(asset, size, seed) {
  const id = asset.id;
  if (asset.frames > 1) {
    const frameW = size / 4;
    const frames = [0, 1, 2, 3].map((i) => `<circle cx="${frameW * i + frameW / 2}" cy="${size / 2}" r="${18 + i * 14}" fill="#ff8a2a" fill-opacity="${0.75 - i * 0.13}"/><circle cx="${frameW * i + frameW / 2}" cy="${size / 2}" r="${8 + i * 8}" fill="#fff4c5" fill-opacity="${0.9 - i * 0.15}"/>`);
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${frames.join("")}</svg>`;
  }
  const color = id.includes("purple") || id.includes("plasma") || id.includes("emp") ? "#9d6cff" : id.includes("orange") || id.includes("explosion") || id.includes("spark") || id.includes("missile") ? "#ff8a2a" : "#55dfff";
  if (id.includes("beam") || id.includes("line") || id.includes("arc")) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><line x1="24" y1="${size / 2}" x2="${size - 24}" y2="${size / 2}" stroke="${color}" stroke-width="10" stroke-opacity="0.32"/><line x1="30" y1="${size / 2}" x2="${size - 30}" y2="${size / 2}" stroke="#ffffff" stroke-width="3" stroke-opacity="0.8"/></svg>`;
  }
  if (id.includes("ring") || id.includes("wave")) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="56" fill="none" stroke="${color}" stroke-width="8" stroke-opacity="0.5"/><circle cx="${size / 2}" cy="${size / 2}" r="34" fill="none" stroke="#ffffff" stroke-width="2" stroke-opacity="0.45"/></svg>`;
  }
  const parts = [];
  for (let i = 0; i < 18; i += 1) {
    const angle = rand(seed, i) * Math.PI * 2;
    const r = 10 + rand(seed + 7, i) * 54;
    parts.push(`<circle cx="${size / 2 + Math.cos(angle) * r}" cy="${size / 2 + Math.sin(angle) * r}" r="${2 + rand(seed + 13, i) * 5}" fill="${i % 4 === 0 ? "#ffffff" : color}" fill-opacity="${0.35 + rand(seed + 19, i) * 0.55}"/>`);
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

function rand(seed, index) {
  const value = Math.sin(seed * 9301 + index * 49297) * 233280;
  return value - Math.floor(value);
}
