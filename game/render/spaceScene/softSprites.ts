import { Sprite, Texture } from "@/game/render/three/three2d";

export function makeSoftEllipseSprite(color: number, width: number, height: number, alpha: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const { r, g, b } = hexToRgb(color);
    const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
    gradient.addColorStop(0.42, `rgba(${r}, ${g}, ${b}, ${alpha * 0.42})`);
    gradient.addColorStop(0.72, `rgba(${r}, ${g}, ${b}, ${alpha * 0.12})`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  const sprite = new Sprite(Texture.fromCanvas(canvas));
  sprite.anchor.set(0.5);
  sprite.width = width;
  sprite.height = height;
  return sprite;
}

function hexToRgb(color: number) {
  return {
    r: (color >> 16) & 255,
    g: (color >> 8) & 255,
    b: color & 255
  };
}
