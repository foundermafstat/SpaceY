import fs from "node:fs/promises";
import sharp from "sharp";

const input = "public/assets/generated/ai/module-ai-sheet.png";
const output = "public/assets/generated/ai/module-ai-normalized-atlas.png";
const manifestPath = "public/assets/generated/ai/module-ai-normalized-atlas.json";
const cell = 192;
const columns = 12;

const image = sharp(input).ensureAlpha();
const { width = 0, height = 0 } = await image.metadata();
const data = await image.raw().toBuffer();
const visited = new Uint8Array(width * height);
const components = [];

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    if (visited[index] || alphaAt(x, y) < 32) continue;
    const component = floodFill(x, y);
    if (component.count > 350 && component.width > 12 && component.height > 12) {
      components.push(component);
    }
  }
}

components.sort((a, b) => a.centerY - b.centerY);
const rows = [];
for (const component of components) {
  const row = rows.find((items) => Math.abs(items[0].centerY - component.centerY) < 58);
  if (row) row.push(component);
  else rows.push([component]);
}
rows.forEach((items) => items.sort((a, b) => a.centerX - b.centerX));
const ordered = rows.flat();

const atlasRows = Math.ceil(ordered.length / columns);
const composites = [];
const assets = {};
for (const [index, component] of ordered.entries()) {
  const col = index % columns;
  const row = Math.floor(index / columns);
  const extract = {
    left: component.minX,
    top: component.minY,
    width: component.width,
    height: component.height
  };
  const maxSide = Math.max(component.width, component.height);
  const scale = Math.min(1, 164 / maxSide);
  const resizedWidth = Math.round(component.width * scale);
  const resizedHeight = Math.round(component.height * scale);
  const buffer = await image
    .clone()
    .extract(extract)
    .resize(resizedWidth, resizedHeight, { fit: "contain" })
    .png()
    .toBuffer();
  composites.push({
    input: buffer,
    left: col * cell + Math.round((cell - resizedWidth) / 2),
    top: row * cell + Math.round((cell - resizedHeight) / 2)
  });
  assets[`ai_module_${index.toString().padStart(3, "0")}`] = {
    col,
    row,
    sourceBounds: extract,
    sourceCenter: [Math.round(component.centerX), Math.round(component.centerY)]
  };
}

await sharp({
  create: {
    width: columns * cell,
    height: atlasRows * cell,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  }
})
  .composite(composites)
  .png()
  .toFile(output);

await fs.writeFile(
  manifestPath,
  `${JSON.stringify({ src: "/assets/generated/ai/module-ai-normalized-atlas.png", columns, rows: atlasRows, cellWidth: cell, cellHeight: cell, assets }, null, 2)}\n`
);

function alphaAt(x, y) {
  return data[(y * width + x) * 4 + 3];
}

function floodFill(startX, startY) {
  const stack = [[startX, startY]];
  visited[startY * width + startX] = 1;
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  let count = 0;

  while (stack.length > 0) {
    const [x, y] = stack.pop();
    count += 1;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);

    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1]
    ]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const index = ny * width + nx;
      if (visited[index] || alphaAt(nx, ny) < 32) continue;
      visited[index] = 1;
      stack.push([nx, ny]);
    }
  }

  const componentWidth = maxX - minX + 1;
  const componentHeight = maxY - minY + 1;
  return {
    minX,
    minY,
    width: componentWidth,
    height: componentHeight,
    count,
    centerX: minX + componentWidth / 2,
    centerY: minY + componentHeight / 2
  };
}
