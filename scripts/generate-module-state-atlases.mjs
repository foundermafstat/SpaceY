import fs from "node:fs/promises";
import sharp from "sharp";

const assets = [
  {
    input: "public/assets/modules/modules-atlas-v2.png",
    output: "public/assets/modules/module-states-atlas.png",
    columns: 4,
    rows: 3
  },
  {
    input: "public/assets/weapons/weapon-parts-atlas.png",
    output: "public/assets/weapons/weapon-states-atlas.png",
    columns: 4,
    rows: 2
  }
];

await fs.mkdir("public/assets/modules", { recursive: true });
await fs.mkdir("public/assets/weapons", { recursive: true });

for (const asset of assets) {
  await generateStateAtlas(asset);
}

async function generateStateAtlas({ input, output, columns, rows }) {
  const source = sharp(input).ensureAlpha();
  const { width = 0, height = 0 } = await source.metadata();
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const sourceBuffer = await source.png().toBuffer();
  const states = await Promise.all([
    sharp(sourceBuffer).png().toBuffer(),
    makeLightDamage(sourceBuffer, width, height, cellWidth, cellHeight, columns, rows),
    makeHeavyDamage(sourceBuffer, width, height, cellWidth, cellHeight, columns, rows),
    makeDebris(sourceBuffer, width, height, cellWidth, cellHeight, columns, rows)
  ]);

  await sharp({
    create: {
      width,
      height: height * states.length,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(states.map((input, index) => ({ input, top: index * height, left: 0 })))
    .png()
    .toFile(output);
}

async function makeLightDamage(input, width, height, cellWidth, cellHeight, columns, rows) {
  return sharp(input)
    .modulate({ brightness: 0.92, saturation: 0.82 })
    .composite([{ input: svgOverlay(width, height, cellWidth, cellHeight, columns, rows, "light"), blend: "over" }])
    .png()
    .toBuffer();
}

async function makeHeavyDamage(input, width, height, cellWidth, cellHeight, columns, rows) {
  return sharp(input)
    .modulate({ brightness: 0.68, saturation: 0.62 })
    .composite([{ input: svgOverlay(width, height, cellWidth, cellHeight, columns, rows, "heavy"), blend: "over" }])
    .png()
    .toBuffer();
}

async function makeDebris(input, width, height, cellWidth, cellHeight, columns, rows) {
  return sharp(input)
    .modulate({ brightness: 0.48, saturation: 0.45 })
    .composite([
      { input: svgCutouts(width, height, cellWidth, cellHeight, columns, rows), blend: "dest-out" },
      { input: svgOverlay(width, height, cellWidth, cellHeight, columns, rows, "debris"), blend: "over" }
    ])
    .png()
    .toBuffer();
}

function svgOverlay(width, height, cellWidth, cellHeight, columns, rows, mode) {
  const parts = [
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`
  ];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const cx = col * cellWidth;
      const cy = row * cellHeight;
      const seed = row * columns + col + 1;
      const count = mode === "light" ? 5 : mode === "heavy" ? 10 : 12;
      const burnCount = mode === "light" ? 1 : mode === "heavy" ? 4 : 6;
      for (let i = 0; i < count; i += 1) {
        const x = cx + cellWidth * (0.2 + random(seed, i) * 0.6);
        const y = cy + cellHeight * (0.2 + random(seed + 9, i) * 0.6);
        const len = cellWidth * (0.08 + random(seed + 17, i) * 0.14);
        const angle = random(seed + 33, i) * Math.PI;
        const x2 = x + Math.cos(angle) * len;
        const y2 = y + Math.sin(angle) * len;
        parts.push(
          `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#101722" stroke-opacity="${mode === "light" ? 0.45 : 0.7}" stroke-width="${mode === "light" ? 3 : 5}" stroke-linecap="round"/>`
        );
        if (mode !== "light" && i % 3 === 0) {
          parts.push(
            `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#ff7a2c" stroke-opacity="0.34" stroke-width="1.6" stroke-linecap="round"/>`
          );
        }
      }
      for (let i = 0; i < burnCount; i += 1) {
        const x = cx + cellWidth * (0.25 + random(seed + 51, i) * 0.5);
        const y = cy + cellHeight * (0.24 + random(seed + 71, i) * 0.52);
        const r = Math.min(cellWidth, cellHeight) * (mode === "light" ? 0.035 : 0.055 + random(seed + 85, i) * 0.04);
        parts.push(
          `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="#03060a" fill-opacity="${mode === "light" ? 0.32 : 0.62}"/>`
        );
      }
    }
  }
  parts.push("</svg>");
  return Buffer.from(parts.join(""));
}

function svgCutouts(width, height, cellWidth, cellHeight, columns, rows) {
  const parts = [
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`
  ];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const cx = col * cellWidth;
      const cy = row * cellHeight;
      const seed = row * columns + col + 1;
      for (let i = 0; i < 4; i += 1) {
        const x = cx + cellWidth * (0.18 + random(seed + 101, i) * 0.62);
        const y = cy + cellHeight * (0.18 + random(seed + 121, i) * 0.62);
        const w = cellWidth * (0.07 + random(seed + 141, i) * 0.07);
        const h = cellHeight * (0.06 + random(seed + 161, i) * 0.08);
        parts.push(`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${w.toFixed(1)}" ry="${h.toFixed(1)}" fill="#000" fill-opacity="0.75" transform="rotate(${Math.round(random(seed + 181, i) * 180)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`);
      }
    }
  }
  parts.push("</svg>");
  return Buffer.from(parts.join(""));
}

function random(seed, index) {
  const value = Math.sin(seed * 1000 + index * 97.13) * 10000;
  return value - Math.floor(value);
}
