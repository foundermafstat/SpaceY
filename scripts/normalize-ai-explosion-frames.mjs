import fs from "node:fs/promises";
import sharp from "sharp";

const input = "public/assets/generated/ai/vfx-ai-sheet.png";
const output = "public/assets/generated/ai/explosion-ai-effects-atlas.png";
const manifestPath = "public/assets/generated/ai/explosion-ai-effects-atlas.json";
const cell = 256;
const columns = 9;

const image = sharp(input).ensureAlpha();
const { width = 0, height = 0 } = await image.metadata();
const data = await image.raw().toBuffer();
const visited = new Uint8Array(width * height);
const components = [];

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    if (visited[index] || alphaAt(x, y) < 24) continue;
    const component = floodFill(x, y);
    if (component.count > 600 && component.width > 24 && component.height > 24) {
      components.push(component);
    }
  }
}

const specs = [
  { id: "small", minY: 400, maxY: 470, maxX: 560 },
  { id: "medium", minY: 500, maxY: 570, maxX: 1160 },
  { id: "large", minY: 600, maxY: 670, maxX: 1120 },
  { id: "plasma", minY: 700, maxY: 780, maxX: 1280 },
  { id: "smoke", minY: 780, maxY: 900, minX: 850 },
  { id: "reactor", minY: 500, maxY: 780, minX: 300, maxX: 830 }
];

const composites = [];
const animations = {};
for (const [row, spec] of specs.entries()) {
  const selected = components
    .filter((component) => {
      if (component.centerY < spec.minY || component.centerY > spec.maxY) return false;
      if (spec.minX !== undefined && component.centerX < spec.minX) return false;
      if (spec.maxX !== undefined && component.centerX > spec.maxX) return false;
      return true;
    })
    .sort((a, b) => a.centerX - b.centerX)
    .slice(0, columns);

  if (selected.length < 4) {
    throw new Error(`Expected at least 4 frames for ${spec.id}, found ${selected.length}`);
  }

  animations[spec.id] = {
    row,
    frames: {}
  };

  for (const [col, frame] of selected.entries()) {
    const pad = 10;
    const left = Math.max(0, frame.minX - pad);
    const top = Math.max(0, frame.minY - pad);
    const right = Math.min(width - 1, frame.maxX + pad);
    const bottom = Math.min(height - 1, frame.maxY + pad);
    const sourceWidth = right - left + 1;
    const sourceHeight = bottom - top + 1;
    const scale = Math.min(1, 220 / Math.max(sourceWidth, sourceHeight));
    const resizedWidth = Math.round(sourceWidth * scale);
    const resizedHeight = Math.round(sourceHeight * scale);
    const buffer = await image
      .clone()
      .extract({ left, top, width: sourceWidth, height: sourceHeight })
      .resize(resizedWidth, resizedHeight, { fit: "contain" })
      .png()
      .toBuffer();

    composites.push({
      input: buffer,
      left: col * cell + Math.round((cell - resizedWidth) / 2),
      top: row * cell + Math.round((cell - resizedHeight) / 2)
    });
    animations[spec.id].frames[`frame_${col.toString().padStart(2, "0")}`] = {
      col,
      row,
      sourceBounds: { left, top, width: sourceWidth, height: sourceHeight }
    };
  }
}

await sharp({
  create: {
    width: columns * cell,
    height: specs.length * cell,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  }
})
  .composite(composites)
  .png()
  .toFile(output);

await fs.writeFile(
  manifestPath,
  `${JSON.stringify({ src: "/assets/generated/ai/explosion-ai-effects-atlas.png", columns, rows: specs.length, cellWidth: cell, cellHeight: cell, animations }, null, 2)}\n`
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
      if (visited[index] || alphaAt(nx, ny) < 24) continue;
      visited[index] = 1;
      stack.push([nx, ny]);
    }
  }

  const componentWidth = maxX - minX + 1;
  const componentHeight = maxY - minY + 1;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: componentWidth,
    height: componentHeight,
    count,
    centerX: minX + componentWidth / 2,
    centerY: minY + componentHeight / 2
  };
}
