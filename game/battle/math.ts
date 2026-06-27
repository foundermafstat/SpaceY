export type Vec = { x: number; y: number };

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function angleDelta(current: number, target: number) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

export function rotateTowards(current: number, target: number, maxDelta: number) {
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

export function getWorldMount(pos: Vec, rotation: number, mount: Vec) {
  return {
    x: pos.x + Math.cos(rotation) * mount.x - Math.sin(rotation) * mount.y,
    y: pos.y + Math.sin(rotation) * mount.x + Math.cos(rotation) * mount.y
  };
}

export function clampToScreenEdge(x: number, y: number, width: number, height: number, padding: number) {
  const centerX = width / 2;
  const centerY = height / 2;
  const dx = x - centerX;
  const dy = y - centerY;
  const safeHalfWidth = width / 2 - padding;
  const safeHalfHeight = height / 2 - padding;
  const scale = Math.min(
    Math.abs(dx) > 0.001 ? safeHalfWidth / Math.abs(dx) : Number.POSITIVE_INFINITY,
    Math.abs(dy) > 0.001 ? safeHalfHeight / Math.abs(dy) : Number.POSITIVE_INFINITY
  );

  return {
    x: centerX + dx * scale,
    y: centerY + dy * scale
  };
}
