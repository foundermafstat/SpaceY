import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const moduleSpritesPath = path.join(root, "game/assets/moduleSprites.ts");
const source = fs.readFileSync(moduleSpritesPath, "utf8");
const assetPaths = [...source.matchAll(/src:\s*"([^"]+)"/g)].map((match) => match[1]);
const requiredPaths = [
  ...assetPaths,
  "/assets/panels/panel-states-atlas.png",
  "/assets/panels-v3/manifest.json",
  "/assets/panels-v3/validation-report.json"
];
const panelStates = ["ideal", "damaged", "heavyDamage", "debris"];
const cabinStates = ["ideal", "damaged", "heavyDamage", "debris"];
const panelNames = [
  "single_1",
  "bar_2h",
  "bar_2v",
  "bar_3h",
  "bar_4h",
  "block_2x2",
  "corner_l_2x2",
  "tee_3x2",
  "cross_3x3",
  "long_l_3x3",
  "zig_3x3",
  "c_2x3",
  "long_corner_2x3",
  "block_tail_2x3"
];
const cabinNames = [
  "cabin_1x1",
  "cabin_1x2",
  "cabin_2x1",
  "cabin_3x1",
  "cabin_2x2",
  "cabin_t_3x2",
  "cabin_cross_3x3",
  "cabin_u_3x2",
  "cabin_block_3x2",
  "cabin_notch_3x2",
  "cabin_zig_3x2"
];

const missing = [];
requiredPaths.push("/assets/cabins-v2/manifest.json", "/assets/cabins-v2/validation-report.json");

for (const assetPath of requiredPaths) {
  if (!fs.existsSync(path.join(root, "public", assetPath))) {
    missing.push(assetPath);
  }
}

for (const state of panelStates) {
  for (const panel of panelNames) {
    const assetPath = `/assets/panels-v3/panels/${state}/${panel}.webp`;
    if (!fs.existsSync(path.join(root, "public", assetPath))) {
      missing.push(assetPath);
    }
  }
}

for (const state of cabinStates) {
  for (const cabin of cabinNames) {
    const assetPath = `/assets/cabins-v2/cabins/${state}/${cabin}.webp`;
    if (!fs.existsSync(path.join(root, "public", assetPath))) {
      missing.push(assetPath);
    }
  }
}

if (missing.length > 0) {
  console.error(`Missing ${missing.length} asset(s):`);
  missing.forEach((assetPath) => console.error(`- ${assetPath}`));
  process.exit(1);
}

console.log(
  `Asset pipeline OK: ${requiredPaths.length + panelStates.length * panelNames.length + cabinStates.length * cabinNames.length} paths checked.`
);
